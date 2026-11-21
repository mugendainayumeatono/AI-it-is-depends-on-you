# Ban/Pick System

A low-latency (<100ms) real-time team selection system inspired by Dota/LoL ban-pick drafts, engineered for Vercel Serverless / Fluid Compute.

## Features

- **Instant Local Transitions (<16ms) & Zero Rollbacks**: Shared deterministic state engine (`src/lib/gameEngine.ts`), serialized FIFO client mutation queue, and monotonic version gating eliminate rapid-action state regressions.
- **Sub-100ms Multi-Client Sync**: 1-RTT atomic Upstash Redis Lua state transitions + built-in Server-Sent Events (`GET /api/stream`) or upgraded Pusher WebSocket deltas (~300B payloads, no base64 images over the wire).
- **Configurable Teams & Members**: Unlimited teams (`teamCount >= 1`), custom team names, member profiles with avatars/backgrounds served via immutable cached proxy URLs (`GET /api/members/[id]/media`).
- **Drag & Drop Selection**: Intuitive `@dnd-kit` drafting board supporting rapid consecutive picks.
- **Dota-Style Timing & Auto-Pick**: Turn duration + team-specific reserve time (`0` allowed) with server-clock synchronization and idempotent version-gated auto-pick on expiry.
- **Randomize**: Unbiased Fisher-Yates shuffle distributing remaining members across teams.

## Architecture (3-Tier <100ms Vercel Design)

1. **Client Optimistic Engine (`src/lib/gameEngine.ts`, `src/hooks/useGameState.ts`)**
   - Replays pending local mutations deterministically on top of the last confirmed server snapshot (`<16ms` local paint for all 8 operations: Start, Pick, Auto-Pick, Randomize, Config/Reset, Add/Update/Delete Member).
   - **Serialized FIFO Mutation Queue**: Sends at most one mutation HTTP request in flight per client so rapid consecutive picks never race each other on the server.
   - **Monotonic Version Gate**: Drops any HTTP response, SSE frame, or Pusher event with `version <= confirmedVersion`, preventing out-of-order or stale-echo rollbacks.

