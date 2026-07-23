import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { TokenBucketLimiter } from './rateLimiter';
import { pool } from '../db/pool';
import { migrate } from '../db/migrate';

// Requires a reachable Postgres (DATABASE_URL, or the docker-compose default) - the whole point
// of this limiter is DB-backed persistence, so a real database is what proves it works.
before(async () => {
  await migrate();
});

after(async () => {
  await pool.query("DELETE FROM rate_limit_buckets WHERE key LIKE 'rate-limiter-test:%'");
  await pool.end();
});

test('allows requests up to capacity, then rejects', async () => {
  const limiter = new TokenBucketLimiter({ name: 'rate-limiter-test', capacity: 3, refillPerSec: 1 });
  const id = randomUUID();
  assert.equal((await limiter.tryConsume(id)).allowed, true);
  assert.equal((await limiter.tryConsume(id)).allowed, true);
  assert.equal((await limiter.tryConsume(id)).allowed, true);
  const fourth = await limiter.tryConsume(id);
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfterSec > 0);
});

test('keys are independent', async () => {
  const limiter = new TokenBucketLimiter({ name: 'rate-limiter-test', capacity: 1, refillPerSec: 1 });
  const a = randomUUID();
  const b = randomUUID();
  assert.equal((await limiter.tryConsume(a)).allowed, true);
  assert.equal((await limiter.tryConsume(a)).allowed, false);
  assert.equal((await limiter.tryConsume(b)).allowed, true);
});

test('refills over time up to capacity', async () => {
  const limiter = new TokenBucketLimiter({ name: 'rate-limiter-test', capacity: 2, refillPerSec: 100 });
  const id = randomUUID();
  assert.equal((await limiter.tryConsume(id)).allowed, true);
  assert.equal((await limiter.tryConsume(id)).allowed, true);
  assert.equal((await limiter.tryConsume(id)).allowed, false);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal((await limiter.tryConsume(id)).allowed, true);
});

test('state survives creating a fresh limiter instance (simulates a process restart)', async () => {
  const id = randomUUID();
  const beforeRestart = new TokenBucketLimiter({ name: 'rate-limiter-test', capacity: 1, refillPerSec: 0.001 });
  assert.equal((await beforeRestart.tryConsume(id)).allowed, true);

  // A new instance has no shared in-memory state with the one above - if this still denies the
  // same identity, the bucket lived in Postgres, not the process.
  const afterRestart = new TokenBucketLimiter({ name: 'rate-limiter-test', capacity: 1, refillPerSec: 0.001 });
  assert.equal((await afterRestart.tryConsume(id)).allowed, false);
});
