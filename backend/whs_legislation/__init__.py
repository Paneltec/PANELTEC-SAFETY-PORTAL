"""v58.13.132mk — Tasmanian WHS Legislation ingestion module.

Phase 1: read-only reference lookup. Fetches Tasmanian WHS Act 2012,
WHS Regulations 2022, and WorkSafe-adopted Codes of Practice, extracts
sections, writes to Mongo `whs_legislation` collection.

Phase 2 (future): embeddings + semantic search + Ask Intelligence chat.
Phase 3 (future): mauve-themed web UI.

The `embedding: float[]` field on each row is intentionally left `null`
in Phase 1 so Phase 2 can backfill without a schema migration.
"""
