# Supportability matrix

What has been run together, and how far it was tested. Last updated 2026-11-26.

**Current target:** the latest `mem0ai` and the latest Qdrant, with the patches in [AGENTS.md](AGENTS.md).

## Status values

| Status | Meaning |
|---|---|
| **Live** | Installed and exercised on a running Gateway. See the coverage table for which operations. |
| **Copy** | Tested only on a copy of the plugin, with a throwaway or copied Qdrant. |
| **Broken** | Fails, as observed or reported. |

A status describes our testing. It is not a support statement from Mem0, Qdrant, or OpenClaw.

## Combinations

| # | Plugin | `mem0ai` | Qdrant client | Qdrant server | Patches | Declared by plugin | Status |
|---|---|---|---|---|---|---|---|
| 1 | 1.2.1 | 3.3.1 | 1.20.0 | 1.20.2 | query, timer | No (`mem0ai` 3.0.7) | **Live** (current) |
| 2 | 1.2.1 | 3.3.1 | 1.20.0 | 1.20.0 | query, timer | No (`mem0ai` 3.0.7) | **Live** |
| 3 | 1.0.14 | 3.0.7 | 1.20.0 | 1.20.0 | query, timer | `mem0ai` yes | **Copy** |
| 4 | 1.0.14 | 3.0.7 | 1.18.0 | 1.20.0 | none | `mem0ai` yes | **Live**, with the timer bug |
| 5 | 1.0.14 | 3.0.7 | 1.20.0 | 1.20.0 | none | `mem0ai` yes | **Broken**: `client.search is not a function` |
| 6 | 1.2.1 | 3.0.7 | 1.19 or later | any | none | `mem0ai` yes | **Broken**, reported in [mem0ai/mem0#7542](https://github.com/mem0ai/mem0/issues/7542) |
| 7 | 1.2.1 | 3.3.1 | 1.20.0 | any | none | No | **Broken**: dense search still calls `client.search()` |

Row 7 comes from reading the code ([mem0ai/mem0#7495](https://github.com/mem0ai/mem0/issues/7495)), not from running it.

Combinations not listed are untested.

Environment for rows 1 to 5: OpenClaw 2026.11.10, Node.js 26.13.1, open-source mode, Ollama embedder, OpenAI-compatible LLM.

## Extra requirements

| `mem0ai` | Requirement |
|---|---|
| 3.3.1 | With the Ollama embedder, add `ollama` (tested: 0.5.18, range `^0.5.14`). Without it, search and add fail. |

## Coverage for the current target (rows 1 and 2)

| Check | Server 1.20.0 | Server 1.20.2 |
|---|---|---|
| Qdrant adapter test, ESM and CommonJS | Passed | Passed (before `ollama` was added; the adapter does not use it) |
| Search, add, get, update, delete on a copy of real data | Passed | Passed |
| Live: plugin loads, search returns memories | Passed | Passed |
| Live: record counts unchanged by the upgrade | Passed | Passed |
| Live: automatic recall and capture during a chat | Not tested | Not tested |
| Delete-all, filtered search | Not tested | Not tested |
| Timer fix runtime behavior | Not tested | Not tested |

## Known limitations

- Collections created before hybrid search have no `bm25` slot. `mem0ai` 3.3.1 then uses semantic search only. Hybrid search on a new collection is untested.
- Plugin 1.2.1 no longer includes the "dream" feature found in 1.0.14.
- A plugin update or reinstall can undo the patches and added packages.

## Updating this file

Add a row for each new combination. Mark only what was actually run, and say when a result comes from code reading or an upstream report.
