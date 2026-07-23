import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketFor, isEnabledForCaller } from './rollout';
import { Flag } from '../types/flag';

const baseFlag: Flag = {
  key: 'new-checkout-flow',
  enabled: true,
  environment: 'prod',
  rollout_percentage: 50,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

test('bucketFor is deterministic for the same input', () => {
  assert.equal(bucketFor('a'), bucketFor('a'));
});

test('bucketFor stays within 0-99', () => {
  for (const input of ['a', 'b', 'c', 'user-123', 'user-456']) {
    const bucket = bucketFor(input);
    assert.ok(bucket >= 0 && bucket < 100);
  }
});

test('disabled flag is never enabled regardless of rollout', () => {
  assert.equal(isEnabledForCaller({ ...baseFlag, enabled: false, rollout_percentage: 100 }, 'user-1'), false);
});

test('rollout_percentage 0 is always off', () => {
  assert.equal(isEnabledForCaller({ ...baseFlag, rollout_percentage: 0 }, 'user-1'), false);
});

test('rollout_percentage 100 is always on', () => {
  assert.equal(isEnabledForCaller({ ...baseFlag, rollout_percentage: 100 }, 'user-1'), true);
});

test('same caller gets the same result on repeated evaluation', () => {
  const first = isEnabledForCaller(baseFlag, 'user-42');
  const second = isEnabledForCaller(baseFlag, 'user-42');
  assert.equal(first, second);
});
