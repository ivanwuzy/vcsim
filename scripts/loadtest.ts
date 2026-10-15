// Run only against an isolated test instance, never an ongoing activity.
// LOADTEST_URL=http://localhost:3001 npm run loadtest
// Creates a new demo event, 100 players; early full portfolios and complete 50-card timelines and freezes this event.
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
const base = process.env.LOADTEST_URL || "http://localhost:3001";
class Client {
  cookie = "";
  async request<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: base, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookie = r.headers.getSetCookie(); if (cookie.length) this.cookie = cookie.map(c => c.split(";")[0]).join("; ");
    const data = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${data.error}`); return data as T;
  }
}
type Run = { id: string; card: { id: string } | null; index: number; status: string };
const admin = new Client();
await admin.request("/api/admin/login", { password: process.env.ADMIN_PASSWORD });
const { eventId } = await admin.request<{ eventId: string }>("/api/admin", { action: "create", title: "隔离压测 · 不用于活动", mode: "demo" });
await admin.request(`/api/admin?event=${eventId}`, { action: "open" });
const clients = Array.from({ length: 100 }, () => new Client()), latencies: number[] = [], registration: number[] = [];
const runs = await Promise.all(clients.map(async (c, i) => {
  const before = performance.now(); await c.request(`/api/events/${eventId}/players`, { name: `压测玩家${i}`, institution: "自动化测试" }); registration.push(performance.now() - before);
  return await c.request<Run>(`/api/events/${eventId}/runs`, {});
}));
for (let turn = 0; turn < 50; turn++) {
  await Promise.all(clients.map(async (c, i) => {
    if (runs[i].status === "completed") return;
    const start = performance.now(); const r = await c.request<Run>(`/api/runs/${runs[i].id}/decisions`, { projectId: runs[i].card!.id, choice: i % 2 && turn < 20 ? "invest" : "pass", key: randomUUID() }); latencies.push(performance.now() - start); runs[i] = r;
  }));
}
await admin.request(`/api/admin?event=${eventId}`, { action: "close" }); await admin.request(`/api/admin?event=${eventId}`, { action: "freeze" });
const rows = await admin.request<{ rows: unknown[] }>(`/api/admin/leaderboard?event=${eventId}`);
const percentile = (a: number[], p: number) => Math.round([...a].sort((a, b) => a - b)[Math.ceil(a.length * p) - 1]);
const report = { url: base, players: 100, decisions: latencies.length, completed: runs.filter(r => r.status === "completed").length, leaderboard: rows.rows.length, registrationP95ms: percentile(registration, .95), decisionP50ms: percentile(latencies, .5), decisionP95ms: percentile(latencies, .95), targetMet: percentile(latencies, .95) < 1000, note: "本机隔离服务、100并发同步提交；不包括手机与公网网络延迟，不代替生产PostgreSQL实测。" };
await mkdir("artifacts", { recursive: true }); await writeFile("artifacts/loadtest.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
if (report.completed !== 100 || !report.targetMet) process.exitCode = 1;
