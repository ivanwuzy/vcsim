import type { LeaderRow, publicLeaderboard } from "./service";

export type BoardData = Awaited<ReturnType<typeof publicLeaderboard>>;
export type PodiumRecord = { player: LeaderRow; record: boolean };

export function fundReturn(profit: number, initial: number) {
  const final = initial + profit;
  return {
    multiple: `${Math.round(initial > 0 ? final / initial : 0)} x`,
    amount: `${Math.round(final / 100_000_000)}亿元`,
  };
}

// Compare unrounded scores and the complete previous board. Rank changes caused
// by removing players or correcting names are not new investment records.
export function newPodiumRecords(previous: BoardData | null, next: BoardData): PodiumRecord[] {
  if (!previous || previous.id !== next.id) return [];
  const oldPlayers = new Map(previous.rows.map(player => [player.playerId, player]));
  const highest = previous.rows[0]?.profit ?? -Infinity;
  return next.rows.filter(player => player.rank <= 3 &&
    (!oldPlayers.has(player.playerId) || player.profit > oldPlayers.get(player.playerId)!.profit)
  ).map(player => ({ player, record: player.rank === 1 && player.profit > highest }));
}
