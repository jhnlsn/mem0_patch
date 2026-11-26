// Exercise the actual Mem0 Qdrant adapter against a disposable Qdrant instance.
// Usage: node scripts/verify-qdrant.mjs /path/to/candidate-plugin
// Requires Qdrant on loopback port 16333. Never point this at live data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.env.NODE_OPTIONS, undefined, "Run without the old preload shim");
assert.ok(process.argv[2], "Provide the candidate plugin directory");
const sdk = path.resolve(process.argv[2], "node_modules/mem0ai/dist/oss");
const esm = await import(pathToFileURL(path.join(sdk, "index.mjs")));
const cjs = createRequire(import.meta.url)(path.join(sdk, "index.js"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error("Qdrant mutation did not become visible");
}

for (const [format, { Qdrant }] of [["esm", esm], ["cjs", cjs]]) {
  const collection = `mem0_query_verification_${format}`;
  const store = new Qdrant({
    url: "http://127.0.0.1:16333",
    collectionName: collection,
    dimension: 3,
  });
  await store.initialize();
  const ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ];
  try {
    await store.insert([[1, 0, 0], [0.8, 0.2, 0], [1, 0, 0]], ids, [
      { user_id: "query-test-a", data: "first" },
      { user_id: "query-test-a", data: "second" },
      { user_id: "query-test-b", data: "other namespace" },
    ]);
    await eventually(async () => (await store.list(undefined, 10))[0].length === 3);

    const results = await store.search([1, 0, 0], 10, { user_id: "query-test-a" });
    assert.deepEqual(results.map((r) => r.id), ids.slice(0, 2));
    assert.equal(results[0].payload.data, "first");
    assert.ok(results[0].score > results[1].score);
    assert.equal((await store.search([1, 0, 0], 1, { user_id: "query-test-a" })).length, 1);
    assert.deepEqual(await store.search([1, 0, 0], 10, { user_id: "absent" }), []);

    await store.update(ids[0], [0, 1, 0], { user_id: "query-test-a", data: "updated" });
    await eventually(async () => (await store.get(ids[0]))?.payload.data === "updated");
    assert.equal((await store.list({ user_id: "query-test-a" }, 10))[0].length, 2);
    await store.delete(ids[0]);
    await eventually(async () => (await store.get(ids[0])) == null);
    console.log(`${format}: insert, query ranking, payloads, namespace filters, limits, update, get, list, delete PASS`);
  } finally {
    await store.deleteCol();
  }
}
