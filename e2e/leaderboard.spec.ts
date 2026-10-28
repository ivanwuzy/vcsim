import { test, expect, type Page } from "@playwright/test";
import nextEnv from "@next/env";
import type { BoardData } from "../lib/leaderboard";
nextEnv.loadEnvConfig(process.cwd());
const origin = process.env.E2E_URL || "http://localhost:3000";
const initial = 100_000_000;
const makePlayer = (id: number, rank = id, profit = (201 - id) * initial) => ({ playerId: `player-${id}`, rank, profit, name: ["林远", "陈星河", "李未来"][id - 1] || `合伙人 ${id}`, institution: ["远见资本", "银河创投", "未来基金"][id - 1] || "具身智能投资基金" });
const board = (count = 24): BoardData => ({ id: "screen-fixture", title: "A Night 2nd · 具身创投之夜", status: "open", frozen: false, mode: "demo", initial, rows: Array.from({ length: count }, (_, index) => makePlayer(index + 1)) });
async function login(page: Page) {
  const response = await page.request.post("/api/admin/login", { data: { password: process.env.ADMIN_PASSWORD }, headers: { Origin: origin } });
  expect(response.ok()).toBe(true);
}
async function screen(page: Page, getBoard: () => BoardData) {
  await login(page);
  await page.route("**/api/admin/leaderboard?*", route => route.fulfill({ json: getBoard() }));
  await page.goto("/admin/screen?event=screen-fixture");
  await expect(page.getByTestId("podium-card").first()).toContainText("林远");
}

test("players retain the public leaderboard and cannot enter the host screen", async ({ page }) => {
  await page.route("**/api/leaderboard", route => route.fulfill({ json: board(8) }));
  await page.goto("/");
  await page.getByRole("link", { name: "排行榜", exact: true }).click();
  await expect(page.getByTestId("podium-card")).toHaveCount(3);
  await expect(page.getByTestId("podium-card").first()).toContainText("201 x");
  await expect(page.getByTestId("podium-card").first()).toContainText("201亿元");
  await expect(page.locator(".board-table")).toContainText("合伙人 4");
  await expect(page.locator(".board-table")).not.toContainText("林远");
  await expect(page.getByRole("link", { name: "打开现场大屏" })).toHaveCount(0);
  for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".podium-art img").evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    for (const amount of await page.locator(".player-podium .podium-score strong").all()) {
      expect(await amount.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll<HTMLImageElement>(".podium-art img")].map(img => img.decode()));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: `artifacts/leaderboard-player-${size.width}.png`, fullPage: true, style: "nextjs-portal { visibility: hidden; }" });
  }
  await page.goto("/leaderboard?screen=1");
  await expect(page).toHaveURL(`${origin}/leaderboard`);
  await expect(page.locator(".live-screen")).toHaveCount(0);
  for (const path of ["/admin/screen?event=screen-fixture", "/leaderboard?adminEvent=screen-fixture&screen=1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${origin}/admin`);
    await expect(page.getByLabel("管理密码")).toBeVisible();
    await expect(page.locator(".live-screen")).toHaveCount(0);
  }
});

test("the public board highlights every tied top-three player and keeps its empty state", async ({ page }) => {
  await page.clock.install();
  let current = { ...board(5), rows: [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4, 3, 198 * initial), makePlayer(5, 5)] };
  await page.route("**/api/leaderboard", route => route.fulfill({ json: current }));
  await page.goto("/leaderboard");
  await expect(page.getByTestId("podium-card")).toHaveCount(4);
  await expect(page.locator(".player-podium .medal-3")).toHaveCount(2);
  await expect(page.locator(".player-podium .medal-3").first()).toContainText("并列第 3 名");
  await expect(page.locator(".player-podium .medal-3").last()).toContainText("合伙人 4");
  await expect(page.locator(".board-table tbody tr")).toHaveCount(1);
  current = { ...current, rows: [] };
  await page.clock.runFor(5200);
  await expect(page.getByTestId("podium-card")).toHaveCount(0);
  await expect(page.getByText("第一位合伙人还在做决定。")).toBeVisible();
});

test("the host console opens a protected independent screen", async ({ page }) => {
  await login(page); await page.goto("/admin");
  const link = page.getByRole("link", { name: "打开现场大屏" });
  await expect(link).toHaveAttribute("href", /^\/admin\/screen\?event=/);
  const popupPromise = page.waitForEvent("popup"); await link.click();
  const popup = await popupPromise;
  await expect(popup.locator(".live-screen")).toBeVisible();
  await expect(popup.locator(".live-event")).not.toBeEmpty();
  await popup.close();
});

