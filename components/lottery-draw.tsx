"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Gift, LoaderCircle, Plus, RotateCcw, ShieldCheck, Sparkles, Star, X } from "lucide-react";
import { api, uuid } from "../lib/client";
import { luckyCandidates, type LotteryState, type LuckyDraw } from "../lib/lottery";
import type { LeaderRow } from "../lib/service";
import { LotteryCelebration } from "./lottery-celebration";
import styles from "./lottery-draw.module.css";

type DrawRequest = { action: "draw"; key: string; count: number; excludeWinners: boolean; replaceDrawId?: string };
type Phase = "ready" | "saving" | "rolling" | "done";

function SlotMachine({ index, winner, candidates, spinning, revealed }: { index: number; winner?: LeaderRow; candidates: LeaderRow[]; spinning: boolean; revealed: boolean }) {
  const strip = useMemo(() => Array.from({ length: 8 }, (_, offset) => candidates[(index * 7 + offset) % candidates.length]).filter(Boolean), [candidates, index]);
  const entry = (player: LeaderRow, key: string) => <div className={styles.entry} key={key}><strong title={player.name}>{player.name}</strong><span title={player.institution}>{player.institution}</span></div>;
  return <article className={`${styles.machine} ${revealed ? styles.won : ""}`} data-testid="lottery-machine" data-revealed={revealed}>
    <div className={styles.marquee}><span><i aria-hidden="true" /> LUCKY DRAW</span><strong>{String(index + 1).padStart(2, "0")}</strong></div>
    <div className={styles.bulbs} aria-hidden="true">{Array.from({ length: 5 }, (_, n) => <i key={n} />)}</div>
    <div className={styles.window} aria-live={revealed ? "polite" : "off"}>
      {revealed && winner ? <div className={styles.winnerEntry}>{entry(winner, winner.playerId)}<span className={styles.winnerBadge}><Check size={12} /> 幸运观众</span></div> : spinning ? <div className={styles.reel} aria-hidden="true"><div>{[...strip, ...strip].map((player, n) => entry(player, `${player.playerId}-${n}`))}</div></div> : <div className={styles.placeholder}><Gift size={38} strokeWidth={1.2} /><strong>等待揭晓</strong><span>YOUR MOMENT AWAITS</span></div>}
    </div>
    <div className={styles.machineBottom}><i /><small>{revealed ? "WINNER CONFIRMED" : "A NIGHT · 2ND"}</small></div>
    <div className={styles.feet} aria-hidden="true"><i /><i /></div>
  </article>;
}

