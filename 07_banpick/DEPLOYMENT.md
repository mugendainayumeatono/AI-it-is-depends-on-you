# Ban/Pick 系统部署指南 (Vercel + Neon + Upstash Redis / 可选 Pusher)

本指南介绍如何将重构后的低延迟（`<100ms`）Ban/Pick 系统部署到 **Vercel**，实现单端 `<16ms` 即时状态切换、快速连续操作零回滚，以及多端 `<100ms` 实时状态同步。

---

## 1. 三层低延迟架构概览

1. **客户端确定性乐观引擎 (`src/lib/gameEngine.ts` + `src/hooks/useGameState.ts`)**
   - **单端 `<16ms` 零延迟**：所有 8 类操作（开始、选人、超时自动选人、随机分队、重置/保存配置、成员增删改）均由前后端共享的纯函数引擎在本地即时演算出下一帧画面。
   - **串行 FIFO 变更队列**：单客户端同时仅有一个写请求在途，快速连点/连拖严格按序提交，彻底消除客户端并发竞争导致的 `400/409` 回滚。
   - **单调版本号门控 (`version`)**：任何 `version <= confirmedVersion` 的 HTTP 响应、SSE 事件或 Pusher 推送都会被直接丢弃，杜绝旧消息覆盖新状态。

2. **热状态与实时推送中间件 — Upstash Redis + 内置 SSE（Vercel `<100ms` 推荐配置）**
   - 通过 **Vercel Marketplace** 一键集成 **Upstash Redis**（`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`，亦兼容 `KV_REST_API_URL` / `KV_REST_API_TOKEN`），无冷启动（`~0ms`）。
   - 每次选人/状态变更通过 **单次原子 Lua 脚本（1 RTT，同区约 4–8ms）** 完成校验、状态更新、单调版本号递增、幂等去重、写入 Redis Stream（`MAXLEN ~ 200`）并 `PUBLISH` 增量事件。
   - 内置 **SSE 推送端点 (`GET /api/stream`)**（配置 `maxDuration = 60`，适配 Vercel Hobby 与 Pro 的 Fluid Compute 按活跃 CPU 计费模型），直接订阅 Upstash Redis Pub/Sub 并在断线/60s 周期重连时通过 `?sinceVersion=N` 从 Redis Stream 无损补齐事件，无需注册额外推送服务商。

3. **持久化冷存储与媒体解耦 — Neon PostgreSQL + 不可变媒体代理**
   - **Neon PostgreSQL**（通过 Prisma 连接：`POSTGRES_PRISMA_URL` 连接池地址 + `POSTGRES_URL_NON_POOLING` 直连地址）作为持久化存储。
   - 启用 Upstash Redis 时，热路径提交后通过 Next.js 16 `after()` 在响应返回后异步持久化回写 Neon（带版本号单调保护，绝不阻塞前端响应与广播）；未配置 Redis 时，自动降级为优化后的 `PrismaStateStore` 直连模式。
   - **媒体与热状态彻底分离 (`GET /api/members/[id]/media`)**：头像与背景图（Base64）仅存储在 Postgres（及 Redis 媒体键），热状态与实时事件中只传输轻量级版本化 URL（`/api/members/<id>/media?field=avatar&v=<mediaVersion>`），并附带 `Cache-Control: public, max-age=31536000, immutable` 浏览器强缓存，热同步载荷从数百 KB–数 MB 降至 **~300B 增量 / ~1–3KB 快照**。

4. **可选 WebSocket 模式 — 升级版 Pusher Channels**
   - 若已配置 Pusher（`PUSHER_APP_ID`、`NEXT_PUBLIC_PUSHER_KEY`、`PUSHER_SECRET`、`NEXT_PUBLIC_PUSHER_CLUSTER`），服务端直接发送 ~300B 增量事件，通过 `after()` 非阻塞触发，且在载荷超过 9,000 字节时自动降级为 `{ kind: 'invalidate' }`，**彻底杜绝 Pusher 10 KB 限制导致的 HTTP 413 静默失败**。
   - 内置 `POST /api/pusher/auth` 私有频道鉴权（`private-banpick-channel`），支持可选的 **双路径推测式客户端事件（Client Events）** 广播（浏览器到浏览器直接预览，数十毫秒后由服务端权威事件无感确认；若 Pusher 控制台未开启 Client Events，则自动静默降级为服务端权威推送）。