2. **Hot State & Realtime Middleware — Upstash Redis + Built-in SSE (Recommended for <100ms on Vercel)**
   - **Upstash Redis** (1-click native Vercel Marketplace integration via `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, also supporting `KV_REST_API_URL` / `KV_REST_API_TOKEN`) holds normalized lean hot state (~1–3 KB) with ~0ms cold start.
   - A **single atomic Lua script (1 RTT, ~4–8ms same-region)** validates invariants, mutates state, increments `version`, records `mutationId` idempotency, appends to Redis Streams (`MAXLEN ~ 200`), and `PUBLISH`es the delta/snapshot.
   - **Built-in SSE (`GET /api/stream`)** (`maxDuration = 60`, works on Vercel Hobby & Pro Fluid Compute) streams real-time updates directly from Upstash Redis Pub/Sub with lossless `?sinceVersion=N` catch-up from Redis Streams on reconnect.

3. **Durable Cold Store & Media — Neon PostgreSQL + Immutable Media Proxy**
   - **Neon PostgreSQL** via Prisma (`POSTGRES_PRISMA_URL` pooled + `POSTGRES_URL_NON_POOLING` direct) provides durable persistence. When Upstash Redis is active, commits flush asynchronously to Neon inside Next.js 16 `after()` (guarded by `version` monotonicity); when Redis is unset, `PrismaStateStore` acts as an optimized direct fallback (selecting only lightweight URLs, never raw base64 blobs on hot queries).
   - **Media Decoupling (`GET /api/members/[id]/media`)**: Uploaded member avatars/backgrounds are stored durably in Postgres (and cached in Redis when enabled) and referenced in hot state via versioned URLs (`/api/members/<id>/media?field=avatar&v=<mediaVersion>`) served with `Cache-Control: public, max-age=31536000, immutable`.

4. **Optional WebSocket Mode — Upgraded Pusher Channels**
   - Supports Pusher Channels (`PUSHER_APP_ID`, `NEXT_PUBLIC_PUSHER_KEY`, `PUSHER_SECRET`, `NEXT_PUBLIC_PUSHER_CLUSTER`) broadcasting compact ~300B `StateDelta` events (with automatic downgrade to `{ kind: 'invalidate' }` if a payload ever exceeds 9,000 bytes, preventing Pusher's 10 KB HTTP 413 error) dispatched non-blockingly via `after()`.
   - Includes `POST /api/pusher/auth` for `private-banpick-channel` to enable optional **Dual-Path Speculative Client Events** (peer-to-peer WebSocket preview reconciled immediately by the authoritative server delta; degrades silently if Client Events are not enabled in Pusher Dashboard).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `POSTGRES_PRISMA_URL` | Prod (Neon) | Neon PostgreSQL **pooled** connection string (used by Prisma runtime). |
| `POSTGRES_URL_NON_POOLING` | Prod (Neon) | Neon PostgreSQL **direct** connection string (used by `prisma db push` during build). |
| `UPSTASH_REDIS_REST_URL` | Recommended | Upstash Redis REST URL (auto-injected by Vercel Marketplace; also accepts `KV_REST_API_URL`). |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | Upstash Redis REST token (also accepts `KV_REST_API_TOKEN`). |
| `NEXT_PUBLIC_SYNC_METHOD` | Optional | Realtime transport mode (see below). Default: `AUTO`. |
| `PUSHER_APP_ID` | Optional | Pusher Channels App ID (WebSocket mode). |
| `NEXT_PUBLIC_PUSHER_KEY` | Optional | Pusher Channels public key. |
| `PUSHER_SECRET` | Optional | Pusher Channels secret (server-only). |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Optional | Pusher cluster (e.g., `ap1`, `us2`). |
| `BANPICK_STORE` | Optional | Force store backend (`upstash`, `prisma`, or `memory`). Auto-detected by default. |

### `NEXT_PUBLIC_SYNC_METHOD` Modes

- **`AUTO`** *(default)*: Uses `PUSHER` automatically if `NEXT_PUBLIC_PUSHER_KEY` is configured; otherwise uses built-in `SSE` (`/api/stream`) — **zero polling**.
- **`SSE`**: Forces built-in Server-Sent Events (`/api/stream`).
- **`PUSHER`**: Forces Pusher Channels WebSocket sync (with optional private-channel speculative client events via `/api/pusher/auth`).
- **`POLLING`**: Legacy HTTP polling fallback.

### Automatic Store Selection

1. **`UpstashRedisStateStore`** when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) are configured (with async Neon write-behind when `POSTGRES_PRISMA_URL` is also set).
2. **`PrismaStateStore`** when Redis env vars are absent and `POSTGRES_PRISMA_URL` is configured.
3. **`InMemoryStateStore`** when neither Redis nor `POSTGRES_PRISMA_URL` is configured (zero-config local dev & tests).

## Local Development

### Option A: Zero-Config Local Dev (Instant Start)

No database, Redis, or Pusher account is required to run locally:

```bash
npm install
npm run dev
```

Without `.env`, the app automatically uses `InMemoryStateStore` + local SSE (`EventEmitter` on `/api/stream`), giving `<10ms` multi-tab synchronization out of the box.

### Option B: Local Dev with Neon + Upstash Redis (and Optional Pusher)

1. Create a `.env` file in the project root:

```env
# Neon PostgreSQL (matching prisma/schema.prisma)
POSTGRES_PRISMA_URL="postgresql://..."
POSTGRES_URL_NON_POOLING="postgresql://..."

# Recommended: Upstash Redis (1-RTT atomic Lua hot state + SSE pub/sub)
UPSTASH_REDIS_REST_URL="https://..."
UPSTASH_REDIS_REST_TOKEN="..."

# Realtime sync mode: AUTO (default) | SSE | PUSHER | POLLING
NEXT_PUBLIC_SYNC_METHOD="AUTO"

# Optional: Pusher WebSocket mode
# PUSHER_APP_ID="..."
# NEXT_PUBLIC_PUSHER_KEY="..."
# PUSHER_SECRET="..."
# NEXT_PUBLIC_PUSHER_CLUSTER="ap1"
```

2. Install dependencies, push schema, and start the dev server:

```bash
npm install
npx prisma db push
npm run dev
```

## Verification & Testing

```bash
npm test            # Run Vitest unit, API, concurrency, and component tests
npm run lint        # Run ESLint
npx tsc --noEmit    # Run TypeScript type checks
```

## Deployment on Vercel (<100ms Checklist)

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete step-by-step guide (including Vercel Marketplace setup for Neon & Upstash Redis).

**Critical `<100ms` Same-Region Co-Location Checklist:**
To prevent 180–250ms cross-ocean round-trips, **all** active components MUST be provisioned in the **same geographic region** closest to your users:

| Target Users | Vercel Function Region | Neon Postgres Region | Upstash Redis Region | Optional Pusher Cluster |
| --- | --- | --- | --- | --- |
| **Asia / APAC** | `sin1` (Singapore) | `ap-southeast-1` (Singapore) | `ap-southeast-1` (Singapore) | `ap1` (Singapore) |
| **US East** | `iad1` (Washington, D.C.) | `us-east-1` (N. Virginia) | `us-east-1` (N. Virginia) | `us2` (US East) |
| **Europe** | `fra1` (Frankfurt) | `eu-central-1` (Frankfurt) | `eu-central-1` (Frankfurt) | `eu` (Ireland / EU) |

Set the **Function Region** in Vercel Project Settings -> **Functions** -> **Function Region** (Vercel defaults to `iad1` if unchanged!).
