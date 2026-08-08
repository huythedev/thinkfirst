import { describe, expect, it } from 'vitest';
import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import { clampToLadder, nextHintLevel } from '@/lib/session/hint-ladder';

/**
 * The hint ladder decides how much of an answer a student may receive, so these
 * tests are about what a *hostile* client cannot achieve, not about the happy
 * path.
 *
 * The `resolveSessionHintLevel` tests that used to live here were removed in
 * session 08 along with the function. It reconciled a client-claimed level with
 * the stored one; the request body no longer carries a level to reconcile, so the
 * claim side of that boundary is now proven by
 * `tests/policy/policy-inputs.test.ts` rejecting the field outright.
 */
describe('clampToLadder', () => {
  it('holds a valid level unchanged', () => {
    expect(clampToLadder(3)).toBe(3);
  });

  it('clamps a corrupt stored value into the ladder', () => {
    expect(clampToLadder(99)).toBe(MAX_HINT_LEVEL);
    expect(clampToLadder(-3)).toBe(0);
  });

  it('treats a non-finite value as the bottom of the ladder', () => {
    expect(clampToLadder(Number.NaN)).toBe(0);
    expect(clampToLadder(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('truncates a fractional level rather than rounding upward', () => {
    expect(clampToLadder(3.9)).toBe(3);
  });
});

describe('nextHintLevel', () => {
  it('advances to the level the policy engine allowed', () => {
    expect(nextHintLevel(2, 3)).toBe(3);
  });

  it('never moves backwards, so help already given stays on the record', () => {
    expect(nextHintLevel(5, 0)).toBe(5);
  });

  it('is capped at the full-solution rung', () => {
    expect(nextHintLevel(7, 99)).toBe(MAX_HINT_LEVEL);
  });

  it('holds position when the plan allows no advance', () => {
    expect(nextHintLevel(3, 3)).toBe(3);
  });
});