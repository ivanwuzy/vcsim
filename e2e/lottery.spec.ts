import { test, expect, type Page } from "@playwright/test";
import nextEnv from "@next/env";
import type { LotteryState, LuckyDraw } from "../lib/lottery";
nextEnv.loadEnvConfig(process.cwd());
const origin = process.env.E2E_URL || "http://localhost:3000";
const people = Array.from({ length: 12 }, (_, index) => ({ playerId: `player-${index}`, name: ["林远", "陈星河", "李未来", "周晴", "许星辰"][index] ?? `幸运观众${index + 1}`, institution: ["远见资本", "银河创投", "未来基金", "原点创投", "山海资本"][index] ?? "具身智能创新投资基金", rank: index + 1, profit: 0 }));
type DrawRequest = { action: string; key: string; count: number; excludeWinners?: boolean; replaceDrawId?: string };

async function fixture(page: Page, initialDraws: LuckyDraw[] = [], locked = true) {
  await page.clock.install();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const response = await page.request.post("/api/admin/login", { headers: { Origin: origin }, data: { password: process.env.ADMIN_PASSWORD } });
  expect(response.ok()).toBe(true);
  const state: LotteryState = { eventId: "lottery-ui", title: "具身创投之夜 · 幸运观众", locked, defaultCount: 5, candidates: people, draws: initialDraws };
  const requests: DrawRequest[] = [];
  let loseResponse = false;
  await page.route("**/api/admin/leaderboard?*", route => route.fulfill({ json: { id: state.eventId, title: state.title, status: locked ? "frozen" : "closed", frozen: locked, initial: 200_000_000, mode: "demo", rows: people } }));
  await page.route("**/api/admin/lottery?*", route => route.fulfill({ json: state }));
  await page.route("**/api/admin?*", async route => {
    const body = route.request().postDataJSON() as DrawRequest;
    requests.push(body);
    let draw = state.draws.find(item => item.request_key === body.key);
    if (!draw) {
      const prior = new Set(state.draws.filter(item => item.id !== body.replaceDrawId).flatMap(item => item.winners.map(winner => winner.playerId)));
      const candidates = people.filter(person => body.excludeWinners === false && !body.replaceDrawId || !prior.has(person.playerId));
      draw = { id: crypto.randomUUID(), kind: "lucky", candidates, winners: candidates.slice(0, body.count), created_at: new Date().toISOString(), request_key: body.key };
      state.draws = [...state.draws.filter(item => item.id !== body.replaceDrawId), draw];
    }
    if (loseResponse) { loseResponse = false; await route.abort("failed"); }
    else await route.fulfill({ json: draw });
  });
  await page.goto("/admin/screen?event=lottery-ui");
  await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(5);
  return { state, requests, loseNextResponse: () => { loseResponse = true; } };
}

