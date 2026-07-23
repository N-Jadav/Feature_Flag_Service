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
npm test        # run unit tests (node:test, covers rollout hashing + rate limiter)
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

## Endpointsc

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
