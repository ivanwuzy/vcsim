import { beforeAll, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { getDb, transaction } from "../lib/db";
import { adminAction, eventMeta, getEvent, publicMeta } from "../lib/service";
import { GET, POST } from "../app/api/[...path]/route";
import { sign } from "../lib/security";

let eventId: string;
beforeAll(async () => {
  process.env.PGLITE_PATH = await mkdtemp(`${tmpdir()}/vc-budget-`);
  process.env.APP_MODE = "demo";
  process.env.SESSION_SECRET = "budget-test-session-secret-at-least-32-characters";
  eventId = (await getEvent()).id;
});
async function measure<T>(task: () => Promise<T>) {
  const db = await getDb(), query = db.query;
  let bytes = 0; const sql: string[] = [];
  db.query = async <R>(statement: string, params?: unknown[]) => {
    const result = await query<R>(statement, params);
    bytes += Buffer.byteLength(JSON.stringify(result.rows)); sql.push(statement); return result;
  };
  try { return { value: await task(), bytes: () => bytes, sql }; }
  finally { db.query = query; }
}
it("keeps 100 metadata polls below 1% of full snapshot reads and preserves metadata", async () => {
  const event = await getEvent(eventId), baseline = Buffer.byteLength(JSON.stringify(event)) * 100;
  const measured = await measure(() => Promise.all(Array.from({ length: 100 }, () => publicMeta())));
  expect(measured.value[0]).toEqual({ ...eventMeta(event), replayEnabled: false });
  expect(measured.bytes()).toBeLessThan(baseline * .01);
  expect(measured.sql).toHaveLength(100);
  expect(measured.sql.every(sql => !sql.includes("SELECT *"))).toBe(true);
  console.log(JSON.stringify({ check: "100 metadata polls", previousBytes: baseline, optimizedBytes: measured.bytes() }));
});
it("reuses snapshots but reads status live and invalidates on direct SQL edits and rollback", async () => {
  const event = await getEvent(eventId);
  const measured = await measure(() => Promise.all(Array.from({ length: 100 }, () => getEvent(eventId))));
  expect(measured.sql.every(sql => !sql.includes("SELECT snapshot FROM"))).toBe(true);
  expect(measured.bytes()).toBeLessThan(Buffer.byteLength(JSON.stringify(event)));
  const db = await getDb(), changed = { ...event.snapshot, version: "budget-test" };
  await db.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify(changed), eventId]);
  expect((await getEvent(eventId)).snapshot.version).toBe("budget-test");
  await expect(transaction(async tx => {
    await tx.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify({ ...changed, version: "rolled-back" }), eventId]);
    expect((await getEvent(eventId, tx, true)).snapshot.version).toBe("rolled-back");
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  expect((await getEvent(eventId)).snapshot.version).toBe("budget-test");
  await db.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify(event.snapshot), eventId]);
  await adminAction(eventId, "close", {}); expect((await getEvent(eventId)).status).toBe("closed");
  await adminAction(eventId, "open", {});
});
function read(path: string, cookie?: string) {
  return GET(new NextRequest(`http://localhost:3000/api/${path}`, { headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ path: path.split("/") }) });
}
it("shares public polling reads while keeping sessions and admin replies private and writes current", async () => {
  const measured = await measure(() => Promise.all(Array.from({ length: 100 }, () => read("meta"))));
  expect(measured.sql).toHaveLength(1);
  expect(measured.value[0].headers.get("cache-control")).toContain("s-maxage=2");
  expect((await read("session")).headers.get("cache-control")).toBe("no-store");
  const cookie = `vc_admin=${sign(`admin:${Date.now() + 60000}`)}`;
  expect((await read("admin/leaderboard", cookie)).headers.get("cache-control")).toBe("no-store");
  expect((await read("admin/leaderboard")).status).toBe(401);
  const response = await POST(new NextRequest(`http://localhost:3000/api/admin?event=${eventId}`, { method: "POST",
    headers: { Cookie: cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ action: "close" }) }), { params: Promise.resolve({ path: ["admin"] }) });
  expect(response.status).toBe(200);
  expect(await (await read("meta")).json()).toBeNull();
});
it("returns uncached JSON errors during database outages and recovers on the next read", async () => {
  const db = await getDb(), query = db.query;
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3000);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  db.query = async () => { throw new Error("quota exceeded"); };
  try {
    const response = await read("meta");
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toHaveProperty("error");
    db.query = query;
    expect((await read("meta")).status).toBe(200);
  } finally { db.query = query; clock.mockRestore(); log.mockRestore(); }
});
it("blocks reads and writes before accessing the database during migration", async () => {
  process.env.MAINTENANCE_MODE = "1";
  const db = await getDb(), query = db.query;
  db.query = async () => { throw new Error("maintenance must not query"); };
  try {
    for (const response of [await read("meta"), await POST(new NextRequest("http://localhost:3000/api/admin/login", { method: "POST" }), { params: Promise.resolve({ path: ["admin", "login"] }) })]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("60");
    }
  } finally { delete process.env.MAINTENANCE_MODE; db.query = query; }
});
