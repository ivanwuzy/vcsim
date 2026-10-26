import type { LeaderRow } from "./service";

export type LuckyDraw = { id: string; kind: string; candidates: LeaderRow[]; winners: LeaderRow[]; created_at: string; request_key?: string };
export type LotteryState = { eventId: string; title: string; locked: boolean; defaultCount: number; candidates: LeaderRow[]; draws: LuckyDraw[]; excludeTopN?: number; topM?: number };
export type LotteryRange = { excludeTopN?: number; topM?: number };

export function luckyCandidates(rows: LeaderRow[], draws: LuckyDraw[], excludeWinners = true, replaceDrawId?: string, range: LotteryRange = {}) {
  const past = new Set(draws.filter(draw => draw.kind === "lucky" && draw.id !== replaceDrawId).flatMap(draw => draw.winners.map(winner => winner.playerId)));
  // Slice the original, ordered roster before removing winners. Ties follow the
  // board's stable player order, so N and M always refer to exact player counts.
  return rows.slice(range.excludeTopN ?? 0, range.topM || undefined).filter(row => !excludeWinners || !past.has(row.playerId));
}
