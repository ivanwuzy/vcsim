import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { adminAction, adminState, getEvent, lotteryState, register, startRun } from "../lib/service";
import { getDb } from "../lib/db";
import type { LuckyDraw } from "../lib/lottery";

beforeAll(async () => {
  process.env.PGLITE_PATH = await mkdtemp(`${tmpdir()}/vc-lottery-test-`);
  process.env.APP_MODE = "demo";
});

async function fixture() {
  const { eventId } = await adminAction(undefined, "create", { title: "幸运观众测试", mode: "demo" }) as { eventId: string };
  await adminAction(eventId, "open", {});
  for (let i = 0; i < 8; i++) {
    const { token } = await register(eventId, `观众${i}`, `机构${i}`);
    await startRun(eventId, token);
  }
  const db = await getDb();
  await db.query("UPDATE runs SET status='completed',profit=0,completed_at=NOW() WHERE event_id=$1", [eventId]);
  const unfinished = await register(eventId, "未结算观众", "机构");
  await startRun(eventId, unfinished.token);
  await adminAction(eventId, "close", {});
  await adminAction(eventId, "freeze", {});
  return eventId;
}
const draw = (eventId: string, options: Record<string, unknown> = {}) => adminAction(eventId, "draw", { key: randomUUID(), count: 2, ...options }) as Promise<LuckyDraw>;

describe("lucky audience awards", () => {
  it("locks only settled participants and saves concurrent retries exactly once", async () => {
    const eventId = await fixture();
    const roster = await lotteryState(eventId);
    expect(roster.locked).toBe(true); expect(roster.candidates).toHaveLength(8);
    expect(JSON.stringify(roster)).not.toContain("未结算观众");
    const key = randomUUID();
    const [first, replay] = await Promise.all([draw(eventId, { key }), draw(eventId, { key })]);
    expect(first.winners).toEqual(replay.winners); expect(first.id).toBe(replay.id);
    expect((await lotteryState(eventId)).draws).toHaveLength(1);
    expect(new Set(first.winners.map(winner => winner.playerId)).size).toBe(2);
  });
  it("excludes active awards across batches and clamps to the remaining roster", async () => {
    const eventId = await fixture();
    const first = await draw(eventId, { count: 5 });
    const extra = await draw(eventId, { count: 10 });
    expect(extra.winners).toHaveLength(3);
    expect(new Set([...first.winners, ...extra.winners].map(winner => winner.playerId)).size).toBe(8);
    await expect(draw(eventId)).rejects.toThrow("没有可抽取");
    expect((await lotteryState(eventId)).draws).toHaveLength(2);
  });
  it("allows special gifts to include previous winners while each batch stays unique", async () => {
    const eventId = await fixture();
    await draw(eventId, { count: 8 });
    const extra = await draw(eventId, { count: 5, excludeWinners: false });
    expect(extra.candidates).toHaveLength(8); expect(extra.winners).toHaveLength(5);
    expect(new Set(extra.winners.map(winner => winner.playerId)).size).toBe(5);
    await expect(draw(eventId)).rejects.toThrow("没有可抽取");
  });
  it("replaces only the requested batch, preserves standings and archives obsolete requests", async () => {
    const eventId = await fixture();
    const first = await draw(eventId), oldKey = randomUUID(), original = await draw(eventId, { key: oldKey });
    const frozen = (await getEvent(eventId)).frozen_rows;
    const key = randomUUID(), replacement = await draw(eventId, { key, replaceDrawId: original.id, excludeWinners: false });
    expect(replacement.candidates).toHaveLength(6);
    expect(replacement.winners.every(winner => !first.winners.some(prior => prior.playerId === winner.playerId))).toBe(true);
    const saved = await lotteryState(eventId);
    expect(saved.draws.map(batch => batch.id)).toEqual([first.id, replacement.id]);
    expect((await adminState(eventId)).draws).toHaveLength(2);
    expect((await getEvent(eventId)).frozen_rows).toEqual(frozen);
    expect((await draw(eventId, { key, replaceDrawId: original.id })).winners).toEqual(replacement.winners);
    await expect(draw(eventId, { key: oldKey })).rejects.toThrow("已被重抽替换");
    await expect(draw(eventId, { replaceDrawId: original.id })).rejects.toThrow("本轮结果已更新");
    const audit = (await adminState(eventId)).audits.find(item => item.action === "redraw");
    expect(audit?.detail).toMatchObject({ replacedDrawId: original.id, drawId: replacement.id, excludeWinners: true });
  });
  it("rejects simultaneous replacements of a stale batch", async () => {
    const eventId = await fixture(), original = await draw(eventId);
    const replies = await Promise.allSettled([draw(eventId, { replaceDrawId: original.id }), draw(eventId, { replaceDrawId: original.id })]);
    expect(replies.filter(reply => reply.status === "fulfilled")).toHaveLength(1);
    expect(replies.filter(reply => reply.status === "rejected")).toHaveLength(1);
    expect((await lotteryState(eventId)).draws).toHaveLength(1);
  });
  it("validates counts and frozen state before changing any awards", async () => {
    const eventId = await fixture();
    for (const count of [0, -1, 1.5, 101, Number.NaN]) await expect(draw(eventId, { count })).rejects.toThrow("整数");
    await expect(draw(eventId, { excludeWinners: "false" })).rejects.toThrow("布尔值");
    expect((await lotteryState(eventId)).draws).toEqual([]);
    await adminAction(eventId, "open", {});
    expect((await lotteryState(eventId)).locked).toBe(false);
    await expect(draw(eventId)).rejects.toThrow("冻结榜单");
  });
  it("uses corrected names in saved winners and clears awards when an activity restarts", async () => {
    const eventId = await fixture(), saved = await draw(eventId), winner = saved.winners[0];
    await adminAction(eventId, "rename", { playerId: winner.playerId, name: "更正姓名", institution: "更正机构" });
    expect((await lotteryState(eventId)).draws[0].winners[0]).toMatchObject({ name: "更正姓名", institution: "更正机构" });
    await adminAction(eventId, "open", {});
    expect((await lotteryState(eventId)).draws).toEqual([]);
    await expect((await getDb()).query("SELECT id FROM draws WHERE event_id=$1", [eventId]).then(result => result.rows)).resolves.toEqual([]);
  });
});
