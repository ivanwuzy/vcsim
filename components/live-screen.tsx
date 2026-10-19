"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Crown, Gift, Maximize, Minimize, Moon, Sparkles, Sun, Trophy } from "lucide-react";
import { fundReturn, newPodiumRecords, type BoardData } from "../lib/leaderboard";
import { Brand } from "./brand";
import { MedalCelebration, type Celebration } from "./medal-celebration";
import { PodiumCard } from "./podium-card";
import { useLeaderboard } from "./use-leaderboard";
import { LotteryDraw } from "./lottery-draw";

const medals = ["金", "银", "铜"];
const clock = (date: Date) => date.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

export default function LiveScreen({ eventId }: { eventId: string }) {
  const { data, error, updatedAt } = useLeaderboard(eventId);
  const previous = useRef<BoardData | null>(null), sequence = useRef(0);
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lottery, setLottery] = useState(false);
  const closeLottery = useCallback(() => setLottery(false), []);
  const [rotation, setRotation] = useState(0), [preview, setPreview] = useState(false), [fullscreen, setFullscreen] = useState(false), [fullscreenError, setFullscreenError] = useState("");
  const complete = useCallback(() => setQueue(items => items.slice(1)), []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vc-live-screen-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* Theme switching remains available when storage is disabled. */ }
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("vc-live-screen-theme", next); } catch { /* Keep the current page's choice. */ }
  }
  useEffect(() => {
    if (!data) return;
    const records = newPodiumRecords(previous.current, data);
    if (previous.current?.id !== data.id) { setQueue([]); setRotation(0); }
    previous.current = data;
    if (records.length) setQueue(items => [...items, ...records.map(record => ({ ...record, initial: data.initial ?? 0, id: ++sequence.current }))]);
  }, [data]);
  useEffect(() => {
    const timer = setInterval(() => setRotation(value => value + 1), 12000);
    const onFullscreen = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => { clearInterval(timer); document.removeEventListener("fullscreenchange", onFullscreen); };
  }, []);
  async function toggleFullscreen() {
    try {
      setFullscreenError("");
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setFullscreenError("浏览器未允许全屏，请使用 F11 或浏览器全屏菜单。"); }
  }
  function playPreview(rank: number) {
    const initial = data?.initial || 100_000_000;
    const player = data?.rows.find(row => row.rank === rank) ?? { playerId: "preview", name: "未来合伙人", institution: "远征 A3U · 动效体验", rank, profit: initial * (rank === 1 ? 199 : rank === 2 ? 114 : 87) };
    setQueue(items => [...items, { id: ++sequence.current, player, initial, record: rank === 1, preview: true }]);
    setPreview(false);
  }
  const podium = data?.rows.filter(row => row.rank <= 3) ?? [];
  // Keep each occupied podium position visible; only cycle the players sharing
  // that position. A tie for bronze must never rotate the gold and silver away.
  const slots = podium.slice(0, 3).map(player => player.rank);
  const groups = new Map([1, 2, 3].map(rank => [rank, podium.filter(player => player.rank === rank)]));
  const podiumPages = Math.max(1, ...[...groups].map(([rank, players]) => Math.ceil(players.length / Math.max(1, slots.filter(slot => slot === rank).length))));
  const featured = slots.map((rank, index) => {
    const players = groups.get(rank)!;
    const occupied = slots.filter(slot => slot === rank).length;
    const offset = slots.slice(0, index).filter(slot => slot === rank).length;
    return players[(rotation * occupied + offset) % players.length];
  });
  const rest = data?.rows.filter(row => row.rank > 3) ?? [];
  const pages = Math.max(1, Math.ceil(rest.length / 7)), page = rotation % pages;
  const visibleRows = rest.slice(page * 7, page * 7 + 7);
  const status = error ? "连接中断 · 自动重连" : !data ? "正在连接榜单" : data.frozen ? "最终榜单 · 已冻结" : data.status === "open" ? "实时榜单 · 5秒更新" : data.status === "closed" ? "活动已停止 · 保留成绩" : "等待活动启动";
  return <main className="live-screen" data-theme={theme}>
    <header className="live-header"><Brand href="/admin" /><div className="live-event header-right"><span className="event-dot" />{data?.title || "具身创投之夜"}{data?.mode === "demo" && <span className="live-demo">演示活动</span>}</div><div className="live-tools"><button className="live-lottery-toggle" onClick={() => { setPreview(false); setLottery(true); }} aria-haspopup="dialog"><Gift size={17} /><span>幸运观众抽奖</span></button><a href="/admin" aria-label="返回主办方工作台" title="返回主办方工作台"><ArrowLeft size={17} /></a><button className="live-theme-toggle" onClick={toggleTheme} aria-label={theme === "dark" ? "切换为浅色" : "切换为深色"} title={theme === "dark" ? "切换为浅色" : "切换为深色"}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}<span>{theme === "dark" ? "浅色" : "深色"}</span></button><button onClick={toggleFullscreen} aria-label={fullscreen ? "退出全屏" : "全屏展示"} title={fullscreen ? "退出全屏" : "全屏展示"}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button></div></header>
    <div className="live-heading"><div><span className="live-eyebrow">THE PARTNERS BOARD <span>/</span> 具身 VC 投资模拟器</span><h1>眼光，会有<span>回报。</span></h1></div><div className="live-heading-note"><Trophy size={24} strokeWidth={1.3} /><p>投资未来的人，<br /><strong>此刻站在这里。</strong></p></div></div>
    {fullscreenError && <p className="live-warning" role="alert">{fullscreenError}</p>}
    {error && <p className="live-warning" role="alert">{error}。{data ? "正在展示最近一次成功更新的榜单，恢复后自动同步。" : "正在自动重试连接。"}</p>}
    <div className="live-board">
      <section className="podium" aria-label="前三名高亮榜单">
        <div className="live-section-label"><span><Crown size={16} /> 远见领跑者</span><small>{podiumPages > 1 ? "并列合伙人 · 自动轮播" : "TOP 03"}</small></div>
        <div className="podium-cards">{Array.from({ length: 3 }, (_, index) => {
          const player = featured[index], rank = player?.rank ?? index + 1;
          return <PodiumCard key={player?.playerId ?? `vacant-${index}`} player={player} rank={rank} initial={data?.initial ?? 0} tied={!!player && podium.filter(row => row.rank === rank).length > 1} />;
        })}</div>
      </section>
      <section className="contenders" aria-label="其余合伙人榜单"><div className="live-section-label"><span>合伙人榜单</span><small>{pages > 1 ? `${page + 1} / ${pages} 页 · 自动轮播` : "THE NEXT VISIONARIES"}</small></div>
        <div className="contenders-body"><div className="contenders-columns"><span>排名 / 合伙人</span><span>基金最终金额</span></div>
          {visibleRows.length ? <div className="contenders-list">{visibleRows.map(player => {
            const score = fundReturn(player.profit, data?.initial ?? 0);
            return <article className="contender-row" key={player.playerId}><span className="contender-rank">{String(player.rank).padStart(2, "0")}</span><div className="contender-player"><h2 title={player.name}>{player.name}</h2><p title={player.institution}>{player.institution}</p></div><div className="contender-score"><strong>{score.amount}</strong><small>MOIC {score.multiple}</small></div></article>;
          })}</div> : <div className="contenders-empty"><Sparkles size={36} strokeWidth={1} /><h2>{!data ? "榜单正在就位" : !data.rows.length ? "第一份远见，正在路上。" : "下一位合伙人，会是你吗？"}</h2><p>{data?.status === "draft" ? "活动启动后，完成投资即可登榜。" : "基金结算后自动登榜。\n每一个选择，都可能改写这里。"}</p></div>}
          <div className="contenders-caption"><span>{rest.length ? `共 ${rest.length} 位合伙人追逐下一份回报` : "每一份远见，都值得被看见"}</span><span className="pagination-dots" aria-hidden="true">{Array.from({ length: Math.min(pages, 10) }, (_, index) => <i className={index === page % 10 ? "active" : ""} key={index} />)}</span></div>
        </div>
      </section>
    </div>
    <footer className="live-footer"><div className={`live-status ${error ? "disconnected" : data?.status === "open" ? "is-live" : ""}`}><i /><span>{status}</span>{updatedAt && <small>最近同步 {clock(updatedAt)}</small>}</div><div className="live-participants"><strong>{data?.rows.length ?? 0}</strong><span>位合伙人已结算</span></div><div className="live-footnote">初始基金 {data?.initial ? `${data.initial / 100_000_000}亿元` : "—"} · 全部回报为模拟</div><div className="preview-controls"><button className="preview-toggle" onClick={() => setPreview(value => !value)} aria-expanded={preview}><Sparkles size={14} />动效预览 <small>临时</small></button>{preview && <div className="preview-menu"><p>仅播放效果，榜单成绩不变</p>{medals.map((medal, index) => <button className={`medal-${index + 1}`} onClick={() => playPreview(index + 1)} key={medal}>{medal} · {index === 0 ? "刷新最高纪录" : `新晋第${index + 1}名`}</button>)}</div>}</div></footer>
    {!lottery && !!queue.length && <MedalCelebration key={queue[0].id} celebration={queue[0]} onComplete={complete} />}
    <LotteryDraw key={eventId} eventId={eventId} open={lottery} onClose={closeLottery} />
  </main>;
}