test("the lever saves once, reveals left to right, celebrates and restores saved winners after reopening", async ({ page }) => {
  const { state, requests } = await fixture(page);
  await page.getByLabel("抽取人数", { exact: true }).fill("3");
  await expect(page.getByTestId("lottery-machine")).toHaveCount(3);
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  expect(state.draws[0].winners).toHaveLength(3);
  await expect(page.getByRole("button", { name: "摇杆：开始抽奖" })).toBeDisabled();
  await expect(page.getByTestId("lottery-machine").nth(0)).toHaveAttribute("data-revealed", "false");
  await page.clock.runFor(2500);
  await expect(page.getByTestId("lottery-machine").nth(0)).toHaveAttribute("data-revealed", "true");
  await expect(page.getByTestId("lottery-machine").nth(1)).toHaveAttribute("data-revealed", "false");
  await page.clock.runFor(650);
  await expect(page.getByTestId("lottery-machine").nth(1)).toHaveAttribute("data-revealed", "true");
  await expect(page.getByTestId("lottery-machine").nth(2)).toHaveAttribute("data-revealed", "false");
  await page.clock.runFor(650);
  await expect(page.getByTestId("lottery-celebration")).toBeVisible();
  for (const winner of state.draws[0].winners) await expect(page.getByRole("dialog")).toContainText(winner.name);
  await page.getByRole("button", { name: "关闭抽奖浮窗" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".live-board")).toBeVisible();
  await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
  await expect(page.getByTestId("lottery-machine").nth(0)).toHaveAttribute("data-revealed", "true");
  await expect(page.getByTestId("lottery-celebration")).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(3);
  await expect(page.getByTestId("lottery-machine").nth(0)).toContainText(state.draws[0].winners[0].institution);
  expect(requests).toHaveLength(1);
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  test(`the last reel and celebration preserve the stage position at ${size.width}`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize(size);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    if (size.width === 1920) await page.screenshot({ path: "artifacts/lottery-tech-preview-ready.png", animations: "disabled" });
    await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
    await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
    await page.clock.runFor(4800);
    const first = (await page.getByTestId("lottery-machine").first().elementHandle())!;
    const dialogBefore = (await page.getByRole("dialog").boundingBox())!;
    const machineBefore = (await first.boundingBox())!;
    await page.clock.runFor(350);
    await expect(page.getByTestId("lottery-celebration")).toBeVisible();
    const dialogAfter = (await page.getByRole("dialog").boundingBox())!;
    const machineAfter = (await page.getByTestId("lottery-machine").first().boundingBox())!;
    console.log({ size, dialogShift: dialogAfter.y - dialogBefore.y, machineShift: machineAfter.y - machineBefore.y, retainedMachine: await first.evaluate(el => el.isConnected) });
    expect(await first.evaluate(el => el.isConnected)).toBe(true);
    expect(Math.abs(dialogAfter.y - dialogBefore.y)).toBeLessThan(1);
    expect(Math.abs(dialogAfter.height - dialogBefore.height)).toBeLessThan(1);
    expect(Math.abs(machineAfter.y - machineBefore.y)).toBeLessThan(1);
    await page.clock.runFor(1500);
    expect(await page.getByTestId("lottery-celebration").locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    })).toBe(true);
    if (size.width === 1920) await page.screenshot({ path: "artifacts/lottery-tech-preview-celebration.png" });
    await page.clock.runFor(7000);
    await expect(page.getByTestId("lottery-celebration")).toHaveCount(0);
    expect((await page.getByRole("dialog").boundingBox())!.y).toBe(dialogAfter.y);
  });
}