test("the podium fits projector viewports, keeps ranks 4–10 fixed and previews all three medals", async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 1920, height: 1080 });
  await screen(page, () => board());
  await expect(page.getByTestId("medal-celebration")).toHaveCount(0);
  await expect(page.getByTestId("podium-card")).toHaveCount(3);
  await expect(page.locator(".live-screen")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "切换为深色", exact: true }).click();
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".podium-art img").evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: `artifacts/live-screen-${size.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "切换为浅色", exact: true }).click();
    await expect(page.locator(".live-screen")).toHaveAttribute("data-theme", "light");
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByTestId("podium-card").first()).toContainText("201 x");
    await page.screenshot({ path: `artifacts/live-screen-light-${size.width}.png`, fullPage: true });
    await page.getByRole("button", { name: "切换为深色", exact: true }).click();
  }
  await page.getByRole("button", { name: "切换为浅色", exact: true }).click();
  await page.reload();
  await expect(page.locator(".live-screen")).toHaveAttribute("data-theme", "light");
  await expect(page.getByTestId("podium-card").first()).toContainText("林远");
  await page.getByRole("button", { name: "切换为深色", exact: true }).click();
  await expect(page.locator(".live-screen")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "全屏展示", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.clock.runFor(12100);
  await expect(page.locator(".contender-rank")).toHaveText(["04", "05", "06", "07", "08", "09", "10"]);
  await expect(page.locator(".contenders-list")).not.toContainText("合伙人 11");
  await expect(page.locator(".pagination-dots")).toHaveCount(0);
  const previousPage = page.getByRole("button", { name: "榜单上一页" });
  const nextPage = page.getByRole("button", { name: "榜单下一页" });
  await expect(previousPage).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "合伙人榜单翻页" })).toContainText("1 / 3");
  await nextPage.click();
  await expect(page.locator(".contender-rank")).toHaveText(["11", "12", "13", "14", "15", "16", "17"]);
  await page.clock.runFor(12100);
  await expect(page.locator(".contender-rank")).toHaveText(["11", "12", "13", "14", "15", "16", "17"]);
  await nextPage.click();
  await expect(page.locator(".contender-rank")).toHaveText(["18", "19", "20", "21", "22", "23", "24"]);
  await expect(nextPage).toBeDisabled();
  await previousPage.click();
  await previousPage.click();
  await expect(page.locator(".contender-rank")).toHaveText(["04", "05", "06", "07", "08", "09", "10"]);
  for (const rank of [1, 2, 3]) {
    await page.getByRole("button", { name: "动效预览 临时" }).click();
    await page.getByRole("button", { name: rank === 1 ? "金 · 刷新最高纪录" : `${rank === 2 ? "银" : "铜"} · 新晋第${rank}名` }).click();
    const effect = page.getByTestId("medal-celebration");
    await expect(effect).toHaveAttribute("data-rank", String(rank));
    await expect(effect).toContainText("动效预览 · 不计入榜单");
    await page.clock.runFor(1400);
    await page.screenshot({ path: `artifacts/live-celebration-${rank}.png` });
    await page.clock.runFor(8000);
    await expect(effect).toHaveCount(0);
    await expect(page.getByTestId("podium-card").first()).toContainText("201 x");
  }
});

test("new records celebrate once in order while the board keeps updating through a connection failure", async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 1920, height: 1080 });
  let current = board(), failing = false;
  await login(page);
  await page.route("**/api/admin/leaderboard?*", route => failing ? route.fulfill({ status: 503, json: { error: "测试连接中断" } }) : route.fulfill({ json: current }));
  await page.goto("/admin/screen?event=screen-fixture");
  await expect(page.getByTestId("podium-card").first()).toContainText("林远");
  current = { ...current, rows: [makePlayer(100, 1, 250 * initial), makePlayer(101, 2, 240 * initial), makePlayer(102, 3, 230 * initial), ...current.rows.map(p => ({ ...p, rank: p.rank + 3 }))] };
  await page.clock.runFor(5200);
  await expect(page.getByTestId("medal-celebration")).toHaveAttribute("data-record", "true");
  await expect(page.getByTestId("medal-celebration")).toHaveAttribute("data-rank", "1");
  await expect(page.getByTestId("podium-card").first()).toContainText("合伙人 100");
  await page.clock.runFor(7400);
  await expect(page.getByTestId("medal-celebration")).toHaveAttribute("data-rank", "2");
  await page.clock.runFor(5400);
  await expect(page.getByTestId("medal-celebration")).toHaveAttribute("data-rank", "3");
  await page.clock.runFor(5400);
  await expect(page.getByTestId("medal-celebration")).toHaveCount(0);
  failing = true; await page.clock.runFor(5100);
  await expect(page.locator(".live-screen").getByRole("alert")).toContainText("正在展示最近一次成功更新的榜单");
  await expect(page.getByTestId("podium-card").first()).toContainText("合伙人 100");
  failing = false; current = { ...current, frozen: true, status: "frozen" };
  await page.clock.runFor(5100);
  await expect(page.locator(".live-screen").getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".live-status")).toContainText("最终榜单 · 已冻结");
  await expect(page.getByTestId("medal-celebration")).toHaveCount(0);
});

test("tied podium players all receive medal highlighting without losing their shared rank", async ({ page }) => {
  await page.clock.install(); await page.setViewportSize({ width: 1366, height: 768 });
  const current = { ...board(5), rows: [makePlayer(1, 1), makePlayer(2, 2), makePlayer(3, 3, 180 * initial), makePlayer(4, 3, 180 * initial), makePlayer(5, 3, 180 * initial)] };
  await screen(page, () => current);
  await expect(page.getByTestId("podium-card").nth(2)).toContainText("并列第 3 名");
  await page.clock.runFor(12100);
  await expect(page.getByTestId("podium-card").first()).toContainText("林远");
  await expect(page.getByTestId("podium-card").nth(1)).toContainText("陈星河");
  await expect(page.getByTestId("podium-card").nth(2)).toContainText("合伙人 4");
  await expect(page.getByTestId("podium-card").nth(2)).toHaveClass(/medal-3/);
  await expect(page.getByTestId("medal-celebration")).toHaveCount(0);
});

test("motion-reduced screens retain a readable celebration and return to the board", async ({ page }) => {
  await page.clock.install(); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 768 }); await screen(page, () => board());
  await page.getByRole("button", { name: "动效预览 临时" }).click();
  await page.getByRole("button", { name: "金 · 刷新最高纪录" }).click();
  await expect(page.getByTestId("medal-celebration")).toContainText("新纪录诞生");
  await page.clock.runFor(3100);
  await expect(page.getByTestId("medal-celebration")).toHaveCount(0);
});
