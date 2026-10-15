import { test, expect, type Page } from "@playwright/test";
import { PROJECTS } from "../data/projects";
import { playerCard } from "../lib/cards";
import type { RunView } from "../lib/types";

const meta = { id: "mobile-ui", title: "手机界面验证", status: "open", mode: "demo", total: 50, initial: 200000000, ticket: 5000000, maxTicket: 40000000, maxInvestments: 20, endOnInvestmentLimit: true, settlementYear: 2031, eras: [{ title: "探索时代", text: "" }, { title: "成长时代", text: "" }, { title: "具身时代", text: "" }] };
const cards = PROJECTS.map(playerCard);
function runAt(index = 0): RunView {
  return { id: "ui-run", player: { name: "界面测试", institution: "测试基金" }, status: "playing", index, total: 50, year: cards[index].year, cash: 200000000, value: 200000000, invested: 0, maxInvestments: 20, card: cards[index], eventStatus: "open", eraNotice: null, updates: [] };
}
async function assertFits(page: Page, withCard = false) {
  expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= innerWidth, height: document.documentElement.scrollHeight <= innerHeight + 1 }))).toEqual({ width: true, height: true });
  const selectors = withCard ? [".game-stats", ".project-card", ".investment-adjuster", ".decision-buttons", ".decision-note"] : [".entry-form", ".entry-form .btn", ".rules-link", ".event-rewards"];
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
  for (const size of [{ width: 375, height: 667 }, { width: 390, height: 664 }, { width: 375, height: 812 }, { width: 390, height: 844 }, { width: 393, height: 852 }, { width: 430, height: 932 }, { width: 623, height: 747 }, { width: 1440, height: 1000 }]) {
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
    await expect(page.locator(".tutorial-guide")).toContainText("也可以点击底部按钮投资，调整滑轨修改投资金额");
    await expect(page.getByTestId("project-card").locator(".card-meta")).toHaveCount(0);
    await expect(page.locator(".decision-hint")).toHaveCount(0);
    await assertFits(page, true);
    if (size.width === 390 && size.height === 844) await page.screenshot({ path: "artifacts/tutorial-iphone.png", animations: "disabled" });
    if (size.width === 623) await page.screenshot({ path: "artifacts/tutorial-updated.png", animations: "disabled" });
    await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
    await expect(page.locator(".game-stats > div:nth-child(3) strong")).toContainText("0 / 20");
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
      const { choice, amount = meta.ticket } = route.request().postDataJSON();
      run = { ...runAt(run.index + 1), invested: run.invested + (choice === "invest" ? 1 : 0), cash: run.cash - (choice === "invest" ? amount : 0) };
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
  expect(decisions).toBe(1); await expect(page.locator(".cash-stat strong")).toContainText("19,500");
  await expect(page.locator(".game-stats")).toContainText("已投项目1 / 20");
  await page.screenshot({ path: "artifacts/game-iphone.png", animations: "disabled" });
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 110, y, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(".progress-stat strong")).toContainText("03"); expect(decisions).toBe(2);
  await expect(page.locator(".cash-stat strong")).toContainText("19,500");
});

