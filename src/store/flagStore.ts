import { Flag } from '../types/flag';

// ponytail: in-memory Map, resets on restart. Swap for a real DB when flags need to survive a deploy.
const flags = new Map<string, Flag>();

export function createFlag(flag: Flag): void {
  flags.set(flag.key, flag);
}

export function getFlag(key: string): Flag | undefined {
  return flags.get(key);
}

export function listFlags(environment?: string): Flag[] {
  const all = [...flags.values()];
  return environment ? all.filter((f) => f.environment === environment) : all;
}

export function updateFlag(key: string, updates: Partial<Flag>): Flag | undefined {
  const existing = flags.get(key);
  if (!existing) return undefined;
  const updated: Flag = { ...existing, ...updates, updated_at: new Date().toISOString() };
  flags.set(key, updated);
  return updated;
}

export function deleteFlag(key: string): boolean {
  return flags.delete(key);
}

export function hasFlag(key: string): boolean {
  return flags.has(key);
}
