import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketLimiter } from './rateLimiter';

test('allows requests up to capacity, then rejects', () => {
  const limiter = new TokenBucketLimiter({ capacity: 3, refillPerSec: 1 });
  assert.equal(limiter.tryConsume('a').allowed, true);
  assert.equal(limiter.tryConsume('a').allowed, true);
  assert.equal(limiter.tryConsume('a').allowed, true);
  const fourth = limiter.tryConsume('a');
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfterSec > 0);
});

test('keys are independent', () => {
  const limiter = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
  assert.equal(limiter.tryConsume('a').allowed, true);
  assert.equal(limiter.tryConsume('a').allowed, false);
  assert.equal(limiter.tryConsume('b').allowed, true);
});

test('refills over time up to capacity', async () => {
  const limiter = new TokenBucketLimiter({ capacity: 2, refillPerSec: 100 });
  assert.equal(limiter.tryConsume('a').allowed, true);
  assert.equal(limiter.tryConsume('a').allowed, true);
  assert.equal(limiter.tryConsume('a').allowed, false);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(limiter.tryConsume('a').allowed, true);
});