---

## 2. 关键前提：Vercel `<100ms` 同区部署检查清单

> **极其重要**：物理光速决定跨洋单次 RTT 高达 **180–250ms**。Vercel Serverless Functions 默认部署在 **美东 `iad1`**；如果您的用户在亚洲或 Pusher 选在 `ap1`，而 Vercel 函数留在 `iad1`，延迟将立刻飙升至数百毫秒以上！

请务必将 **所有已启用的组件** 部署在距离用户最近的 **同一个云区域**：

| 目标用户区域 | Vercel Function Region | Neon Postgres 区域 | Upstash Redis 区域 | 可选 Pusher 集群 |
| --- | --- | --- | --- | --- |
| **亚太 / 中国周边** | `sin1`（新加坡） | `ap-southeast-1`（新加坡） | `ap-southeast-1`（新加坡） | `ap1`（新加坡） |
| **北美东部** | `iad1`（美东华盛顿） | `us-east-1`（美东弗吉尼亚） | `us-east-1`（美东弗吉尼亚） | `us2`（美东） |
| **欧洲** | `fra1`（法兰克福） | `eu-central-1`（法兰克福） | `eu-central-1`（法兰克福） | `eu`（爱尔兰/欧洲） |

**检查项**：
- [ ] 在 Vercel 项目页面 -> **Settings -> Functions -> Function Region** 中将函数区域设置为与数据库相同的区域（切勿保留默认的 `iad1` 而把数据库建在新加坡！）。
- [ ] Neon Postgres 项目区域与 Vercel Function Region 一致。
- [ ] Upstash Redis 数据库主区域与 Vercel Function Region 一致。
- [ ] 若使用 Pusher，Cluster 与 Vercel Function Region 一致。

---

## 3. Vercel 部署步骤（推荐使用 Vercel Marketplace）

