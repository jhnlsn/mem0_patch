# Patching instructions

You are patching an installed OpenClaw Mem0 plugin. Follow the steps in order.

## Rules

1. Work on a copy. Change the live plugin only in step 6, after the user approves.
2. Apply a patch only when its "before" block matches **exactly once**. If neither the "before" nor the "after" block matches, stop, show the user the current code, and propose an adaptation. Do not force it.
3. Every step must be safe to repeat. Skip patches that are already applied.
4. Never print or commit secrets. `openclaw.json` contains credentials.
5. Do not run `npm install` or `pnpm install` in the plugin directory. It rewrites much more than these patches need, and with `--ignore-scripts` it can remove native modules.
6. Do not delete, recreate, or migrate Qdrant collections.
7. Report what you tested and what you did not.

## Tested combination

Tested on 2026-11-26:

| Component | Version |
|---|---|
| `@mem0/openclaw-mem0` | 1.0.14 |
| `mem0ai` | 3.0.7 |
| `@qdrant/js-client-rest` | 1.20.0 |
| `undici` | 7.29.1 |
| Qdrant server | 1.20.0 |
| Node.js | 26.13.1 |

Covered: both patches applied to a copy, a syntax check of the patched `dist/index.js`, and `scripts/verify-qdrant.mjs` (ESM and CommonJS adapters).

Not covered: loading the patched copy in a running Gateway, end-to-end recall and capture, and the timer's runtime behavior.

## 1. Inspect

```bash
REPO="$(pwd)"   # root of this repository
LIVE="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/extensions/openclaw-mem0"
cd "$LIVE"
for p in . node_modules/mem0ai node_modules/@qdrant/js-client-rest node_modules/undici; do
  node -p "const j=require('./$p/package.json'); j.name+' '+j.version"
done
grep -c 'client.search(this.collectionName' node_modules/mem0ai/dist/oss/index.{mjs,js}
grep -c 'clearTimeout(recallTimer)' dist/index.js
npm view @mem0/openclaw-mem0 version
npm view mem0ai version
npm view @qdrant/js-client-rest version
```

If the plugin is installed elsewhere, ask the user for the path.

