# Patching instructions

You are updating an installed OpenClaw Mem0 plugin to current versions and patching it. Follow the steps in order, in one Bash shell.

## Rules

1. Build in a new directory. Change the live setup only in steps 7 and 8, after the user approves.
2. Apply a patch only when its "before" block matches **exactly once**. If neither the "before" nor the "after" block matches, stop, show the user the current code, and propose an adaptation. Do not force it.
3. Skip patches that are already applied.
4. Never print or commit secrets. `openclaw.json` contains credentials.
5. Do not run `npm install` or `pnpm install` in the live plugin directory.
6. Do not delete, recreate, or migrate live Qdrant collections.
7. Report what you tested and what you did not.

See [SUPPORT.md](SUPPORT.md) for tested combinations. Tell the user before using any other.

## 1. Inspect

```bash
REPO="$(pwd)"   # root of this repository
STATE="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
LIVE="$STATE/extensions/openclaw-mem0"
for p in . node_modules/mem0ai node_modules/@qdrant/js-client-rest; do
  node -p "const j=require('$LIVE/$p/package.json'); j.name+' '+j.version"
done
grep -c 'client.search(this.collectionName' "$LIVE"/node_modules/mem0ai/dist/oss/index.{mjs,js} || true
grep -c 'clearTimeout(recallTimer)' "$LIVE/dist/index.js" || true
jq -r '.plugins.entries["openclaw-mem0"].config.oss | "embedder=\(.embedder.provider) llm=\(.llm.provider) store=\(.vectorStore.provider)"' "$STATE/openclaw.json"
for p in @mem0/openclaw-mem0 mem0ai @qdrant/js-client-rest; do echo "$p $(npm view $p version)"; done
```

If the plugin is installed elsewhere, ask the user for the path. These steps cover open-source mode with a Qdrant store.

