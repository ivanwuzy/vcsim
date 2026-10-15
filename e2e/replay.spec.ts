import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const origin = process.env.E2E_URL || "http://localhost:3000";
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { data, headers: { Origin: origin } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function headerFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const brand = (await page.locator(".brand").boundingBox())!, controls = (await page.locator(".header-right").boundingBox())!;
  expect(brand.x + brand.width).toBeLessThanOrEqual(controls.x);
  const button = (await page.getByRole("button", { name: "再玩一次", exact: true }).boundingBox())!;
  expect(button.x).toBeGreaterThanOrEqual(0); expect(button.x + button.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(button.height).toBeGreaterThanOrEqual(44);
}

test("admin controls replay globally, resetting clears identity, progress, score and browser state", async ({ page, request, browser }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const originalSetting = (await request.get("/api/admin").then(r => r.json())).replayEnabled;
  const { eventId } = await post(request, "/api/admin", { action: "create", title: "试用重置浏览器验证", mode: "formal" });
  await post(request, `/api/admin?event=${eventId}`, { action: "open" });
  await post(request, "/api/admin", { action: "replay-settings", enabled: false });
  const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(`/?event=${eventId}`);
    await expect(page.getByRole("heading", { name: "就位，合伙人。" })).toBeVisible();
    await expect(page.getByRole("button", { name: "再玩一次", exact: true })).toHaveCount(0);
    expect((await page.request.post("/api/admin", { data: { action: "replay-settings", enabled: true }, headers: { Origin: origin } })).status()).toBe(401);
    expect((await page.request.post("/api/session/reset", { data: { eventId }, headers: { Origin: origin } })).status()).toBe(403);
    expect((await request.post("/api/admin", { data: { action: "replay-settings", enabled: "true" }, headers: { Origin: origin } })).status()).toBe(422);
    await post(admin.request, `${origin}/api/admin/login`, { password: process.env.ADMIN_PASSWORD });
    await admin.goto(`${origin}/admin`);
    const toggle = admin.getByRole("switch", { name: "向所有玩家显示“再玩一次”" });
    await expect(toggle).not.toBeChecked();
    await toggle.click(); await expect(toggle).toBeChecked();
    await expect(page.getByRole("button", { name: "再玩一次", exact: true })).toBeVisible({ timeout: 10000 });
    await admin.reload(); await expect(toggle).toBeChecked();
    for (const width of [320, 375, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await headerFits(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("你的姓名").fill("尚未实名"); await page.getByLabel("机构名称").fill("草稿机构");
    await page.getByRole("button", { name: "再玩一次", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByLabel("你的姓名")).toHaveValue(""); await expect(page.getByLabel("机构名称")).toHaveValue("");

    await page.getByLabel("你的姓名").fill("重置玩家"); await page.getByLabel("机构名称").fill("试用基金");
    await page.getByRole("button", { name: "开启我的投资之旅" }).click();
    await expect(page.getByRole("heading", { name: "未来便利店" })).toBeVisible();
    await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
    await expect(page.getByTestId("project-card")).toBeVisible();
    for (const width of [320, 375, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await headerFits(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "artifacts/replay-game-mobile.png", animations: "disabled" });
    let session = await page.request.get("/api/session").then(r => r.json());
    const oldRunId = session.run.id;
    await post(request, `/api/events/${eventId}/players`, { name: "保留玩家", institution: "另一基金" });
    const otherRun = await post(request, `/api/events/${eventId}/runs`, {});
    // Finish quickly with five maximum-sized investments, then reset from results.
    for (let i = 0; i < 5; i++) {
      const next = await post(page.request, `/api/runs/${session.run.id}/decisions`, { projectId: session.run.card.id, choice: "invest", amount: 40_000_000, key: crypto.randomUUID() });
      session = { ...session, run: next };
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "选择有了回响。" })).toBeVisible();
    await headerFits(page);
    expect((await request.get("/api/leaderboard").then(r => r.json())).rows.map((r: { name: string }) => r.name)).toContain("重置玩家");
    await page.evaluate(({ runId, eventId }) => {
      localStorage.setItem(`pending:${runId}`, "stale decision");
      localStorage.setItem(`amount:${runId}`, "40000000");
      localStorage.setItem(`taught:${eventId}`, "yes");
      localStorage.setItem("vc-game-theme", "dark");
    }, { runId: oldRunId, eventId });
    await page.getByRole("button", { name: "再玩一次", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByRole("heading", { name: "就位，合伙人。" })).toBeVisible();
    await expect(page.getByLabel("你的姓名")).toHaveValue(""); await expect(page.getByLabel("机构名称")).toHaveValue("");
    const reset = await page.request.get("/api/session").then(r => r.json());
    expect(reset.player).toBeNull(); expect(reset.run).toBeNull();
    expect((await page.context().cookies()).some(c => c.name === "vc_players")).toBe(false);
    expect(await page.evaluate(({ runId, eventId }) => [localStorage.getItem(`pending:${runId}`), localStorage.getItem(`amount:${runId}`), localStorage.getItem(`taught:${eventId}`), localStorage.getItem("vc-game-theme")], { runId: oldRunId, eventId })).toEqual([null, null, null, "dark"]);
    const state = await request.get(`/api/admin?event=${eventId}`).then(r => r.json());
    expect(state.players.map((p: { name: string }) => p.name)).toEqual(["保留玩家"]);
    expect((await request.get(`/api/runs/${otherRun.id}`)).ok()).toBe(true);
    expect((await page.request.get(`/api/runs/${oldRunId}`)).status()).toBe(404);
    expect((await request.get("/api/leaderboard").then(r => r.json())).rows).toHaveLength(0);

    await page.getByLabel("你的姓名").fill("重置玩家"); await page.getByLabel("机构名称").fill("试用基金");
    await page.getByRole("button", { name: "开启我的投资之旅" }).click();
    await expect(page.getByRole("heading", { name: "未来便利店" })).toBeVisible();
    const fresh = await page.request.get("/api/session").then(r => r.json());
    expect(fresh.run.id).not.toBe(oldRunId); expect(fresh.run.index).toBe(0); expect(fresh.run.cash).toBe(200_000_000);
    await toggle.click(); await expect(toggle).not.toBeChecked();
    await expect(page.getByRole("button", { name: "再玩一次", exact: true })).toHaveCount(0, { timeout: 10000 });
    expect((await page.request.post("/api/session/reset", { data: { eventId }, headers: { Origin: origin } })).status()).toBe(403);
    expect((await page.request.get("/api/session").then(r => r.json())).run.id).toBe(fresh.run.id);
  } finally {
    await admin.close();
    await post(request, "/api/admin", { action: "replay-settings", enabled: originalSetting });
    await post(request, `/api/admin?event=${eventId}`, { action: "delete" });
  }
});
