// End-to-end check against a COPY of your Qdrant data on port 16333.
// Usage: node scripts/e2e-copy.mjs /path/to/candidate-plugin
// Uses your configured LLM and embedder (may incur API cost). Export any
// variables that openclaw.json references before running.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const dir = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw"), "openclaw.json"))).plugins.entries["openclaw-mem0"].config;
const oss = structuredClone(cfg.oss);
const sub = (v) => typeof v === "string" ? v.replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] ?? "") : v;
for (const part of [oss.llm, oss.embedder]) for (const k in part.config) part.config[k] = sub(part.config[k]);
oss.vectorStore.config.url = "http://127.0.0.1:16333";
const { Memory } = await import(pathToFileURL(path.join(dir, "node_modules/mem0ai/dist/oss/index.mjs")));
const mem = new Memory({ version: "v1.1", ...oss, customInstructions: cfg.customInstructions, historyDbPath: path.join(path.dirname(dir), "canary-history.db") });
const filters = { user_id: cfg.userId };
const all = await mem.getAll({ filters, topK: 1000 }); console.log("getAll:", all.results.length);
const s = await mem.search("preferences", { filters, topK: 5 }); console.log("search existing:", s.results.length); assert.ok(s.results.length);
const user = "canary-e2e";
const added = await mem.add([{ role: "user", content: "My favorite canary test fruit is the kumquat. Please remember that." }], { userId: user });
console.log("add:", added.results.length); assert.ok(added.results.length, "nothing extracted");
const found = await mem.search("favorite fruit", { filters: { user_id: user }, topK: 5 }); assert.match(JSON.stringify(found.results), /kumquat/i); console.log("search new: PASS");
const id = added.results[0].id; assert.ok(await mem.get(id));
await mem.update(id, "Favorite canary test fruit is the persimmon."); assert.match((await mem.get(id)).memory, /persimmon/); console.log("get/update: PASS");
console.log("history entries:", (await mem.history(id)).length);
for (const r of added.results) await mem.delete(r.id);
assert.equal((await mem.getAll({ filters: { user_id: user } })).results.length, 0); console.log("delete: PASS");
process.exit(0);