test("redrawing requires confirmation and additional awards use the requested count and exclusion choice", async ({ page }) => {
  const { state, requests } = await fixture(page);
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  const original = state.draws[0];
  await page.getByRole("button", { name: "重抽本轮" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("5 位中奖名单将被新结果替换");
  await page.getByRole("button", { name: "保留现有名单" }).click();
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "重抽本轮" }).click();
  await page.getByRole("button", { name: "确认重抽" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  expect(requests[1]).toMatchObject({ replaceDrawId: original.id, count: 5, excludeWinners: true });
  expect(state.draws).toHaveLength(1); expect(state.draws[0].id).not.toBe(original.id);
  await page.getByLabel("再抽几个").fill("2");
  await expect(page.getByLabel("排除已抽中人员")).toBeChecked();
  await page.getByRole("button", { name: "抽取更多", exact: true }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(2);
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  expect(requests[2]).toMatchObject({ count: 2, excludeWinners: true });
  expect(new Set(state.draws.flatMap(draw => draw.winners.map(winner => winner.playerId))).size).toBe(7);
  await page.getByLabel("排除已抽中人员").uncheck();
  await page.getByLabel("再抽几个").fill("3");
  await page.getByRole("button", { name: "抽取更多", exact: true }).click();
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  expect(requests[3]).toMatchObject({ count: 3, excludeWinners: false });
  await page.getByRole("button", { name: /中奖名单 · 共 3 轮/ }).click();
  await expect(page.getByRole("heading", { name: /第 1 轮/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /第 3 轮/ })).toBeVisible();
  await page.screenshot({ path: "artifacts/lottery-all-winners.png" });
});

test("saved requests recover after a lost response and an interrupted animation never redraws", async ({ page }) => {
  const { state, requests, loseNextResponse } = await fixture(page);
  loseNextResponse();
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.draws).toHaveLength(1);
  await page.getByRole("button", { name: "摇杆：同步抽取结果" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  expect(requests).toHaveLength(2); expect(requests[0].key).toBe(requests[1].key);
  expect(state.draws).toHaveLength(1);
  await page.getByRole("button", { name: "关闭抽奖浮窗" }).click();
  await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
  await expect(page.getByTestId("lottery-machine").nth(4)).toHaveAttribute("data-revealed", "true");
  expect(requests).toHaveLength(2);
  loseNextResponse();
  await page.getByRole("button", { name: "抽取更多", exact: true }).click();
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.draws).toHaveLength(2);
  await page.reload();
  await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(5);
  await expect(page.getByTestId("lottery-machine").first()).toHaveAttribute("data-revealed", "true");
  await expect(page.getByRole("button", { name: "摇杆：同步抽取结果" })).toHaveCount(0);
  expect(requests).toHaveLength(3);
});

test("slot machines fit projector sizes and large batches and remain usable with reduced motion", async ({ page }) => {
  await fixture(page);
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const modal = page.getByRole("dialog");
    expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (size.width >= 900) expect(await modal.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
    const bounds = (await modal.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: `artifacts/lottery-ready-${size.width}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByLabel("抽取人数", { exact: true }).fill("100");
  await expect(page.getByTestId("lottery-machine")).toHaveCount(12);
  await expect(page.getByRole("dialog")).toContainText("本轮将抽取 12 人");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.clock.runFor(10000);
  await expect(page.getByTestId("lottery-machine").nth(11)).toHaveAttribute("data-revealed", "true");
  await page.screenshot({ path: "artifacts/lottery-large-batch.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "幸运观众抽奖", exact: true })).toBeFocused();
});

test("the screen blocks draws until the roster is locked", async ({ page }) => {
  const { requests } = await fixture(page, [], false);
  await expect(page.getByRole("dialog")).toContainText("停止活动并冻结最终榜单");
  await expect(page.getByRole("button", { name: "摇杆：开始抽奖" })).toBeDisabled();
  expect(requests).toHaveLength(0);
});

test("the real API persists screen draws and replacement awards and the host console reopens the same results", async ({ page, playwright }) => {
  const post = async (path: string, body: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data: body });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await post("/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post("/api/admin", { action: "create", title: "幸运观众界面验证", mode: "demo" });
  await post(`/api/admin?event=${eventId}`, { action: "open" });
  for (const person of people.slice(0, 5)) {
    const player = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
    try {
      expect((await player.post(`/api/events/${eventId}/players`, { data: { name: person.name, institution: person.institution } })).ok()).toBe(true);
      let run = await player.post(`/api/events/${eventId}/runs`, { data: {} }).then(response => response.json());
      for (let index = 0; index < 5; index++) {
        const response = await player.post(`/api/runs/${run.id}/decisions`, { data: { projectId: run.card.id, choice: "invest", amount: 40_000_000, key: crypto.randomUUID() } });
        expect(response.ok()).toBe(true); run = await response.json();
      }
      expect(run.status).toBe("completed");
    } finally { await player.dispose(); }
  }
  await post(`/api/admin?event=${eventId}`, { action: "close" });
  await post(`/api/admin?event=${eventId}`, { action: "freeze" });
  await page.clock.install();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/admin/screen?event=${eventId}`);
  await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(5);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.screenshot({ path: "artifacts/lottery-tech-ready-1920.png", animations: "disabled" });
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  let saved = await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json()) as LotteryState;
  expect(saved.draws).toHaveLength(1); expect(saved.draws[0].winners).toHaveLength(5);
  const oldId = saved.draws[0].id;
  await page.clock.runFor(5300);
  await expect(page.getByTestId("lottery-machine").nth(4)).toHaveAttribute("data-revealed", "true");
  await page.screenshot({ path: "artifacts/lottery-winners-1920.png", animations: "disabled" });
  await page.clock.runFor(1300);
  await page.screenshot({ path: "artifacts/lottery-tech-celebration-1920.png" });
  await page.clock.runFor(5000);
  await page.screenshot({ path: "artifacts/lottery-tech-winners-1920.png", animations: "disabled" });
  await page.getByRole("button", { name: "重抽本轮" }).click();
  await page.screenshot({ path: "artifacts/lottery-redraw-confirm.png" });
  await page.getByRole("button", { name: "确认重抽" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  saved = await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json());
  expect(saved.draws).toHaveLength(1); expect(saved.draws[0].id).not.toBe(oldId);
  const invalid = await page.request.post(`/api/admin?event=${eventId}`, { headers: { Origin: origin }, data: { action: "draw", key: crypto.randomUUID(), count: 1, excludeWinners: "false" } });
  expect(invalid.status()).toBe(422);
  await page.getByLabel("排除已抽中人员").uncheck();
  await page.getByLabel("再抽几个").fill("2");
  await page.getByRole("button", { name: "抽取更多", exact: true }).click();
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  const current = await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json()) as LotteryState;
  expect(current.draws).toHaveLength(2); expect(current.draws[1].winners).toHaveLength(2);
  const exported = await page.request.get(`/api/admin/export?event=${eventId}`).then(response => response.text());
  expect(exported).toContain("幸运奖");
  await page.getByRole("button", { name: "关闭抽奖浮窗" }).click();
  await page.goto("/admin");
  await page.getByRole("button", { name: "榜单与抽奖", exact: true }).click();
  await page.getByRole("button", { name: "查看中奖名单 / 继续抽奖" }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(2);
  await expect(page.getByTestId("lottery-machine").first()).toContainText(current.draws[1].winners[0].name);
  await expect(page.getByRole("dialog").getByRole("button", { name: "清空抽奖结果", exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json())).draws).toHaveLength(2);
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  expect((await anonymous.get(`/api/admin/lottery?event=${eventId}`)).status()).toBe(401);
  const clearBody = { action: "clear-lottery", confirmed: true, drawIds: current.draws.map(draw => draw.id) };
  expect((await anonymous.post(`/api/admin?event=${eventId}`, { headers: { Origin: origin }, data: clearBody })).status()).toBe(401);
  await anonymous.dispose();

  await page.getByRole("button", { name: "关闭抽奖浮窗" }).click();
  const beforeClear = await page.request.get(`/api/admin?event=${eventId}`).then(response => response.json());
  expect((await page.request.post(`/api/admin?event=${eventId}`, { headers: { Origin: origin }, data: { ...clearBody, confirmed: false } })).status()).toBe(422);
  const clearButton = page.getByRole("button", { name: "清空抽奖结果", exact: true });
  await expect(clearButton).toBeEnabled();
  await clearButton.click();
  const confirmation = page.getByRole("alertdialog", { name: "清空抽奖结果" });
  await expect(confirmation).toContainText("全部 2 轮幸运抽奖结果");
  await expect(confirmation).toContainText("共 7 个中奖名额");
  await confirmation.getByRole("button", { name: "保留抽奖结果" }).click();
  expect((await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json())).draws).toHaveLength(2);

  // A failed clear keeps the confirmation and saved results available for a deliberate retry.
  await page.route("**/api/admin?*", route => route.request().method() === "POST" && route.request().postDataJSON()?.action === "clear-lottery" ? route.fulfill({ status: 503, json: { error: "清空失败，请重试。" } }) : route.fallback());
  await clearButton.click();
  await confirmation.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "清空失败" })).toContainText("清空失败");
  await expect(confirmation).toBeVisible();
  expect((await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json())).draws).toHaveLength(2);
  await page.unroute("**/api/admin?*");
  await page.evaluate(({ eventId, key }) => sessionStorage.setItem(`vc-lottery-pending:${eventId}`, JSON.stringify({ action: "draw", key, count: 5, excludeWinners: true })), { eventId, key: current.draws[0].request_key });
  await confirmation.screenshot({ path: "artifacts/lottery-clear-confirm.png" });
  await confirmation.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByRole("status")).toContainText("幸运抽奖结果已清空，可重新抽奖。");
  await expect(confirmation).toHaveCount(0);
  await expect(clearButton).toBeDisabled();
  expect(await page.evaluate(eventId => sessionStorage.getItem(`vc-lottery-pending:${eventId}`), eventId)).toBeNull();
  const cleared = await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json());
  expect(cleared.draws).toEqual([]); expect(cleared.locked).toBe(true); expect(cleared.candidates).toHaveLength(5);
  const afterClear = await page.request.get(`/api/admin?event=${eventId}`).then(response => response.json());
  expect(afterClear.players).toEqual(beforeClear.players); expect(afterClear.event).toEqual(beforeClear.event); expect(afterClear.leaderboard).toEqual(beforeClear.leaderboard);
  const stale = await page.request.post(`/api/admin?event=${eventId}`, { headers: { Origin: origin }, data: { action: "draw", key: current.draws[0].request_key, count: 5 } });
  expect(stale.status()).toBe(409);
  await page.getByRole("button", { name: "抽取5位幸运玩家" }).click();
  await expect(page.getByLabel("抽取人数", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "摇杆：开始抽奖" })).toBeEnabled();
  await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
  await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
  await page.getByRole("button", { name: "跳过动画" }).click();
  const fresh = await page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json());
  expect(fresh.draws).toHaveLength(1); expect(fresh.draws[0].winners).toHaveLength(5);
  expect(new Set(fresh.draws[0].winners.map((winner: { playerId: string }) => winner.playerId)).size).toBe(5);
  await page.reload();
  await page.getByRole("button", { name: "榜单与抽奖", exact: true }).click();
  await page.getByRole("button", { name: "查看中奖名单 / 继续抽奖" }).click();
  await expect(page.getByTestId("lottery-machine")).toHaveCount(5);
  await expect(page.getByTestId("lottery-machine").first()).toHaveAttribute("data-revealed", "true");
});
