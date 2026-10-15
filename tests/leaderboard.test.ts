import { describe, expect, it } from "vitest";
import { fundReturn, newPodiumRecords, type BoardData } from "../lib/leaderboard";
import type { LeaderRow } from "../lib/service";

const player = (playerId: string, profit: number, rank: number): LeaderRow => ({ playerId, profit, rank, name: playerId, institution: "基金" });
const board = (rows: LeaderRow[], id = "event"): BoardData => ({ id, rows, initial: 100_000_000, frozen: false, title: "活动", status: "open", mode: "demo" });

describe("fund return display", () => {
  it("includes the original principal in MOIC and the final fund amount", () => {
    expect(fundReturn(19_900_000_000, 100_000_000)).toEqual({ multiple: "200 x", amount: "200亿元" });
    expect(fundReturn(11_400_000_000, 100_000_000)).toEqual({ multiple: "115 x", amount: "115亿元" });
    expect(fundReturn(0, 100_000_000)).toEqual({ multiple: "1 x", amount: "1亿元" });
  });
  it("rounds only the display and handles different principal and losses", () => {
    expect(fundReturn(11_437_000_000, 50_000_000)).toEqual({ multiple: "230 x", amount: "115亿元" });
    expect(fundReturn(-100_000_000, 100_000_000)).toEqual({ multiple: "0 x", amount: "0亿元" });
  });
});

describe("new podium records", () => {
  const previous = board([player("a", 300, 1), player("b", 200, 2), player("c", 100, 3), player("d", 50, 4)]);
  it("does not celebrate initial loading, reloading or switching activities", () => {
    expect(newPodiumRecords(null, previous)).toEqual([]);
    expect(newPodiumRecords(previous, previous)).toEqual([]);
    expect(newPodiumRecords(previous, board(previous.rows, "next"))).toEqual([]);
  });
  it("celebrates each new top-three record and reserves the record effect for a strictly higher score", () => {
    const next = board([player("gold", 400, 1), player("a", 300, 2), player("silver", 250, 3)]);
    expect(newPodiumRecords(previous, next)).toEqual([
      { player: next.rows[0], record: true }, { player: next.rows[2], record: false },
    ]);
    expect(newPodiumRecords(previous, board([...previous.rows, player("e", 1, 5)]))).toEqual([]);
  });
  it("includes all tied podium entrants without declaring an equal score a new highest record", () => {
    const next = board([player("a", 300, 1), player("tied", 300, 1), player("b", 200, 3), player("tied-bronze", 200, 3)]);
    expect(newPodiumRecords(previous, next).map(r => [r.player.playerId, r.record])).toEqual([["tied", false], ["tied-bronze", false]]);
  });
  it("does not mistake renames, freeze or a promoted existing player for a new record", () => {
    const renamed = { ...previous, frozen: true, rows: previous.rows.map(p => ({ ...p, name: "已纠正" })) };
    expect(newPodiumRecords(previous, renamed)).toEqual([]);
    expect(newPodiumRecords(previous, board([player("b", 200, 1), player("c", 100, 2), player("d", 50, 3)]))).toEqual([]);
  });
  it("celebrates improvements even if their rounded MOIC is unchanged", () => {
    const next = board([player("a", 301, 1), ...previous.rows.slice(1)]);
    expect(fundReturn(300, 100_000_000)).toEqual(fundReturn(301, 100_000_000));
    expect(newPodiumRecords(previous, next)).toEqual([{ player: next.rows[0], record: true }]);
  });
  it("celebrates the first finisher after the empty board is already on screen", () => {
    const next = board([player("first", 0, 1)]);
    expect(newPodiumRecords(board([]), next)).toEqual([{ player: next.rows[0], record: true }]);
  });
});
