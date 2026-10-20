import { createHash } from "node:crypto";
import type { Choice, Deck, Decision, Era, Path, Project, Snapshot, GameRules, Valuation } from "./types";

export const INITIAL = 200_000_000;
export const TICKET = 5_000_000;
export const MAX_TICKET = INITIAL * .2;
export const TOTAL = 50;
export const MAX_INVESTMENTS = 20;
export const SETTLEMENT_YEAR = 2031;
export const CONTENT_VERSION = "2026.10-workbook-v4.4-chronological-2015";
export const RULES: GameRules = { initial: INITIAL, ticket: TICKET, maxTicket: MAX_TICKET, total: TOTAL, maxInvestments: MAX_INVESTMENTS, settlementYear: SETTLEMENT_YEAR, endOnInvestmentLimit: true };
export const projectYear = (project: Project) => project.decisionYear ?? project.foundedYear ?? project.firstFundingYear ?? project.year;
export const chronologicalProjects = (projects: Project[]) => [...projects].sort((a, b) => projectYear(a) - projectYear(b) || a.id.localeCompare(b.id, "en"));
export function nextProjectId(ids: string[], decisions: Decision[]) {
  const seen = new Set(decisions.map(d => d.projectId));
  return ids.find(id => !seen.has(id));
}
export const ERA_EVENTS = [
  { title: "机器开始看见世界", text: "2015 · 机器视觉与移动供应链成熟。能交付、能维护的产品，开始走出实验室。", shock: "客户更愿意为可验证的效率付费。" },
  { title: "资本加速，交付追赶", text: "2016—2020 · 深度学习走向产业。资本愿意给远景定价，真实客户开始检验交付能力。", shock: "规模扩张放大了产品可靠性与现金消耗的差异。" },
  { title: "具身浪潮，现金为王", text: "2021—2026 · 供应链降本与模型能力提升。融资环境变化，商业化与现场可靠性成为分水岭。", shock: "成本下降带来机会，客户续费决定项目能否熬过周期。" },
] as const;
export const era = (year: number): Era => year <= 2015 ? 0 : year <= 2020 ? 1 : 2;
export function rng(seed: string) { let a = createHash("sha256").update(seed).digest().readUInt32LE(0); return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function rulesFor(snapshot: Snapshot): GameRules { return snapshot.rules ?? { initial: 24_000_000, ticket: 1_000_000, total: 24, maxInvestments: 24, settlementYear: 2031 }; }
export function investmentAmount(decision: Decision, rules: GameRules): number {
  if (decision.choice !== "invest") return 0;
  const amount = decision.amount ?? rules.ticket;
  if (!Number.isSafeInteger(amount) || amount < rules.ticket || amount > (rules.maxTicket ?? rules.ticket) || amount % rules.ticket !== 0) throw new Error("投资金额须在单笔额度内，按默认投资金额的整数档调整。");
  return amount;
}
export function valuationMultiple(v: Valuation): number {
  const retention = v.retention ?? 1;
  if (!Number.isFinite(retention) || retention < 0 || retention > 1) throw new Error("持股保留系数无效。");
  let multiple: number;
  if (v.specifiedMultiple !== undefined) multiple = v.specifiedMultiple;
  else if (v.entryValue !== undefined && v.terminalValue !== undefined) {
    if (v.entryValue === null || v.terminalValue === null || !Number.isFinite(v.entryValue) || v.entryValue <= 0 || !Number.isFinite(v.terminalValue) || v.terminalValue < 0) throw new Error("原币估值数据无效。");
    multiple = v.terminalValue / v.entryValue;
  } else {
    if (v.entryYuan === null || v.terminalYuan === null || !Number.isFinite(v.entryYuan) || v.entryYuan < TICKET || !Number.isFinite(v.terminalYuan) || v.terminalYuan < 0) throw new Error("估值数据无效。");
    multiple = v.method === "funding-proxy" && v.entryFundingYuan && v.terminalFundingYuan !== undefined ? v.terminalFundingYuan / v.entryFundingYuan : v.terminalYuan / v.entryYuan;
  }
  if (!Number.isFinite(multiple) || multiple < 0) throw new Error("回报倍数无效。");
  return multiple * retention;
}
export function samplePath(project: Project, _seed: string): Path {
  const v = project.valuation;
  if (!v) throw new Error(`估值数据无效：${project.id}`);
  const multipleBps = Math.round(valuationMultiple(v) * 10000);
  const basis = v.basis ?? (v.method === "funding-proxy" ? "累计融资÷30%的历史代理" : v.method === "fiction" ? "虚构情景" : "游戏估值假设");
  const ending = `${v.status}。本局按${basis}结算为${(multipleBps / 10000).toFixed(4)}倍；${v.note}`;
  // Compress different historical durations into a single settlement; no early reinvestment.
  return { multipleBps, ending, milestones: [{ year: SETTLEMENT_YEAR, valueBps: multipleBps, text: ending }] };
}
export function deckStats(ids: string[], paths: Record<string, Path>) {
  const profits = ids.map(id => Math.round(TICKET * (paths[id].multipleBps - 10000) / 10000));
  return { maxProfit: [...profits].sort((a, b) => b - a).slice(0, MAX_INVESTMENTS).reduce((s, p) => s + Math.max(0, p), 0), losses: profits.filter(p => p < 0).length, allInProfit: profits.slice(0, MAX_INVESTMENTS).reduce((s, p) => s + p, 0) };
}
export function validDeck(ids: string[], projects: Project[]): boolean {
  const expected = chronologicalProjects(projects).map(p => p.id);
  return projects.length === TOTAL && ids.length === TOTAL && new Set(ids).size === TOTAL && ids.every((id, i) => id === expected[i]);
}
export function generateSnapshot(projects: Project[], seed: string): Snapshot {
  const ids = chronologicalProjects(projects).map(p => p.id);
  if (!validDeck(ids, projects)) throw new Error("题库需要50个不同项目，按投资进入时点生成固定顺序。");
  const paths = Object.fromEntries(projects.map(p => [p.id, samplePath(p, seed)]));
  const deck: Deck = { id: "timeline-1", ids, ...deckStats(ids, paths) };
  return { version: CONTENT_VERSION, projects, paths, decks: [deck], rules: RULES, events: ERA_EVENTS.map(e => ({ ...e })) };
}
export function calculateValue(decisions: Decision[], snapshot: Snapshot, year = SETTLEMENT_YEAR) {
  const rules = rulesFor(snapshot); let cash = rules.initial, holdings = 0;
  const investments = decisions.filter(d => d.choice === "invest");
  if (investments.length > rules.maxInvestments) throw new Error("投资家数超过上限。");
  if (investments.reduce((sum, d) => sum + investmentAmount(d, rules), 0) > rules.initial) throw new Error("剩余本金不足，不能超额投资。");
  for (const d of investments) {
    const amount = investmentAmount(d, rules);
    cash -= amount;
    const p = snapshot.projects.find(x => x.id === d.projectId)!;
    const path = snapshot.paths[p.id];
    const milestones = path.milestones.filter(m => m.year <= year);
    const bps = milestones.length ? milestones[milestones.length - 1].valueBps : 10000;
    const value = Math.round(amount * bps / 10000);
    const settled = snapshot.rules ? year >= rules.settlementYear : p.year + 5 <= year;
    if (settled) cash += value; else holdings += value;
  }
  return { cash, holdings, value: cash + holdings, profit: cash + holdings - rules.initial };
}
export function rankRows<T extends { profit: number }>(rows: T[]) { let previous: number | undefined, rank = 0; return [...rows].sort((a, b) => b.profit - a.profit).map((row, i) => { if (row.profit !== previous) rank = i + 1; previous = row.profit; return { ...row, rank }; }); }
export function strategyProfit(ids: string[], snapshot: Snapshot, choose: (p: Project) => Choice) {
  let invested = 0; const decisions: Decision[] = [];
  for (const id of ids) {
    const choice = invested < rulesFor(snapshot).maxInvestments ? choose(snapshot.projects.find(p => p.id === id)!) : "pass";
    if (choice === "invest") invested++;
    decisions.push({ projectId: id, choice, key: id });
    if (rulesFor(snapshot).endOnInvestmentLimit && invested >= rulesFor(snapshot).maxInvestments) break;
  }
  return calculateValue(decisions, snapshot).profit;
}
