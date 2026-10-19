import { describe, expect, it } from "vitest";
import { PROJECTS } from "../data/projects";
import manifest from "../data/question-bank-manifest.json";
import { calculateValue, deckStats, generateSnapshot, INITIAL, MAX_INVESTMENTS, rankRows, TICKET, validDeck, strategyProfit, rulesFor, chronologicalProjects, projectYear, valuationMultiple } from "../lib/engine";
import { playerCard } from "../lib/cards";
import { contentIssues } from "../lib/service";
import type { Decision } from "../lib/types";
const snapshot = generateSnapshot(PROJECTS, "test-world");
const deck = snapshot.decks[0];
const decisions = (count: number): Decision[] => deck.ids.map((id, i) => ({ projectId: id, choice: i < count ? "invest" : "pass", key: id }));
describe("domestic historical content and sequential fund rules", () => {
  it("has the 50 confirmed domestic v4.3 cases and six confirmed loss recoveries", () => {
    expect(PROJECTS).toHaveLength(50); expect(PROJECTS.every(p => p.real)).toBe(true);
    expect(PROJECTS.filter(p => p.market === "overseas")).toHaveLength(0);
    expect(PROJECTS.filter(p => p.editorial?.manualCase)).toHaveLength(50);
    expect(PROJECTS.every(p => p.decisionYear && p.team && p.technical && p.traction)).toBe(true);
    expect(contentIssues(PROJECTS)).toEqual(["50题尚未通过审校或缺少同期证据。"]);
    const counts = Object.values(snapshot.paths).map(p => p.multipleBps);
    expect([counts.filter(v => v > 10000).length, counts.filter(v => v === 10000).length, counts.filter(v => v < 10000).length]).toEqual([44, 0, 6]);
  });
  it("matches every confirmed entry year and settlement multiple in the import manifest", () => {
    const years = manifest.years as Record<string, number>, returns = manifest.returns as Record<string, number>;
    expect(Object.keys(years).sort()).toEqual(PROJECTS.map(p => p.name).sort());
    for (const p of PROJECTS) {
      expect(p.year).toBe(years[p.name]);
      expect(p.decisionYear).toBe(years[p.name]);
      expect(p.valuation.entryYear).toBe(years[p.name]);
      expect(valuationMultiple(p.valuation)).toBeCloseTo(returns[p.name], 8);
      expect(snapshot.paths[p.id].multipleBps).toBe(Math.round(returns[p.name] * 10000));
      expect(p.editorial?.sourceSha256).toBe(manifest.sourceSha256);
      const amount = 15_000_000;
      expect(calculateValue([{ projectId: p.id, choice: "invest", key: p.id, amount }], snapshot).profit)
        .toBe(Math.round(amount * Math.round(returns[p.name] * 10000) / 10000) - amount);
    }
    expect(chronologicalProjects(PROJECTS).at(-1)?.name).toBe("德塔智能");
    expect(chronologicalProjects(PROJECTS).find(p => p.name === "柔宇科技")?.year).toBe(2013);
  });
  it("does not count later history as evidence available at entry time", () => {
    const p = { ...PROJECTS[0], review: "approved" as const, reviewedAt: "2026-10-13", decisionEvidence: PROJECTS[0].sources[0].url, sources: [{ ...PROJECTS[0].sources[0], publishedAt: `${PROJECTS[0].year + 1}-01-01` }] };
    expect(contentIssues([p, ...PROJECTS.slice(1)]).at(-1)).toContain("50题");
  });
  it("uses one fixed chronological timeline containing all 50 cases across seeds and bank ordering", () => {
    expect(snapshot.decks).toHaveLength(1);
    expect(deck.ids).toHaveLength(50);
    expect(validDeck(deck.ids, PROJECTS)).toBe(true);
    expect(generateSnapshot([...PROJECTS].reverse(), "different-seed").decks).toEqual(snapshot.decks);
    expect(generateSnapshot(PROJECTS, "different-seed").events).toEqual(snapshot.events);
    expect(new Set(snapshot.decks.flatMap(d => d.ids)).size).toBe(50);
    expect(generateSnapshot(PROJECTS, "test-world")).toEqual(snapshot);
  });
  it("prioritizes investment entry years and retains legacy year fallbacks", () => {
    const founding = { ...PROJECTS[0], decisionYear: undefined, foundedYear: 2006, firstFundingYear: 2008 };
    const funding = { ...PROJECTS[1], decisionYear: undefined, firstFundingYear: 2010 };
    expect(projectYear(founding)).toBe(2006); expect(projectYear(funding)).toBe(2010);
    expect(chronologicalProjects([PROJECTS[2], funding, founding]).map(p => p.id)).toEqual([founding.id, funding.id, PROJECTS[2].id]);
    expect(playerCard(founding).yearBasis).toBe("founded");
    expect(playerCard(funding).yearBasis).toBe("first-funding");
    expect(playerCard(PROJECTS[0]).yearBasis).toBe("entry");
    expect(projectYear({ ...founding, decisionYear: 2020 })).toBe(2020);
    expect(playerCard({ ...PROJECTS[0], decisionYear: undefined }).yearBasis).toBe("example");
    expect(() => generateSnapshot(PROJECTS.slice(1), "missing")).toThrow("50");
    expect(() => generateSnapshot([PROJECTS[0], ...PROJECTS.slice(0, 49)], "duplicate")).toThrow("50");
  });
  it("hides identities, prototype stories, classifications and terminal returns from player cards", () => {
    const before = JSON.stringify(PROJECTS);
    const cards = PROJECTS.map(playerCard);
    expect(JSON.stringify(cards)).not.toMatch(/王鹤|韩峰涛|高继扬|邓泰华|彭志辉|陈建宇|王兴兴|汪滔|余凯|黄晓庆|蒋尚义/);
    expect(cards.filter(p => p.placeholder)).toHaveLength(0);
    expect(JSON.stringify(cards)).not.toMatch(/editorial|manualCase|terminalValue|specifiedMultiple|multipleBps|trajectory|history|category|sourceSha256/);
    const dji = PROJECTS.find(p => p.name === "大疆创新")!;
    expect(playerCard(dji).entryValuation).toBeUndefined();
    expect(playerCard(dji).entryReference).toBe("15亿美元");
    expect(JSON.stringify(PROJECTS)).toBe(before);
  });
  it("preserves all cash when passing, and includes unused principal for smaller portfolios", () => {
    expect(calculateValue(decisions(0), snapshot)).toEqual({ value: INITIAL, cash: INITIAL, holdings: 0, profit: 0 });
    const result = calculateValue(decisions(3), snapshot);
    const proceeds = deck.ids.slice(0, 3).reduce((s, id) => s + Math.round(TICKET * snapshot.paths[id].multipleBps / 10000), 0);
    expect(result.value).toBe(INITIAL - 3 * TICKET + proceeds);
    expect(calculateValue(decisions(3), snapshot, 2026)).toEqual({ cash: INITIAL - 3 * TICKET, holdings: 3 * TICKET, value: INITIAL, profit: 0 });
  });
  it("caps strategy investing at 20 and rejects an invalid 21-investment ledger", () => {
    expect(() => calculateValue(decisions(21), snapshot)).toThrow("上限");
    let shown = 0;
    expect(strategyProfit(deck.ids, snapshot, () => { shown++; return "invest"; })).toBe(calculateValue(decisions(20), snapshot).profit);
    expect(shown).toBe(20);
    expect(deckStats(deck.ids, snapshot.paths).allInProfit).toBe(calculateValue(decisions(20), snapshot).profit);
  });
  it("accounts for individual tickets and rejects out-of-range, non-step and overspent ledgers", () => {
    expect(snapshot.rules).toMatchObject({ initial: 200_000_000, ticket: 5_000_000, maxTicket: 40_000_000 });
    const amounts = [5_000_000, 15_000_000, 40_000_000];
    const ledger = amounts.map((amount, i) => ({ projectId: deck.ids[i], choice: "invest" as const, key: deck.ids[i], amount }));
    const spent = 60_000_000;
    expect(calculateValue(ledger, snapshot, 2026)).toEqual({ cash: INITIAL - spent, holdings: spent, value: INITIAL, profit: 0 });
    const proceeds = ledger.reduce((sum, d) => sum + Math.round(d.amount * snapshot.paths[d.projectId].multipleBps / 10000), 0);
    expect(calculateValue(ledger, snapshot).value).toBe(INITIAL - spent + proceeds);
    for (const amount of [0, -5_000_000, 1_000_000, 7_500_000, 45_000_000, NaN]) expect(() => calculateValue([{ ...ledger[0], amount }], snapshot)).toThrow("金额");
    const overBudget = deck.ids.slice(0, 6).map(id => ({ projectId: id, choice: "invest" as const, key: id, amount: 40_000_000 }));
    expect(() => calculateValue(overBudget, snapshot)).toThrow("本金不足");
    const legacy = structuredClone(snapshot); delete legacy.rules!.maxTicket; legacy.rules!.initial = 100_000_000;
    expect(calculateValue([{ ...ledger[0], amount: undefined }], legacy, 2026).cash).toBe(95_000_000);
    expect(() => calculateValue([{ ...ledger[0], amount: 10_000_000 }], legacy)).toThrow("金额");
  });
  it("preserves confirmed returns and calculates original-currency, loss and retention returns", () => {
    const expected = { 宇树: 280, 沐曦: 364.175, 梅卡曼德: 100, 智谱: 564.4, Kimi: 500 / 3, 毫末: .1, 柔宇: .1 };
    for (const [name, multiple] of Object.entries(expected)) {
      const p = PROJECTS.find(p => p.name.includes(name))!;
      expect(snapshot.paths[p.id].multipleBps).toBe(Math.round(multiple * 10000));
    }
    const scale = PROJECTS.find(p => p.name === "大疆创新")!;
    const unitree = PROJECTS.find(p => p.name === "宇树科技")!;
    expect(unitree.valuation.specifiedMultiple).toBe(280);
    expect(valuationMultiple({ ...unitree.valuation, entryValue: 100, terminalValue: 103500 })).toBe(280);
    expect(valuationMultiple(scale.valuation)).toBeCloseTo(160 / 15);
    expect(valuationMultiple({ ...scale.valuation, retention: .5 })).toBeCloseTo(160 / 15 * .5);
    expect(() => valuationMultiple({ ...scale.valuation, retention: 1.1 })).toThrow();
    expect(() => valuationMultiple({ ...scale.valuation, entryValue: 0 })).toThrow();
    expect(valuationMultiple({ ...scale.valuation, specifiedMultiple: 0 })).toBe(0);
    expect(valuationMultiple({ ...scale.valuation, currency: undefined, entryValue: undefined, terminalValue: undefined, entryYuan: 10e6, terminalYuan: 20e6, method: "funding-proxy", entryFundingYuan: 1e6, terminalFundingYuan: 3e6 })).toBe(3);
    expect(generateSnapshot(PROJECTS, "other-seed").paths).toEqual(snapshot.paths);
  });
  it("retains legacy snapshot accounting", () => {
    const old = structuredClone(snapshot); delete old.rules;
    const id = deck.ids[0]; old.paths[id].milestones = [{ year: 2016, valueBps: 20000, text: "旧版退出" }];
    expect(rulesFor(old).initial).toBe(24_000_000);
    expect(calculateValue([{ projectId: id, choice: "invest", key: id }], old).profit).toBe(1_000_000);
  });
  it("ranks integer returns with competition ties", () => {
    expect(rankRows([{ profit: 99 }, { profit: 100 }, { profit: 100 }, { profit: 98 }]).map(r => r.rank)).toEqual([1, 1, 3, 4]);
  });
});
