export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error((data.error || "连接失败，请重试。") + (Array.isArray(data.details) ? ` ${data.details.join("；")}` : "")); return data as T;
}
export const money = (yuan: number, digits = 0) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(yuan / 10000);
export function uuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const a = crypto.getRandomValues(new Uint8Array(16)); a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128;
  const h = [...a].map(n => n.toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
