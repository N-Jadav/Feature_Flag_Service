# LocalOps Feature Flag API

A small Express + TypeScript REST API for managing feature flags, with API-key auth,
per-key rate limiting (hand-rolled token bucket), and percentage-based rollout evaluation
using consistent hashing.

## Setup

Requires Node 18+ and a Postgres database.

```bash
npm install
```

### Database

Flags are persisted in Postgres. Bring one up locally with Docker:

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` with a `localops` user/db matching the app's
default connection string, so no further config is needed for local dev. To point at a
different database (e.g. a managed Postgres instance when deploying), set `DATABASE_URL`:

```bash
export DATABASE_URL=postgres://user:password@host:5432/dbname
```

The schema (a single `flags` table) is created automatically on server startup if it
doesn't already exist — no separate migration step to run.

Auth is a static API key check. By default the key `dev-key-123` is accepted. To use your
own key(s), set `API_KEYS` (comma-separated for multiple) before starting the server:

```bash
export API_KEYS=dev-key-123,another-key
```

## Run

```bash
npm run dev     # start with auto-reload (tsx watch)
```

The server listens on `http://localhost:3000` (override with `PORT`).

Other scripts:

```bash
npm run build   # compile to dist/
npm start       # run compiled build (after npm run build)
npm run lint    # eslint
npm test        # run tests (node:test) - rollout hashing is pure, rate limiter tests need a
                # reachable Postgres (see Database below) since it's DB-backed
```

## Auth

Every endpoint except `/health` requires an `x-api-key` header. Missing or invalid keys
get a `401`.

```bash
curl http://localhost:3000/flags
# 401 {"error":"missing or invalid API key"}

curl http://localhost:3000/flags -H "x-api-key: dev-key-123"
# 200 []
```

The examples below all assume:

```bash
export API_KEY=dev-key-123
```

## Endpoints

### Health check

```bash
curl http://localhost:3000/health
```

### Create a flag

```bash
curl -X POST http://localhost:3000/flags \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "new-checkout-flow",
    "environment": "prod",
    "enabled": true,
    "rollout_percentage": 50
  }'
```

`key` and `environment` are required; `enabled` (default `false`) and `rollout_percentage`
(default `0`) are optional. `key` must be unique — creating a duplicate returns `409`.

### List flags

```bash
curl http://localhost:3000/flags -H "x-api-key: $API_KEY"

# filter by environment
curl "http://localhost:3000/flags?environment=prod" -H "x-api-key: $API_KEY"
```

### Get a single flag

```bash
curl http://localhost:3000/flags/new-checkout-flow -H "x-api-key: $API_KEY"
```

Returns `404` if the key doesn't exist.

### Update a flag

Partial update — send only the fields you want to change.

```bash
curl -X PATCH http://localhost:3000/flags/new-checkout-flow \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rollout_percentage": 75}'
```

### Delete a flag

```bash
curl -X DELETE http://localhost:3000/flags/new-checkout-flow -H "x-api-key: $API_KEY"
```

Returns `204` on success, `404` if the key doesn't exist.

### Evaluate a flag

```bash
curl "http://localhost:3000/evaluate/new-checkout-flow?env=prod&userId=alice" \
  -H "x-api-key: $API_KEY"
```

Returns whether the flag is on for the given caller:

```json
{ "key": "new-checkout-flow", "environment": "prod", "enabled": true }
```

- `env` is required and must match the flag's stored `environment` (otherwise `404`).
- `userId` identifies the caller for rollout bucketing. If omitted, the caller's IP is
  used instead. The same `userId` always gets the same result for a given flag, via a
  hash of `key:userId` bucketed 0-99 against `rollout_percentage` — so a 50% rollout
  consistently includes the same half of your users rather than flipping per request.

## Rate limiting

Each API key gets its own token bucket per limiter tier:

| Routes | Burst capacity | Refill rate |
|---|---|---|
| CRUD (`/flags*`) | 20 | 10/sec |
| `/evaluate/*` | 200 | 100/sec |

`/evaluate` gets a much bigger bucket since it's the high-traffic path client apps hit on
every request, while flag management is low-volume admin traffic.

Bucket state lives in a `rate_limit_buckets` table (one row per `tier:apiKey`), not in process
memory, so quotas survive a restart and stay correct if you ever run more than one server
instance against the same database. The refill-and-consume happens as a single atomic SQL
statement (an `UPDATE`, or `INSERT ... ON CONFLICT DO UPDATE` for a brand new key), so
concurrent requests for the same key can't race each other into over-consuming.

The tradeoff: every rate-limited request now costs a DB round trip instead of an in-memory
check. For a single Postgres instance that's still fast, but it does mean `/evaluate`'s
throughput ceiling is now bounded by Postgres, not memory - worth knowing if you ever need to
push this well past hundreds of requests/sec (see "What I'd do differently" below).

