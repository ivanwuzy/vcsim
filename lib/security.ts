import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "./db";

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function sameSecret(a: string, b: string) { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
function secret() { const key = process.env.SESSION_SECRET; if (!key || key.length < 32) throw new Error("请配置至少32字符的 SESSION_SECRET。 "); return key; }
export function sign(value: string) { return `${value}.${createHmac("sha256", secret()).update(value).digest("base64url")}`; }
export function verify(value: string | undefined) {
  if (!value) return null; const i = value.lastIndexOf("."); if (i < 0) return null;
  const payload = value.slice(0, i); return sameSecret(sign(payload), value) ? payload : null;
}
export function isAdminSession(token: string | undefined) {
  const payload = verify(token);
  return !!payload && /^admin:\d+$/.test(payload) && Number(payload.slice(6)) > Date.now();
}
export function assertAdmin(request: NextRequest) {
  if (!isAdminSession(request.cookies.get("vc_admin")?.value)) throw new HttpError(401, "请先登录管理后台。");
}
function webUrl(value: string | null | undefined) {
  try { const url = new URL(value ?? ""); return ["http:", "https:"].includes(url.protocol) ? url : null; }
  catch { return null; }
}
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
export function assertOrigin(request: NextRequest) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const source = webUrl(origin), target = new URL(request.url);
  const allowed = [target.origin, webUrl(process.env.PUBLIC_URL)?.origin];
  // Next.js may use its wildcard bind address in request.url for a localhost visit.
  const sameLocalEndpoint = source && localHosts.has(source.hostname) && localHosts.has(target.hostname) && source.port === target.port && source.protocol === target.protocol;
  if (!source || source.origin !== origin || (!allowed.includes(origin) && !sameLocalEndpoint)) throw new HttpError(403, "请求来源不匹配，请从活动网页操作。");
}
export async function rateLimit(bucket: string, limit = 12, windowMs = 60000) {
  const db = await getDb(), now = Date.now();
  const r = await db.query<{ count: number }>(`INSERT INTO rate_limits(bucket,count,reset_at) VALUES($1,1,$2)
    ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN rate_limits.reset_at < $3 THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at < $3 THEN $2 ELSE rate_limits.reset_at END RETURNING count`, [bucket, now + windowMs, now]);
  if (r.rows[0].count > limit) throw new HttpError(429, "操作太频繁，请稍后再试。");
}
export const cookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: process.env.PUBLIC_URL?.startsWith("https://") ?? false, path: "/", maxAge: 60 * 60 * 24 * 30 };
