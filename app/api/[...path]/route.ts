import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { assertAdmin, assertOrigin, cookieOptions, HttpError, rateLimit, sameSecret, sign, verify } from "../../../lib/security";
import { adminAction, adminState, decide, eventMeta, getActiveEvent, getEvent, getRun, leaderboard, playerForToken, publicLeaderboard, publicMeta, register, result, startRun } from "../../../lib/service";
import { getDb } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const text = z.string().trim().min(1).max(80);
const sourceSchema = z.object({ url: z.url().refine(v => /^https?:/.test(v)), publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), note: z.string().max(500) });
const projectSchema = z.object({ id: z.string().min(1).max(80), name: text, alias: text, year: z.number().int().min(2006).max(2026), category: z.enum(["A", "B", "C"]), real: z.boolean(), market: z.enum(["CN", "overseas"]), robotics: z.boolean(), sector: text,
  foundedYear: z.number().int().min(1900).max(2026).optional(), firstFundingYear: z.number().int().min(1900).max(2026).optional(),
  decisionYear: z.number().int().min(2006).max(2026).optional(),
  pitch: z.string().min(1).max(300), team: z.string().min(1).max(500), technical: z.string().min(1).max(500), traction: z.string().min(1).max(500), risk: z.string().min(1).max(500), history: z.string().min(1).max(1500), lesson: z.string().min(1).max(1000),
  valuation: z.object({ method: z.enum(["funding-proxy", "assumption", "fiction", "manual", "reference"]), entryYear: z.number().int(), endYear: z.number().int(), entryYuan: z.number().finite().min(5000000).nullable(), terminalYuan: z.number().finite().min(0).nullable(), entryFundingYuan: z.number().positive().optional(), terminalFundingYuan: z.number().nonnegative().optional(), points: z.array(z.object({ year: z.number().int(), cumulativeFundingYuan: z.number().nonnegative().optional(), valueYuan: z.number().nonnegative() })), reference: z.string(), status: z.string(), note: z.string(),
    basis: z.string().optional(), currency: z.enum(["CNY", "USD", "index"]).optional(), entryValue: z.number().finite().nonnegative().nullable().optional(), terminalValue: z.number().finite().nonnegative().nullable().optional(), specifiedMultiple: z.number().finite().nonnegative().optional(), retention: z.number().min(0).max(1).optional(), entryRound: z.string().optional(), cutoff: z.string().optional() }),
  editorial: z.object({ manualCase: z.boolean(), sourceBook: z.string(), sourceRow: z.number().int(), sourceSha256: z.string(), prototypeTeam: z.string(), prototypeTechnology: z.string(), prototypeBusiness: z.string(), firstFunding: z.string(), cumulativeFunding: z.string(), trajectory: z.string(), stage: z.string(), informationBoundary: z.string() }).optional(),
  sensitivity: z.array(z.string().max(80)).min(1).max(8), sources: z.array(sourceSchema).max(12), review: z.enum(["draft", "approved"]), reviewedAt: z.string().nullable(), decisionEvidence: z.string().nullable(), family: z.string().max(80).optional() });
const adminSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: text, mode: z.enum(["demo", "formal"]) }),
  z.object({ action: z.literal("settings"), title: text, topCount: z.number().int().min(1).max(100), luckyCount: z.number().int().min(1).max(100) }),
  z.object({ action: z.literal("import"), projects: z.array(projectSchema).length(50) }),
  ...["open", "close", "freeze", "delete"].map(action => z.object({ action: z.literal(action) })),
  z.object({ action: z.literal("draw"), key: z.uuid(), count: z.number().int().min(1).max(100) }),
  z.object({ action: z.literal("tie"), key: z.uuid() }),
  z.object({ action: z.literal("recovery"), playerId: z.uuid() }),
  z.object({ action: z.literal("rename"), playerId: z.uuid(), name: text, institution: text }),
]);
function playerTokens(request: NextRequest): Record<string, string> {
  try { const value = verify(request.cookies.get("vc_players")?.value); return value ? JSON.parse(value) : {}; } catch { return {}; }
}
async function tokenForRun(request: NextRequest, runId: string) {
  const db = await getDb(); const r = await db.query<{ event_id: string }>("SELECT event_id FROM runs WHERE id=$1", [runId]);
  if (!r.rows[0]) throw new HttpError(404, "游戏不存在。");
  if ((await getActiveEvent())?.id !== r.rows[0].event_id) throw new HttpError(409, "活动已停止或已切换，请进入当前活动。");
  return playerTokens(request)[r.rows[0].event_id];
}
function reply(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function dispatch(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    assertOrigin(request); const { path } = await context.params; const route = path.join("/"), post = request.method === "POST";
    if (post && Number(request.headers.get("content-length") || 0) > 1500000) throw new HttpError(413, "内容太大。");
    if (route === "admin/login" && post) {
      await rateLimit("admin-login", 15);
      const { password } = z.object({ password: z.string().max(200) }).parse(await request.json());
      if (!process.env.ADMIN_PASSWORD || !sameSecret(password, process.env.ADMIN_PASSWORD)) throw new HttpError(401, "后台密码不正确。");
      const response = reply({ ok: true }); response.cookies.set("vc_admin", sign(`admin:${Date.now() + 8 * 60 * 60 * 1000}`), { ...cookieOptions, maxAge: 8 * 60 * 60 }); return response;
    }
    if (route === "admin/logout" && post) { const response = reply({ ok: true }); response.cookies.delete("vc_admin"); return response; }
    if (route === "meta" && !post) return reply(await publicMeta());
    if (route === "session" && !post) {
      const event = await getActiveEvent();
      if (!event) return reply({ meta: null, player: null, run: null });
      const meta = eventMeta(event);
      const token = playerTokens(request)[event.id];
      if (!token) return reply({ meta, player: null, run: null });
      try { const player = await playerForToken(token); const db = await getDb(); const run = (await db.query<{ id: string }>("SELECT id FROM runs WHERE player_id=$1", [player.id])).rows[0];
        return reply({ meta, player: { name: player.name, institution: player.institution }, run: run ? await getRun(run.id, token) : null });
      } catch (e) { if (e instanceof HttpError && e.status === 401) return reply({ meta, player: null, run: null }); throw e; }
    }
    if (route === "admin") {
      assertAdmin(request); const eventId = request.nextUrl.searchParams.get("event") || undefined;
      if (!post) return reply(await adminState(eventId));
      const parsed = adminSchema.parse(await request.json());
      return reply(await adminAction(eventId, parsed.action, parsed));
    }
    if (route === "admin/leaderboard" && !post) {
      assertAdmin(request);
      const event = await getEvent(request.nextUrl.searchParams.get("event") || undefined);
      return reply({ id: event.id, rows: await leaderboard(event), frozen: event.status === "frozen", status: event.status, title: event.title, mode: event.mode, initial: eventMeta(event).initial });
    }
    if (route === "admin/export" && !post) {
      assertAdmin(request); const state = await adminState(request.nextUrl.searchParams.get("event") || undefined);
      if (!state.event) throw new HttpError(404, "活动不存在。");
      if (request.nextUrl.searchParams.get("type") === "projects") return new NextResponse(JSON.stringify(state.event.snapshot.projects, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="projects.json"', "Cache-Control": "no-store" } });
      const lucky = new Set((state.draws as { kind: string; winners: { playerId: string }[] }[]).filter(d => d.kind === "lucky").flatMap(d => d.winners.map(w => w.playerId)));
      const tieDraw = (state.draws as { kind: string; candidates: { playerId: string }[]; winners: { playerId: string }[] }[]).find(d => d.kind === "tie");
      const boundary = state.leaderboard[Math.min(state.event.settings.topCount, state.leaderboard.length) - 1];
      const boundaryTied = !!boundary && state.leaderboard.filter(r => r.rank === boundary.rank).length > state.event.settings.topCount - (boundary.rank - 1);
      const rows = [["姓名", "机构", "进度", "排名", "虚拟净收益（元）", "排名奖", "幸运奖", "领奖核验"], ...state.players.map(p => { const r = state.leaderboard.find(r => r.playerId === p.id);
        let award = r && r.rank <= state.event.settings.topCount ? "是" : "否";
        if (r && boundaryTied && r.rank === boundary.rank) award = tieDraw ? (tieDraw.winners.some(w => w.playerId === p.id) ? "是" : "否") : "待并列抽签";
        return [p.name, p.institution, p.progress, r?.rank ?? "", r?.profit ?? "", award, lucky.has(p.id) ? "是" : "否", ""]; })];
      const cell = (v: unknown) => { const s = String(v ?? ""); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`; };
      return new NextResponse("\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="participants.csv"', "Cache-Control": "no-store" } });
    }
    if (route === "admin/qr" && !post) {
      assertAdmin(request);
      const base = process.env.PUBLIC_URL || "http://localhost:3000";
      return new NextResponse(await QRCode.toString(`${base.replace(/\/$/, "")}/`, { type: "svg", margin: 2 }), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
    }
    if (route === "leaderboard" && !post) return reply(await publicLeaderboard());
    if (path[0] === "events" && path.length === 3) {
      const eventId = path[1];
      if (path[2] === "players" && post) {
        await rateLimit(`register:${eventId}`, 160); // supports simultaneous ~100 guest arrival
        const body = z.object({ name: text, institution: text, recovery: z.string().max(80).optional() }).parse(await request.json());
        const tokens = playerTokens(request), value = await register(eventId, body.name, body.institution, tokens[eventId], body.recovery);
        tokens[eventId] = value.token;
        const response = reply({ player: { name: value.player.name, institution: value.player.institution } });
        response.cookies.set("vc_players", sign(JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(-8)))), cookieOptions); return response;
      }
      if (path[2] === "runs" && post) return reply(await startRun(eventId, playerTokens(request)[eventId]));
      if (path[2] === "leaderboard" && !post) {
        return reply(await publicLeaderboard());
      }
    }
    if (path[0] === "runs" && path.length >= 2) {
      const runId = path[1], token = await tokenForRun(request, runId);
      if (path.length === 2 && !post) return reply(await getRun(runId, token));
      if (path[2] === "result" && !post) return reply(await result(runId, token));
      if (path[2] === "decisions" && post) {
        const body = z.object({ projectId: z.string().max(80), choice: z.enum(["invest", "pass"]), key: z.uuid() }).parse(await request.json());
        return reply(await decide(runId, token, body));
      }
    }
    throw new HttpError(404, "接口不存在。");
  } catch (error) {
    if (error instanceof z.ZodError) return reply({ error: "输入格式不正确。", details: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).slice(0, 5) }, 422);
    if (error instanceof HttpError) return reply({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return reply({ error: "请求不是有效的JSON。" }, 400);
    if ((error as { code?: string }).code === "23505") return reply({ error: "该身份或记录已经存在。" }, 409);
    console.error("API error", error); return reply({ error: "服务暂时不可用，请稍后重试；当前决策不会丢失。" }, 500);
  }
}
export const GET = dispatch;
export const POST = dispatch;
