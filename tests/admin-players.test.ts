import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { adminAction, adminState, getEvent, getRun, lotteryState, publicLeaderboard, register, result, startRun } from "../lib/service";
import { getDb } from "../lib/db";
import { luckyCandidates, type LuckyDraw } from "../lib/lottery";
import { POST } from "../app/api/[...path]/route";
import { sign } from "../lib/security";

beforeAll(async () => {
  process.env.PGLITE_PATH = await mkdtemp(`${tmpdir()}/vc-admin-players-`);
  process.env.APP_MODE = "demo";
  process.env.SESSION_SECRET = "admin-players-test-session-secret-at-least-32-characters";
});
async function fixture() {
  const { eventId } = await adminAction(undefined, "create", { title: "成绩管理测试", mode: "demo" }) as { eventId: string };
  await adminAction(eventId, "open", {});
  return eventId;
}
async function freeze(eventId: string) {
  await adminAction(eventId, "close", {});
  await adminAction(eventId, "freeze", {});
}
const draw = (eventId: string, payload: Record<string, unknown> = {}) => adminAction(eventId, "draw", { key: randomUUID(), count: 5, ...payload }) as Promise<LuckyDraw>;

describe("admin test players and score entry", () => {
  it("adds settled test players around 100 亿 with unique identities, visible on the public board", async () => {
    const eventId = await fixture();
    expect(await adminAction(eventId, "add-test-players", { count: 50 })).toMatchObject({ addedCount: 50 });
    await adminAction(eventId, "add-test-players", { count: 7 });
    const state = await adminState(eventId), initial = state.event!.snapshot.rules!.initial;
    expect(state.players).toHaveLength(57);
    expect(state.players.every(player => player.is_test && player.status === "completed" && player.score_source === "test")).toBe(true);
    expect(new Set(state.players.map(player => player.name)).size).toBe(57);
    for (const player of state.leaderboard) {
      expect(player.profit + initial).toBeGreaterThanOrEqual(6_000_000_000);
      expect(player.profit + initial).toBeLessThanOrEqual(14_000_000_000);
    }
    expect((await publicLeaderboard()).rows).toEqual(state.leaderboard);
    const otherId = await fixture();
    await adminAction(otherId, "add-test-players", { count: 2 });
    await adminAction(eventId, "delete-test-players", {});
    expect((await adminState(eventId)).players).toHaveLength(0);
    expect((await adminState(otherId)).players).toHaveLength(2);
  });

  it("upserts an existing player, preserves credentials and decisions, and calculates the correct AUM and MOIC", async () => {
    const eventId = await fixture(), player = await register(eventId, "张三", "基金"), run = await startRun(eventId, player.token);
    const original = (await getDb()).query("SELECT token_hash FROM players WHERE id=$1", [player.player.id]);
    const filled = await adminAction(eventId, "fill-score", { playerId: player.player.id, name: "张三", institution: "基金", aum: 10_000_000_000 });
    expect(filled).toMatchObject({ aum: 10_000_000_000, moic: 50 });
    expect((await getRun(run.id, player.token)).value).toBe(10_000_000_000);
    expect(await result(run.id, player.token)).toMatchObject({ value: 10_000_000_000, profit: 9_800_000_000, multiple: 50, rank: 1 });
    expect((await (await getDb()).query("SELECT token_hash FROM players WHERE id=$1", [player.player.id])).rows).toEqual((await original).rows);
    await adminAction(eventId, "fill-score", { name: " 张 三 ", institution: "基金", aum: 0 });
    const state = await adminState(eventId);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({ id: player.player.id, is_test: false, score_source: "manual" });
    expect(state.leaderboard[0].profit).toBe(-200_000_000);
    await expect(adminAction(eventId, "fill-score", { playerId: player.player.id, name: "另一个人", institution: "基金", aum: 1 })).rejects.toThrow("重新补填");
  });

  it("updates frozen standings and removes only marked test players and their awards, including archived retries", async () => {
    const eventId = await fixture();
    await adminAction(eventId, "add-test-players", { count: 10 });
    await adminAction(eventId, "fill-score", { name: "测试玩家真人", institution: "真实机构", aum: 15_000_000_000 });
    await freeze(eventId);
    const key = randomUUID(), saved = await draw(eventId, { count: 11, key });
    await adminAction(eventId, "fill-score", { name: "新补填玩家", institution: "另一机构", aum: 16_000_000_000 });
    expect((await lotteryState(eventId)).candidates[0].name).toBe("新补填玩家");
    expect((await lotteryState(eventId)).draws[0].winners).toEqual(saved.winners);
    expect(await adminAction(eventId, "delete-test-players", {})).toMatchObject({ deletedCount: 10 });
    const state = await adminState(eventId), lottery = await lotteryState(eventId);
    expect(state.players.map(player => player.name).sort()).toEqual(["新补填玩家", "测试玩家真人"]);
    expect(state.leaderboard.map(player => player.rank)).toEqual([1, 2]);
    expect(lottery.locked).toBe(true); expect(lottery.candidates).toHaveLength(2);
    expect(lottery.draws[0].winners.map(player => player.name)).toEqual(["测试玩家真人"]);
    expect((await draw(eventId, { key })).winners.map(player => player.name)).toEqual(["测试玩家真人"]);
    expect((await draw(eventId)).winners.map(player => player.name)).toEqual(["新补填玩家"]);
    expect(await adminAction(eventId, "delete-test-players", {})).toMatchObject({ deletedCount: 0 });
  });

  it("invalidates tie awards after a score correction", async () => {
    const eventId = await fixture();
    for (let i = 0; i < 4; i++) await adminAction(eventId, "fill-score", { name: `并列${i}`, institution: "机构", aum: 10_000_000_000 });
    await freeze(eventId);
    const key = randomUUID();
    await adminAction(eventId, "tie", { key });
    await adminAction(eventId, "fill-score", { name: "并列0", institution: "机构", aum: 9_000_000_000 });
    expect((await adminState(eventId)).draws).toHaveLength(0);
    await expect(adminAction(eventId, "tie", { key })).rejects.toThrow("榜单已调整");
  });

  it("validates mutations and enforces admin authorization at the API boundary", async () => {
    const eventId = await fixture();
    for (const count of [0, -1, 1.5, 1001, "50"]) await expect(adminAction(eventId, "add-test-players", { count })).rejects.toThrow("整数");
    for (const aum of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "100"]) await expect(adminAction(eventId, "fill-score", { name: "玩家", institution: "机构", aum })).rejects.toThrow("AUM");
    const post = (body: unknown, authenticated = true) => POST(new NextRequest(`http://localhost:3000/api/admin?event=${eventId}`, { method: "POST", headers: {
      Origin: "http://localhost:3000", "Content-Type": "application/json", ...(authenticated ? { Cookie: `vc_admin=${sign(`admin:${Date.now() + 60000}`)}` } : {}),
    }, body: JSON.stringify(body) }), { params: Promise.resolve({ path: ["admin"] }) });
    for (const body of [{ action: "add-test-players", count: 1 }, { action: "delete-test-players" }, { action: "fill-score", name: "玩家", institution: "机构", aum: 1 }]) expect((await post(body, false)).status).toBe(401);
    expect((await post({ action: "add-test-players", count: 0 })).status).toBe(422);
    expect((await post({ action: "fill-score", name: " ", institution: "机构", aum: 1 })).status).toBe(422);
    expect((await post({ action: "fill-score", name: "玩家", institution: "机构", aum: 123_456_789 })).status).toBe(200);
    expect((await adminState(eventId)).leaderboard[0].profit).toBe(-76_543_211);
  });
});

