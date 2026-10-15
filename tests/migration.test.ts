import { beforeAll, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PROJECTS } from "../data/projects";
import { getDb } from "../lib/db";
import { generateSnapshot, CONTENT_VERSION } from "../lib/engine";
import { adminAction, adminState, ensureSeed, getEvent } from "../lib/service";

beforeAll(async () => { process.env.PGLITE_PATH = await mkdtemp(`${tmpdir()}/vc-migration-`); });

it("keeps a shorter legacy bank accessible while upgrading compatible activities", async () => {
  const db = await getDb();
  const current = generateSnapshot(PROJECTS.map(p => ({ ...p, alias: `旧版${p.alias}` })), "migration-test");
  const legacy = { ...current, version: "legacy-24", projects: PROJECTS.slice(0, 24), rules: { initial: 24_000_000, ticket: 1_000_000, total: 24, maxInvestments: 24, settlementYear: 2031 } };
  await db.query("INSERT INTO game_settings(id,content_version,projects) VALUES(1,$1,$2)", ["previous-version", JSON.stringify(PROJECTS)]);
  for (const [id, snapshot] of [["legacy", legacy], ["compatible", { ...current, version: "previous-50" }]] as const) {
    await db.query("INSERT INTO events(id,title,status,mode,snapshot,settings) VALUES($1,$1,'draft','demo',$2,$3)", [id, JSON.stringify(snapshot), JSON.stringify({ topCount: 3, luckyCount: 5 })]);
  }
  await db.query("INSERT INTO events(id,title,status,mode,snapshot,settings) VALUES('played','已参赛旧活动','closed','demo',$1,$2)", [JSON.stringify(current), JSON.stringify({ topCount: 3, luckyCount: 5 })]);
  await db.query("INSERT INTO players(id,event_id,name,institution,identity_key,token_hash) VALUES('player','played','旧玩家','旧机构','old','oldhash')");
  await db.query("INSERT INTO runs(id,player_id,event_id,deck_id) VALUES('run','player','played','timeline-1')");
  await ensureSeed();
  expect((await getEvent("legacy")).snapshot).toEqual(legacy);
  expect((await getEvent("compatible")).snapshot.version).toBe(CONTENT_VERSION);
  expect((await adminState("legacy")).events).toHaveLength(3);
  expect((await getEvent("compatible")).snapshot.projects).toEqual(PROJECTS);
  expect((await getEvent("played")).snapshot).toEqual(current);
  const created = await adminAction(undefined, "create", { title: "本地新测试", mode: "demo" }) as { eventId: string };
  expect((await getEvent(created.eventId)).snapshot.projects).toHaveLength(50);
});
