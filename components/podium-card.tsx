import { Crown, Medal } from "lucide-react";
import { fundReturn } from "../lib/leaderboard";
import type { LeaderRow } from "../lib/service";

const robotImages = ["/robots/a3u-gold.webp", "/robots/a3u-silver.webp", "/robots/a3u-bronze.webp"];

export function PodiumCard({ player, rank, initial, tied }: { player?: LeaderRow; rank: number; initial: number; tied: boolean }) {
  const score = player ? fundReturn(player.profit, initial) : null;
  const Icon = rank === 1 ? Crown : Medal;
  return <article className={`podium-card medal-${rank} ${!player ? "podium-vacant" : ""}`} data-testid="podium-card" data-player={player?.playerId}>
    <div className="podium-rank"><span>{String(rank).padStart(2, "0")}</span><Icon size={26} strokeWidth={1.5} /></div>
    <div className="podium-player"><span className="podium-label">{tied ? "并列" : ""}第 {rank} 名</span><h2 title={player?.name}>{player?.name || "虚位以待"}</h2><p title={player?.institution}>{player?.institution || "下一份远见，即将登榜"}</p></div>
    <div className="podium-score">{score ? <><div className="podium-aum"><span className="score-label">AUM</span><strong>{score.amount}</strong></div><div className="podium-moic"><span className="score-label">MOIC</span><b>{score.multiple}</b></div></> : <span className="podium-wait">等待基金结算</span>}</div>
    <div className="podium-art" aria-hidden="true"><img src={robotImages[rank - 1]} alt="" width="900" height="900" /></div>
  </article>;
}
