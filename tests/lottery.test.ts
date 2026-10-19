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
  it("clears every lucky batch and obsolete retry, preserves standings, tie awards and other activities, and lets the whole roster draw again", async () => {
    const eventId = await fixture();
    const firstKey = randomUUID(), replacedKey = randomUUID(), latestKey = randomUUID();
    const first = await draw(eventId, { key: firstKey });
    const replaced = await draw(eventId, { key: replacedKey });
    const latest = await draw(eventId, { key: latestKey, replaceDrawId: replaced.id });
    const tie = await adminAction(eventId, "tie", { key: randomUUID() }) as LuckyDraw;
    const before = await adminState(eventId);
    const otherEventId = await fixture(), other = await draw(otherEventId);
    const body = { confirmed: true, drawIds: [first.id, latest.id] };
    expect(await adminAction(eventId, "clear-lottery", body)).toMatchObject({ clearedCount: 2 });
    const state = await lotteryState(eventId), after = await adminState(eventId);
    expect(state.draws).toEqual([]); expect(state.locked).toBe(true); expect(state.candidates).toHaveLength(8);
    expect(after.players).toEqual(before.players); expect(after.event).toEqual(before.event); expect(after.leaderboard).toEqual(before.leaderboard);
    expect(after.draws).toEqual([expect.objectContaining({ id: tie.id, kind: "tie" })]);
    expect((await lotteryState(otherEventId)).draws.map(draw => draw.id)).toEqual([other.id]);
    expect(after.audits.find(item => item.action === "clear-lottery")?.detail).toMatchObject({ clearedCount: 2, clearedWinners: 4 });
    for (const key of [firstKey, replacedKey, latestKey]) await expect(draw(eventId, { key })).rejects.toThrow("已清空");
    expect(await adminAction(eventId, "clear-lottery", body)).toMatchObject({ clearedCount: 0 });
    const fresh = await draw(eventId, { count: 8 });
    expect(fresh.candidates).toHaveLength(8); expect(fresh.winners).toHaveLength(8);
    expect(new Set(fresh.winners.map(winner => winner.playerId)).size).toBe(8);
    await expect(adminAction(eventId, "clear-lottery", body)).rejects.toThrow("结果已更新");
    expect((await lotteryState(eventId)).draws.map(draw => draw.id)).toEqual([fresh.id]);
  });
  it("requires explicit confirmation and the current batch list before clearing anything", async () => {
    const eventId = await fixture(), first = await draw(eventId);
    for (const confirmed of [undefined, false, "true"]) await expect(adminAction(eventId, "clear-lottery", { confirmed, drawIds: [first.id] })).rejects.toThrow("确认");
    await expect(adminAction(eventId, "clear-lottery", { confirmed: true })).rejects.toThrow("轮次");
    const second = await draw(eventId);
    await expect(adminAction(eventId, "clear-lottery", { confirmed: true, drawIds: [first.id] })).rejects.toThrow("结果已更新");
    expect((await lotteryState(eventId)).draws.map(draw => draw.id)).toEqual([first.id, second.id]);
    const unstarted = await adminAction(undefined, "create", { title: "未冻结", mode: "demo" }) as { eventId: string };
    await expect(adminAction(unstarted.eventId, "clear-lottery", { confirmed: true, drawIds: [first.id] })).rejects.toThrow("已冻结");
  });
});
