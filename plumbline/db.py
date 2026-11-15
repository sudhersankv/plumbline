"""Postgres (Neon) connection pool and schema."""

from __future__ import annotations

from contextlib import contextmanager

from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config

SCHEMA = f"""
create extension if not exists vector;

-- Sources and derived data
create table if not exists documents (
  id text primary key,
  plan text,                      -- null for regulations (shared by every plan)
  kind text not null,             -- regulation | policy | evidence
  title text not null,
  path text not null
);
create table if not exists paragraphs (
  id text primary key,            -- e.g. SUNVALE-POL-02:P3
  doc_id text not null references documents(id) on delete cascade,
  plan text,
  kind text not null,
  idx int not null,
  section text not null default '',
  text text not null,
  text_hash text not null,
  embedding vector({config.EMBEDDING_DIMENSIONS})
);
create index if not exists paragraphs_plan_kind on paragraphs(plan, kind);

-- Operational data
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  workflow text not null,
  plan text,
  status text not null default 'running',   -- running | done | failed
  params jsonb not null default '{{}}',
  summary jsonb not null default '{{}}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists verdicts (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  task text not null,
  item_id text not null,          -- requirement id or audit item id
  label text not null,
  confidence double precision,
  probabilities jsonb,
  severity text,
  paragraph_ids jsonb not null default '[]',
  quote text,
  regulation_quote text,
  reason text,
  explanation text,
  citation_status text not null,  -- verified | needs_review
  citation_notes jsonb not null default '[]',
  setup text not null,            -- which route produced it
  review_status text not null default 'pending',  -- pending | accepted | rejected
  review_label text,
  review_note text,
  reviewed_at timestamptz
);
create index if not exists verdicts_run on verdicts(run_id);
create table if not exists model_calls (
  id bigserial primary key,
  run_id uuid,
  benchmark_id uuid,
  task text not null,
  kind text not null,             -- complete | decide | embed
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd double precision not null default 0,
  latency_ms int not null default 0,
  cached boolean not null default false,
  fallback_from text,
  attempts int not null default 1,
  error text,
  created_at timestamptz not null default now()
);
alter table model_calls add column if not exists setup text;
create index if not exists model_calls_run on model_calls(run_id);
create index if not exists model_calls_bench on model_calls(benchmark_id);
create table if not exists cache (
  key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Config and labels
create table if not exists routes (
  task text primary key,
  route jsonb not null,
  note text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists route_history (
  id bigserial primary key,
  task text not null,
  route jsonb not null,
  changed_at timestamptz not null default now()
);
create table if not exists review_labels (
  id bigserial primary key,
  task text not null,
  plan text,
  item_id text not null,
  label text not null,
  verdict_id bigint,
  source text not null default 'reviewer',
  created_at timestamptz not null default now()
);
create table if not exists benchmarks (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  kind text not null default 'setups',      -- setups | snap_stress
  status text not null default 'running',
  results jsonb not null default '{{}}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
"""

_pool: ConnectionPool | None = None


def _configure(conn):
    register_vector(conn)


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            config.DATABASE_URL,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row, "autocommit": True},
            configure=_configure,
            open=True,
        )
    return _pool


@contextmanager
def conn():
    with pool().connection() as c:
        yield c


def q(sql: str, *args) -> list[dict]:
    with conn() as c:
        cur = c.execute(sql, args)
        return cur.fetchall() if cur.description else []


def one(sql: str, *args) -> dict | None:
    rows = q(sql, *args)
    return rows[0] if rows else None


def migrate() -> None:
    import psycopg

    with psycopg.connect(config.DATABASE_URL, autocommit=True) as c:
        c.execute(SCHEMA)


J = Jsonb  # wrap dicts/lists for jsonb columns