Check [mem0ai/mem0#7495](https://github.com/mem0ai/mem0/issues/7495). If a fix is released and in the `mem0ai` version you will install, skip the query patch.

## 2. Download the plugin

```bash
PLUGIN_VER=1.2.1
MEM0_VER=3.3.1
CLIENT_VER=1.20.0
WORK="$(mktemp -d "$HOME/mem0-build.XXXXXX")"
cd "$WORK"
npm pack "@mem0/openclaw-mem0@$PLUGIN_VER" --ignore-scripts --silent
tar -xzf ./*.tgz && mv package candidate
```

## 3. Set dependency versions

```bash
cd "$WORK/candidate"
jq --arg m "$MEM0_VER" --arg c "$CLIENT_VER" '
  .dependencies.mem0ai=$m | .dependencies["@qdrant/js-client-rest"]=$c
  | .overrides={"mem0ai":$m,"@qdrant/js-client-rest":$c}
  | del(.devDependencies,.pnpm)' package.json > package.json.new && mv package.json.new package.json
```

`mem0ai` loads some provider libraries only when used, and does not install them for you. For the Ollama embedder:

```bash
RANGE="$(jq -r .peerDependencies.ollama <(npm view "mem0ai@$MEM0_VER" --json))"
OLLAMA_VER="$(npm view "ollama@$RANGE" version --json | jq -r 'if type=="array" then last else . end')"
jq --arg o "$OLLAMA_VER" '.dependencies.ollama=$o' package.json > package.json.new && mv package.json.new package.json
```

For other providers, check `peerDependencies` of `mem0ai` and add what the configured provider needs.

## 4. Install in the build directory

```bash
cd "$WORK/candidate"
npm install --omit=dev --no-audit --no-fund
node -e "const D=require('better-sqlite3'); new D(':memory:').close(); console.log('sqlite ok')"
```

npm may warn that `better-sqlite3` has an install script awaiting approval. The check must print `sqlite ok`; if it does not, show the user the warning and ask before approving the script.

## 5. Patch: query API

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

## 6. Patch: recall timer

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

The bundler may rename `resolve2`. Matching that rename is acceptable if the logic is otherwise identical. The surrounding `try`/`catch` stays as it is.

## 7. Verify the build

Set `SERVER_TAG` to the Qdrant server version that will be live after this run.

```bash
SERVER_TAG=v1.20.2
node --check "$WORK/candidate/dist/index.js"
wait_q() { for i in $(seq 90); do curl -sf -m 3 "http://127.0.0.1:$1/readyz" >/dev/null && return 0; sleep 1; done; return 1; }
docker run -d --rm --name mem0-canary -p 127.0.0.1:16333:6333 "qdrant/qdrant:$SERVER_TAG"
wait_q 16333 && env -u NODE_OPTIONS node "$REPO/scripts/verify-qdrant.mjs" "$WORK/candidate"
docker stop mem0-canary
```

Both `esm` and `cjs` must print `PASS`.

Then test on a **copy** of the data. Ask the user first: this briefly stops the Gateway and Qdrant, and calls their LLM and embedder.

```bash
QDRANT=mem0-qdrant   # confirm with: docker ps
STORAGE="$(docker inspect "$QDRANT" | jq -r '.[0].Mounts[]|select(.Destination=="/qdrant/storage").Source')"
BACKUP="$HOME/.openclaw-backups/mem0-$(date +%Y%m%d-%H%M%S)"
mkdir -p -m 700 "$BACKUP" "$BACKUP/canary-storage"
systemctl --user stop openclaw-gateway.service
docker stop -t 60 "$QDRANT"
docker run --rm -v "$STORAGE:/src:ro" -v "$BACKUP:/dst" --entrypoint sh "qdrant/qdrant:$SERVER_TAG" -c "tar -czf /dst/storage.tgz -C /src . && chown $(id -u):$(id -g) /dst/storage.tgz && chmod 600 /dst/storage.tgz"
docker start "$QDRANT"
systemctl --user start openclaw-gateway.service
tar -tzf "$BACKUP/storage.tgz" >/dev/null && echo "backup readable"
docker run --rm -v "$BACKUP:/b" --entrypoint sh "qdrant/qdrant:$SERVER_TAG" -c 'tar -xzf /b/storage.tgz -C /b/canary-storage'
docker run -d --rm --name mem0-canary -p 127.0.0.1:16333:6333 -v "$BACKUP/canary-storage:/qdrant/storage" "qdrant/qdrant:$SERVER_TAG"
wait_q 16333 && node "$REPO/scripts/e2e-copy.mjs" "$WORK/candidate"
docker stop mem0-canary
```

If `openclaw.json` refers to environment variables, export them first without printing them. If any check fails, stop and leave the live setup alone.

## 8. Install (ask the user first)

### Qdrant server, only if it is changing

Take a fresh backup as above while Qdrant is stopped. Read `docker inspect "$QDRANT"` and recreate the container with the **same** mounts, ports, restart policy, networks and custom environment, changing only the image to `qdrant/qdrant:$SERVER_TAG`. Rename the old container instead of removing it, and set its restart policy to `no`. Compare exact point counts for every collection before and after. To roll back, restore the storage backup **and** start the old container.

### Plugin

Keep the old copy outside the `extensions` directory.

```bash
systemctl --user stop openclaw-gateway.service
mv "$LIVE" "$BACKUP/plugin-old" && cp -a "$WORK/candidate" "$LIVE" \
  || { rm -rf "$LIVE"; mv "$BACKUP/plugin-old" "$LIVE"; echo "install failed, restored"; }
systemctl --user start openclaw-gateway.service
```

### Verify live

```bash
openclaw mem0 status
openclaw mem0 search "preferences"
journalctl --user -u openclaw-gateway.service --since '10 min ago' | grep -i mem0
```

- Status connects and the search returns without error.
- After a real chat turn, the log shows memory injection and capture, with no `client.search is not a function`, `recall failed`, `capture failed`, or `package is required`.
- A successful injection is not followed about 8 seconds later by a stray timeout warning from the same turn. Genuine timeouts can still occur.

### Roll back the plugin

```bash
systemctl --user stop openclaw-gateway.service
mv "$LIVE" "$BACKUP/plugin-failed" && mv "$BACKUP/plugin-old" "$LIVE"
systemctl --user start openclaw-gateway.service
```

## Report

Finish with: versions before and after, which patches were applied or skipped, test results, the backup path, and anything left unverified. Add the result to [SUPPORT.md](SUPPORT.md).
