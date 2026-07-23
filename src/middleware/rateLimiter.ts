import { Response, NextFunction } from 'express';
import { AuthedRequest } from './auth';
import { pool } from '../db/pool';

export interface TokenBucketOptions {
  name: string; // namespaces bucket keys so different limiter tiers don't share state
  capacity: number; // max burst size
  refillPerSec: number; // sustained rate
}

// The refill-and-consume happens as one UPDATE (or one INSERT..ON CONFLICT DO UPDATE for a new
// key), so it's atomic per row - Postgres locks the row for the statement's duration, so two
// concurrent requests for the same key can't both read a stale token count and over-consume.
// The row itself, not the process, is what's checked - so state survives a restart and stays
// correct across multiple server instances sharing the same database.
export class TokenBucketLimiter {
  constructor(private readonly options: TokenBucketOptions) {}

  async tryConsume(identity: string): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const key = `${this.options.name}:${identity}`;
    const { capacity, refillPerSec } = this.options;

    const result = await pool.query<{ tokens: number }>(
      `INSERT INTO rate_limit_buckets AS b (key, tokens, last_refill)
       VALUES ($1, $2::double precision - 1, now())
       ON CONFLICT (key) DO UPDATE
       SET tokens = LEAST($2::double precision, b.tokens + EXTRACT(EPOCH FROM (now() - b.last_refill)) * $3) - 1,
           last_refill = now()
       WHERE LEAST($2::double precision, b.tokens + EXTRACT(EPOCH FROM (now() - b.last_refill)) * $3) >= 1
       RETURNING tokens`,
      [key, capacity, refillPerSec]
    );

    if (result.rows[0]) {
      return { allowed: true, retryAfterSec: 0 };
    }

    // Denied - the UPDATE above never ran (its WHERE was false), so we don't have a fresh token
    // count to size Retry-After from. One extra read-only query, only on the denied path.
    const current = await pool.query<{ tokens: number }>(
      `SELECT LEAST($2::double precision, tokens + EXTRACT(EPOCH FROM (now() - last_refill)) * $3) AS tokens
       FROM rate_limit_buckets WHERE key = $1`,
      [key, capacity, refillPerSec]
    );
    const tokens = current.rows[0]?.tokens ?? 0;
    const deficit = Math.max(0, 1 - tokens);
    return { allowed: false, retryAfterSec: deficit / refillPerSec };
  }
}

export function createRateLimiter(options: TokenBucketOptions) {
  const limiter = new TokenBucketLimiter(options);

  return function rateLimiter(req: AuthedRequest, res: Response, next: NextFunction): void {
    const identity = req.apiKey ?? 'anonymous';
    limiter
      .tryConsume(identity)
      .then(({ allowed, retryAfterSec }) => {
        if (!allowed) {
          res.setHeader('Retry-After', Math.ceil(retryAfterSec).toString());
          res.status(429).json({ error: 'rate limit exceeded, try again later' });
          return;
        }
        next();
      })
      .catch(next);
  };
}
