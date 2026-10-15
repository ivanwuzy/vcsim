export type Category = "A" | "B" | "C";
export type Era = 0 | 1 | 2;
export type Choice = "invest" | "pass";
export type Source = { url: string; publishedAt: string | null; note: string };
export type Project = {
  id: string; name: string; alias: string; year: number; category: Category;
  foundedYear?: number; firstFundingYear?: number; decisionYear?: number;
  real: boolean; market?: "CN" | "overseas"; robotics: boolean; sector: string; pitch: string; team: string; technical: string;
  traction: string; risk: string; history: string; lesson: string;
  sensitivity: string[]; sources: Source[];
  review: "draft" | "approved"; reviewedAt: string | null;
  decisionEvidence: string | null; family?: string; valuation: Valuation;
  editorial?: { manualCase: boolean; sourceBook: string; sourceRow: number; sourceSha256: string; prototypeTeam: string; prototypeTechnology: string; prototypeBusiness: string; firstFunding: string; cumulativeFunding: string; trajectory: string; stage: string; informationBoundary: string };
};
export type ValuationPoint = { year: number; cumulativeFundingYuan?: number; valueYuan: number };
export type Valuation = { method: "funding-proxy" | "assumption" | "fiction" | "manual" | "reference"; entryYear: number; endYear: number; entryYuan: number | null; terminalYuan: number | null; entryFundingYuan?: number; terminalFundingYuan?: number; points: ValuationPoint[]; reference: string; status: string; note: string; basis?: string; currency?: "CNY" | "USD" | "index"; entryValue?: number | null; terminalValue?: number | null; specifiedMultiple?: number; retention?: number; entryRound?: string; cutoff?: string };
export type Path = { multipleBps: number; ending: string; milestones: { year: number; valueBps: number; text: string }[] };
export type Deck = { id: string; ids: string[]; maxProfit: number; losses: number; allInProfit: number };
export type GameRules = { initial: number; ticket: number; maxTicket?: number; total: number; maxInvestments: number; settlementYear: number; endOnInvestmentLimit?: boolean };
export type Snapshot = { version: string; projects: Project[]; paths: Record<string, Path>; decks: Deck[]; events: { title: string; text: string; shock: string }[]; rules?: GameRules };
export type Decision = { projectId: string; choice: Choice; key: string; amount?: number };
export type PlayerCard = Pick<Project, "id" | "alias" | "year" | "sector" | "pitch" | "team" | "technical" | "traction" | "risk"> & { entryValuation?: number; entryReference?: string; placeholder?: boolean; yearBasis?: "entry" | "founded" | "first-funding" | "example" };
export type RunView = {
  id: string; player: { name: string; institution: string }; status: "playing" | "completed";
  index: number; total: number; year: number; value: number; cash: number;
  invested: number; maxInvestments: number; card: PlayerCard | null; eventStatus: string;
  eraNotice: { title: string; text: string } | null;
  updates: { alias: string; text: string; year: number }[];
};
