import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertOrigin } from "../lib/security";

function request(url: string, origin?: string, method = "POST", headers: Record<string, string> = {}) {
  return new NextRequest(url, { method, headers: { ...headers, ...(origin === undefined ? {} : { Origin: origin }) } });
}
afterEach(() => vi.unstubAllEnvs());

describe("request origin protection", () => {
  it("allows the browser's localhost origin when Next.js uses its wildcard bind address", () => {
    vi.stubEnv("PUBLIC_URL", "http://localhost:3000");
    expect(() => assertOrigin(request("http://0.0.0.0:8000/api/admin/login", "http://localhost:8000"))).not.toThrow();
  });
  it("allows loopback aliases on the same port in local development and local production tests", () => {
    vi.stubEnv("PUBLIC_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    for (const origin of ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000"]) {
      expect(() => assertOrigin(request("http://0.0.0.0:8000/api/admin/login", origin))).not.toThrow();
    }
    expect(() => assertOrigin(request("http://127.0.0.1:8000/api/admin", "http://localhost:8000"))).not.toThrow();
  });
  it("preserves the configured public origin, including a trailing slash", () => {
    vi.stubEnv("PUBLIC_URL", "https://game.example.com/");
    expect(() => assertOrigin(request("http://0.0.0.0:3000/api/admin/login", "https://game.example.com"))).not.toThrow();
    expect(() => assertOrigin(request("https://game.example.com/api/admin", "https://game.example.com"))).not.toThrow();
  });
  it("rejects external origins, different local ports and schemes, and lookalike hosts", () => {
    vi.stubEnv("PUBLIC_URL", "");
    for (const origin of ["https://evil.example", "http://localhost:3000", "https://localhost:8000", "http://localhost.evil.example:8000", "http://192.168.1.1:8000"]) {
      expect(() => assertOrigin(request("http://0.0.0.0:8000/api/admin/login", origin))).toThrow("来源不匹配");
    }
    expect(() => assertOrigin(request("https://game.example.com/api/admin", "https://localhost"))).toThrow("来源不匹配");
  });
  it("does not trust attacker-supplied host headers or missing and malformed origins", () => {
    vi.stubEnv("PUBLIC_URL", "");
    expect(() => assertOrigin(request("http://0.0.0.0:8000/api/admin", "https://evil.example", "POST", { Host: "evil.example", "X-Forwarded-Host": "evil.example" }))).toThrow("来源不匹配");
    for (const origin of [undefined, "null", "invalid", "http://localhost:8000/path", "file://localhost"]) {
      expect(() => assertOrigin(request("http://0.0.0.0:8000/api/admin", origin))).toThrow("来源不匹配");
    }
  });
  it("allows read-only requests without an origin", () => {
    for (const method of ["GET", "HEAD"]) expect(() => assertOrigin(request("http://localhost:8000/api/meta", undefined, method))).not.toThrow();
  });
});
