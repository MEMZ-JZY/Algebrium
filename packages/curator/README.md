# Algebrium Curator

Curator is the only process allowed to update the knowledge base. The main Algebrium service uses read-only retrieval APIs.

From this directory, run `bun run curator collect` to migrate SQLite, seed the local mathematics corpus, and index it in Qdrant. Other heartbeat commands are `index-refresh`, `cleanup`, `difficulty`, `health`, `graph-rebuild`, and `process-mistakes`.

Set `ALGEBRIUM_KB_PATH`, `QDRANT_URL`, or `QDRANT_COLLECTION` to override local defaults. The development embedder is deterministic and offline; replace it with bge-m3 before production ingestion.
