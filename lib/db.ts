import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { mkdir } from "node:fs/promises";

export type DB = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
type State = { db?: DB; local?: PGlite; pool?: Pool; ready?: Promise<void>; schemaReady?: Promise<void>; queue: Promise<void> };
const globalDb = globalThis as typeof globalThis & { vcDb?: State };
const state = globalDb.vcDb ??= { queue: Promise.resolve() };
const schema = `
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL,
 snapshot JSONB NOT NULL, settings JSONB NOT NULL, frozen_rows JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), frozen_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS players (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), name TEXT NOT NULL,
 institution TEXT NOT NULL, identity_key TEXT NOT NULL, token_hash TEXT NOT NULL,
 recovery_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(event_id, identity_key)
);
CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL UNIQUE REFERENCES players(id), event_id TEXT NOT NULL REFERENCES events(id),
 deck_id TEXT NOT NULL, decisions JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'playing',
 profit BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS draws (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), request_key TEXT NOT NULL,
 kind TEXT NOT NULL, candidates JSONB NOT NULL, winners JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(event_id, request_key)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id TEXT PRIMARY KEY, event_id TEXT, action TEXT NOT NULL, detail JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rate_limits (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_event_status ON runs(event_id, status);
CREATE TABLE IF NOT EXISTS game_settings (
 id INTEGER PRIMARY KEY CHECK (id=1), content_version TEXT NOT NULL, projects JSONB NOT NULL
);
-- Older versions allowed multiple open events. Preserve their data and stop all but one.
UPDATE events SET status='closed' WHERE status='open' AND id <> (
 SELECT id FROM events WHERE status='open' ORDER BY created_at DESC, id DESC LIMIT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS events_single_open ON events(status) WHERE status='open';
`;
async function init() {
  if (process.env.DATABASE_URL) {
    state.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
    state.db = { query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await state.pool!.query(sql, params)).rows as T[] }) };
  } else {
    if (process.env.APP_MODE === "formal" && process.env.NODE_ENV === "production") throw new Error("正式生产环境必须配置 DATABASE_URL。 ");
    await mkdir(".data", { recursive: true }); state.local = new PGlite(process.env.PGLITE_PATH || ".data/postgres");
    state.db = { query: async <T>(sql: string, params: unknown[] = []) => ({ rows: (await state.local!.query<T>(sql, params)).rows }) };
  }
}
export async function getDb(): Promise<DB> {
  state.ready ??= init(); await state.ready;
  // Hot reload can retain a connection initialized by the previous version.
  state.schemaReady ??= (async () => { if (state.local) await state.local.exec(schema); else await state.pool!.query(schema); })();
  try { await state.schemaReady; }
  catch (error) { state.schemaReady = undefined; throw error; }
  return state.db!;
}
// Local embedded Postgres has one connection; protect complete transactions.
// Real Postgres uses a dedicated client plus row locks for cross-process correctness.
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  await getDb();
  if (state.pool) {
    const client: PoolClient = await state.pool.connect();
    try { await client.query("BEGIN"); const value = await fn({ query: async <R>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as R[] }) }); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  const previous = state.queue; let release!: () => void; state.queue = new Promise(resolve => { release = resolve; });
  await previous;
  try { return await state.local!.transaction(tx => fn({ query: async <R>(sql: string, params: unknown[] = []) => ({ rows: (await tx.query<R>(sql, params)).rows }) })); }
  finally { release(); }
}
