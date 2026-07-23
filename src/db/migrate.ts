import { pool } from './pool';
import { SCHEMA_SQL } from './schema';

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
