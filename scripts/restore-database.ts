import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { databaseSchema } from "../lib/db";
import { postgresOptions } from "../lib/postgres";

type Table = { name: string; columns: { column_name: string; udt_name: string }[]; rows: string[]; sha256: string };
type Backup = { format: string; tables: Table[] };
const names = ["events", "players", "runs", "draws", "audit_log", "rate_limits", "game_settings"];
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const digest = (rows: string[]) => createHash("sha256").update(rows.join("\n")).digest("hex");

// Keep row JSON as text: JavaScript numbers/dates would lose BIGINT or microseconds.
export function validateBackup(backup: Backup) {
  if (backup.format !== "vc-postgres-jsonb-v1" || backup.tables.map(t => t.name).join() !== names.join()) throw new Error("Unsupported backup/table set");
  for (const table of backup.tables) {
    if (digest(table.rows) !== table.sha256) throw new Error(`Backup checksum mismatch: ${table.name}`);
    if (!table.columns.length || new Set(table.columns.map(c => c.column_name)).size !== table.columns.length) throw new Error(`Invalid columns: ${table.name}`);
  }
}
export async function verifyBackup(db: Pick<Client, "query">, backup: Backup) {
  validateBackup(backup);
  const results = [];
  for (const table of backup.tables) {
    const columns = (await db.query<{ column_name: string; udt_name: string }>("SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table.name])).rows;
    for (const col of table.columns) if (!columns.some(c => c.column_name === col.column_name && c.udt_name === col.udt_name)) throw new Error(`Column/type mismatch: ${table.name}.${col.column_name}`);
    const extra = columns.filter(c => !table.columns.some(s => s.column_name === c.column_name)).map(c => c.column_name);
    const order = table.name === "rate_limits" ? "bucket" : "id";
    const rows = (await db.query<{ row: string }>(`SELECT (to_jsonb(t)-$1::text[])::text AS row FROM public.${quote(table.name)} t ORDER BY ${quote(order)}`, [extra])).rows.map(r => r.row);
    const sha256 = digest(rows);
    if (rows.length !== table.rows.length || sha256 !== table.sha256) throw new Error(`Restored data mismatch: ${table.name}`);
    results.push({ name: table.name, count: rows.length, sha256 });
  }
  return results;
}
export async function restoreBackup(db: Pick<Client, "query">, backup: Backup) {
  validateBackup(backup);
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='120s'");
    const existing = (await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    if (existing.some(t => !names.includes(t.tablename))) throw new Error("Target has unrelated public tables; refusing to change it");
    await db.query(databaseSchema);
    await db.query(`LOCK TABLE ${names.map(n => `public.${quote(n)}`).join(",")} IN ACCESS EXCLUSIVE MODE`);
    for (const name of names) if ((await db.query(`SELECT 1 FROM public.${quote(name)} LIMIT 1`)).rows.length) throw new Error(`Target is not empty: ${name}`);
    for (const table of backup.tables) {
      const columns = table.columns.map(c => quote(c.column_name)).join(",");
      for (const row of table.rows) await db.query(`INSERT INTO public.${quote(table.name)} (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::public.${quote(table.name)},$1::jsonb)`, [row]);
      // Application data is accessed only through the trusted PostgreSQL backend.
      await db.query(`ALTER TABLE public.${quote(table.name)} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.${quote(table.name)} FROM PUBLIC,anon,authenticated`);
    }
    await db.query("REVOKE ALL ON FUNCTION public.vc_snapshot_revision() FROM PUBLIC,anon,authenticated");
    const tables = await verifyBackup(db, backup);
    await db.query("COMMIT");
    return tables;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

async function main() {
  const [mode, backupPath, urlPath, reportPath] = process.argv.slice(2);
  if (!["restore", "verify"].includes(mode) || !backupPath || !urlPath || !reportPath) throw new Error("Usage: tsx scripts/restore-database.ts restore|verify BACKUP URL_FILE REPORT");
  const backup = JSON.parse(await readFile(backupPath, "utf8")) as Backup;
  validateBackup(backup);
  const connectionString = (await readFile(urlPath, "utf8")).trim();
  const ca = process.env.DATABASE_SSL_CA_FILE ? await readFile(process.env.DATABASE_SSL_CA_FILE, "utf8") : process.env.DATABASE_SSL_CA;
  const db = new Client({ ...postgresOptions(connectionString, ca), connectionTimeoutMillis: 15000, application_name: "vc-migration" });
  try {
    await db.connect();
    await db.query("SET TIME ZONE 'UTC'");
    const server = (await db.query("SELECT current_database() AS database, current_setting('server_version') AS version")).rows[0];
    const tables = mode === "restore" ? await restoreBackup(db, backup) : await verifyBackup(db, backup);
    const report = { mode, verifiedAt: new Date().toISOString(), server, tables };
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally { await db.end(); }
}
if (process.argv[1]?.endsWith("restore-database.ts")) main().catch(error => { console.error(error.message); process.exitCode = 1; });
