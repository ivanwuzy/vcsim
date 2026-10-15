"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Compass, Fingerprint, Gift, Layers3, LoaderCircle, MapPin, Moon, Sparkles, Sun, TrendingUp, Trophy, X } from "lucide-react";
import type { Choice, Decision, RunView } from "../lib/types";
import type { result as serverResult } from "../lib/service";
import { api, money, uuid } from "../lib/client";
import { Brand } from "./brand";
type Result = Awaited<ReturnType<typeof serverResult>>;
type Meta = { contentVersion?: string; yearBasis?: "entry" | "legacy"; id: string; title: string; status: string; mode: string; total: number; initial: number; ticket: number; maxTicket?: number; maxInvestments: number; endOnInvestmentLimit: boolean; settlementYear: number; eras: { title: string; text: string }[] };
type Pending = Decision;

export default function Game() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [meta, setMeta] = useState<Meta | null>(null), [run, setRun] = useState<RunView | null>(null), [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState(""), [institution, setInstitution] = useState(""), [recovery, setRecovery] = useState(""), [showRecovery, setShowRecovery] = useState(false);
  const [registered, setRegistered] = useState(false), [tutorial, setTutorial] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const [dx, setDx] = useState(0), drag = useRef<{ x: number; y: number; dx: number; pointerId: number } | null>(null), lock = useRef(false);
  const [rules, setRules] = useState(false), [expanded, setExpanded] = useState<string | null>(null), [showReviews, setShowReviews] = useState(false);
  const [selectedAmount, setAmount] = useState(5_000_000);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vc-game-theme");
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch { /* Theme switching remains available when storage is disabled. */ }
  }, []);
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { localStorage.setItem("vc-game-theme", next); } catch { /* Keep the current page's choice. */ }
  }
  const ticketLimit = meta?.maxTicket ?? meta?.ticket ?? 5_000_000;
  const maxAmount = run?.status === "playing" && !tutorial ? Math.min(ticketLimit, run.cash) : ticketLimit;
  const amount = Math.min(selectedAmount, maxAmount);
  function restoreAmount(runId: string | undefined, current: Meta | null) {
    if (!current) return;
    const stored = runId ? Number(localStorage.getItem(`amount:${runId}`)) : 0;
    setAmount(Number.isSafeInteger(stored) && stored >= current.ticket && stored <= (current.maxTicket ?? current.ticket) && stored % current.ticket === 0 ? stored : current.ticket);
  }
  function adjustAmount(value: number) {
    if (!meta || !run || busy || pending || run.eventStatus !== "open" || !Number.isFinite(value)) return;
    const next = Math.max(meta.ticket, Math.min(maxAmount, Math.round(value / meta.ticket) * meta.ticket));
    setAmount(next); localStorage.setItem(`amount:${run.id}`, String(next));
  }
  const loadedEventId = useRef<string | null>(null);
  async function load() {
    setLoading(true); setError("");
    try {
      const session = await api<{ meta: Meta | null; player: { name: string; institution: string } | null; run: RunView | null }>("/api/session");
      setMeta(session.meta); loadedEventId.current = session.meta?.id ?? null;
      restoreAmount(session.run?.id, session.meta);
      setRun(session.run); setResult(null); setPending(null); setTutorial(false); setRules(false); setExpanded(null); setShowReviews(false); setShowRecovery(false); setRecovery(""); setDx(0); drag.current = null;
      setRegistered(!!session.player);
      if (session.player) { setName(session.player.name); setInstitution(session.player.institution); }
      if (session.run) {
        setRun(session.run);
        const stored = localStorage.getItem(`pending:${session.run.id}`);
        if (stored) { const p = JSON.parse(stored) as Pending; if (p.projectId === session.run.card?.id) setPending(p); else localStorage.removeItem(`pending:${session.run.id}`); }
      }
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setInterval(async () => {
      if (busy || loading) return;
      try { const current = await api<Meta | null>("/api/meta"); if ((current?.id ?? null) !== loadedEventId.current) await load(); }
      catch { /* Keep saved progress while the network is unavailable. */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [busy, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!run || run.status !== "completed") return;
    let live = true;
    const refresh = () => api<Result>(`/api/runs/${run.id}/result`).then(value => { if (live) setResult(value); }).catch(e => { if (live) setError(e.message); });
    void refresh(); const timer = setInterval(refresh, 15000);
    return () => { live = false; clearInterval(timer); };
  }, [run]);
  async function enter(e?: FormEvent) {
    e?.preventDefault(); if (!meta || busy) return; setBusy(true); setError("");
    try {
      if (!registered) { await api(`/api/events/${meta.id}/players`, { name, institution, ...(recovery ? { recovery } : {}) }); setRegistered(true); }
      const value = await api<RunView>(`/api/events/${meta.id}/runs`, {}); setRun(value); restoreAmount(value.id, meta); window.scrollTo(0, 0);
      if (value.index === 0 && !localStorage.getItem(`taught:${meta.id}`)) setTutorial(true);
    } catch (e) { setError((e as Error).message); if ((e as Error).message.includes("已登记")) setShowRecovery(true); } finally { setBusy(false); }
  }
  async function commit(choice: Choice, retry?: Pending) {
    if (busy || run?.eventStatus !== "open") { setDx(0); return; }
    if (tutorial) { setTutorial(false); localStorage.setItem(`taught:${meta!.id}`, "yes"); setDx(0); return; }
    if (!run?.card || lock.current || (pending && !retry) || run.eventStatus !== "open") return;
    if (choice === "invest" && run.invested >= run.maxInvestments) { setDx(0); return; }
    if (choice === "invest" && run.cash < (retry?.amount ?? amount)) { setError("剩余本金不足，请降低投资金额或跳过项目。"); setDx(0); return; }
    lock.current = true; setBusy(true); setError("");
    const d = retry ?? { projectId: run.card.id, choice, key: uuid(), ...(choice === "invest" ? { amount } : {}) };
    setPending(d); localStorage.setItem(`pending:${run.id}`, JSON.stringify(d));
    try {
      const next = await api<RunView>(`/api/runs/${run.id}/decisions`, d);
      setRun(next); setPending(null); localStorage.removeItem(`pending:${run.id}`); setDx(0);
    } catch (e) { setError((e as Error).message); setDx(0); }
    finally { lock.current = false; setBusy(false); }
  }
  async function sync() {
    if (!run || busy) return; setBusy(true);
    try {
      const current = await api<RunView>(`/api/runs/${run.id}`); setRun(current);
      if (current.card?.id !== pending?.projectId) { setPending(null); localStorage.removeItem(`pending:${run.id}`); setError(""); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0 || busy || pending || run?.eventStatus !== "open" || (e.target as HTMLElement).closest("button,a")) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, pointerId: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const offset = e.clientX - drag.current.x;
    drag.current.dx = Math.abs(offset) > Math.abs(e.clientY - drag.current.y) ? offset : 0;
    setDx(drag.current.dx);
  }
  function cancelDrag() { drag.current = null; setDx(0); }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const offset = drag.current.dx; drag.current = null;
    if (Math.abs(offset) >= 90) void commit(offset > 0 ? "invest" : "pass"); else setDx(0);
  }
  const card = tutorial ? { id: "tutorial", alias: "未来便利店", year: 2011, sector: "教学卡 · 不计入成绩", pitch: "一家只卖创意的公司，值得你的第一笔投资吗？", team: "两位工程师，有热情，还没有产品。", technical: "用识别与自动取货机构完成便利店服务。", entryValuation: 100000000, traction: "朋友们都说想买，还没人真的付钱。", risk: "好故事是开始，付费客户才是线索。" } : run?.card;
  const phase = run ? run.year <= 2015 ? 0 : run.year <= 2020 ? 1 : 2 : 0;
  const boardUrl = "/leaderboard";
  const themeToggle = <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={theme === "light" ? "切换为深色" : "切换为浅色"} title={theme === "light" ? "切换为深色" : "切换为浅色"}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}<span>{theme === "light" ? "深色" : "浅色"}</span></button>;
  if (loading || !meta) return <main className="app game-app player-theme" data-theme={theme}><header className="site-header"><Brand href="/" />{themeToggle}</header><div className="loading">{loading ? <><LoaderCircle className="spin" /><p>正在打开你的投资世界…</p></> : <><h1>暂无进行中的活动</h1><p>请等待主办方启动活动，页面会自动更新。</p>{error && <p role="alert">{error}</p>}<button className="btn primary" onClick={load}>刷新活动</button><a className="text-link" href="/admin">活动管理</a></>}</div></main>;
  return <main className={`app player-theme ${run ? "game-app in-game" : "event-home"}`} data-theme={theme}>
    <header className="site-header"><Brand href="/" /><div className="header-right"><span className="header-event"><span className="event-dot" />{meta.title}</span>{meta.mode === "demo" && <span className="tag">演示</span>}<a href={boardUrl} className="text-link">排行榜 <ArrowUpRight size={15} /></a>{themeToggle}</div></header>
    {!run ? <div className="landing">
      <section className="hero">
        <div className="hero-art" aria-hidden="true" />
        <div className="hero-top"><span className="eyebrow">2026 智元创新日</span><span className="innovation-en">AGIBOT INNOVATION DAY 2026</span></div>
        <h1 className="event-title">A Night <span className="event-edition">2nd</span></h1>
        <div className="event-subtitle"><span>智元创投 A 计划</span><span className="event-location"><MapPin size={13} />10月28日 · 上海</span></div>
        <div className="game-invitation"><span className="game-label"><span className="dot" /> 活动专属 · 趣味投资小游戏</span><h2>发现潜力。<br />投出直觉。<br /><span>重仓未来。</span></h2><p className="hero-description"><strong>把 BP 留在家里，把好奇心带来。</strong><br />这是为本次 A Night 设计的具身投资小游戏。<br />用一只虚拟基金，体验技术、时代与运气的交汇。</p></div>
        <a href="#join-game" className="btn primary mobile-entry">开始小游戏 <ArrowRight size={18} /></a>
        <div className="hero-facts"><div><strong>{meta.total}<span>个项目</span></strong><small>按时间遇见，最多投20家</small></div><div><strong>3–5<span>分钟</span></strong><small>轻松开局 · 不限时</small></div></div>
        <div className="hero-caption"><span>活动话题 / 具身 · 量子 · Infra · 脑机</span><ArrowUpRight size={15} /></div>
      </section>
      <section className="entry-panel">
        <div className="fund-preview"><div className="entry-kicker"><span><Sparkles size={15} /> A NIGHT PLAYGROUND</span><span className="fund-status"><span className="dot" /> 虚拟基金</span></div><p>你的第一只基金</p><div className="fund-balance">{money(meta.initial)}<span>万元</span><span className="fund-currency">CNY</span></div><div className="chart-caption"><span>未来，由你的选择绘制</span><small>示意走势</small></div><svg className="fund-chart" viewBox="0 0 360 72" fill="none" aria-hidden="true"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="72" gradientUnits="userSpaceOnUse"><stop stopColor="#8da8ff" stopOpacity=".3" /><stop offset="1" stopColor="#8da8ff" stopOpacity="0" /></linearGradient></defs><path d="M0 61C22 61 22 34 43 35S64 65 85 52S102 17 125 24S145 53 168 44S196 13 222 24S243 38 267 21S301 38 322 13L355 4V72H0Z" fill="url(#chart-fill)" /><path d="M0 61C22 61 22 34 43 35S64 65 85 52S102 17 125 24S145 53 168 44S196 13 222 24S243 38 267 21S301 38 322 13L355 4" stroke="#b6c9ff" strokeWidth="1.5" /><circle cx="125" cy="24" r="4" fill="white" /><circle cx="267" cy="21" r="4" fill="white" /><path d="m346 4 9 0-2 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg><div className="fund-terms"><span><strong>{money(meta.ticket)} 万</strong>默认单笔投资</span><span><strong>{meta.total} 个</strong>项目机会</span><span><strong>{meta.settlementYear} 年</strong>模拟清算</span></div></div>
        <form id="join-game" className="entry-form" onSubmit={enter}><div className="form-heading"><span className="form-overline">具身 VC 投资模拟器</span><h2>{registered ? `欢迎回来，${name}` : "就位，合伙人。"}</h2><p>{registered ? "你的时间线与投资记录已经保存。" : "为今晚的好奇心，开一只虚拟基金。填写姓名与机构，即可开始。"}</p></div>
          {!registered && <><label>你的姓名<input required maxLength={80} autoComplete="name" placeholder="请输入真实姓名" value={name} onChange={e => setName(e.target.value)} /></label><label>机构名称<input required maxLength={80} autoComplete="organization" placeholder="例如：某某资本" value={institution} onChange={e => setInstitution(e.target.value)} /></label></>}
          {showRecovery && <label>工作人员提供的恢复码<input value={recovery} maxLength={80} onChange={e => setRecovery(e.target.value)} placeholder="换机或重名，请先联系工作人员" /></label>}
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary wide" disabled={busy || !["open"].includes(meta.status)}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{meta.status === "open" ? registered ? "继续我的投资之旅" : "开启我的投资之旅" : meta.status === "draft" ? "活动即将开放" : "活动已停止新参赛"}<ArrowRight size={19} /></button>
          {!registered && <p className="privacy"><Fingerprint size={14} /> 姓名与机构仅用于本场排名和领奖核验</p>}
          <button type="button" className="rules-link" onClick={() => setRules(true)}><CircleHelp size={14} /> 先看看怎么玩</button>
        </form>
        <div className="event-rewards"><div><span><Trophy size={18} /></span><p><strong>凭眼光登榜</strong><small>活动收尾，排名靠前的玩家获得奖励</small></p></div><div><span><Gift size={18} /></span><p><strong>也凭一点好运</strong><small>基金结算后，即可参与幸运礼品抽奖</small></p></div></div>
      </section>
      <section className="play-guide" aria-label="玩法速览"><div className="guide-heading"><span className="eyebrow">A LITTLE GAME. A BIG WHAT IF.</span><h2>把今晚的好奇，变成一次选择。</h2></div><div className="guide-steps"><div><span>01</span><p><strong>看见机会</strong><small>按固定时间线读项目卡，从有限线索做判断。</small></p><Compass size={21} /></div><div><span>02</span><p><strong>跟随判断</strong><small>右滑按选定金额投资，默认 {money(meta.ticket)} 万，最多投 {meta.maxInvestments} 家；左滑等待。</small></p><ArrowRight size={21} /></div><div><span>03</span><p><strong>揭晓未来</strong><small>本金投完或投满名额即结算；或看完 {meta.total} 个项目，剩余现金保本。</small></p><TrendingUp size={21} /></div></div><p className="event-signoff">来 A Night 逛一逛。碰杯无需理由，举杯皆是同谋。</p></section>
    </div> : run.status === "completed" ? result ? <div className="result-page">
      <div className="result-intro"><span className="eyebrow">{meta.settlementYear} · FUND CLOSED</span><div className="result-emblem"><TrendingUp size={34} strokeWidth={1.5} /></div><h1>选择有了回响。</h1><p role="status">{result.completionReason === "principal-exhausted" ? `已完成基金投资：本金已全部投完，后续${result.unseen}个项目未再呈现。` : result.completionReason === "investment-limit" ? `已完成基金投资：提前投满${meta.maxInvestments}家，后续${result.unseen}个项目未再呈现。` : `时间线已结束，你已看完${result.seen}个项目。`}</p><p>{result.player.name}，你投资了{result.invested}家，保留{money(result.unspent)}万元未投本金。</p></div>
      <section className="return-card"><span>基金最终净收益</span><div className={result.profit >= 0 ? "return-amount positive" : "return-amount negative"}>{result.profit > 0 ? "+" : ""}{money(result.profit, 2)}<small>万元</small></div><div className="return-stats"><div><strong>{money(result.value, 2)}</strong><small>基金终值 / 万元</small></div><div><strong>{(result.profit / result.initial * 100).toFixed(2)}%</strong><small>收益率</small></div><div><strong>{result.rank ? `#${result.rank}` : "—"}</strong><small>{result.frozen ? "最终" : "当前"}排名 / {result.participants}人</small></div></div></section>
      <div className="highlights">{[["最成功的一笔", result.highlights.best], ["避开的最大亏损", result.highlights.avoided], ["已跳过的最大机会", result.highlights.missed]].map(([title, p]) => { const project = p as Result["reviews"][number] | null; return <div className="highlight" key={String(title)}><span>{String(title)}</span><strong>{project?.alias ?? "本局暂无"}</strong><small>{project ? `${project.multiple.toFixed(2)}× 模拟回报` : "每种选择都构成你的组合"}</small></div>; })}</div>
      <a className="btn primary wide" href={boardUrl}>看看合伙人排行榜 <ArrowUpRight size={18} /></a>
      <div className="complete-note"><Check size={15} /> 已进入本场幸运抽奖候选池，等候活动收尾揭晓。</div>
      <button className="btn wide review-entry" onClick={() => setShowReviews(true)}>查看 {result.seen} 个项目复盘 <ArrowRight size={17} /></button>
      {showReviews && <div className="modal-backdrop"><section className="modal review-modal" role="dialog" aria-modal="true" aria-label="项目复盘"><button className="close-modal" aria-label="关闭复盘" onClick={() => setShowReviews(false)}><X /></button><div className="review-heading"><h2>原来，这就是他们。</h2><p>复盘仅包含已看过的{result.seen}个项目。真实案例按人工基准、公开估值参考与教学假设结算；账面回报不等于实际退出收益。</p></div>
      <section className="reviews">{result.reviews.map(p => <article className="review" key={p.id}><button className="review-toggle" onClick={() => setExpanded(expanded === p.id ? null : p.id)}><span className={`review-choice ${p.choice}`}>{p.choice === "invest" ? "投" : "过"}</span><span className="review-name"><strong>{p.alias}</strong><small>{p.real ? p.name : "示例占位 · 待替换真实案例"} · {p.year}</small></span><span className={p.multiple >= 1 ? "positive" : "negative"}>{p.multiple.toFixed(2)}×</span><ChevronDown size={16} className={expanded === p.id ? "rotated" : ""} /></button>{expanded === p.id && <div className="review-detail">{p.choice === "invest" && <p>本次投资 {money(p.amount)} 万元 · 净收益 {money(p.profit, 2)} 万元</p>}<label>{p.real ? "真实历史" : "示例故事与模拟回报"}</label><p>{p.history}</p><label>本局回报依据</label><p>{p.ending}</p><label>投资思考</label><p>{p.lesson}</p>{p.sources.map((s, i) => <a href={s.url} key={i} target="_blank" rel="noreferrer" className="source-link">来源线索 {s.publishedAt ?? "· 待补日期"}<ArrowUpRight size={12} /></a>)}{meta.mode === "demo" && <small className="draft-note">回报为游戏测算，资料口径和信息边界见本题来源。</small>}</div>}</article>)}</section></section></div>}
    </div> : <div className="loading"><LoaderCircle className="spin" /><p>正在结算你的基金…</p>{error && <><p role="alert">{error}</p><button className="btn" onClick={() => api<Result>(`/api/runs/${run.id}/result`).then(setResult).catch(e => setError(e.message))}>重试结算</button></>}</div> : <div className="play-layout">
      <section className="play-main">
        <div className="game-stats" aria-label="投资进度" aria-live="polite"><div><small>当前年代</small><strong>{tutorial ? "教学" : run.year}<span>{!tutorial && " 年"}</span></strong></div><div className="progress-stat"><small>已查看 BP</small><strong>{tutorial ? "00" : String(run.index + 1).padStart(2, "0")}<span> / {run.total}</span></strong></div><div><small>已投项目</small><strong>{run.invested}<span> / {run.maxInvestments}</span></strong></div><div className="cash-stat"><small>剩余可投本金</small><strong>{money(run.cash)}<span> 万</span></strong></div></div>
        <div className="progress-track"><i style={{ width: `${run.index / run.total * 100}%` }} /></div>
        <div className="era-banner"><span className="dot" /><span>{tutorial ? "先练习一次，教学卡不计入成绩" : meta.eras[phase].title}</span><button className="game-help" onClick={() => setRules(true)} aria-label="查看游戏规则"><CircleHelp size={14} /> 玩法</button></div>
        {tutorial && <div className="tutorial-guide" aria-label="滑动教学"><div><span className="tutorial-pass"><ArrowLeft size={20} /> 左滑不投</span><span className="tutorial-invest">右滑投资 {money(amount)}万 <ArrowRight size={20} /></span></div><p>也可以点击底部按钮投资，调整滑轨修改投资金额</p><small>左右拖动试试看，滑动足够距离后松手确认</small></div>}
        {card && <div className="card-stack"><div className="card-shadow" /><div key={card.id} data-testid="project-card" className={`project-card ${busy ? "saving" : ""} ${dx ? "dragging" : ""}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelDrag} onLostPointerCapture={() => { if (drag.current) cancelDrag(); }} style={{ transform: `translateX(${Math.max(-120, Math.min(120, dx * .65))}px) rotate(${Math.max(-8, Math.min(8, dx / 22))}deg)` }}>
          {Math.abs(dx) > 8 && <div className={`swipe-overlay ${dx > 0 ? "invest" : "pass"}`} data-testid="swipe-overlay" style={{ "--swipe-opacity": Math.min(.62, .15 + Math.abs(dx) / 220) } as CSSProperties} aria-hidden="true"><strong>{dx > 0 ? `投资${money(amount)}万` : "不投"}</strong><span>{dx > 0 && !tutorial && run.cash < amount ? "本金不足 · 请降低金额" : Math.abs(dx) >= 90 ? "松手确认" : "继续滑动 · 松手可取消"}</span></div>}
          <div className="card-top"><span className="sector-tag">{card.sector}{card.placeholder ? " · 示例占位" : ""}</span><span className="card-number">{tutorial ? "TRY IT" : `DEAL ${String(run.index + 1).padStart(2, "0")}`}</span></div>
          <div className="project-heading"><div className={`project-symbol symbol-${phase}`}><Compass size={27} strokeWidth={1.3} /></div><h2>{card.alias}</h2></div><p className="pitch">{card.pitch}</p>{!tutorial && <div className="card-meta"><span>{card.yearBasis === "entry" ? `${card.year} 年投资时点` : card.yearBasis === "founded" ? `${card.year} 年创办` : card.yearBasis === "first-funding" ? `${card.year} 年首轮融资` : `${card.year} 年 · 示例年份待补`}</span>{card.entryValuation !== undefined && <span>进入参考 {money(card.entryValuation)} 万元</span>}{card.entryReference && <span>进入参考 {card.entryReference}</span>}</div>}
          {tutorial ? <div className="tutorial-card-note"><Compass size={30} strokeWidth={1.3} /><p>看线索，做判断。<br />正式项目会展示团队、技术、商业化与风险。</p><small>这张卡片只用来练习操作</small></div> : <div className="card-facts"><div><label><Layers3 size={13} /> 团队背景</label><p>{card.team}</p></div><div><label><Layers3 size={13} /> 技术亮点</label><p>{card.technical}</p></div><div><label><TrendingUp size={13} /> 商业化亮点</label><p>{card.traction}</p></div><div className="risk-fact"><label><CircleHelp size={13} /> 值得多想一步</label><p>{card.risk}</p></div></div>}
        </div></div>}

        {error && <div className="error" role="alert">{error}</div>}
        <div className="decision-area">
        {maxAmount > meta.ticket && <div className="investment-adjuster" role="group" aria-label="调整投资金额"><div className="amount-summary"><label htmlFor="investment-amount">单笔投资</label><strong aria-live="polite">{money(amount)}<small> 万</small></strong><small>拖动选择 · 每档 {money(meta.ticket)} 万</small></div><input id="investment-amount" className="amount-slider" type="range" min={meta.ticket} max={maxAmount} step={meta.ticket} value={amount} aria-valuetext={`${money(amount)} 万元`} disabled={busy || !!pending || run.eventStatus !== "open"} onChange={e => adjustAmount(e.currentTarget.valueAsNumber)} style={{ "--amount-progress": `${(amount - meta.ticket) / (maxAmount - meta.ticket) * 100}%` } as CSSProperties} /><div className="amount-ticks" aria-hidden="true">{Array.from({ length: maxAmount / meta.ticket }, (_, i) => { const value = (i + 1) * meta.ticket; return <span key={value} className={value === amount ? "selected" : ""} style={{ left: `${i / (maxAmount / meta.ticket - 1) * 100}%` }}>{value / 10000}</span>; })}</div></div>}
        {pending && !busy ? <div className="retry-panel"><p>已保留“{pending.choice === "invest" ? `投资 ${money(pending.amount ?? meta.ticket)} 万` : "不投"}”选择，确认保存后继续。</p><button className="btn primary" onClick={() => commit(pending.choice, pending)}>重试保存</button><button className="btn" onClick={sync}>同步进度</button></div> : <div className="decision-buttons"><button className="decision pass" onClick={() => commit("pass")} disabled={busy || run.eventStatus !== "open"}><span><X size={24} /></span><div><strong>不投</strong></div></button><button className="decision invest" onClick={() => commit("invest")} title={!tutorial && run.cash < amount ? "本金不足，请降低金额" : undefined} aria-description={!tutorial && run.cash < amount ? "本金不足，请降低金额" : undefined} disabled={busy || run.eventStatus !== "open" || (!tutorial && (run.invested >= run.maxInvestments || run.cash < amount))}><span>{busy ? <LoaderCircle className="spin" size={24} /> : <Check size={25} />}</span><div><strong>{!tutorial && run.invested >= run.maxInvestments ? "投资名额已用完" : `投资 ${money(amount)} 万`}</strong></div></button></div>}
        <div className="decision-note">{run.eventStatus !== "open" ? "活动已停止，进度已保存。" : tutorial ? "练习不消耗本金，也不增加已查看 BP 数" : "左滑不投 · 右滑投资 · 确认后不可撤回"}</div></div>
      </section>
    </div>}
    <footer className="site-footer"><span>A Night 2nd · 碰杯无需理由，举杯皆是同谋</span><span>仅供交流娱乐 · 全部收益为模拟</span>{!run && <a href="/admin">活动管理 <ArrowUpRight size={11} /></a>}</footer>
    {rules && <div className="modal-backdrop" onClick={() => setRules(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="游戏规则" onClick={e => e.stopPropagation()}><button className="close-modal" aria-label="关闭规则" onClick={() => setRules(false)}><X /></button><span className="eyebrow">HOW TO PLAY</span><h2>{meta.total}个机会，最多投{meta.maxInvestments}次。</h2>{run?.eraNotice && <p className="era-context">{run.eraNotice.title} · {run.eraNotice.text}</p>}{!!run?.updates.length && <p>{run.updates.slice(-2).map(u => `${u.year} · ${u.alias}：${u.text}`).join(" ")}</p>}<ul className="rule-list"><li><ArrowRight /> 初始本金{money(meta.initial)}万元；右滑按选定金额投资，默认{money(meta.ticket)}万元，左滑保留现金。</li><li><Layers3 /> 单笔最高{money(ticketLimit)}万元{ticketLimit > meta.ticket ? `（基金本金的20%），拖动底部横向滑轨，按${money(meta.ticket)}万元一档调整；金额持续生效，剩余本金不足时自动调低，单笔不得超过余额。` : "，旧场次使用固定额度。"}</li><li><Layers3 /> 全部{meta.total}个项目按{meta.yearBasis === "entry" ? "选定投资时点" : "历史年份"}，以固定顺序逐张出现；不能提前翻牌或回头改选。</li><li><Sparkles /> 最多投{meta.maxInvestments}家；{meta.endOnInvestmentLimit ? "投满立即提示完成基金投资并结算，后续项目不再呈现。" : "旧活动投满后继续跳过余下项目。"}</li><li><TrendingUp /> 本金全部投完立即结算；也可以一直不投，等待后续机会；看完{meta.total}个项目也会结束，未投现金按本金保留。</li></ul><p>50个项目均取材自真实案例，在终局揭晓。</p><p>基金净收益决定游戏内排名，最终进入活动幸运奖池。</p><button className="btn primary wide" onClick={() => setRules(false)}>明白，准备就位 <ArrowRight size={17} /></button></section></div>}
  </main>;
}
