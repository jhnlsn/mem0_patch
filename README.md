# mem0_patch

Agent instructions for keeping the OpenClaw Mem0 plugin (`@mem0/openclaw-mem0`) working with a current Qdrant client.

| Patch | Problem | Fix |
|---|---|---|
| Query API | `mem0ai` calls `QdrantClient.search()`, removed in `@qdrant/js-client-rest` 1.19. Recall and capture fail with `this.client.search is not a function`. Upstream: [mem0ai/mem0#7495](https://github.com/mem0ai/mem0/issues/7495) | Call `query()` instead |
| Recall timer | The recall timeout timer is never cancelled, so it logs "timed out" even after recall succeeds | Clear the timer |

## Use

Give a coding agent this repo and say:

> Follow AGENTS.md to patch my OpenClaw Mem0 plugin.

Run it again after any OpenClaw or plugin update. Tested versions are listed in [SUPPORT.md](SUPPORT.md).
