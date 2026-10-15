import { PROJECTS } from "../data/projects";
import { generateSnapshot, INITIAL, rng, strategyProfit } from "../lib/engine";
import type { Project } from "../lib/types";

// This policy reads only the text sent to players, not historical category or outcome.
export function informed(p: Pick<Project, "risk" | "traction">): boolean {
  return !/尚不明确|尚未验证|尚未变成|尚未证明|现金消耗|尚待验证|毛利承压|价格与毛利承压|价格竞争加剧|试点未保证|知识产权.*尚待|资本与规模扩张压力/.test(p.risk);
}
export function simulate(worlds = 10, trials = 1000) {
  const sums = { informed: 0, random: 0, allIn: 0, allPass: 0 }; let better = 0, count = 0;
  const worldsReport: unknown[] = [];
  for (let w = 0; w < worlds; w++) {
    const s = generateSnapshot(PROJECTS, `calibration-v1-${w}`), random = rng(`players:${w}`);
    worldsReport.push({ world: w, decks: s.decks.length });
    for (let i = 0; i < trials; i++) {
      const d = s.decks[Math.floor(random() * s.decks.length)];
      const know = strategyProfit(d.ids, s, p => (random() < .15 ? !informed(p) : informed(p)) ? "invest" : "pass");
      const rand = strategyProfit(d.ids, s, () => random() < .5 ? "invest" : "pass");
      const all = strategyProfit(d.ids, s, () => "invest");
      sums.informed += know; sums.random += rand; sums.allIn += all; if (know > all) better++; count++;
    }
  }
  return { trials: count, worlds: worldsReport, averageReturnPercent: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, +(v / count / INITIAL * 100).toFixed(3)])), informedBeatsAllInPercent: +(better / count * 100).toFixed(2), methodology: "50题历史代理收益固定，按固定顺序展示50题、最多顺序投20家，投满立即结束；文本启发式含15%误判。只报告情景策略表现，不保证启发式优于其他策略，也不代表玩家表现。" };
}
if (process.argv[1]?.endsWith("simulate.ts")) console.log(JSON.stringify(simulate(), null, 2));