- Check [mem0ai/mem0#7495](https://github.com/mem0ai/mem0/issues/7495). If a fix is released **and** the installed `mem0ai` contains it, skip the Query API patch.
- A `search` count of `0` does not alone prove the patch is applied. Compare with the "after" block.
- If versions differ from the tested table, tell the user before continuing.

## 2. Make a working copy

```bash
WORK="$(mktemp -d)"
cp -a "$LIVE" "$WORK/plugin"
```

## 3. Update the Qdrant client

Replace only the client package. Use the version the user wants; `1.20.0` is the tested one.

```bash
VER=1.20.0
cd "$WORK"
npm pack "@qdrant/js-client-rest@$VER" --ignore-scripts
mkdir client && tar -xzf "qdrant-js-client-rest-$VER.tgz" -C client
node -p "require('./client/package/package.json').dependencies"
rm -rf plugin/node_modules/@qdrant/js-client-rest
cp -a client/package plugin/node_modules/@qdrant/js-client-rest
```

Check that every listed dependency resolves from the new client at a satisfying version:

```bash
cd "$WORK/plugin/node_modules/@qdrant/js-client-rest"
node -e "const r=require('module').createRequire(process.cwd()+'/package.json');
for (const [d,want] of Object.entries(require('./package.json').dependencies)) {
  const p=r.resolve.paths(d).map(x=>x+'/'+d+'/package.json').find(require('fs').existsSync);
  console.log(d,'wants',want,'found',p?require(p).version:'MISSING');
}"
```

If a dependency is missing or does not satisfy the range, stop and report it.

Then set every `@qdrant/js-client-rest` version entry in `$WORK/plugin/package.json` and `$WORK/plugin/pnpm-workspace.yaml` to the exact version installed.

## 4. Patch: Query API

Apply to **both** files:

- `node_modules/mem0ai/dist/oss/index.mjs`
- `node_modules/mem0ai/dist/oss/index.js`

Before:

```js
    const results = await this.client.search(this.collectionName, {
      vector: query,
      filter: queryFilter,
      limit: topK
    });
    return results.map((hit) => ({
```

After:

```js
    const response = await this.client.query(this.collectionName, {
      query,
      filter: queryFilter,
      limit: topK,
      with_payload: true
    });
    return response.points.map((hit) => ({
```

`query()` returns `{ points }` and omits payloads unless asked, so all of these changes are required. Do not touch `keywordSearch()` or the other vector stores.

## 5. Patch: recall timer

File: `dist/index.js`, which is what the plugin loads (confirm with `main` in `package.json`).

Before:

```js
        const timeout = new Promise((resolve2) => {
          setTimeout(() => resolve2(void 0), RECALL_TIMEOUT_MS);
        });
        const result = await Promise.race([
          recallWork(),
          timeout.then(() => {
            api.logger.warn(
              `openclaw-mem0: recall timed out after ${RECALL_TIMEOUT_MS}ms, skipping`
            );
            return void 0;
          })
        ]);
        return result;
```

After:

```js
        let recallTimer;
        const timeout = new Promise((resolve2) => {
          recallTimer = setTimeout(() => {
            api.logger.warn(
              `openclaw-mem0: recall timed out after ${RECALL_TIMEOUT_MS}ms, skipping`
            );
            resolve2(void 0);
          }, RECALL_TIMEOUT_MS);
        });
        try {
          return await Promise.race([recallWork(), timeout]);
        } finally {
          clearTimeout(recallTimer);
        }
```

The bundler may rename `resolve2`. Matching that rename is an acceptable adaptation if the logic is otherwise identical. The surrounding `try`/`catch` stays as it is.

## 6. Verify, then install

### Verify the copy

```bash
node --check "$WORK/plugin/dist/index.js"
docker run -d --rm --name mem0-canary -p 127.0.0.1:16333:6333 qdrant/qdrant:v1.20.0
until curl -sf http://127.0.0.1:16333/readyz; do sleep 1; done
env -u NODE_OPTIONS node "$REPO/scripts/verify-qdrant.mjs" "$WORK/plugin"
docker stop mem0-canary
```

Use the image tag matching the live server version. Both `esm` and `cjs` must print `PASS`. If not, stop; leave the live plugin alone.

### Install (ask the user first)

This stops the Gateway briefly. Keep the backup outside the `extensions` directory.

```bash
BACKUP="$HOME/.openclaw-backups/openclaw-mem0-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$(dirname "$BACKUP")"
systemctl --user stop openclaw-gateway.service
mv "$LIVE" "$BACKUP" && cp -a "$WORK/plugin" "$LIVE"
systemctl --user start openclaw-gateway.service
```

### Verify live

```bash
openclaw mem0 search "preferences"
journalctl --user -u openclaw-gateway.service --since '10 min ago' | grep -i mem0
```

- The search returns without error.
- After a real agent turn, the log shows memory injection and capture, with no `client.search is not a function`, `recall failed`, or `capture failed`.
- A successful injection is not followed about 8 seconds later by a stray timeout warning from the same turn. Genuine timeouts can still occur.
- With the user's approval, add a uniquely marked test memory, find it, and delete only that ID (see `openclaw mem0 add --help` and `openclaw mem0 delete --help`).

### Roll back

```bash
systemctl --user stop openclaw-gateway.service
mv "$LIVE" "$LIVE.failed" && mv "$BACKUP" "$LIVE"
mv "$LIVE.failed" "$WORK/failed"
systemctl --user start openclaw-gateway.service
```

## Upgrading other components

These are **untested**. Get approval, and back up Qdrant data (a collection snapshot or a copy of its stopped storage volume) before going live.

- **Plugin or `mem0ai`:** build the new versions in the working copy, then run steps 4 to 6 against it. A plugin release may pin an older `mem0ai`; overriding it is unsupported by that release. `mem0ai` 3.3.1 still calls `client.search()` for Qdrant dense search. The verify script covers only the Qdrant adapter, not other API changes.
- **Qdrant server:** read the release notes, test with the matching image in step 6, and pin an explicit tag instead of `latest`.

## Report

Finish with: versions before and after, which patches were applied or skipped, test results, the backup path, and anything left unverified.
