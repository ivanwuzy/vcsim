import { test, expect, type Page } from "@playwright/test";
import { PROJECTS } from "../data/projects";
import { playerCard } from "../lib/cards";
import type { RunView } from "../lib/types";

const meta = { id: "mobile-ui", title: "手机界面验证", status: "open", mode: "demo", total: 50, initial: 100000000, ticket: 5000000, maxInvestments: 20, endOnInvestmentLimit: true, settlementYear: 2031, eras: [{ title: "探索时代", text: "" }, { title: "成长时代", text: "" }, { title: "具身时代", text: "" }] };
const cards = PROJECTS.map(playerCard);
function runAt(index = 0): RunView {
  return { id: "ui-run", player: { name: "界面测试", institution: "测试基金" }, status: "playing", index, total: 50, year: cards[index].year, cash: 100000000, value: 100000000, invested: 0, maxInvestments: 20, card: cards[index], eventStatus: "open", eraNotice: null, updates: [] };
}
async function assertFits(page: Page, withCard = false) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= innerWidth, height: document.documentElement.scrollHeight <= innerHeight + 1 }))).toEqual({ width: true, height: true });
  const selectors = withCard ? [".game-stats", ".project-card", ".decision-buttons", ".decision-note"] : [".entry-form", ".entry-form .btn", ".rules-link", ".event-rewards"];
  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox();
    expect(box, selector).not.toBeNull();
    expect(box!.y, selector).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, selector).toBeLessThanOrEqual((await page.evaluate(() => innerHeight)) + 1);
  }
  if (withCard) await expect.poll(() => page.getByTestId("project-card").evaluate(el => ({ fits: el.scrollHeight <= el.clientHeight + 1, height: el.clientHeight, scroll: el.scrollHeight }))).toMatchObject({ fits: true });
}

test("scrollable invitation restores both panels and entering keeps iPhone gameplay in one screen", async ({ page }) => {
  let run: RunView | null = null;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/meta") return route.fulfill({ json: meta });
    if (path === "/api/session") return route.fulfill({ json: { meta, run, player: run?.player ?? null } });
    if (path.endsWith("/players")) return route.fulfill({ json: {} });
    if (path.endsWith("/runs")) { run = runAt(); return route.fulfill({ json: run }); }
    if (path.endsWith("/decisions")) { run = runAt(run!.index + 1); return route.fulfill({ json: run }); }
    return route.fulfill({ json: {} });
  });
  for (const size of [{ width: 375, height: 667 }, { width: 390, height: 664 }, { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 1440, height: 1000 }]) {
    run = null;
    await page.setViewportSize(size); await page.goto("/");
    await expect(page.getByRole("heading", { name: "就位，合伙人。" })).toBeVisible();
    await expect(page.locator(".hero-description")).toBeVisible();
    await expect(page.locator(".fund-chart")).toBeVisible();
    await expect(page.getByText("基金结算后，即可参与幸运礼品抽奖")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (size.width < 701) {
      const hero = (await page.locator(".hero").boundingBox())!, entry = (await page.locator(".entry-panel").boundingBox())!;
      expect(entry.y).toBeGreaterThan(hero.y + hero.height);
      expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
      await page.getByRole("link", { name: "开始小游戏", exact: true }).click();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      await expect(page.getByLabel("你的姓名")).toBeInViewport();
    } else {
      const hero = (await page.locator(".hero").boundingBox())!, entry = (await page.locator(".entry-panel").boundingBox())!;
      expect(entry.x).toBeGreaterThan(hero.x + hero.width);
      expect(Math.abs(hero.y - entry.y)).toBeLessThan(2);
    }
    await page.getByLabel("你的姓名").fill("界面测试"); await page.getByLabel("机构名称").fill("测试基金");
    await page.evaluate(() => localStorage.clear());
    await page.getByRole("button", { name: "开启我的投资之旅" }).click();
    await expect(page.locator(".tutorial-guide")).toContainText("左滑不投");
    await expect(page.locator(".tutorial-guide")).toContainText("右滑投资");
    await expect(page.locator(".tutorial-guide")).toContainText("也可以在页面底部点击按钮");
    await assertFits(page, true);
    if (size.width === 390 && size.height === 844) await page.screenshot({ path: "artifacts/tutorial-iphone.png", animations: "disabled" });
    await page.getByRole("button", { name: /练习：投资/ }).click();
    await assertFits(page, true);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  for (let i = 0; i < 50; i++) {
    run = runAt(i);
    await page.reload();
    await expect(page.getByTestId("project-card")).toContainText(cards[i].alias);
    await assertFits(page, true);
    for (const field of ["team", "technical", "traction", "risk"] as const) await expect(page.locator(".card-facts")).toContainText(cards[i][field]);
    expect(await page.locator(".card-facts").evaluate(el => el.getBoundingClientRect().bottom <= el.parentElement!.getBoundingClientRect().bottom - 5)).toBe(true);
  }
});

