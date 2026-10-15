import { projectYear } from "./engine";
import type { PlayerCard, Project } from "./types";

// Presentation only: keep the editable bank and its historical/valuation records intact.
const PEOPLE = ["王鹤", "韩峰涛", "高阳", "高继扬", "邓泰华", "彭志辉", "陈建宇", "张巍", "王世全", "郑勇", "邵天兰", "李一帆", "孙恺", "余凯", "郭光灿", "郭国平", "左昱昱", "左昱领", "刘培超", "王兴兴", "汪滔", "李通", "张涛", "昌敬", "俞浩", "张峻彬", "赵越", "王群", "叶杨笙", "张朝辉", "梅雪松", "朱秋国", "蔡颖鹏", "李卫平", "李明洋", "沈岗", "黄晓庆", "浦汉来", "倪凯", "唐锐", "王劲", "刘君", "蒋尚义", "刘自鸿"];
const identities: [RegExp, string][] = [
  [/华为|百度|OPPO|IBM|微软亚洲工程院/g, "某头部科技公司"],
  [/深兰科技|达闼集团|长城汽车|科沃斯|清水湾|知行|发那科|博智林|台积电/g, "某产业集团"],
  [/清华交叉信息研究院|清华|北大|浙江大学|上海交通大学|西安交通大学|中国科学技术大学/g, "国内名校"],
  [/斯坦福|南加州大学|东京工业大学/g, "海外名校"],
];
export function anonymizeText(text: string) {
  let value = text.replace(new RegExp(PEOPLE.join("|"), "g"), "创始人");
  value = value.replace(/创始人(?:[、与]创始人)+/g, "联合创始团队");
  for (const [pattern, replacement] of identities) value = value.replace(pattern, replacement);
  return value;
}

// Missing case types use clearly marked examples, never fabricated real prototypes.
const EXAMPLES: Record<string, Partial<PlayerCard>> = {
  "f-41": { pitch: "目标做人形机器人，却决定先把电机卖好。", team: "材料研究团队和量产工程师搭伙创业，不急着发布整机。", technical: "先攻关电机效率和关节寿命，再考虑整机。", traction: "两家本体团队愿意付费试用核心部件。", risk: "小零件能带来收入，但离通用人形机器人的梦想还很远。" },
  "f-46": { alias: "纸飞机智能", sector: "AI大模型", pitch: "想让每家小公司，都有一个会干活的AI助手。", team: "某某跳动技术高P创业，团队写得了模型，还没卖过企业软件。", technical: "用小模型和行业数据做便宜的专用助手。", traction: "演示很惊艳，三家客户愿意试用，但还没人续费。", risk: "算力账单按月来，客户预算还在下一季度。" },
  "f-47": { team: "师从AI教母归国创业，模型研究履历亮眼，机器人现场经验还在补课。" },
  "f-50": { team: "团队背景不算豪华，几位热爱机器人的普通211理工科极客。", risk: "只会一个工位的动作，看起来不够通用，但客户愿意为这一个动作付钱。" },
};
export function playerCard(project: Project): PlayerCard {
  const card: PlayerCard = {
    id: project.id, alias: project.alias, year: projectYear(project), sector: project.sector,
    pitch: project.pitch, team: project.team, technical: project.technical ?? "早期版本未单独列技术亮点。",
    traction: project.traction, risk: project.risk, ...(project.valuation?.entryYuan != null ? { entryValuation: project.valuation.entryYuan } : {}),
    ...(project.valuation.currency === "USD" && project.valuation.entryValue != null ? { entryReference: `${Number((project.valuation.entryValue / 100000000).toFixed(2))}亿美元` } : {}),
    placeholder: !project.real,
    yearBasis: project.decisionYear !== undefined ? "entry" : project.foundedYear !== undefined ? "founded" : project.firstFundingYear !== undefined ? "first-funding" : "example",
    ...(!project.real ? EXAMPLES[project.id] : {}),
  };
  for (const field of ["alias", "sector", "pitch", "team", "technical", "traction", "risk"] as const) card[field] = anonymizeText(card[field]);
  return card;
}