Exceeding the limit returns `429` with a `Retry-After` header (seconds until a token is
available):

```bash
curl -i http://localhost:3000/flags -H "x-api-key: $API_KEY"
# HTTP/1.1 429 Too Many Requests
# Retry-After: 1
# {"error":"rate limit exceeded, try again later"}
```

To see it trip, fire requests faster than the refill rate, e.g.:

```bash
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code} " -H "x-api-key: $API_KEY" http://localhost:3000/flags
done
echo
```

## Try the full flow

```bash
API_KEY=dev-key-123

curl -X POST http://localhost:3000/flags -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"key":"beta","environment":"prod","enabled":true,"rollout_percentage":50}'

curl "http://localhost:3000/flags?environment=prod" -H "x-api-key: $API_KEY"

curl "http://localhost:3000/evaluate/beta?env=prod&userId=alice" -H "x-api-key: $API_KEY"

curl -X PATCH http://localhost:3000/flags/beta -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"rollout_percentage": 100}'

curl -X DELETE http://localhost:3000/flags/beta -H "x-api-key: $API_KEY"
```

## Project layout

```
src/
  app.ts               express app wiring
  server.ts             entrypoint
  routes/
    health.ts            GET /health
    flags.ts              flag CRUD + GET /evaluate/:key
  middleware/
    auth.ts               API key check
    logger.ts             request logging
    rateLimiter.ts         token bucket rate limiter
    errorHandler.ts        catches thrown/rejected errors, responds 500
  lib/
    rollout.ts             consistent-hash rollout evaluation
  db/
    pool.ts                pg connection pool
    schema.ts               table definition (run on boot)
    migrate.ts              runs schema.ts against the pool
  store/
    flagStore.ts           Postgres-backed flag CRUD
  types/
    flag.ts                Flag type
```

## Design decisions

- **`key` is globally unique; `environment` is just an attribute on it.** `/evaluate/:key?env=X`
  checks that the flag's stored environment matches the requested one and 404s otherwise. The
  alternative - keying on `(key, environment)` so one logical flag can have independently
  configured rollouts per environment - is arguably more realistic for a real flag system, but
  wasn't what the field list implied ("key (unique string)"). Easy to switch if that's wrong.
- **Rollout bucketing** hashes `flagKey:callerId` (md5, stdlib `crypto`) into 0-99 and compares
  against `rollout_percentage`, so a given caller always lands in the same bucket for a given
  flag. Caller identity is `userId` if the client passes it, else the request IP - a weak proxy
  (NAT, mobile networks) but there's no auth/session concept for end users here, only for API
  callers.
- **No ORM.** Plain `pg` and hand-written SQL - the query surface is small (one table's worth of
  CRUD plus the rate limiter), and an ORM's abstraction wouldn't pay for itself at this size.
- **Schema-on-boot instead of a migration tool.** `CREATE TABLE IF NOT EXISTS` run once at
  startup. Fine while there's one schema shape and no migration history to sequence; not fine
  once a real schema change (rename, backfill) needs to happen safely against live data.
- **Auth is a static API key set from an env var**, not a user/key management system - there's
  no signup flow or concept of "whose key is this," which is consistent with this being an
  internal ops API rather than a multi-tenant product.
- **Rate limiter state lives in Postgres**, not Redis or in-process memory, so it survives
  restarts and stays correct across multiple instances - reusing the database the app already
  requires rather than adding new infrastructure. The real cost is discussed below.

## What I'd do differently with more time

- **Rate limiter throughput.** Putting it in Postgres was the right call for correctness
  (survives restarts, no new infra) but it puts a DB round trip on every single request,
  including `/evaluate` - the endpoint most likely to see real volume. If this needed to scale
  well past a few hundred req/sec, I'd move to Redis (`INCR`/Lua script, still O(1) and atomic)
  or an in-memory limiter per instance with periodic async reconciliation to a shared store,
  trading a little precision for not hitting the DB on every request.
- **A real migration tool** (e.g. `node-pg-migrate`) as soon as there's a second schema change
  to make against a database that already has data in it.
- **Real API key management** - issuing, rotating, and revoking keys, and scoping them (e.g.
  read-only vs. admin), instead of one static list from an env var.
- **`/health` doesn't check the database.** Right now it's a pure liveness check; for a service
  that's now stateful, a readiness check that verifies the DB connection would catch "process is
  up but can't actually serve traffic" during rollout.
- **Structured logging** (e.g. `pino`) shipped somewhere queryable, instead of `console.log` -
  fine for local dev, not for debugging a real incident.
- **Connection pool tuning** - currently using `pg`'s defaults (max 10 connections); worth
  sizing deliberately against expected concurrency once this sees real traffic.