test("eight-step slider drags, persists across cards and reload, synchronizes swipe and locks pending retries", async ({ page }) => {
  let run = runAt(), failNext = false;
  const submitted: { projectId: string; choice: string; amount?: number; key: string }[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/meta") return route.fulfill({ json: meta });
    if (path === "/api/session") return route.fulfill({ json: { meta, run, player: run.player } });
    if (path.endsWith("/decisions")) {
      const decision = route.request().postDataJSON(); submitted.push(decision);
      if (failNext) { failNext = false; return route.abort("failed"); }
      const { choice, amount = meta.ticket } = decision;
      run = { ...runAt(run.index + 1), invested: run.invested + (choice === "invest" ? 1 : 0), cash: run.cash - (choice === "invest" ? amount : 0) };
      return route.fulfill({ json: run });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "单笔投资" });
  const invest = page.locator(".decision.invest");
  await expect(invest).toContainText("投资 500 万");
  await expect(slider).toHaveValue("5000000");
  await expect(slider).toHaveAttribute("min", "5000000");
  await expect(slider).toHaveAttribute("max", "40000000");
  await expect(slider).toHaveAttribute("step", "5000000");
  await expect(page.locator(".amount-ticks > span")).toHaveText(["500", "1000", "1500", "2000", "2500", "3000", "3500", "4000"]);
  const rail = (await slider.boundingBox())!;
  await page.mouse.move(rail.x + 12, rail.y + rail.height / 2); await page.mouse.down();
  for (let i = 1; i <= 7; i++) {
    const amount = (i + 1) * 500;
    await page.mouse.move(rail.x + 12 + (rail.width - 24) * i / 7, rail.y + rail.height / 2, { steps: 3 });
    await expect(slider).toHaveValue(String(amount * 10000));
    await expect(invest).toContainText(`投资 ${amount.toLocaleString("en-US")} 万`);
    await expect(page.locator(".amount-ticks .selected")).toHaveText(String(amount));
    expect(submitted).toHaveLength(0);
  }
  await page.mouse.up();
  await slider.press("ArrowRight"); await expect(slider).toHaveValue("40000000");
  await slider.press("Home"); await slider.press("ArrowLeft"); await expect(slider).toHaveValue("5000000");
  await slider.press("ArrowRight");
  await expect(invest).toContainText("投资 1,000 万");
  const card = (await page.getByTestId("project-card").boundingBox())!;
  const x = card.x + card.width / 2, y = card.y + card.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 115, y, { steps: 6 });
  await expect(page.getByTestId("swipe-overlay")).toContainText("投资1,000万");
  await page.screenshot({ path: "artifacts/amount-swipe-mobile.png", animations: "disabled" });
  await page.mouse.up(); await expect(page.locator(".progress-stat strong")).toContainText("02");
  expect(submitted[0].amount).toBe(10_000_000); await expect(invest).toContainText("投资 1,000 万");
  await page.getByRole("button", { name: "不投", exact: true }).click();
  await expect(page.locator(".progress-stat strong")).toContainText("03"); await expect(invest).toContainText("投资 1,000 万");
  await page.reload(); await expect(invest).toContainText("投资 1,000 万");
  failNext = true; await invest.click();
  await expect(page.locator(".retry-panel")).toContainText("投资 1,000 万");
  await expect(slider).toBeDisabled();
  await page.reload(); await expect(page.locator(".retry-panel")).toContainText("投资 1,000 万");
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".progress-stat strong")).toContainText("04");
  expect(submitted[2]).toEqual(submitted[3]);
  await expect(invest).toContainText("投资 1,000 万");
  run.cash = 5_000_000; await page.reload();
  await expect(invest).toBeEnabled(); await expect(invest).toContainText("投资 500 万");
  await expect(slider).toHaveCount(0);
  run.cash = 15_000_000; await page.reload();
  await expect(slider).toHaveAttribute("max", "15000000");
  await expect(page.locator(".amount-ticks > span")).toHaveText(["500", "1000", "1500"]);
  await page.setViewportSize({ width: 375, height: 667 });
  const facts = page.locator(".card-facts");
  await facts.hover(); await page.mouse.wheel(0, 400);
  await expect.poll(() => facts.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".risk-fact p")).toBeInViewport();
  await assertFits(page, true);
  await page.screenshot({ path: "artifacts/amount-controls-small-mobile.png", animations: "disabled" });
});

test("native touch scroll reads short-screen clues and right swipe commits the selected amount", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    let run = runAt(), decisions = 0;
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/decisions")) {
        const { amount } = route.request().postDataJSON(); decisions++;
        run = { ...runAt(run.index + 1), cash: run.cash - amount, invested: run.invested + 1 };
        return route.fulfill({ json: run });
      }
      return route.fulfill({ json: path === "/api/session" ? { meta, run, player: run.player } : meta });
    });
    await page.goto(process.env.E2E_URL || "http://localhost:3000");
    const slider = page.getByRole("slider", { name: "单笔投资" });
    const cdp = await context.newCDPSession(page);
    const rail = (await slider.boundingBox())!;
    const railX = rail.x + 12, railY = rail.y + rail.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: railX, y: railY }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: railX + (rail.width - 24) / 7 * i / 6, y: railY }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(slider).toHaveValue("10000000");
    expect(decisions).toBe(0);
    const box = (await page.locator(".card-facts").boundingBox())!;
    await cdp.send("Input.synthesizeScrollGesture", { x: box.x + box.width / 2, y: box.y + box.height - 20, yDistance: -100, speed: 500, preventFling: true, gestureSourceType: "touch" });
    await expect.poll(() => page.locator(".card-facts").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(decisions).toBe(0);
    const x = box.x + 50, y = box.y + 50;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 22, y }] });
    await expect(page.getByTestId("swipe-overlay")).toContainText("投资1,000万");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator(".progress-stat strong")).toContainText("02");
    expect(decisions).toBe(1);
    await expect(page.locator(".cash-stat strong")).toContainText("19,000");
    await expect(page.locator(".decision.invest strong")).toContainText("投资 1,000 万");
  } finally { await context.close(); }
});

test("settlement stays in one screen and opens complete reviews on demand", async ({ page }) => {
  const reviews = PROJECTS.map((p, i) => ({ ...p, ...cards[i], choice: "pass", multiple: 1.2, profit: 1000000, ending: "模拟回报依据" }));
  const run = { ...runAt(), status: "completed", index: 50, card: null };
  const result = { profit: 0, value: 200000000, initial: 200000000, seen: 50, unseen: 0, completionReason: "timeline-end", invested: 0, unspent: 200000000, player: run.player, rank: 1, participants: 100, reviews, highlights: { best: null, avoided: reviews[0], missed: reviews[1] }, frozen: false };
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
