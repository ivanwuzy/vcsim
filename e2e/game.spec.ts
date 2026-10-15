import { test, expect, type APIRequestContext } from "@playwright/test";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const origin = process.env.E2E_URL || "http://localhost:3000";
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(path, { data, headers: { Origin: origin } });
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`); return response.json();
}
test("mobile full run, swipe, lost response recovery, result reveal and host closure", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post(request, "/api/admin", { action: "create", title: "浏览器流程验证", mode: "demo" });
  await post(request, `/api/admin?event=${eventId}`, { action: "open" });
  await page.goto(`/?event=${eventId}`);
  await expect(page.getByRole("heading", { name: "就位，合伙人。" })).toBeVisible();
  await page.getByRole("button", { name: "先看看怎么玩" }).click();
  await expect(page.getByRole("dialog")).toContainText("50个机会，最多投20次");
  await expect(page.getByRole("dialog")).toContainText("固定顺序");
  await expect(page.getByRole("dialog")).toContainText("投满立即");
  await page.getByRole("button", { name: "明白，准备就位" }).click();
  await page.getByLabel("你的姓名").fill("浏览器测试玩家"); await page.getByLabel("机构名称").fill("演示基金");
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await expect(page.getByRole("heading", { name: "未来便利店" })).toBeVisible();
  await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
  await expect(page.getByTestId("project-card")).toBeVisible();
  expect(await page.locator('.brand').getAttribute('href')).toBe('/');
  expect((await page.request.get("/api/admin")).status()).toBe(401);
  await page.screenshot({ path: "artifacts/game-mobile.png", fullPage: true, animations: "disabled" });
  const card = await page.getByTestId("project-card").boundingBox();
  await page.mouse.move(card!.x + 70, card!.y + 130); await page.mouse.down(); await page.mouse.move(card!.x + 210, card!.y + 130, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(".progress-stat strong")).toContainText("02");
  // Simulate server accepted a decision but browser did not receive the response.
  await page.route("**/api/runs/*/decisions", async route => { await route.fetch(); await route.abort("failed"); }, { times: 1 });
  await page.getByRole("button", { name: "不投", exact: true }).click();
  await expect(page.getByRole("button", { name: "重试保存" })).toBeVisible();
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.locator(".progress-stat strong")).toContainText("03");
  await page.reload(); await expect(page.locator(".progress-stat strong")).toContainText("03");
  for (let i = 2; i < 50; i++) {
    const before = await page.locator(".card-number").textContent();
    await page.getByRole("button", { name: "不投", exact: true }).click();
    if (i < 49) await expect(page.locator(".card-number")).not.toHaveText(before!);
  }
  await expect(page.getByRole("heading", { name: "选择有了回响。" })).toBeVisible();
  await page.getByRole("button", { name: "查看 50 个项目复盘" }).click();
  await expect(page.locator(".review")).toHaveCount(50); await page.locator(".review-toggle").first().click();
  await expect(page.locator(".review-detail")).toContainText("本局回报依据");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/result-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "关闭复盘" }).click();
  await page.getByRole("link", { name: "看看合伙人排行榜" }).click();
  await expect(page.getByRole("heading", { name: "眼光，会有回报。" })).toBeVisible(); await expect(page.locator(".board-table")).toContainText("浏览器测试玩家");
  await post(request, `/api/admin?event=${eventId}`, { action: "close" }); await post(request, `/api/admin?event=${eventId}`, { action: "freeze" });
  const key = crypto.randomUUID(); const draw = await post(request, `/api/admin?event=${eventId}`, { action: "draw", key, count: 5 });
  expect(draw.winners).toHaveLength(1); const repeat = await post(request, `/api/admin?event=${eventId}`, { action: "draw", key, count: 5 }); expect(repeat.winners).toEqual(draw.winners);
  await expect(page.locator(".board-empty")).toContainText("暂无进行中的活动", { timeout: 10000 });
  const history = await request.get(`/api/admin/leaderboard?event=${eventId}`).then(r => r.json());
  expect(history.frozen).toBe(true); expect(history.rows[0].name).toBe("浏览器测试玩家");
  expect((await page.request.get(`/api/admin/leaderboard?event=${eventId}`)).status()).toBe(401);
});
test("desktop admin creates, imports drafts, starts formal activities and keeps a shared QR entry", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId: original } = await post(request, "/api/admin", { action: "create", title: "统一入口测试一", mode: "demo" });
  await post(request, `/api/admin?event=${original}`, { action: "open" });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/?event=old-deleted-event");
  await expect(page.getByRole("heading", { name: "A Night 2nd" })).toBeVisible();
  await expect(page.getByText("活动专属 · 趣味投资小游戏")).toBeVisible();
  await expect(page.getByText("10月28日 · 上海", { exact: true })).toBeVisible();
  await expect(page.getByText("也凭一点好运", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/landing-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: "artifacts/landing-mobile.png", fullPage: true });
  await page.goto("/admin"); await page.getByLabel("管理密码").fill(process.env.ADMIN_PASSWORD!); await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("button", { name: "新活动" })).toBeVisible(); await page.getByRole("button", { name: "新活动" }).click();
  await page.locator(".modal").getByLabel("活动名称").fill("未审校正式活动"); await page.getByRole("button", { name: "创建活动" }).click();
  await expect(page.locator(".metric").first()).toContainText("未开放");
  expect((await request.get("/api/meta").then(r => r.json())).id).toBe(original);
  const eventId = await page.getByLabel("选择活动").inputValue();
  await page.getByRole("button", { name: "题库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "50题 · 内容工作台" })).toBeVisible(); await expect(page.locator(".content-item")).toHaveCount(50);
  const exported = await page.request.get(`/api/admin/export?event=${eventId}&type=projects`);
  expect(exported.ok()).toBe(true); const json = await exported.json(); expect(json).toHaveLength(50);
  json[0].alias = "浏览器导入的新题目";
  await page.locator('input[type=file]').setInputFiles({ name: 'drafts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
  await expect(page.getByRole('heading', { name: '导入题库版本' })).toBeVisible(); await page.getByRole('button', { name: '确认操作' }).click();
  await expect(page.getByRole('status')).toContainText('操作已保存');
  await expect(page.locator(".content-item").first()).toContainText("浏览器导入的新题目");
  await page.getByRole("button", { name: "活动", exact: true }).click();
  await page.getByRole("button", { name: "启动活动", exact: true }).click();
  await expect(page.locator(".metric").first()).toContainText("进行中");
  expect((await request.get(`/api/meta?event=${original}`).then(r => r.json())).id).toBe(eventId);
  expect((await request.get(`/api/session?event=${original}`).then(r => r.json())).meta.id).toBe(eventId);
  const state = await request.get("/api/admin").then(r => r.json());
  expect(state.events.filter((e: { status: string }) => e.status === "open")).toHaveLength(1);
  expect(state.events.find((e: { id: string }) => e.id === original).status).toBe("closed");
  const oldBoard = await request.get(`/api/events/${original}/leaderboard`).then(r => r.json());
  expect(oldBoard.id).toBe(eventId); expect(oldBoard.rows).toEqual([]);
  await expect(page.getByAltText("统一活动入口二维码")).toBeVisible();
  expect(await page.getByAltText("统一活动入口二维码").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const qrA = await request.get(`/api/admin/qr?event=${original}`).then(r => r.text());
  const qrB = await request.get(`/api/admin/qr?event=${eventId}`).then(r => r.text()); expect(qrA).toBe(qrB);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: "artifacts/admin-desktop.png", fullPage: true });
  // Hosts can still show the selected historical activity on a protected screen.
  await page.goto(`/leaderboard?adminEvent=${original}&screen=1`);
  await expect(page.locator(".header-right")).toContainText("统一入口测试一");
});


test("twenty early investments settle immediately and stop presenting subsequent opportunities", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post(request, "/api/admin", { action: "create", title: "提前满仓测试", mode: "demo" });
  await post(request, `/api/admin?event=${eventId}`, { action: "open" });
  await page.goto("/");
  await page.getByLabel("你的姓名").fill("满仓测试玩家"); await page.getByLabel("机构名称").fill("隔离测试基金");
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
  for (let i = 0; i < 20; i++) {
    await expect(page.locator(".progress-stat strong")).toContainText(String(i + 1).padStart(2, "0"));
    await page.getByRole("button", { name: /投资 500 万/ }).click();
  }
  await expect(page.getByRole("heading", { name: "选择有了回响。" })).toBeVisible();
  await expect(page.locator(".result-intro")).toContainText("已完成基金投资");
  await expect(page.locator(".result-intro")).toContainText("后续30个项目未再呈现");
  await page.getByRole("button", { name: "查看 20 个项目复盘" }).click();
  await expect(page.locator(".review")).toHaveCount(20);
  await expect(page.getByTestId("project-card")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/cap-20-mobile.png", fullPage: true, animations: "disabled" });
  await page.reload();
  await expect(page.locator(".result-intro")).toContainText("已完成基金投资");
  await expect(page.getByTestId("project-card")).toHaveCount(0);
  await page.getByRole("button", { name: "查看 20 个项目复盘" }).click();
  await expect(page.locator(".review")).toHaveCount(20);
});

test("variable tickets deduct the displayed amount and settle a mixed twenty-project portfolio", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post(request, "/api/admin", { action: "create", title: "可调投资金额验证", mode: "demo" });
  await post(request, `/api/admin?event=${eventId}`, { action: "open" });
  const meta = await request.get("/api/meta").then(r => r.json());
  expect(meta).toMatchObject({ initial: 200_000_000, ticket: 5_000_000, maxTicket: 40_000_000, maxInvestments: 20 });
  await page.goto("/");
  await page.getByLabel("你的姓名").fill("可调投资玩家"); await page.getByLabel("机构名称").fill("金额验证基金");
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
  const slider = page.getByRole("slider", { name: "单笔投资" });
  const invest = page.locator(".decision.invest");
  await expect(invest).toContainText("投资 500 万"); await expect(slider).toHaveValue("5000000");
  const session = await page.request.get("/api/session").then(r => r.json());
  for (const amount of [7_500_000, 45_000_000]) {
    const invalid = await page.request.post(`/api/runs/${session.run.id}/decisions`, { headers: { Origin: origin }, data: { projectId: session.run.card.id, choice: "invest", key: crypto.randomUUID(), amount } });
    expect(invalid.status()).toBe(422);
  }
  await slider.press("ArrowRight"); await expect(invest).toContainText("投资 1,000 万");
  const card = (await page.getByTestId("project-card").boundingBox())!;
  const x = card.x + card.width / 2, y = card.y + card.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 110, y, { steps: 6 });
  await expect(page.getByTestId("swipe-overlay")).toContainText("投资1,000万"); await page.mouse.up();
  await expect(page.locator(".cash-stat strong")).toContainText("19,000"); await expect(invest).toContainText("投资 1,000 万");
  await page.getByRole("button", { name: "不投", exact: true }).click(); await expect(page.locator(".progress-stat strong")).toContainText("03");
  await page.reload(); await expect(invest).toContainText("投资 1,000 万");
  await slider.press("End");
  await expect(slider).toHaveValue("40000000"); await expect(invest).toContainText("投资 4,000 万"); await invest.click();
  await expect(page.locator(".cash-stat strong")).toContainText("15,000");
  await slider.press("Home");
  for (let i = 0; i < 18; i++) { await expect(invest).toBeEnabled(); await invest.click(); }
  await expect(page.getByRole("heading", { name: "选择有了回响。" })).toBeVisible();
  await expect(page.locator(".result-intro")).toContainText("保留6,000万元未投本金");
  const final = await page.request.get(`/api/runs/${session.run.id}/result`).then(r => r.json());
  expect(final.invested).toBe(20); expect(final.seen).toBe(21); expect(final.unspent).toBe(60_000_000);
  expect(final.reviews.filter((r: { choice: string }) => r.choice === "invest").map((r: { amount: number }) => r.amount)).toEqual([10_000_000, 40_000_000, ...Array(18).fill(5_000_000)]);
  await page.getByRole("button", { name: "查看 21 个项目复盘" }).click(); await page.locator(".review-toggle").first().click();
  await expect(page.locator(".review-detail")).toContainText("本次投资 1,000 万元");
});

test("exhausting principal caps the last ticket and settles immediately", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post(request, "/api/admin", { action: "create", title: "本金耗尽验证", mode: "demo" });
  await post(request, `/api/admin?event=${eventId}`, { action: "open" });
  await page.goto("/");
  await page.getByLabel("你的姓名").fill("本金耗尽玩家"); await page.getByLabel("机构名称").fill("余额验证基金");
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
  const slider = page.getByRole("slider", { name: "单笔投资" });
  const invest = page.locator(".decision.invest");
  await slider.press("End");
  for (let i = 0; i < 4; i++) {
    await expect(invest).toContainText("投资 4,000 万"); await invest.click();
    await expect(page.locator(".cash-stat strong")).toContainText((20_000 - (i + 1) * 4_000).toLocaleString("en-US"));
  }
  await slider.press("ArrowLeft"); // Invest 3500 of the remaining 4000, leaving one 500 ticket.
  await expect(invest).toContainText("投资 3,500 万"); await invest.click();
  await expect(page.locator(".cash-stat strong")).toContainText("500");
  await expect(slider).toHaveCount(0);
  await expect(invest).toContainText("投资 500 万"); await expect(invest).toBeEnabled();
  await page.reload();
  await expect(invest).toContainText("投资 500 万"); await expect(slider).toHaveCount(0);
  const session = await page.request.get("/api/session").then(r => r.json());
  const invalid = await page.request.post(`/api/runs/${session.run.id}/decisions`, { headers: { Origin: origin }, data: { projectId: session.run.card.id, choice: "invest", key: crypto.randomUUID(), amount: 10_000_000 } });
  expect(invalid.status()).toBe(409);
  await invest.click();
  await expect(page.getByRole("heading", { name: "选择有了回响。" })).toBeVisible();
  await expect(page.locator(".result-intro")).toContainText("本金已全部投完");
  await expect(page.locator(".result-intro")).toContainText("后续44个项目未再呈现");
  await expect(page.getByTestId("project-card")).toHaveCount(0);
  const final = await page.request.get(`/api/runs/${session.run.id}/result`).then(r => r.json());
  expect(final).toMatchObject({ invested: 6, seen: 6, unspent: 0, completionReason: "principal-exhausted" });
  expect(final.reviews.map((r: { amount: number }) => r.amount)).toEqual([40_000_000, 40_000_000, 40_000_000, 40_000_000, 35_000_000, 5_000_000]);
  await page.reload(); await expect(page.locator(".result-intro")).toContainText("本金已全部投完");
});

test("passing every project retains all principal and ends at project 50", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post(request, "/api/admin", { action: "create", title: "全不投测试", mode: "demo" });
  await post(request, `/api/admin?event=${eventId}`, { action: "open" });
  await page.goto("/");
  await page.getByLabel("你的姓名").fill("耐心玩家"); await page.getByLabel("机构名称").fill("现金基金");
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await page.getByRole("button", { name: "不投", exact: true }).click();
  for (let i = 0; i < 50; i++) {
    await expect(page.locator(".progress-stat strong")).toContainText(String(i + 1).padStart(2, "0"));
    await expect(page.locator(".game-stats > div:nth-child(3) strong")).toContainText("0 / 20");
    await page.getByRole("button", { name: "不投", exact: true }).click();
  }
  await expect(page.locator(".result-intro")).toContainText("已看完50个项目");
  await expect(page.locator(".result-intro")).toContainText("保留20,000万元未投本金");
  await expect(page.locator(".return-amount")).toContainText("0");
  await page.getByRole("button", { name: "查看 50 个项目复盘" }).click();
  await expect(page.locator(".review")).toHaveCount(50);
  await expect(page.locator(".review-choice.pass")).toHaveCount(50);
  await expect(page.getByTestId("project-card")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("players follow activity switches, stopped runs resume, and admins can delete every activity", async ({ page, request }) => {
  await post(request, "/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId: first } = await post(request, "/api/admin", { action: "create", title: "切换测试一", mode: "formal" });
  await post(request, `/api/admin?event=${first}`, { action: "open" });
  await page.goto("/");
  await page.getByLabel("你的姓名").fill("跨活动玩家"); await page.getByLabel("机构名称").fill("同一机构");
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
  await page.getByRole("button", { name: "不投", exact: true }).click();
  await expect(page.locator(".progress-stat strong")).toContainText("02");
  const saved = await page.request.get("/api/session").then(r => r.json());
  const { eventId: second } = await post(request, "/api/admin", { action: "create", title: "切换测试二", mode: "formal" });
  await post(request, `/api/admin?event=${second}`, { action: "open" });
  await expect(page.locator(".header-event")).toContainText("切换测试二", { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "就位，合伙人。" })).toBeVisible();
  const stale = await page.request.post(`/api/runs/${saved.run.id}/decisions`, { data: { projectId: saved.run.card.id, choice: "pass", key: crypto.randomUUID() }, headers: { Origin: origin } });
  expect(stale.status()).toBe(409);
  await page.getByRole("button", { name: "开启我的投资之旅" }).click();
  await page.getByRole("button", { name: "投资 500 万", exact: true }).click();
  await expect(page.locator(".progress-stat strong")).toContainText("01");
  await post(request, `/api/admin?event=${second}`, { action: "close" });
  await expect(page.getByRole("heading", { name: "暂无进行中的活动" })).toBeVisible({ timeout: 10000 });
  await post(request, `/api/admin?event=${first}`, { action: "open" });
  await expect(page.locator(".progress-stat strong")).toContainText("02", { timeout: 10000 });
  expect((await page.request.get("/api/session").then(r => r.json())).run.id).toBe(saved.run.id);
  // Delete through the UI, including the currently active and finally the last activity.
  await page.goto("/admin"); await page.getByLabel("管理密码").fill(process.env.ADMIN_PASSWORD!); await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "删除活动", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("切换测试一");
  await page.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByRole("status")).toContainText("操作已保存");
  expect(await request.get("/api/meta").then(r => r.json())).toBeNull();
  const events = (await request.get("/api/admin").then(r => r.json())).events;
  for (const event of events.slice(1)) await post(request, `/api/admin?event=${event.id}`, { action: "delete" });
  await page.getByLabel("选择活动").selectOption(events[0].id);
  await expect(page.locator(".admin-top h1")).toHaveText(events[0].title);
  await page.getByRole("button", { name: "删除活动", exact: true }).click(); await page.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByRole("heading", { name: "暂无活动", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "暂无活动", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新活动" }).click(); await page.locator(".modal").getByLabel("活动名称").fill("清理后的下一场");
  await page.getByRole("button", { name: "创建活动" }).click(); await page.getByRole("button", { name: "启动活动", exact: true }).click();
  await expect(page.locator(".metric").first()).toContainText("进行中");
  await page.goto(`/?event=${first}`); await expect(page.locator(".header-event")).toContainText("清理后的下一场");
  await expect(page.getByRole("heading", { name: "就位，合伙人。" })).toBeVisible();
});
