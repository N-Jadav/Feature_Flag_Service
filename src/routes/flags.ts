import { Router } from 'express';
import { createFlag, getFlag, listFlags, updateFlag, deleteFlag, isUniqueViolation } from '../store/flagStore';
import { isEnabledForCaller } from '../lib/rollout';
import { Flag } from '../types/flag';
import { apiKeyAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// CRUD is low-volume, admin-style traffic. /evaluate is the hot path client apps hit on every
// request, so it gets a much bigger bucket - it's the one endpoint that has to absorb bursts
// without tripping the limiter.
const standardLimiter = createRateLimiter({ name: 'standard', capacity: 20, refillPerSec: 10 });
const evaluateLimiter = createRateLimiter({ name: 'evaluate', capacity: 200, refillPerSec: 100 });

function isValidPercentage(n: unknown): n is number {
  return typeof n === 'number' && n >= 0 && n <= 100;
}

// Express 5 types req.params values as string | string[] to allow for repeatable path segments
// (e.g. /:key+). Our routes never use those, so this just narrows back to the plain string.
function paramKey(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

router.post('/flags', apiKeyAuth, standardLimiter, async (req, res) => {
  const { key, enabled, environment, rollout_percentage } = req.body ?? {};

  if (typeof key !== 'string' || key.trim() === '') {
    res.status(400).json({ error: 'key is required and must be a non-empty string' });
    return;
  }
  if (typeof environment !== 'string' || environment.trim() === '') {
    res.status(400).json({ error: 'environment is required and must be a non-empty string' });
    return;
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  if (rollout_percentage !== undefined && !isValidPercentage(rollout_percentage)) {
    res.status(400).json({ error: 'rollout_percentage must be a number between 0 and 100' });
    return;
  }

  const now = new Date().toISOString();
  const flag: Flag = {
    key,
    enabled: enabled ?? false,
    environment,
    rollout_percentage: rollout_percentage ?? 0,
    created_at: now,
    updated_at: now,
  };

  try {
    await createFlag(flag);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `flag with key "${key}" already exists` });
      return;
    }
    throw err;
  }
  res.status(201).json(flag);
});

router.get('/flags', apiKeyAuth, standardLimiter, async (req, res) => {
  const environment = req.query.environment;
  if (environment !== undefined && typeof environment !== 'string') {
    res.status(400).json({ error: 'environment must be a single string value' });
    return;
  }
  res.json(await listFlags(environment));
});

router.get('/flags/:key', apiKeyAuth, standardLimiter, async (req, res) => {
  const flag = await getFlag(paramKey(req.params.key));
  if (!flag) {
    res.status(404).json({ error: 'flag not found' });
    return;
  }
  res.json(flag);
});

router.patch('/flags/:key', apiKeyAuth, standardLimiter, async (req, res) => {
  const key = paramKey(req.params.key);

  const { enabled, environment, rollout_percentage } = req.body ?? {};
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }
  if (environment !== undefined && (typeof environment !== 'string' || environment.trim() === '')) {
    res.status(400).json({ error: 'environment must be a non-empty string' });
    return;
  }
  if (rollout_percentage !== undefined && !isValidPercentage(rollout_percentage)) {
    res.status(400).json({ error: 'rollout_percentage must be a number between 0 and 100' });
    return;
  }

  const updates: Partial<Flag> = {};
  if (enabled !== undefined) updates.enabled = enabled;
  if (environment !== undefined) updates.environment = environment;
  if (rollout_percentage !== undefined) updates.rollout_percentage = rollout_percentage;

  const updated = await updateFlag(key, updates);
  if (!updated) {
    res.status(404).json({ error: 'flag not found' });
    return;
  }
  res.json(updated);
});

router.delete('/flags/:key', apiKeyAuth, standardLimiter, async (req, res) => {
  if (!(await deleteFlag(paramKey(req.params.key)))) {
    res.status(404).json({ error: 'flag not found' });
    return;
  }
  res.status(204).send();
});

router.get('/evaluate/:key', apiKeyAuth, evaluateLimiter, async (req, res) => {
  const env = req.query.env;
  if (typeof env !== 'string' || env.trim() === '') {
    res.status(400).json({ error: 'env query parameter is required' });
    return;
  }

  const flag = await getFlag(paramKey(req.params.key));
  if (!flag || flag.environment !== env) {
    res.status(404).json({ error: 'flag not found for this key and environment' });
    return;
  }

  const callerId = typeof req.query.userId === 'string' ? req.query.userId : (req.ip ?? 'unknown');
  const enabled = isEnabledForCaller(flag, callerId);

  res.json({ key: flag.key, environment: flag.environment, enabled });
});

export default router;