export function LotteryDraw({ eventId, open, onClose }: { eventId: string; open: boolean; onClose: () => void }) {
  const [state, setState] = useState<LotteryState | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [count, setCount] = useState(5), [moreCount, setMoreCount] = useState(1), [exclude, setExclude] = useState(true);
  const [phase, setPhase] = useState<Phase>("ready"), [revealed, setRevealed] = useState(0), [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState(false), [preparingMore, setPreparingMore] = useState(false), [pending, setPending] = useState<DrawRequest | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const dialog = useRef<HTMLElement>(null), confirmation = useRef<HTMLElement>(null), inFlight = useRef(false);
  const pendingRequest = useRef<DrawRequest | null>(null);
  const pendingKey = `vc-lottery-pending:${eventId}`;
  const latest = state?.draws.at(-1), busy = phase === "saving" || phase === "rolling";
  const pool = state ? luckyCandidates(state.candidates, state.draws, latest ? exclude : true) : [];
  const requestedCount = preparingMore ? moreCount : count;
  const machineCount = phase === "rolling" || !preparingMore && latest ? latest!.winners.length : Math.min(pending?.count ?? requestedCount, pool.length);
  const showWinners = !!latest && !preparingMore && phase !== "saving";

  function clearPending() { pendingRequest.current = null; setPending(null); try { sessionStorage.removeItem(pendingKey); } catch { /* In-memory retries still work. */ } }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(""); setConfirm(false); setHistory(false); setPreparingMore(false); setCelebrating(false);
    let saved: DrawRequest | null = pendingRequest.current;
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey) || "null") as DrawRequest | null;
      if (value?.action === "draw" && typeof value.key === "string" && Number.isInteger(value.count) && value.count >= 1 && value.count <= 100 && typeof value.excludeWinners === "boolean") saved = value;
    } catch { /* A unavailable or outdated storage entry must not block the drawer. */ }
    pendingRequest.current = saved; setPending(saved);
    void api<LotteryState>(`/api/admin/lottery?event=${encodeURIComponent(eventId)}`).then(value => {
      if (cancelled) return;
      setState(value); setCount(value.defaultCount); setPhase(value.draws.length ? "done" : "ready"); setRevealed(value.draws.at(-1)?.winners.length ?? 0);
      if (saved && value.draws.some(draw => draw.request_key === saved!.key)) clearPending();
    }).catch(reason => { if (!cancelled) setError((reason as Error).message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || phase !== "rolling" || !latest) return;
    const timers = latest.winners.map((_, index) => setTimeout(() => {
      setRevealed(index + 1);
      if (index === latest.winners.length - 1) { setPhase("done"); setCelebrating(true); }
    }, 2400 + index * Math.min(650, 6000 / latest.winners.length)));
    return () => timers.forEach(clearTimeout);
  }, [open, phase, latest]);

  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), 6200);
    return () => clearTimeout(timer);
  }, [celebrating]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = confirm ? confirmation.current : dialog.current;
    root?.focus({ preventScroll: true });
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (phase === "saving") return;
        if (confirm) setConfirm(false); else onClose();
      }
      if (event.key !== "Tab" || !root) return;
      const buttons = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex="0"]')];
      const first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, confirm, phase, onClose]);

  async function start(mode: "initial" | "more" | "redraw") {
    if (inFlight.current || busy || !state?.locked) return;
    const body: DrawRequest = pending ?? { action: "draw", key: uuid(), count: mode === "redraw" ? latest!.winners.length : mode === "more" ? moreCount : count, excludeWinners: mode === "more" ? exclude : true, ...(mode === "redraw" ? { replaceDrawId: latest!.id } : {}) };
    inFlight.current = true; pendingRequest.current = body; setPhase("saving"); setError(""); setConfirm(false); setPending(body); setCelebrating(false);
    try { sessionStorage.setItem(pendingKey, JSON.stringify(body)); } catch { /* Keep retries in memory. */ }
    try {
      const response = await fetch(`/api/admin?event=${encodeURIComponent(eventId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) { if (response.status < 500) clearPending(); throw new Error(value.error || "抽取失败，请重试。"); }
      const draw = value as LuckyDraw;
      clearPending();
      setState(current => current && ({ ...current, draws: [...current.draws.filter(item => item.id !== body.replaceDrawId && item.id !== draw.id), draw] }));
      setPreparingMore(false); setRevealed(0); setPhase("rolling");
    } catch (reason) { setError((reason as Error).message); setPhase(latest ? "done" : "ready"); }
    finally { inFlight.current = false; }
  }
  function prepareMore() { setPreparingMore(true); setPhase("ready"); setError(""); }
  function finish() { setRevealed(latest?.winners.length ?? 0); setPhase("done"); setCelebrating(true); }
  if (!open) return null;

  return <div className={styles.backdrop} onClick={() => { if (phase !== "saving" && !confirm) onClose(); }}>
    <section ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="lottery-title" onClick={event => event.stopPropagation()}>
      <button className={styles.close} aria-label="关闭抽奖浮窗" disabled={phase === "saving"} onClick={onClose}><X size={22} /></button>
      <div className={styles.brandRow}><div className={styles.brand}>A Night<sup>2nd</sup><span>智元创投 A 计划</span></div><span className={styles.edition}>2026 AGIBOT INNOVATION DAY</span></div>
      <header className={styles.header}><div className={styles.kicker}><span /> THE NEXT LUCKY MOMENT <span /></div><h1 id="lottery-title">幸运观众 <span className={styles.titleTag}>LUCKY DRAW</span></h1><p>{phase === "rolling" ? "下一位幸运观众，正在揭晓" : phase === "done" && latest ? "恭喜本轮幸运观众，共赴下一个精彩时刻" : "投资未来，也让好运在此刻发生"}</p></header>
      {loading ? <div className={styles.loading}><LoaderCircle className="spin" /> 正在同步候选与中奖名单…</div> : <>
        <div className={styles.roster}><span><ShieldCheck size={16} />{state?.locked ? `名单已锁定 · ${state.candidates.length} 位观众` : "等待锁定名单"}</span><span>{preparingMore ? `准备第 ${state!.draws.length + 1} 轮 · 抽取 ${machineCount} 位` : latest ? `第 ${state!.draws.length} 轮 · ${latest.winners.length} 位幸运观众` : `本轮抽取 ${machineCount} 位`}</span></div>
        {!state?.locked && <p className={styles.notice}>请先在主办方工作台停止活动并冻结最终榜单，再开始抽奖。</p>}
        {error && <div className={styles.error} role="alert">{error}<button onClick={() => { setLoading(true); void api<LotteryState>(`/api/admin/lottery?event=${encodeURIComponent(eventId)}`).then(value => { setState(value); setPreparingMore(false); setCelebrating(false); setPhase(value.draws.length ? "done" : "ready"); setRevealed(value.draws.at(-1)?.winners.length ?? 0); if (pending && value.draws.some(draw => draw.request_key === pending.key)) clearPending(); setError(""); }).catch(reason => setError(reason.message)).finally(() => setLoading(false)); }}>刷新名单</button></div>}
        {pending && phase !== "saving" && phase !== "rolling" && <p className={styles.notice}>上次请求尚未确认。点击摇杆同步同一次抽取结果，避免重复抽取。</p>}
        <div className={styles.stage}>
          <div className={styles.machines} style={{ "--columns": Math.min(5, Math.max(1, machineCount)) } as CSSProperties}>
            {machineCount ? Array.from({ length: machineCount }, (_, index) => <SlotMachine key={`${latest?.id ?? "slots"}-${index}`} index={index} candidates={state?.candidates ?? []} winner={showWinners ? latest?.winners[index] : undefined} spinning={phase === "rolling" && index >= revealed} revealed={showWinners && (phase === "done" || phase === "rolling" && index < revealed)} />) : <div className={styles.empty}><Gift size={48} /><h2>{state?.locked ? "本轮暂无可抽取的观众" : "好运舞台，准备就绪"}</h2><p>{state?.locked ? "可取消排除已中奖人员，开启特别礼品抽奖。" : "锁定名单后，幸运观众将在这里揭晓。"}</p></div>}
          </div>
          <button className={`${styles.lever} ${busy ? styles.pulled : ""}`} aria-label={pending ? "摇杆：同步抽取结果" : "摇杆：开始抽奖"} disabled={loading || busy || !state?.locked || (!pending && (!!latest && !preparingMore || !machineCount))} onClick={() => void start(preparingMore ? "more" : "initial")}><span className={styles.leverBall} /><span className={styles.leverStem} /><span className={styles.leverBase} /><span className={styles.leverLabel}>{phase === "saving" ? "正在抽取" : phase === "rolling" ? "好运转动中" : latest && !preparingMore && !pending ? "本轮已揭晓" : pending ? "同步结果" : "拉动摇杆"}</span></button>
        </div>
        <div className={styles.status} role="status">{phase === "rolling" ? <><Sparkles size={18} />正在揭晓 {revealed} / {latest?.winners.length}<button onClick={finish}>跳过动画</button></> : phase === "saving" ? <><LoaderCircle className="spin" size={18} />正在保存本轮中奖名单…</> : phase === "done" && latest ? <><Gift size={18} />本轮 {latest.winners.length} 位幸运观众已揭晓 · 名单已保存</> : <><Star size={16} />准备好接住这份好运了吗？</>}</div>
        {state?.locked && <div className={styles.controls}>
          {!latest ? <label className={styles.countControl}>抽取人数<input type="number" aria-label="抽取人数" min={1} max={100} value={count} disabled={busy || !!pending} onChange={event => setCount(Math.min(100, Math.max(1, Math.trunc(Number(event.target.value)) || 1)))} /><span>位</span></label> : <>
            <button className={styles.secondary} disabled={busy || !!pending} onClick={() => setConfirm(true)}><RotateCcw size={16} />重抽本轮</button>
            <div className={styles.moreControls}><label>再抽<input type="number" aria-label="再抽几个" min={1} max={100} value={moreCount} disabled={busy || !!pending} onChange={event => setMoreCount(Math.min(100, Math.max(1, Math.trunc(Number(event.target.value)) || 1)))} />位</label><label className={styles.exclude}><input type="checkbox" checked={exclude} disabled={busy || !!pending} onChange={event => setExclude(event.target.checked)} />排除已抽中人员</label><button className={styles.primary} disabled={busy || !!pending || !pool.length || preparingMore} onClick={prepareMore}><Plus size={16} />{preparingMore ? "请拉动摇杆" : "抽取更多"}</button></div>
          </>}
        </div>}
        <div className={styles.details}>
          {!busy && state?.locked && (!latest || preparingMore) && <p className={styles.hint}>可参与 {pool.length} 人{requestedCount > pool.length ? ` · 名额超过候选人数，本轮将抽取 ${pool.length} 人` : ""}{preparingMore && <button onClick={() => { setPreparingMore(false); setPhase("done"); }}>返回本轮名单</button>}</p>}
          {!busy && latest && <div className={styles.history}><button aria-expanded={history} onClick={() => setHistory(value => !value)}>中奖名单 · 共 {state!.draws.length} 轮 / {state!.draws.reduce((sum, draw) => sum + draw.winners.length, 0)} 个名额<ChevronDown size={16} className={history ? styles.flipped : ""} /></button>{history && <div className={styles.historyList}>{state!.draws.map((draw, index) => <section key={draw.id}><h3>第 {index + 1} 轮 <small>{draw.winners.length} 位</small></h3><div>{draw.winners.map(winner => <p key={winner.playerId}><strong>{winner.name}</strong><span>{winner.institution}</span></p>)}</div></section>)}</div>}</div>}
        </div>
      </>}
      <footer className={styles.footer}><span>A NIGHT · INVEST IN THE NEXT</span><span>关闭后，可再次打开查看中奖名单</span></footer>
      {celebrating && phase === "done" && latest && !preparingMore && !loading && <div className={styles.celebration} key={latest.id} data-testid="lottery-celebration" aria-hidden="true"><LotteryCelebration /></div>}
      {confirm && <div className={styles.confirmBackdrop}><section ref={confirmation} className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="lottery-confirm-title" tabIndex={-1}><span className={styles.confirmIcon}><RotateCcw size={30} /></span><h2 id="lottery-confirm-title">确定重抽本轮吗？</h2><p>第 {state!.draws.length} 轮的 {latest!.winners.length} 位中奖名单将被新结果替换。其他轮次保留，已在其他轮次中奖的人员仍被排除。</p><p className={styles.confirmNote}>本轮原中奖人员重新参与抽取，可能再次中奖。</p><div><button className={styles.secondary} onClick={() => setConfirm(false)}>保留现有名单</button><button className={styles.primary} onClick={() => void start("redraw")}>确认重抽</button></div></section></div>}
    </section>
  </div>;
}
