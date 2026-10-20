# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

具身VC投资模拟器：线下活动用的投资决策小游戏。玩家按固定时间线看 50 个真实公司案例、最多投 20 家，服务端统一在 2031 年模拟结算，并支持现场排行榜、大屏与抽奖。所有评分、时间线与抽奖都在服务端完成。

## 常用命令

需要 Node.js 22+。

```bash
npm run dev          # next dev --hostname 0.0.0.0
npm run typecheck    # tsc --noEmit
npm test             # vitest run（tests/**/*.test.ts）
npm run build && npm start   # start 走 scripts/start.mjs，拼装 standalone 产物后再启动
npm run simulate     # 策略收益模拟，调参题库后用于回归
npm run export-content       # 由 data/projects.ts 生成 docs/题库初稿.{json,md}
```

单个单元测试：`npx vitest run tests/engine.test.ts`，单个用例加 `-t "关键字"`。vitest 串行执行（`maxWorkers: 1`、`fileParallelism: false`），因为测试共享 PGlite；每个测试文件在 `beforeAll` 里把 `process.env.PGLITE_PATH` 指到临时目录。

端到端测试需要先手工起一个服务，再运行：

```bash
npx playwright test e2e/game.spec.ts
```

`playwright.config.ts` 不会自动拉起服务；`E2E_URL` 默认 `http://localhost:3000`，用本机 Chrome（或 `PLAYWRIGHT_BROWSER_PATH`），视口固定 390×844。用例通过 `/api/admin/login` 直接建活动，所以运行前 `.env.local` 里要有 `ADMIN_PASSWORD`，且写请求必须带 `Origin` 头。

## 架构

### 请求入口只有一个

`app/api/[...path]/route.ts` 是全部 API 的唯一分发点：按 `path.join("/")` 匹配路由、用 Zod 校验入参、把 `HttpError` 翻成状态码、把 ZodError 统一翻成 422。**新增接口是在这个文件里加一个分支，不是加新的 route 文件。** `app/` 下的页面都只是 `components/` 里客户端组件的薄壳。

分层：`route.ts`（HTTP + 校验 + Cookie）→ `lib/service.ts`（业务逻辑 + 全部 SQL）→ `lib/db.ts`（连接与事务）。`lib/engine.ts` 是纯函数的游戏规则，不碰数据库，便于单测。

### 活动快照（最容易踩坑的地方）

每个活动在 `events.snapshot` 里存一份完整的 `Snapshot` JSONB（projects + paths + decks + rules），而不是引用当前题库。因此：

- 改 `data/projects.ts` 会改变 `lib/service.ts` 里的 `BANK_VERSION`（= 版本串 + PROJECTS 的 sha256），`ensureSeed()` 只会把**未产生过 run 的 draft/open 活动**升级到新题库；已有人参赛的活动永远保留原快照与成绩。
- 存在两个相互独立的版本键：`lib/engine.ts` 的 `CONTENT_VERSION`（规则/时间线口径，写进 snapshot.version）与 `lib/service.ts` 的 `BANK_VERSION`（题库内容）。二者当前并不同步，改题库或改规则时要分清该动哪个。
- `events.snapshot_revision` 由 Postgres 触发器 `vc_snapshot_revision` 维护（`md5(snapshot)`），它是进程内快照缓存 `snapshots` 的键。任何绕过应用直接改 snapshot 的 SQL 都必须让这个列变化，否则热实例会一直返回旧题库。

### 并发与幂等

- 同时只允许一个 `status='open'` 活动，由部分唯一索引 `events_single_open` 兜底；启动一个活动会自动把其他 open 改成 closed。
- 所有后台开关、`resetPlayer` 都先取 `pg_advisory_xact_lock(20261028)` 跨进程串行化，再对具体活动行 `FOR UPDATE`。
- 玩家决策按客户端生成的 `key`（uuid）幂等：重复提交返回同一视图，内容不一致则 409。抽奖按 `(event_id, request_key)` 唯一；重抽把旧轮次标成 `lucky-replaced`，清空标成 `lucky-cleared`，**从不物理删除**，幂等重试才能正确识别。
- 活动生命周期：`draft → open → closed → frozen`。冻结时把排行榜固化进 `frozen_rows`，抽奖只在 frozen 状态下进行；重新 open 会清掉 draws 并解冻。

