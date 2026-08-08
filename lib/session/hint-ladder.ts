import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';

/**
 * A stored level outside the ladder is data corruption, not a request to skip
 * ahead, so it is clamped rather than trusted.
 *
 * `resolveSessionHintLevel` used to live here. It reconciled a client-claimed
 * level against the stored one, bounding the claim by the number of assistant
 * turns when no session had been read. That fallback path is gone: `sessionId` is
 * now required and the level is always read from the session document, so there
 * is no client claim left to reconcile. Removed in session 08 rather than left as
 * an unused export, per section 52.2 item 1.
 */
export function clampToLadder(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), MAX_HINT_LEVEL);
}

/**
 * The level to persist after a turn.
 *
 * The policy engine's `allowedHintLevel` is the ceiling, not the model's
 * self-reported `hintLevel`: a model that overstates what it gave must not be
 * able to ratchet the session forward. The level never decreases, so help a
 * student has already received stays visible to scoring and to teachers.
 */
export function nextHintLevel(currentLevel: number, allowedHintLevel: number): number {
  return clampToLadder(Math.max(clampToLadder(currentLevel), clampToLadder(allowedHintLevel)));
}
