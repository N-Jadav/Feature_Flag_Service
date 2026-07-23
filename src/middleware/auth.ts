import { Request, Response, NextFunction } from 'express';

// ponytail: keys read from env, comma-separated. Swap for a real key table when you need per-key
// scopes, rotation, or revocation without a redeploy.
const validKeys = new Set(
  (process.env.API_KEYS ?? 'dev-key-123')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
);

export interface AuthedRequest extends Request {
  apiKey?: string;
}

export function apiKeyAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const key = req.header('x-api-key');
  if (!key || !validKeys.has(key)) {
    res.status(401).json({ error: 'missing or invalid API key' });
    return;
  }
  req.apiKey = key;
  next();
}
