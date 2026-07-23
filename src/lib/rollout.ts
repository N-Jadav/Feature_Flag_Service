import { createHash } from 'crypto';
import { Flag } from '../types/flag';

// Stable bucket 0-99 for a given input string - same input always maps to the same bucket.
export function bucketFor(input: string): number {
  const hash = createHash('md5').update(input).digest();
  return hash.readUInt32BE(0) % 100;
}

export function isEnabledForCaller(flag: Flag, callerId: string): boolean {
  if (!flag.enabled) return false;
  if (flag.rollout_percentage >= 100) return true;
  if (flag.rollout_percentage <= 0) return false;
  return bucketFor(`${flag.key}:${callerId}`) < flag.rollout_percentage;
}
