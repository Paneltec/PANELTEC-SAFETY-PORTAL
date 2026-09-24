"""v58.13.132mk — Phase 1 embedding wrapper (stub).

Phase 1 is INFORMATION-LOOKUP ONLY per user brief — sections are
extracted, chunked, and stored in Mongo but `embedding: null` for
every row. Phase 2 will populate this module with a real OpenAI
`text-embedding-3-small` call via the Emergent LLM key.

Kept as a real module (not a bare `pass`) so callers can `import`
from it now and Phase 2 replaces the internals without any callsite
changes.
"""
from __future__ import annotations
from typing import List, Optional


# Dimension of the target model. Phase 2 will actually generate
# vectors of this length; Phase 1 stores `None` on every row.
EMBEDDING_DIM = 1536  # OpenAI text-embedding-3-small


async def embed_section(text: str) -> Optional[List[float]]:
    """Phase 1 stub — always returns None so the ingest writes
    `embedding: null` on every row. Phase 2 replaces this with a
    batched Emergent-LLM-key OpenAI embeddings call."""
    return None


async def embed_batch(texts: List[str]) -> List[Optional[List[float]]]:
    """Phase 1 stub — returns a list of Nones matching input length."""
    return [None] * len(texts)