test("direction overlays preview, reverse, cancel, and commit exactly one decision", async ({ page }) => {
  let run = runAt(), decisions = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/meta") return route.fulfill({ json: meta });
    if (path === "/api/session") return route.fulfill({ json: { meta, run, player: run.player } });
    if (path.endsWith("/decisions")) {
      decisions++;
      const choice = route.request().postDataJSON().choice;
      run = { ...runAt(run.index + 1), invested: run.invested + (choice === "invest" ? 1 : 0), cash: run.cash - (choice === "invest" ? meta.ticket : 0) };
      return route.fulfill({ json: run });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/"); await expect(page.getByTestId("project-card")).toBeVisible();
  const box = (await page.getByTestId("project-card").boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y, { steps: 4 });
  const overlay = page.getByTestId("swipe-overlay");
  await expect(overlay).toHaveClass(/invest/); await expect(overlay).toContainText("投资");
  expect(await overlay.evaluate(el => getComputedStyle(el, "::before").backgroundColor)).toBe("rgb(17, 150, 88)");
  const overlayBox = (await overlay.boundingBox())!, labelBox = (await overlay.locator("strong").boundingBox())!;
  expect(Math.abs((labelBox.x + labelBox.width / 2) - (overlayBox.x + overlayBox.width / 2))).toBeLessThan(5);
  await page.screenshot({ path: "artifacts/swipe-invest-iphone.png" });
  await page.mouse.move(x - 50, y, { steps: 5 });
  await expect(overlay).toHaveClass(/pass/); await expect(overlay).toContainText("不投");
  expect(await overlay.evaluate(el => getComputedStyle(el, "::before").backgroundColor)).toBe("rgb(220, 53, 76)");
  await page.screenshot({ path: "artifacts/swipe-pass-iphone.png" });
  await page.mouse.up(); await expect(overlay).toHaveCount(0); expect(decisions).toBe(0);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 115, y, { steps: 8 });
  await expect(overlay).toContainText("松手确认"); expect(decisions).toBe(0);
  await page.mouse.up(); await expect(page.locator(".progress-stat strong")).toContainText("02");
  expect(decisions).toBe(1); await expect(page.locator(".cash-stat strong")).toContainText("9,500");
  await expect(page.locator(".game-stats")).toContainText("已投项目1 / 20");
  await page.screenshot({ path: "artifacts/game-iphone.png", animations: "disabled" });
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 110, y, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(".progress-stat strong")).toContainText("03"); expect(decisions).toBe(2);
  await expect(page.locator(".cash-stat strong")).toContainText("9,500");
});

test("settlement stays in one screen and opens complete reviews on demand", async ({ page }) => {
  const reviews = PROJECTS.map((p, i) => ({ ...p, ...cards[i], choice: "pass", multiple: 1.2, profit: 1000000, ending: "模拟回报依据" }));
  const run = { ...runAt(), status: "completed", index: 50, card: null };
  const result = { profit: 0, value: 100000000, initial: 100000000, seen: 50, unseen: 0, completionReason: "timeline-end", invested: 0, unspent: 100000000, player: run.player, rank: 1, participants: 100, reviews, highlights: { best: null, avoided: reviews[0], missed: reviews[1] }, frozen: false };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/result") ? result : path === "/api/session" ? { meta, run, player: run.player } : meta });
  });
  for (const size of [{ width: 375, height: 667 }, { width: 390, height: 664 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(size); await page.goto("/");
    await expect(page.getByRole("heading", { name: "选择有了回响。" })).toBeVisible();
    const button = page.getByRole("button", { name: "查看 50 个项目复盘" });
    const box = (await button.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    if (size.width === 390 && size.height === 844) await page.screenshot({ path: "artifacts/result-iphone.png" });
    await button.click();
    await expect(page.getByRole("dialog", { name: "项目复盘" })).toBeVisible();
    await expect(page.locator(".review")).toHaveCount(50);
    await page.locator(".review-toggle").first().click();
    await expect(page.locator(".review-detail")).toContainText("模拟回报依据");
    await page.getByRole("button", { name: "关闭复盘" }).click();
    await expect(button).toBeVisible();
  }
});