### 第 1 步：导入项目到 Vercel
1. 将代码推送到 GitHub 仓库。
2. 登录 [Vercel](https://vercel.com/) -> **Add New -> Project** -> 选择您的仓库。
3. 若项目位于 Monorepo 子目录，请将 **Root Directory** 设置为 `07_banpick`。
4. 构建命令保持默认（`package.json` 已内置 `prisma generate && prisma db push --accept-data-loss && next build`，首次部署会自动初始化并同步表结构与索引）。

### 第 2 步：配置 Neon PostgreSQL（必填，持久化冷存储）
- **方式 A（推荐，Vercel Marketplace）**：在 Vercel 项目 **Storage / Integrations** 中安装 **Neon**（或 CLI 运行 `vercel install neon`），选择与函数一致的区域，并确认项目环境变量包含：
  - `POSTGRES_PRISMA_URL`（Neon **Pooled Connection** 连接池地址）
  - `POSTGRES_URL_NON_POOLING`（Neon **Direct Connection** 直连地址，用于构建期 `prisma db push`）
- **方式 B（手动配置）**：在 [Neon.tech](https://neon.tech/) 创建项目，将 Pooled 与 Direct 连接字符串分别填入 Vercel 环境变量 `POSTGRES_PRISMA_URL` 和 `POSTGRES_URL_NON_POOLING`。

### 第 3 步：配置 Upstash Redis（强烈推荐，实现 `<100ms` 热状态与内置 SSE）
- 在 Vercel 项目 **Storage / Integrations** 中一键添加 **Upstash Redis**（或 CLI 运行 `vercel install upstash`），**选择与 Vercel 函数相同的区域**。
- Vercel 会自动注入以下环境变量（系统亦自动兼容旧版 Vercel KV 命名 `KV_REST_API_URL` / `KV_REST_API_TOKEN`）：
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- 配置完成后，无需任何额外推送服务账号，系统即可通过 **Upstash Redis Lua + 内置 SSE (`/api/stream`)** 实现 `<100ms` 多端同步。

### 第 4 步：（可选）配置 Pusher Channels WebSocket 模式
如果您已有 Pusher 账号，或需要长连接无 60s SSE 周期重连及双路径推测式同步，可添加以下环境变量：
- `PUSHER_APP_ID`
- `NEXT_PUBLIC_PUSHER_KEY`
- `PUSHER_SECRET`
- `NEXT_PUBLIC_PUSHER_CLUSTER`（例如 `ap1`、`us2`）
- *可选增强*：在 Pusher 控制台 **App Settings** 中开启 **Enable client events**，客户端将自动通过 `POST /api/pusher/auth` 订阅 `private-banpick-channel`，启用毫秒级浏览器直连推测同步（未开启时也会平滑回退到服务端权威推送，不会报错）。

### 第 5 步：同步模式说明 (`NEXT_PUBLIC_SYNC_METHOD`)

| 取值 | 行为说明 |
| --- | --- |
| **`AUTO`** *(默认)* | 若配置了 `NEXT_PUBLIC_PUSHER_KEY` 则自动启用 `PUSHER`；否则自动启用内置 `SSE`（`/api/stream`）——**默认零轮询**。 |
| **`SSE`** | 强制使用内置 SSE（`/api/stream`）。 |
| **`PUSHER`** | 强制使用 Pusher Channels WebSocket 同步。 |
| **`POLLING`** | 传统 HTTP 轮询兜底模式（仅用于特殊网络限制环境）。 |

### 第 6 步：存储后端自动降级策略

系统按以下优先级自动选择存储层（也可通过可选环境变量 `BANPICK_STORE=upstash|prisma|memory` 手动指定）：
1. **Upstash Redis + Neon 异步回写 (`upstash`)**：配置了 `UPSTASH_REDIS_REST_URL` 与 `UPSTASH_REDIS_REST_TOKEN`（或 `KV_REST_API_*`）时自动启用，延迟最低、无冷启动。
2. **Neon Prisma 直连 (`prisma`)**：未配置 Redis 但配置了 `POSTGRES_PRISMA_URL` 时自动降级，仍享有单事务优化、媒体解耦、单调版本门控与零回滚保障。
3. **内存模式 (`memory`)**：未配置数据库与 Redis 时自动启用，适合零配置本地开发与自动化测试。

---

## 4. 本地开发与验证

### 方式 A：零配置极速启动（无需任何云账号）
不创建 `.env` 文件直接启动：
```bash
npm install
npm run dev
```
此时后端自动使用 `InMemoryStateStore`，`/api/stream` 自动使用进程内 `EventEmitter` 推送，打开多个浏览器标签页即可体验 `<10ms` 实时多端同步与零回滚拖拽。

### 方式 B：连接真实 Neon + Upstash Redis（与可选 Pusher）
1. 在 `07_banpick` 目录创建 `.env`：
   ```env
   # Neon PostgreSQL（与 prisma/schema.prisma 一致）
   POSTGRES_PRISMA_URL="postgresql://..."
   POSTGRES_URL_NON_POOLING="postgresql://..."

   # 推荐：Upstash Redis（1-RTT 原子 Lua 热状态 + SSE 推送）
   UPSTASH_REDIS_REST_URL="https://..."
   UPSTASH_REDIS_REST_TOKEN="..."

   # 同步模式：AUTO（默认）| SSE | PUSHER | POLLING
   NEXT_PUBLIC_SYNC_METHOD="AUTO"

   # 可选：Pusher WebSocket 实时同步
   # PUSHER_APP_ID="你的_app_id"
   # NEXT_PUBLIC_PUSHER_KEY="你的_key"
   # PUSHER_SECRET="你的_secret"
   # NEXT_PUBLIC_PUSHER_CLUSTER="ap1"
   ```
2. 初始化并启动：
   ```bash
   npm install
   npx prisma db push
   npm run dev
   ```

### 测试与静态检查命令
```bash
npm test            # 运行全部 Vitest 单元、API、并发与组件测试
npm run lint        # 运行 ESLint 检查
npx tsc --noEmit    # 运行 TypeScript 类型检查
```
