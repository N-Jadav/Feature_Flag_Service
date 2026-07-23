import { pool } from '../db/pool';
import { Flag } from '../types/flag';

interface FlagRow {
  key: string;
  enabled: boolean;
  environment: string;
  rollout_percentage: number;
  created_at: Date;
  updated_at: Date;
}

function toFlag(row: FlagRow): Flag {
  return {
    key: row.key,
    enabled: row.enabled,
    environment: row.environment,
    rollout_percentage: row.rollout_percentage,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function createFlag(flag: Flag): Promise<void> {
  await pool.query(
    `INSERT INTO flags (key, enabled, environment, rollout_percentage, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [flag.key, flag.enabled, flag.environment, flag.rollout_percentage, flag.created_at, flag.updated_at]
  );
}

export async function getFlag(key: string): Promise<Flag | undefined> {
  const result = await pool.query<FlagRow>('SELECT * FROM flags WHERE key = $1', [key]);
  return result.rows[0] ? toFlag(result.rows[0]) : undefined;
}

export async function listFlags(environment?: string): Promise<Flag[]> {
  const result = environment
    ? await pool.query<FlagRow>('SELECT * FROM flags WHERE environment = $1 ORDER BY key', [environment])
    : await pool.query<FlagRow>('SELECT * FROM flags ORDER BY key');
  return result.rows.map(toFlag);
}

// Single UPDATE ... RETURNING instead of read-then-write - avoids a race where a concurrent
// delete or update between the read and write would silently resurrect or clobber fields.
export async function updateFlag(key: string, updates: Partial<Flag>): Promise<Flag | undefined> {
  const result = await pool.query<FlagRow>(
    `UPDATE flags
     SET enabled = COALESCE($2, enabled),
         environment = COALESCE($3, environment),
         rollout_percentage = COALESCE($4, rollout_percentage),
         updated_at = now()
     WHERE key = $1
     RETURNING *`,
    [key, updates.enabled ?? null, updates.environment ?? null, updates.rollout_percentage ?? null]
  );
  return result.rows[0] ? toFlag(result.rows[0]) : undefined;
}

export async function deleteFlag(key: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM flags WHERE key = $1', [key]);
  return (result.rowCount ?? 0) > 0;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
