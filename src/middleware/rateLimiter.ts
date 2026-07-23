import { Response, NextFunction } from 'express';
import { AuthedRequest } from './auth';

interface Bucket {
  tokens: number;
  lastRefill: number; // ms since epoch
}

export interface TokenBucketOptions {
  capacity: number; // max burst size
  refillPerSec: number; // sustained rate
}

// Plain token bucket, no timers - refills lazily based on elapsed time at request arrival.
// O(1) per check, so it holds up under load; the only per-key state is a {tokens, lastRefill} pair.
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: TokenBucketOptions) {}

  tryConsume(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.options.capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.options.capacity, bucket.tokens + elapsedSec * this.options.refillPerSec);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSec: 0 };
    }

    const deficit = 1 - bucket.tokens;
    return { allowed: false, retryAfterSec: deficit / this.options.refillPerSec };
  }
}

export function createRateLimiter(options: TokenBucketOptions) {
  const limiter = new TokenBucketLimiter(options);

  return function rateLimiter(req: AuthedRequest, res: Response, next: NextFunction): void {
    const key = req.apiKey ?? 'anonymous';
    const { allowed, retryAfterSec } = limiter.tryConsume(key);

    if (!allowed) {
      res.setHeader('Retry-After', Math.ceil(retryAfterSec).toString());
      res.status(429).json({ error: 'rate limit exceeded, try again later' });
      return;
    }

    next();
  };
}
