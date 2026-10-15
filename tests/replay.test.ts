import { beforeAll, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { adminAction, adminState, decide, getEvent, getRun, leaderboard, playerForToken, publicMeta, register, replayEnabled, resetPlayer, startRun } from "../lib/service";
import { getDb } from "../lib/db";

beforeAll(async () => {
  process.env.PGLITE_PATH = await mkdtemp(`${tmpdir()}/vc-replay-test-`);
  process.env.APP_MODE = "demo";
  await getEvent();
});
async function createEvent(mode = "demo") {
  const { eventId } = await adminAction(undefined, "create", { title: "重置测试", mode }) as { eventId: string };
  await adminAction(eventId, "open", {});
  return eventId;
}

describe("trial replay", () => {
  it("defaults to hidden and persists a global setting across activities and modes", async () => {
    expect(await replayEnabled()).toBe(false);
    expect((await publicMeta())?.replayEnabled).toBe(false);
    await expect(adminAction(undefined, "replay-settings", { enabled: "true" })).rejects.toThrow("布尔值");
    await adminAction(undefined, "replay-settings", { enabled: true });
    const id = await createEvent("formal");
    expect((await publicMeta())?.replayEnabled).toBe(true);
    expect((await adminState(id)).replayEnabled).toBe(true);
    expect((await adminState(id)).audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "replay-settings" })]));
  });

  it("rejects reset while hidden and keeps identity and decisions intact", async () => {
    const id = await createEvent(), player = await register(id, "禁止重置", "机构");
    const run = await startRun(id, player.token);
    await adminAction(undefined, "replay-settings", { enabled: false });
    await expect(resetPlayer(id, player.token)).rejects.toThrow("暂未开放");
    expect(await getRun(run.id, player.token)).toEqual(run);
    expect((await playerForToken(player.token)).id).toBe(player.player.id);
    await adminAction(undefined, "replay-settings", { enabled: true });
  });

  it("clears an unfinished run and identity, permits the same name again and preserves other players", async () => {
    const id = await createEvent();
    const a = await register(id, "再来一次", "原机构"), b = await register(id, "其他玩家", "原机构");
    const initial = await startRun(id, a.token), other = await startRun(id, b.token);
    const progressed = await decide(initial.id, a.token, { projectId: initial.card!.id, choice: "invest", amount: 40_000_000, key: randomUUID() });
    expect(progressed.index).toBe(1);
    expect((await resetPlayer(id, a.token)).runId).toBe(initial.id);
    await expect(playerForToken(a.token)).rejects.toThrow("失效");
    const db = await getDb();
    expect((await db.query("SELECT id FROM runs WHERE id=$1", [initial.id])).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM players WHERE id=$1", [a.player.id])).rows).toHaveLength(0);
    expect(await getRun(other.id, b.token)).toEqual(other);
    const fresh = await register(id, "再来一次", "原机构", a.token);
    const restarted = await startRun(id, fresh.token);
    expect(fresh.player.id).not.toBe(a.player.id);
    expect(restarted.id).not.toBe(initial.id);
    expect(restarted.index).toBe(0); expect(restarted.invested).toBe(0); expect(restarted.cash).toBe(200_000_000);
  });

  it("removes completed scores from standings", async () => {
    const id = await createEvent(), player = await register(id, "已完成重置", "机构");
    let run = await startRun(id, player.token);
    for (let i = 0; i < 5; i++) run = await decide(run.id, player.token, { projectId: run.card!.id, choice: "invest", amount: 40_000_000, key: randomUUID() });
    expect(run.status).toBe("completed");
    expect(await leaderboard(await getEvent(id))).toHaveLength(1);
    await resetPlayer(id, player.token);
    expect(await leaderboard(await getEvent(id))).toHaveLength(0);
    await expect(getRun(run.id, player.token)).rejects.toThrow("失效");
  });

  it("resets registered players before starting and safely repeats anonymous or stale resets", async () => {
    const id = await createEvent(), player = await register(id, "只登记", "机构");
    expect((await resetPlayer(id, player.token)).runId).toBeNull();
    expect((await resetPlayer(id, player.token)).ok).toBe(true);
    expect((await resetPlayer(id)).ok).toBe(true);
    const fresh = await register(id, "只登记", "机构");
    expect((await resetPlayer(id, "invalid-token")).ok).toBe(true);
    expect((await playerForToken(fresh.token)).id).toBe(fresh.player.id);
  });

  it("rejects a switched or stopped event and preserves its history", async () => {
    const old = await createEvent(), player = await register(old, "历史玩家", "机构");
    const run = await startRun(old, player.token);
    const active = await createEvent();
    await expect(resetPlayer(old, player.token)).rejects.toThrow("已停止或已切换");
    expect(await getRun(run.id, player.token)).toEqual({ ...run, eventStatus: "closed" });
    await resetPlayer(active, player.token);
    expect((await playerForToken(player.token)).id).toBe(player.player.id);
  });

  it("keeps global visibility manageable when all activities are deleted", async () => {
    const state = await adminState();
    for (const event of state.events) await adminAction(event.id, "delete", {});
    await adminAction(undefined, "replay-settings", { enabled: false });
    expect((await adminState()).event).toBeNull();
    expect((await adminState()).replayEnabled).toBe(false);
    await adminAction(undefined, "replay-settings", { enabled: true });
    expect((await adminState()).replayEnabled).toBe(true);
    await createEvent();
    expect((await publicMeta())?.replayEnabled).toBe(true);
  });
});