describe("rank-restricted lottery", () => {
  it("draws 20 distinct awards in four batches of five from the original positions N+1 through M", async () => {
    const eventId = await fixture();
    await adminAction(eventId, "add-test-players", { count: 50 });
    await freeze(eventId);
    const roster = (await lotteryState(eventId)).candidates, allowed = new Set(roster.slice(3, 30).map(player => player.playerId));
    const results = [await draw(eventId, { excludeTopN: 3, topM: 30 })];
    // Distinct simultaneous requests are serialized and cannot repeat winners.
    results.push(...await Promise.all([draw(eventId), draw(eventId), draw(eventId)]));
    expect(results.every(result => result.winners.length === 5)).toBe(true);
    const winners = results.flatMap(result => result.winners);
    expect(winners.every(player => allowed.has(player.playerId))).toBe(true);
    expect(new Set(winners.map(player => player.playerId)).size).toBe(20);
    expect(results.map(result => result.candidates.length).sort((a, b) => b - a)).toEqual([27, 22, 17, 12]);
    expect(await lotteryState(eventId)).toMatchObject({ excludeTopN: 3, topM: 30 });
    expect((await draw(eventId, { count: 100 })).winners).toHaveLength(7);
    await expect(draw(eventId)).rejects.toThrow("没有可抽取");
    const original = results[0];
    const replacement = await draw(eventId, { replaceDrawId: original.id });
    expect(replacement.winners.map(player => player.playerId).sort()).toEqual(original.winners.map(player => player.playerId).sort());
  });

  it("uses exact player counts for ties and rejects invalid ranges without saving awards", async () => {
    const eventId = await fixture();
    for (let i = 0; i < 8; i++) await adminAction(eventId, "fill-score", { name: `玩家${i}`, institution: "机构", aum: 10_000_000_000 });
    await freeze(eventId);
    const roster = (await getEvent(eventId)).frozen_rows!;
    expect(roster.every(player => player.rank === 1)).toBe(true);
    expect(luckyCandidates(roster, [], true, undefined, { excludeTopN: 3, topM: 6 })).toEqual(roster.slice(3, 6));
    for (const range of [{ excludeTopN: -1 }, { topM: 1.5 }, { topM: "5" }, { excludeTopN: 3, topM: 3 }, { excludeTopN: 5, topM: 3 }]) await expect(draw(eventId, range)).rejects.toThrow(/整数|必须大于/);
    expect((await lotteryState(eventId)).draws).toHaveLength(0);
    expect((await draw(eventId, { excludeTopN: 3, topM: 6 })).winners).toHaveLength(3);
    const extra = await draw(eventId, { excludeWinners: false });
    expect(extra.candidates).toEqual(roster.slice(3, 6));
  });
});
