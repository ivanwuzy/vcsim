import { PGlite } from "@electric-sql/pglite";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { databaseSchema } from "../lib/db";
import { restoreBackup, verifyBackup } from "../scripts/restore-database";

it("restores microsecond timestamps and large integers exactly, protects private tables and rejects overwrite", async () => {
  const source = new PGlite(), target = new PGlite();
  try {
    await source.exec(databaseSchema);
    await source.exec(`SET TIME ZONE 'UTC';
      INSERT INTO events(id,title,status,mode,snapshot,settings,created_at) VALUES('event','migration','open','demo','{}','{}','2026-10-15T13:41:52.123456Z');
      INSERT INTO players(id,event_id,name,institution,identity_key,token_hash,recovery_hash) VALUES('player','event','测试','测试','identity','hash','recovery');
      INSERT INTO runs(id,player_id,event_id,deck_id,status,profit) VALUES('run','player','event','deck','completed',9007199254740993);
      INSERT INTO rate_limits VALUES('bucket',1,9007199254740995);`);
    const tables = [];
    for (const name of ["events", "players", "runs", "draws", "audit_log", "rate_limits", "game_settings"]) {
      const columns = (await source.query<{ column_name: string; udt_name: string }>("SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [name])).rows;
      const rows = (await source.query<{ row: string }>(`SELECT to_jsonb(t)::text AS row FROM ${name} t ORDER BY ${name === 'rate_limits' ? 'bucket' : 'id'}`)).rows.map(r => r.row);
      tables.push({ name, columns, rows, sha256: createHash("sha256").update(rows.join("\n")).digest("hex") });
    }
    const backup = { format: "vc-postgres-jsonb-v1", tables };
    await target.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    const db = { query: async (sql: string, params?: unknown[]) => {
      if (!params && sql.includes(";")) { await target.exec(sql); return { rows: [] }; }
      return target.query(sql, params);
    } } as unknown as Pick<Client, "query">;
    expect((await restoreBackup(db, backup)).find(t => t.name === "runs")?.count).toBe(1);
    expect(await verifyBackup(db, backup)).toHaveLength(7);
    const values = (await target.query<{ profit: string; created_at: string }>("SELECT profit::text, e.created_at::text FROM runs JOIN events e ON e.id=runs.event_id")).rows[0];
    expect(values.profit).toBe("9007199254740993");
    expect(values.created_at).toContain(".123456");
    expect((await target.query<{ allowed: boolean }>("SELECT has_table_privilege('anon','players','SELECT') AS allowed")).rows[0].allowed).toBe(false);
    await expect(restoreBackup(db, backup)).rejects.toThrow("Target is not empty");
    expect(await verifyBackup(db, backup)).toHaveLength(7);
    const damaged = structuredClone(backup); damaged.tables[0].rows[0] += " ";
    await expect(restoreBackup(db, damaged)).rejects.toThrow("checksum mismatch");
  } finally { await source.close(); await target.close(); }
});
