// Plain "run this at boot" schema instead of a migration framework - there's exactly one table
// and no migration history to manage yet. Reach for something like node-pg-migrate when there's
// a second schema change to sequence.
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS flags (
    key TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false,
    environment TEXT NOT NULL,
    rollout_percentage INTEGER NOT NULL DEFAULT 0
      CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_flags_environment ON flags (environment);

  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key TEXT PRIMARY KEY,
    tokens DOUBLE PRECISION NOT NULL,
    last_refill TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;
