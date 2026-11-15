"""Settings, paths and model prices. Everything comes from .env."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
load_dotenv(ROOT / ".env", override=True)  # this project's .env wins over stray system variables


def env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        raise RuntimeError(f"Missing setting {name}. Copy .env.example to .env and fill it in.")
    return v.strip().strip('"')


DATABASE_URL = env("DATABASE_URL")
NEON_BASE = env("NEON_AI_GATEWAY_BASE_URL").rstrip("/")
NEON_TOKEN = env("NEON_AI_GATEWAY_TOKEN")
SUBQ_BASE = env("SUBQ_BASE_URL", "https://api.subq.ai/v1").rstrip("/")
SUBQ_KEY = env("SUBQ_API_KEY")

STRONG_MODEL = env("STRONG_MODEL", "claude-opus-5-5")
CHEAP_MODEL = env("CHEAP_MODEL", "claude-haiku-5-5")
FALLBACK_MODEL = env("FALLBACK_MODEL", "claude-sonnet-5-5")
EMBEDDING_MODEL = env("EMBEDDING_MODEL", "qwen3-embedding-0-6b")
EMBEDDING_DIMENSIONS = int(env("EMBEDDING_DIMENSIONS", "1024"))
SNAP_MODEL = env("SUBQ_DECISION_MODEL", "subq-snap-1.2")
SAVANT_MODEL = env("SUBQ_LONG_CONTEXT_MODEL", "subq-savant-1.4")

# USD per 1M tokens: (input, output, cache_read, cache_write).
# Claude prices are the Neon AI Gateway's, from models.dev (provider "neon"), 2026-11-14.
# SubQ prices are from docs.subq.ai. Embeddings are priced at 0 (not listed); they are a rounding error here.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-opus-5-5": (4.0, 20.0, 0.2, 5.0),
    "claude-sonnet-5-5": (2.0, 10.0, 0.2, 2.5),
    "claude-haiku-5-5": (0.1, 0.5, 0.01, 0.125),
    SNAP_MODEL: (float(env("SUBQ_SNAP_INPUT_PER_MTOK", "0.04")), 0.0, 0.0, 0.0),
    SAVANT_MODEL: (
        float(env("SUBQ_SAVANT_INPUT_PER_MTOK", "0.10")),
        float(env("SUBQ_SAVANT_OUTPUT_PER_MTOK", "0.50")),
        0.01,
        0.0,
    ),
}


def cost_usd(model: str, input_tokens: int, output_tokens: int, cache_read: int = 0, cache_write: int = 0) -> float:
    p = PRICES.get(model)
    if not p:
        return 0.0
    return (input_tokens * p[0] + output_tokens * p[1] + cache_read * p[2] + cache_write * p[3]) / 1_000_000
