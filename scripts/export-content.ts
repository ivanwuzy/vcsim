import { mkdir, writeFile } from "node:fs/promises";
import { PROJECTS } from "../data/projects";
import manifest from "../data/question-bank-manifest.json";
import { projectYear, valuationMultiple } from "../lib/engine";
await mkdir("docs", { recursive: true });
await writeFile("docs/题库初稿.json", JSON.stringify(PROJECTS, null, 2) + "\n");
const labels = { A: "高开高走", B: "高开低走", C: "低开高走" };
const method = { "funding-proxy": "融资代理", assumption: "教学测算", fiction: "虚构情景", manual: "人工基准", reference: "公开估值参考" };
const value = (p: typeof PROJECTS[number], end = false) => {
  const v = p.valuation, n = end ? v.terminalValue ?? v.terminalYuan : v.entryValue ?? v.entryYuan;
  if (n === null || n === undefined) return "未指定估值";
  return v.currency === "index" ? `${n}（指数）` : `${Number((n / 1e8).toFixed(4))}${v.currency === "USD" ? "亿美元" : "亿元人民币"}`;
};
const header = `# 50家公司题库 ${manifest.version} · 游戏导出\n\n正式来源为 ${manifest.sourceBook}。50个国内真实原型，卡片年份采用题库底稿F列游戏进入年份，早于2015年统一改为2015年；活动按展示年份升序、同年按案例ID排序；估值测算进入年保留回报测算C列，结算倍数采用K列，I列人工指定倍率优先。两种年份分开保存；题库底稿中的近似倍数及研究备注不覆盖人工确认回报。按选定投资进入年份展示全部50题，最多投资20次，投满即结算。\n\n基金本金2亿元，单笔默认500万元，最高4000万元（基金本金的20%），按500万元一档调整。未投本金原值计入终值；2031年统一模拟结算，不预测真实2031年估值。回收额＝该笔实际投资金额×回报倍数（取万分之一）。回报倍数＝指定倍数×持股保留系数，或同币种终值÷进入值×持股保留系数。默认保留系数100%；不计分红、追加投入、税费、优先权或现金利息。美元保留原币比较；指数与指定倍数不伪造人民币估值。\n\n原型故事、真实团队、终值、分类和来源仅供后台与终局复盘，玩家决策时仅下发匿名化卡片文案与进入参考。人工确认回报与进入年不等同卡片全部事实审校通过；来源时间与信息边界按原表保留。\n\n## 总览\n\n| 代称 | 真实原型 | 领域 | 分类 | 投资进入年 | 回报口径 | 进入→终值 | 倍数 |\n|---|---|---|---|---|---|---|---|\n${PROJECTS.map(p => `| ${p.alias} | ${p.name} | ${p.sector} | ${labels[p.category]} | ${projectYear(p)} | ${p.valuation.basis ?? method[p.valuation.method]} | ${value(p)}→${value(p, true)} | ${(Math.round(valuationMultiple(p.valuation) * 10000) / 10000).toFixed(4)}× |`).join("\n")}\n\n`;
const body = PROJECTS.map((p, i) => `## ${i + 1}. ${p.alias} · ${p.name}\n\n- ID：${p.id}；投资进入年：${projectYear(p)}；${p.sector}；${labels[p.category]}${p.editorial?.manualCase ? "；人工确认案例" : ""}\n- 游戏一句话：${p.pitch}\n- 游戏团队背景：${p.team}\n- 游戏技术亮点：${p.technical}\n- 游戏商业化亮点：${p.traction}\n- 游戏疑点：${p.risk}\n- 原型团队：${p.editorial?.prototypeTeam ?? "见历史"}\n- 原型技术：${p.editorial?.prototypeTechnology ?? "见历史"}\n- 原型商业故事：${p.editorial?.prototypeBusiness ?? p.history}\n- 回报口径：${p.valuation.basis ?? method[p.valuation.method]}；${value(p)}→${value(p, true)}；指定倍数：${p.valuation.specifiedMultiple ?? "无"}；持股保留系数：${p.valuation.retention ?? 1}\n- 口径与局限：${p.valuation.note}\n- 复盘思考：${p.lesson}\n- 信息边界：${p.editorial?.informationBoundary ?? "待补"}\n${p.sources.map(s => `- 来源：[${s.publishedAt ?? "日期待补"}](${s.url})；${s.note}`).join("\n")}\n`).join("\n");
await writeFile("docs/题库初稿.md", header + body);
console.log(`Exported ${PROJECTS.length} ${manifest.version} cases`);
