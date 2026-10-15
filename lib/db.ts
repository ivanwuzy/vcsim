import { PGlite } from "@electric-sql/pglite";
import { Pool, type PoolClient } from "pg";
import { mkdir } from "node:fs/promises";
import { postgresOptions } from "./postgres";

export type DB = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };
type State = { db?: DB; local?: PGlite; pool?: Pool; ready?: Promise<void>; schemaReady?: Promise<void>; schemaVersion?: string; queue: Promise<void> };
const globalDb = globalThis as typeof globalThis & { vcDb?: State };
const state = globalDb.vcDb ??= { queue: Promise.resolve() };
export const databaseSchema = `
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
CREATE INDEX IF NOT EXISTS players_token_hash ON players(token_hash);
CREATE TABLE IF NOT EXISTS game_settings (
 id INTEGER PRIMARY KEY CHECK (id=1), content_version TEXT NOT NULL, projects JSONB NOT NULL
);
ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS replay_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS snapshot_revision TEXT NOT NULL DEFAULT '';
-- Change the cache key in Postgres, including imports, migrations and direct SQL edits.
CREATE OR REPLACE FUNCTION vc_snapshot_revision() RETURNS TRIGGER AS $$
BEGIN
 NEW.snapshot_revision := md5(NEW.snapshot::text);
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER vc_snapshot_revision BEFORE INSERT OR UPDATE OF snapshot ON events
 FOR EACH ROW EXECUTE FUNCTION vc_snapshot_revision();
UPDATE events SET snapshot_revision=md5(snapshot::text) WHERE snapshot_revision='';
-- Older versions allowed multiple open events. Preserve their data and stop all but one.
UPDATE events SET status='closed' WHERE status='open' AND id <> (
 SELECT id FROM events WHERE status='open' ORDER BY created_at DESC, id DESC LIMIT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS events_single_open ON events(status) WHERE status='open';
`;
async function init() {
  if (process.env.DATABASE_URL) {
    state.pool = new Pool({ ...postgresOptions(process.env.DATABASE_URL, process.env.DATABASE_SSL_CA), max: 4, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000, maxLifetimeSeconds: 300, application_name: "vc-simulator" });
    state.pool.on("error", error => console.error("Idle database connection error", error.message));
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
  if (state.schemaVersion !== "2026.10-neon-budget") { state.schemaReady = undefined; state.schemaVersion = "2026.10-neon-budget"; }
  state.schemaReady ??= (async () => { if (state.local) await state.local.exec(databaseSchema); else await state.pool!.query(databaseSchema); })();
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
