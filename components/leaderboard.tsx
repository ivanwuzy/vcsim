"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, LoaderCircle, Trophy } from "lucide-react";
import { api, money } from "../lib/client";
import type { publicLeaderboard } from "../lib/service";
import { Brand } from "./brand";
export default function Leaderboard({ adminEventId, screen = false }: { adminEventId?: string; screen?: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof publicLeaderboard>> | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    async function refresh() {
      try {
        const d = await api<NonNullable<typeof data>>(adminEventId ? `/api/admin/leaderboard?event=${encodeURIComponent(adminEventId)}` : "/api/leaderboard");
        if (live) { setData(d); setError(""); }
      } catch (e) { if (live) setError((e as Error).message); }
    }
    void refresh(); const timer = setInterval(refresh, 5000); return () => { live = false; clearInterval(timer); };
  }, [adminEventId]);
  return <main className={`app ${screen ? "screen" : ""}`}><header className="site-header"><Brand href="/" /><span className="header-right"><span className="event-dot" />{data?.title || "合伙人排行榜"}</span></header><div className="board-page"><div className="page-heading"><div><span className="eyebrow">THE PARTNERS BOARD</span><h1>眼光，会有回报。</h1><p>{data?.frozen ? "最终榜单已冻结。今晚的选择，已经写下答案。" : data?.status === "inactive" ? "请等待主办方启动活动，榜单会自动更新。" : "完成全局后登榜，每5秒更新。收益相同者并列。"}</p></div>{!screen && <a href="/" className="btn"><ArrowLeft size={14} />回到我的基金</a>}</div>
      {error && <div className="error" role="alert">{error}</div>}
      <section className="table-shell">{!data ? <div className="board-empty"><LoaderCircle className="spin" /></div> : !data.rows.length ? <div className="board-empty"><Trophy size={30} strokeWidth={1.4} /><p>{data.status === "inactive" ? "暂无进行中的活动" : <>第一位合伙人还在做决定。<br />完成本局全部项目选择后，你的名字会出现在这里。</>}</p></div> : <table className="board-table"><thead><tr><th>排名</th><th>合伙人</th><th>基金净收益 / 万元</th></tr></thead><tbody>{data.rows.map(p => <tr key={p.playerId}><td><span className={`rank ${p.rank <= 3 ? "top" : ""}`}>{String(p.rank).padStart(2, "0")}</span></td><td className="player-cell"><strong>{p.name}</strong><small>{p.institution}</small></td><td className={p.profit >= 0 ? "positive" : "negative"}>{p.profit > 0 ? "+" : ""}{money(p.profit, 2)}</td></tr>)}</tbody></table>}</section>
      <div className="board-info"><span>{data?.rows.length ?? 0}位合伙人已完成 · {data?.frozen ? "最终排名" : "当前排名"}{data?.mode === "demo" ? " · 演示活动" : ""}</span><span>{data?.initial ? `初始基金 ${money(data.initial)}万元` : "等待活动启动"}</span></div>{!screen && <a href="/leaderboard?screen=1" className="text-link">打开现场大屏 <ArrowUpRight size={13} /></a>}
    </div><footer className="site-footer"><span>一场关于技术、时代与直觉的投资实验</span><span>仅供交流娱乐 · 全部收益为模拟</span></footer></main>;
}
