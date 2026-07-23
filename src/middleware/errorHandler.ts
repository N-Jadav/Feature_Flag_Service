import { Request, Response, NextFunction } from 'express';

// Express 5 forwards rejected promises from async route handlers here automatically.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
}
