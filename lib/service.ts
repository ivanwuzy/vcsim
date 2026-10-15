import { randomInt, randomUUID } from "node:crypto";
import { PROJECTS } from "../data/projects";
import { calculateValue, era, generateSnapshot, CONTENT_VERSION, investmentAmount, rankRows, validDeck, rulesFor, projectYear, valuationMultiple } from "./engine";
import { anonymizeText, playerCard } from "./cards";
import { getDb, transaction, type DB } from "./db";
import { hash, HttpError, newToken } from "./security";
import type { Decision, Project, RunView, Snapshot } from "./types";

export type EventRow = { id: string; title: string; status: string; mode: string; snapshot: Snapshot; settings: { topCount: number; luckyCount: number }; frozen_rows: LeaderRow[] | null };
export type PlayerRow = { id: string; event_id: string; name: string; institution: string; identity_key: string; token_hash: string; recovery_hash: string | null };
export type RunRow = { id: string; player_id: string; event_id: string; deck_id: string; decisions: Decision[]; status: "playing" | "completed"; profit: string | number | null; completed_at: string | null };
export type LeaderRow = { playerId: string; name: string; institution: string; profit: number; rank: number };
const globalService = globalThis as typeof globalThis & { vcSeed?: Promise<void>; vcSeedVersion?: string };
// Rule upgrades must not overwrite an unchanged bank or an administrator's imported cards.
const BANK_VERSION = `2026.10-workbook-v3:${hash(JSON.stringify(PROJECTS))}`;
const SEED_VERSION = `${CONTENT_VERSION}:${BANK_VERSION}`;
export async function ensureSeed() {
  if (globalService.vcSeedVersion !== SEED_VERSION) { globalService.vcSeed = undefined; globalService.vcSeedVersion = SEED_VERSION; }
  globalService.vcSeed ??= (async () => {
    await transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(20261028)");
      const settings = (await db.query<{ content_version: string }>("SELECT content_version FROM game_settings WHERE id=1")).rows[0];
      if (settings) {
        const bankChanged = settings.content_version !== BANK_VERSION;
        if (bankChanged) await db.query("UPDATE game_settings SET content_version=$1,projects=$2 WHERE id=1", [BANK_VERSION, JSON.stringify(PROJECTS)]);
        const unplayed = (await db.query<EventRow>("SELECT * FROM events e WHERE status IN ('draft','open') AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.event_id=e.id) FOR UPDATE")).rows;
        for (const event of unplayed) {
          // Retain legacy banks that cannot satisfy the current timeline's project count.
          if ((!bankChanged && event.snapshot.version === CONTENT_VERSION) || event.snapshot.projects.length !== PROJECTS.length || new Set(event.snapshot.projects.map(p => p.id)).size !== PROJECTS.length) continue;
          await db.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify(generateSnapshot(bankChanged ? PROJECTS : event.snapshot.projects, newToken())), event.id]);
        }
        return;
      }
      const legacy = (await db.query<EventRow>("SELECT * FROM events ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE")).rows[0];
      const projects = legacy?.snapshot.version === CONTENT_VERSION ? legacy.snapshot.projects : PROJECTS;
      await db.query("INSERT INTO game_settings(id,content_version,projects) VALUES(1,$1,$2)", [BANK_VERSION, JSON.stringify(projects)]);
      if (legacy) {
        const runs = await db.query("SELECT id FROM runs WHERE event_id=$1 LIMIT 1", [legacy.id]);
        if (!runs.rows.length && legacy.snapshot.version !== CONTENT_VERSION && ["open", "draft"].includes(legacy.status)) await db.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify(generateSnapshot(projects, newToken())), legacy.id]);
        return;
      }
      const mode = process.env.APP_MODE === "formal" ? "formal" : "demo";
      await db.query("INSERT INTO events(id,title,status,mode,snapshot,settings) VALUES($1,$2,$3,$4,$5,$6)", ["october-2026", mode === "demo" ? "具身创投之夜 · 演示" : "具身创投之夜", mode === "demo" ? "open" : "draft", mode, JSON.stringify(generateSnapshot(projects, newToken())), JSON.stringify({ topCount: 3, luckyCount: 5 })]);
    });
  })();
  try { await globalService.vcSeed; }
  catch (error) { globalService.vcSeed = undefined; throw error; }
}
export async function getEvent(id?: string, db?: DB, lock = false): Promise<EventRow> {
  await ensureSeed(); db ??= await getDb();
  const q = id ? "SELECT * FROM events WHERE id=$1" : "SELECT * FROM events ORDER BY (status='open') DESC, created_at DESC, id DESC LIMIT 1";
  const r = await db.query<EventRow>(q + (lock ? " FOR UPDATE" : ""), id ? [id] : []);
  if (!r.rows[0]) throw new HttpError(404, "活动不存在。"); return r.rows[0];
}
export async function getActiveEvent(db?: DB): Promise<EventRow | null> {
  await ensureSeed();
  return (await (db ?? await getDb()).query<EventRow>("SELECT * FROM events WHERE status='open'")).rows[0] ?? null;
}
export async function playerForToken(token: string | undefined, db?: DB): Promise<PlayerRow> {
  if (!token) throw new HttpError(401, "请先登记参加活动。");
  const r = await (db ?? await getDb()).query<PlayerRow>("SELECT * FROM players WHERE token_hash=$1", [hash(token)]);
  if (!r.rows[0]) throw new HttpError(401, "身份已失效，请联系现场工作人员恢复。"); return r.rows[0];
}
export function identity(name: string, institution: string) { return `${name.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()}|${institution.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()}`; }
export async function register(eventId: string, name: string, institution: string, currentToken?: string, recovery?: string) {
  await ensureSeed();
  return transaction(async db => {
    const event = await getEvent(eventId, db, true);
    if (event.status !== "open") throw new HttpError(409, "活动已停止登记，请进入当前活动。");
    const key = identity(name, institution);
    const duplicate = (await db.query<PlayerRow>("SELECT * FROM players WHERE event_id=$1 AND identity_key=$2 FOR UPDATE", [event.id, key])).rows[0];
    if (duplicate) {
      if (currentToken && hash(currentToken) === duplicate.token_hash) return { player: duplicate, token: currentToken };
      if (recovery && duplicate.recovery_hash === hash(recovery)) {
        const token = newToken(); await db.query("UPDATE players SET token_hash=$1,recovery_hash=NULL WHERE id=$2", [hash(token), duplicate.id]); return { player: duplicate, token };
      }
      throw new HttpError(409, "姓名与机构已登记。请使用原设备继续，或向工作人员领取一次性恢复码。");
    }
    const token = newToken(), id = randomUUID();
    const player = (await db.query<PlayerRow>("INSERT INTO players(id,event_id,name,institution,identity_key,token_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [id, event.id, name, institution, key, hash(token)])).rows[0];
    return { player, token };
  });
}
export async function startRun(eventId: string, token?: string): Promise<RunView> {
  await ensureSeed();
  return transaction(async db => {
    const event = await getEvent(eventId, db, true), player = await playerForToken(token, db);
    if (event.status !== "open") throw new HttpError(409, "活动已停止，请进入当前活动。");
    if (player.event_id !== eventId) throw new HttpError(403, "登记身份与活动不匹配。");
    let run = (await db.query<RunRow>("SELECT * FROM runs WHERE player_id=$1", [player.id])).rows[0];
    if (!run) {
      const deck = event.snapshot.decks[randomInt(event.snapshot.decks.length)];
      run = (await db.query<RunRow>("INSERT INTO runs(id,player_id,event_id,deck_id) VALUES($1,$2,$3,$4) RETURNING *", [randomUUID(), player.id, eventId, deck.id])).rows[0];
    }
    return view(run, event, player);
  });
}
function view(run: RunRow, event: EventRow, player: PlayerRow): RunView {
  const ids = event.snapshot.decks.find(d => d.id === run.deck_id)!.ids;
  const rules = rulesFor(event.snapshot);
  const index = run.decisions.length, project = run.status === "playing" && index < rules.total ? event.snapshot.projects.find(p => p.id === ids[index])! : null;
  const previous = index ? event.snapshot.projects.find(p => p.id === ids[index - 1])! : null;
  const year = project ? projectYear(project) : rules.settlementYear, value = calculateValue(run.decisions, event.snapshot, year);
  const card = project ? playerCard(project) : null;
  const updates = run.decisions.filter(d => d.choice === "invest").flatMap(d => {
    const p = event.snapshot.projects.find(p => p.id === d.projectId)!;
    return event.snapshot.paths[p.id].milestones.filter(m => m.year > (previous ? projectYear(previous) : 0) && m.year <= year).map(m => ({ alias: anonymizeText(p.alias), text: anonymizeText(m.text), year: m.year }));
  });
  const currentEra = project ? event.snapshot.events[era(year)] : null;
  const eraNotice = currentEra && (!previous || era(year) !== era(projectYear(previous))) ? { title: currentEra.title, text: currentEra.shock } : null;
  return { id: run.id, player: { name: player.name, institution: player.institution }, status: run.status, index, total: rules.total, year, value: value.value, cash: value.cash, invested: run.decisions.filter(d => d.choice === "invest").length, maxInvestments: rules.maxInvestments, card, eventStatus: event.status, eraNotice, updates };
}
export async function ownedRun(id: string, token?: string, db?: DB, lock = false) {
  db ??= await getDb(); const player = await playerForToken(token, db);
  const run = (await db.query<RunRow>("SELECT * FROM runs WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id])).rows[0];
  if (!run || run.player_id !== player.id) throw new HttpError(404, "游戏不存在。");
  return { run, player };
}
export async function getRun(id: string, token?: string) { const { run, player } = await ownedRun(id, token); return view(run, await getEvent(run.event_id), player); }
export async function decide(id: string, token: string | undefined, decision: Decision): Promise<RunView> {
  const { run: lookup } = await ownedRun(id, token);
  return transaction(async db => {
    const event = await getEvent(lookup.event_id, db, true), { run, player } = await ownedRun(id, token, db, true);
    const rules = rulesFor(event.snapshot);
    let amount: number;
    try { amount = investmentAmount(decision, rules); }
    catch (error) { throw new HttpError(422, (error as Error).message); }
    const same = run.decisions.find(d => d.key === decision.key);
    if (same) {
      if (same.projectId !== decision.projectId || same.choice !== decision.choice || investmentAmount(same, rules) !== amount) throw new HttpError(409, "重试内容与原决策不同。");
      return view(run, event, player);
    }
    if (event.status === "frozen") throw new HttpError(409, "榜单已冻结，未完成游戏不再计分。");
    if (event.status !== "open") throw new HttpError(409, "活动已停止，进度已保存。请等待恢复或进入当前活动。");
    if (run.status === "completed") throw new HttpError(409, "正式游戏已完成。");
    const deck = event.snapshot.decks.find(d => d.id === run.deck_id)!;
    if (deck.ids[run.decisions.length] !== decision.projectId) throw new HttpError(409, "项目顺序不匹配，请恢复当前进度。");
    const invested = run.decisions.filter(d => d.choice === "invest").length;
    if (decision.choice === "invest" && invested >= rulesFor(event.snapshot).maxInvestments) throw new HttpError(409, `已达到${rulesFor(event.snapshot).maxInvestments}家投资上限，剩余项目只能跳过。`);
    const spent = run.decisions.reduce((sum, d) => sum + investmentAmount(d, rules), 0);
    if (amount > rules.initial - spent) throw new HttpError(409, "剩余本金不足，请降低投资金额或跳过项目。");
    const decisions = [...run.decisions, decision.choice === "invest" ? { ...decision, amount } : decision];
    const completed = spent + amount >= rules.initial || decisions.length >= rules.total || !!rules.endOnInvestmentLimit && invested + (decision.choice === "invest" ? 1 : 0) >= rules.maxInvestments;
    const profit = completed ? calculateValue(decisions, event.snapshot).profit : null;
    await db.query("UPDATE runs SET decisions=$1,status=$2,profit=$3,completed_at=CASE WHEN $4 THEN NOW() ELSE completed_at END WHERE id=$5", [JSON.stringify(decisions), completed ? "completed" : "playing", profit, completed, id]);
    return view({ ...run, decisions, status: completed ? "completed" : "playing", profit }, event, player);
  });
}
export async function leaderboard(event: EventRow, db?: DB): Promise<LeaderRow[]> {
  if (event.frozen_rows) return event.frozen_rows;
  const rows = (await (db ?? await getDb()).query<{ playerId: string; name: string; institution: string; profit: string }>(`SELECT p.id AS "playerId", p.name,p.institution,r.profit FROM runs r JOIN players p ON p.id=r.player_id WHERE r.event_id=$1 AND r.status='completed' ORDER BY r.profit DESC,p.id`, [event.id])).rows;
  return rankRows(rows.map(r => ({ ...r, profit: Number(r.profit) })));
}
export async function result(id: string, token?: string) {
  const { run, player } = await ownedRun(id, token);
  if (run.status !== "completed") throw new HttpError(409, "基金尚未结束；投完本金、投满投资名额或看完全部项目后可查看复盘。");
  const event = await getEvent(run.event_id), rows = await leaderboard(event), rules = rulesFor(event.snapshot);
  const reviews = run.decisions.map(d => {
    const p = event.snapshot.projects.find(p => p.id === d.projectId)!; const path = event.snapshot.paths[p.id];
    const display = playerCard(p);
    const amount = d.choice === "invest" ? investmentAmount(d, rules) : rules.ticket;
    return { ...p, ...display, history: anonymizeText(p.history), lesson: anonymizeText(p.lesson), choice: d.choice, amount, multiple: path.multipleBps / 10000, profit: Math.round(amount * path.multipleBps / 10000) - amount, ending: anonymizeText(path.ending) };
  });
  const best = (items: typeof reviews) => [...items].sort((a, b) => b.profit - a.profit)[0] ?? null;
  const unspent = rules.initial - run.decisions.reduce((sum, d) => sum + investmentAmount(d, rules), 0);
  return { ...calculateValue(run.decisions, event.snapshot), initial: rules.initial, seen: run.decisions.length, unseen: rules.total - run.decisions.length, completionReason: unspent === 0 ? "principal-exhausted" as const : run.decisions.length < rules.total ? "investment-limit" as const : "timeline-end" as const, invested: run.decisions.filter(d => d.choice === "invest").length, unspent, player: { name: player.name, institution: player.institution }, rank: rows.find(r => r.playerId === player.id)?.rank ?? null, participants: rows.length, reviews,
    highlights: { best: best(reviews.filter(r => r.choice === "invest" && r.profit > 0)), missed: best(reviews.filter(r => r.choice === "pass" && r.profit > 0)), avoided: [...reviews].filter(r => r.choice === "pass" && r.profit < 0).sort((a, b) => a.profit - b.profit)[0] ?? null }, frozen: event.status === "frozen" };
}
export function contentIssues(projects: Project[]) {
  const issues: string[] = [];
  if (projects.length !== 50 || new Set(projects.map(p => p.id)).size !== 50) issues.push("需要50个不同项目。");
  const placeholders = projects.filter(p => !p.real).length;
  if (placeholders) issues.push(`${placeholders}题为示例占位，最终题库需全部替换为真实案例。`);
  const missingYears = projects.filter(p => p.decisionYear === undefined && p.foundedYear === undefined && p.firstFundingYear === undefined).length;
  if (missingYears) issues.push(`${missingYears}题缺少投资进入年份，暂用现有年份作示例时点。`);
  if (!projects.some(p => p.real && /AI大模型|AI模型|AI应用与模型|语言模型|LLM/.test(p.sector))) issues.push("AI大模型真实案例尚缺。");
  if (projects.some(p => { try { return !p.technical || !p.valuation || !Number.isFinite(valuationMultiple(p.valuation)); } catch { return true; } })) issues.push("缺少技术亮点或有效估值路径。");
  if (projects.some(p => p.market !== "CN" && p.market !== "overseas")) issues.push("需填写公司归属（CN或overseas）。");
  const unaudited = projects.filter(p => p.review !== "approved" || !p.reviewedAt || !Number.isFinite(Date.parse(p.reviewedAt)) || (p.real && (!p.decisionEvidence || !p.sources.some(s => s.url === p.decisionEvidence && s.publishedAt && Number.isFinite(Date.parse(s.publishedAt)) && Number(s.publishedAt.slice(0, 4)) <= projectYear(p)))));
  if (unaudited.length) issues.push(`${unaudited.length}题尚未通过审校或缺少同期证据。`);
  return issues;
}
export async function adminState(eventId?: string) {
  await ensureSeed(); const db = await getDb();
  const events = (await db.query<{ id: string; title: string; status: string; mode: string }>("SELECT id,title,status,mode FROM events ORDER BY created_at DESC,id DESC")).rows;
  const activeEventId = events.find(e => e.status === "open")?.id ?? null;
  const event = events.length ? await getEvent(eventId) : null;
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:3000";
  if (!event) return { event: null, events, activeEventId, players: [], draws: [], audits: [], leaderboard: [], issues: [], publicUrl };
  const players = (await db.query<{ id: string; name: string; institution: string; status: string | null; progress: number; profit: string | null }>(`SELECT p.id,p.name,p.institution,r.status,COALESCE(jsonb_array_length(r.decisions),0) AS progress,r.profit FROM players p LEFT JOIN runs r ON r.player_id=p.id WHERE p.event_id=$1 ORDER BY p.created_at`, [event.id])).rows;
  const draws = (await db.query("SELECT id,kind,candidates,winners,created_at FROM draws WHERE event_id=$1 ORDER BY created_at", [event.id])).rows;
  const audits = (await db.query("SELECT action,detail,created_at FROM audit_log WHERE event_id=$1 ORDER BY created_at DESC LIMIT 30", [event.id])).rows;
  return { event, events, activeEventId, players, draws, audits, leaderboard: await leaderboard(event), issues: contentIssues(event.snapshot.projects), publicUrl };
}
async function audit(db: DB, eventId: string, action: string, detail: unknown) { await db.query("INSERT INTO audit_log(id,event_id,action,detail) VALUES($1,$2,$3,$4)", [randomUUID(), eventId, action, JSON.stringify(detail)]); }
export async function adminAction(eventId: string | undefined, action: string, payload: Record<string, unknown>) {
  await ensureSeed();
  return transaction(async db => {
    // Serialize switches across processes before acquiring individual event locks.
    await db.query("SELECT pg_advisory_xact_lock(20261028)");
    if (action === "create") {
      const id = randomUUID(), mode = payload.mode === "formal" ? "formal" : "demo";
      const { projects } = (await db.query<{ projects: Project[] }>("SELECT projects FROM game_settings WHERE id=1")).rows[0];
      await db.query("INSERT INTO events(id,title,status,mode,snapshot,settings) VALUES($1,$2,'draft',$3,$4,$5)", [id, payload.title, mode, JSON.stringify(generateSnapshot(projects, newToken())), JSON.stringify({ topCount: 3, luckyCount: 5 })]);
      await audit(db, id, action, { mode }); return { eventId: id };
    }
    const event = await getEvent(eventId, db, true);
    if (action === "delete") {
      await db.query("DELETE FROM draws WHERE event_id=$1", [event.id]);
      await db.query("DELETE FROM runs WHERE event_id=$1", [event.id]);
      await db.query("DELETE FROM players WHERE event_id=$1", [event.id]);
      await db.query("DELETE FROM events WHERE id=$1", [event.id]);
      await audit(db, event.id, action, { title: event.title });
      return { eventId: (await db.query<{ id: string }>("SELECT id FROM events ORDER BY (status='open') DESC,created_at DESC,id DESC LIMIT 1")).rows[0]?.id ?? "" };
    }
    if (action === "settings") {
      if (event.status !== "draft") throw new HttpError(409, "奖品数量只能在活动开启前调整。");
      await db.query("UPDATE events SET title=$1,settings=$2 WHERE id=$3", [payload.title, JSON.stringify({ topCount: payload.topCount, luckyCount: payload.luckyCount }), event.id]);
    } else if (action === "import") {
      if (event.status !== "draft") throw new HttpError(409, "只能导入未开放活动的题库。请创建新活动，已参赛成绩保持原版本。");
      const projects = payload.projects as Project[];
      if (projects.some(p => p.market !== "CN" && p.market !== "overseas")) throw new HttpError(422, "题库必须标注国内或海外原型。");
      const snapshot = generateSnapshot(projects, newToken());
      if (!snapshot.decks.every(d => validDeck(d.ids, projects))) throw new HttpError(422, "牌组校验失败。");
      await db.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify(snapshot), event.id]);
      await db.query("UPDATE game_settings SET projects=$1,content_version=$2 WHERE id=1", [JSON.stringify(projects), BANK_VERSION]);
    } else if (action === "open") {
      if (event.status === "open") return { ok: true };
      if (event.mode === "formal" && process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) throw new HttpError(422, "正式生产活动需要PostgreSQL连接。");
      if (event.status === "draft") {
        const { projects } = (await db.query<{ projects: Project[] }>("SELECT projects FROM game_settings WHERE id=1")).rows[0];
        await db.query("UPDATE events SET snapshot=$1 WHERE id=$2", [JSON.stringify(generateSnapshot(projects, newToken())), event.id]);
      }
      const stopped = await db.query<{ id: string }>("UPDATE events SET status='closed' WHERE status='open' AND id<>$1 RETURNING id", [event.id]);
      for (const previous of stopped.rows) await audit(db, previous.id, "close", { activatedEventId: event.id });
      if (event.status === "frozen") await db.query("DELETE FROM draws WHERE event_id=$1", [event.id]);
      await db.query("UPDATE events SET status='open',frozen_rows=NULL,frozen_at=NULL WHERE id=$1", [event.id]);
    } else if (action === "close") {
      if (event.status !== "open") throw new HttpError(409, "只能关闭进行中的活动。");
      await db.query("UPDATE events SET status='closed' WHERE id=$1", [event.id]);
    } else if (action === "freeze") {
      if (event.status === "frozen") return { ok: true };
      if (event.status !== "closed") throw new HttpError(409, "请先停止活动，再冻结榜单。");
      const rows = await leaderboard(event, db);
      await db.query("UPDATE events SET status='frozen',frozen_rows=$1,frozen_at=NOW() WHERE id=$2", [JSON.stringify(rows), event.id]);
    } else if (action === "draw" || action === "tie") {
      if (event.status !== "frozen") throw new HttpError(409, "冻结榜单后才能抽奖。");
      const existing = (await db.query("SELECT * FROM draws WHERE event_id=$1 AND request_key=$2", [event.id, payload.key])).rows[0];
      if (existing) return existing;
      const draws = (await db.query<{ winners: LeaderRow[]; kind: string }>("SELECT winners,kind FROM draws WHERE event_id=$1", [event.id])).rows;
      const rows = event.frozen_rows!;
      let candidates: LeaderRow[], count: number;
      if (action === "tie") {
        if (draws.some(d => d.kind === "tie")) throw new HttpError(409, "排名边界抽签已完成。");
        const limit = event.settings.topCount, boundary = rows[Math.min(limit, rows.length) - 1];
        candidates = boundary ? rows.filter(r => r.rank === boundary.rank) : [];
        count = boundary ? limit - rows.filter(r => r.profit > boundary.profit).length : 0;
        if (candidates.length <= count || count <= 0) throw new HttpError(409, "没有需要抽签的边界并列。");
      } else {
        const past = new Set(draws.filter(d => d.kind === "lucky").flatMap(d => d.winners.map(w => w.playerId)));
        candidates = rows.filter(r => !past.has(r.playerId)); count = Math.min(Number(payload.count ?? event.settings.luckyCount), candidates.length);
        if (!count) throw new HttpError(409, "没有可抽取的完成者。");
      }
      const pool = [...candidates], winners: LeaderRow[] = [];
      for (let i = 0; i < count; i++) winners.push(pool.splice(randomInt(pool.length), 1)[0]);
      const draw = { id: randomUUID(), candidates, winners, kind: action === "tie" ? "tie" : "lucky" };
      await db.query("INSERT INTO draws(id,event_id,request_key,kind,candidates,winners) VALUES($1,$2,$3,$4,$5,$6)", [draw.id, event.id, payload.key, draw.kind, JSON.stringify(candidates), JSON.stringify(winners)]);
      await audit(db, event.id, action, { drawId: draw.id, candidates: candidates.length, winners: winners.map(w => w.playerId) }); return draw;
    } else if (action === "recovery") {
      const code = newToken().slice(0, 16);
      const r = await db.query("UPDATE players SET recovery_hash=$1 WHERE id=$2 AND event_id=$3 RETURNING id", [hash(code), payload.playerId, event.id]);
      if (!r.rows.length) throw new HttpError(404, "玩家不存在。");
      await audit(db, event.id, action, { playerId: payload.playerId }); return { code };
    } else if (action === "rename") {
      const r = await db.query("UPDATE players SET name=$1,institution=$2,identity_key=$3 WHERE id=$4 AND event_id=$5 RETURNING id", [payload.name, payload.institution, identity(String(payload.name), String(payload.institution)), payload.playerId, event.id]);
      if (!r.rows.length) throw new HttpError(404, "玩家不存在。");
      if (event.status === "frozen") {
        const rows = event.frozen_rows!.map(r => r.playerId === payload.playerId ? { ...r, name: String(payload.name), institution: String(payload.institution) } : r);
        await db.query("UPDATE events SET frozen_rows=$1 WHERE id=$2", [JSON.stringify(rows), event.id]);
      }
    } else throw new HttpError(400, "不支持的管理操作。");
    await audit(db, event.id, action, action === "import" ? { projects: (payload.projects as Project[]).length } : payload); return { ok: true };
  });
}
export function eventMeta(event: EventRow) {
  const rules = rulesFor(event.snapshot); return { id: event.id, title: event.title, status: event.status, mode: event.mode, contentVersion: event.snapshot.version, yearBasis: event.snapshot.projects.every(p => p.decisionYear !== undefined) ? "entry" : "legacy", total: rules.total, maxInvestments: rules.maxInvestments, ticket: rules.ticket, maxTicket: rules.maxTicket ?? rules.ticket, initial: rules.initial, endOnInvestmentLimit: !!rules.endOnInvestmentLimit, settlementYear: rules.settlementYear, eras: event.snapshot.events.map(e => ({ title: e.title, text: e.text })), settings: event.settings };
}
export async function publicMeta() {
  const event = await getActiveEvent();
  return event ? eventMeta(event) : null;
}
export async function publicLeaderboard() {
  const event = await getActiveEvent();
  return { id: event?.id ?? null, rows: event ? await leaderboard(event) : [], frozen: false, status: event?.status ?? "inactive", title: event?.title ?? "暂无进行中的活动", mode: event?.mode ?? "", initial: event ? rulesFor(event.snapshot).initial : null };
}