### 数据边界

玩家接口只下发 `lib/cards.ts` 的 `playerCard()` 结果：当前这一张卡、匿名化后的文案（真实人名→"创始人"、具体机构→"某头部科技公司"等）。真实公司名、终值估值、历史与来源只在 `result()` 终局复盘里出现。改动卡片相关代码时注意不要把 `Project` 原样透出。

### 数据库

`lib/db.ts` 用同一份 `databaseSchema` 字符串（全幂等 DDL + 迁移语句）在两种驱动上跑：有 `DATABASE_URL` 走 `pg` 连接池（max 4、idle 5s，为 serverless 额度优化），否则落到 `.data/postgres` 的 PGlite（仅单进程本地演示）。改 `databaseSchema` 时要同时改 `getDb()` 里的 `schemaVersion` 字面量，否则热实例不会重跑 DDL。`transaction()` 在 PGlite 下用队列串行化，在 pg 下用独占 client。

### 流量与成本约束

这套代码为 Neon/Supabase 免费额度做过专门优化，改动时别破坏：`publicMeta()` 只用 JSONB 投影取元数据，绝不整份读 snapshot；公共读经 `lib/read-cache.ts` 缓存 2 秒；前端轮询统一走 `lib/poll.ts` 的 `pollVisible`（隐藏标签页暂停、失败指数退避到 60s）。`tests/database-budget.test.ts` 会对轮询字节数设红线。

### 安全

`lib/security.ts`：HMAC 签名的 HttpOnly Cookie（`vc_players` 是 eventId→token 的映射，`vc_admin` 带过期时间戳）、所有写请求 `assertOrigin`、基于 `rate_limits` 表的限流、`timingSafeEqual` 比较。`SESSION_SECRET` 至少 32 字符，缺失直接抛错。

## 题库流水线

Excel 是唯一事实源，**不要修改 .xlsx**：

```bash
python3 scripts/import-question-bank.py   # xlsx → data/projects.ts + data/question-bank-manifest.json
npm run export-content                     # → docs/题库初稿.{json,md}
```

导入脚本按公司名连接"题库底稿/回报测算/资料口径"三张表并核对案例 ID，不依赖行序；回报以回报测算表 C 列（游戏进入年）与 K 列（结算倍数）为准，I 列人工指定倍率优先；遇到缺值、重复公司、ID 冲突或公式缓存不一致即报错中止。manifest 记录原表 SHA256 与逐公司进入年/倍数。

后台也可以导入 JSON 题库，但只允许导入 **draft 状态**的活动。

## 约定

- 面向用户的文案、错误消息一律中文；服务端抛 `new HttpError(status, "中文提示")`。
- 代码风格极度紧凑：单行函数、少换行、几乎不写注释；仅在不显然的不变量处写一句英文注释。新增代码请沿用，不要重排已有代码。
- 样式集中在 `app/globals.css`（约 1000 行）+ Tailwind v4（postcss），组件里基本不写 utility class 堆砌。
- git commit message 用英文祈使句（见 `git log`）。
- 发布流程是 push 到 `main`，Vercel 自动构建部署到 vcsim.ootoday.top；生产库是 Supabase 事务池（6543）+ `DATABASE_SSL_CA`。
- `MAINTENANCE_MODE=1` 时所有 API 在连接数据库之前返回 503，迁移时使用（见 `docs/数据库迁移.md`）。
- 发布前的验证口径记在 `docs/验证记录.md`，现场操作见 `docs/活动操作说明.md`。

## Next.js 16

`AGENTS.md` 由 `next dev` 自动写入：本仓库的 Next.js 版本与训练数据可能不一致，写 Next 相关代码前先读 `node_modules/next/dist/docs/`。该文件被工具重新生成属正常现象，连同改动一起提交即可。
