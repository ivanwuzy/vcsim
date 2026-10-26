import { test, expect } from "@playwright/test";
import nextEnv from "@next/env";
import type { adminState } from "../lib/service";
import type { LotteryState } from "../lib/lottery";
nextEnv.loadEnvConfig(process.cwd());
const origin = process.env.E2E_URL || "http://localhost:3000";

test("test players, score entry, four ranked batches and safe test cleanup work through the host console", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const post = async (path: string, body: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data: body });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await post("/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  const { eventId } = await post("/api/admin", { action: "create", title: "后台玩家与排名抽奖验证", mode: "demo" });
  const endpoint = `/api/admin?event=${eventId}`;
  const readPlayers = () => page.request.get(endpoint).then(response => response.json()) as Promise<Awaited<ReturnType<typeof adminState>>>;
  const readLottery = () => page.request.get(`/api/admin/lottery?event=${eventId}`).then(response => response.json()) as Promise<LotteryState>;
  try {
    await post(endpoint, { action: "settings", title: "后台玩家与排名抽奖验证", topCount: 3, luckyCount: 3 });
    await post(endpoint, { action: "open" });
    await page.goto("/admin");
    await page.getByRole("button", { name: "玩家", exact: true }).click();
    await page.getByRole("button", { name: "增加测试玩家", exact: true }).click();
    const tests = page.getByRole("dialog", { name: "增加测试玩家", exact: true });
    await expect(tests.getByLabel("测试玩家数量")).toHaveValue("50");
    await tests.getByLabel("测试玩家数量").fill("3");
    await tests.getByRole("button", { name: "增加 3 个测试玩家" }).click();
    await expect(page.getByRole("status")).toContainText("已增加 3 个测试玩家");
    await page.getByRole("button", { name: "增加测试玩家", exact: true }).click();
    await tests.getByLabel("测试玩家数量").fill("47");
    await tests.getByRole("button", { name: "增加 47 个测试玩家" }).click();
    await expect(page.locator(".board-table tbody tr")).toHaveCount(50);
    await expect(page.getByRole("columnheader", { name: "AUM / 亿元" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "MOIC" })).toBeVisible();

    await page.getByRole("button", { name: "补填", exact: true }).first().click();
    const score = page.getByRole("dialog", { name: "补填玩家成绩" });
    await score.getByLabel("姓名", { exact: true }).fill("测试玩家真人");
    await score.getByLabel("机构", { exact: true }).fill("真实机构");
    await score.getByLabel("成绩 AUM（亿元）").fill("100.12");
    await expect(score.getByRole("status")).toContainText("50.06×");
    await page.screenshot({ path: "artifacts/admin-fill-score.png" });
    await score.getByRole("button", { name: "保存成绩" }).click();
    await expect(score).toHaveCount(0);
    const realPlayer = page.getByRole("row").filter({ hasText: "测试玩家真人" });
    await expect(realPlayer).toContainText("100.12");
    await expect(realPlayer).toContainText("50.06×");
    await realPlayer.getByRole("button", { name: "补填", exact: true }).click();
    await expect(score.getByLabel("姓名", { exact: true })).toBeDisabled();
    await score.getByLabel("成绩 AUM（亿元）").fill("200");
    await score.getByRole("button", { name: "保存成绩" }).click();
    await expect(realPlayer).toContainText("100.00×");
    await expect(page.locator(".board-table tbody tr")).toHaveCount(51);
    await page.screenshot({ path: "artifacts/admin-test-players.png" });

    await post(endpoint, { action: "close" });
    await post(endpoint, { action: "freeze" });
    const original = (await readLottery()).candidates, allowed = new Set(original.slice(3, 30).map(player => player.playerId));
    await page.clock.install();
    await page.goto(`/admin/screen?event=${eventId}`);
    await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
    await page.getByLabel("剔除排名前N个玩家").fill("3");
    await page.getByLabel("在前M名玩家中抽奖").fill("30");
    await expect(page.getByLabel("抽取人数", { exact: true })).toHaveValue("3");
    await page.getByLabel("抽取人数", { exact: true }).fill("5");
    await expect(page.getByRole("dialog")).toContainText("可参与 27 人");
    await page.screenshot({ path: "artifacts/lottery-ranked-ready.png", animations: "disabled" });
    for (let index = 0; index < 4; index++) {
      if (index) {
        await expect(page.getByLabel("再抽几个")).toHaveValue("5");
        await expect(page.getByLabel("排除已抽中人员")).toBeChecked();
        await page.getByRole("button", { name: "抽取更多", exact: true }).click();
      }
      await page.getByRole("button", { name: "摇杆：开始抽奖" }).click();
      await expect(page.getByRole("button", { name: "跳过动画" })).toBeVisible();
      await page.getByRole("button", { name: "跳过动画" }).click();
    }
    await expect(page.getByRole("dialog")).toContainText("累计已抽 20 个名额");
    await page.screenshot({ path: "artifacts/lottery-ranked-20-winners.png", animations: "disabled" });
    const lottery = await readLottery(), winners = lottery.draws.flatMap(draw => draw.winners);
    expect(lottery.draws.map(draw => draw.winners.length)).toEqual([5, 5, 5, 5]);
    expect(new Set(winners.map(player => player.playerId)).size).toBe(20);
    expect(winners.every(player => allowed.has(player.playerId))).toBe(true);
    await page.getByRole("button", { name: "关闭抽奖浮窗" }).click();
    await page.reload();
    await page.getByRole("button", { name: "幸运观众抽奖", exact: true }).click();
    await expect(page.getByLabel("剔除排名前N个玩家")).toHaveValue("3");
    await expect(page.getByLabel("在前M名玩家中抽奖")).toHaveValue("30");
    await expect(page.getByLabel("再抽几个")).toHaveValue("5");
    await page.getByRole("button", { name: "关闭抽奖浮窗" }).click();

    await page.goto("/admin");
    await page.getByRole("button", { name: "玩家", exact: true }).click();
    await page.getByRole("button", { name: /快速删除测试玩家/ }).click();
    await page.getByRole("dialog", { name: "快速删除测试玩家" }).getByRole("button", { name: "确认操作" }).click();
    await expect(page.locator(".board-table tbody tr")).toHaveCount(1);
    await expect(realPlayer).toContainText("测试玩家真人");
    const remaining = await readPlayers();
    expect(remaining.players[0]).toMatchObject({ name: "测试玩家真人", is_test: false });
    expect(remaining.leaderboard[0]).toMatchObject({ name: "测试玩家真人", rank: 1, profit: 19_800_000_000 });
    expect((await readLottery()).draws).toHaveLength(0);
  } finally {
    await post(endpoint, { action: "delete" });
  }
});
