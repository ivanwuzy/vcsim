"use client";
import { ArrowLeft, LoaderCircle, Trophy } from "lucide-react";
import { money } from "../lib/client";
import { fundReturn } from "../lib/leaderboard";
import { Brand } from "./brand";
import { useLeaderboard } from "./use-leaderboard";

export default function Leaderboard() {
  const { data, error } = useLeaderboard();
  return <main className="app player-board">
    <header className="site-header"><Brand href="/" /><span className="header-right"><span className="event-dot" />{data?.title || "合伙人排行榜"}</span></header>
    <div className="board-page">
      <div className="page-heading"><div><span className="eyebrow">THE PARTNERS BOARD</span><h1>眼光，会有回报。</h1><p>{data?.status === "inactive" ? "请等待主办方启动活动，榜单会自动更新。" : "基金结算后登榜，每5秒更新。回报相同者并列。"}</p></div><a href="/" className="btn"><ArrowLeft size={14} />回到我的基金</a></div>
      {error && <div className="error" role="alert">{error} · 正在自动重连</div>}
      <section className="table-shell">
        {!data ? <div className="board-empty"><LoaderCircle className="spin" /></div> : !data.rows.length ? <div className="board-empty"><Trophy size={30} strokeWidth={1.4} /><p>{data.status === "inactive" ? "暂无进行中的活动" : <>第一位合伙人还在做决定。<br />基金结算后，你的名字会出现在这里。</>}</p></div> :
          <table className="board-table"><thead><tr><th>排名</th><th>合伙人</th><th>基金最终金额 / 回报倍数</th></tr></thead><tbody>{data.rows.map(p => {
            const score = fundReturn(p.profit, data.initial ?? 0);
            return <tr key={p.playerId}><td><span className={`rank medal-${p.rank}`}>{String(p.rank).padStart(2, "0")}</span></td><td className="player-cell"><strong>{p.name}</strong><small>{p.institution}</small></td><td className="board-return"><strong>{score.amount}</strong><small>MOIC {score.multiple}</small></td></tr>;
          })}</tbody></table>}
      </section>
      <div className="board-info"><span>{data?.rows.length ?? 0}位合伙人已完成{data?.mode === "demo" ? " · 演示活动" : ""}</span><span>{data?.initial ? `初始基金 ${money(data.initial)}万元` : "等待活动启动"}</span></div>
    </div>
    <footer className="site-footer"><span>一场关于技术、时代与直觉的投资实验</span><span>仅供交流娱乐 · 全部收益为模拟</span></footer>
  </main>;
}
