import { z } from 'zod';

/**
 * The chat endpoint's request contract.
 *
 * It once accepted the policy inputs that decide whether the tutor may reveal an
 * answer, first unchecked and later clamped. Section 41.1 is explicit that
 * clamping is a mitigation rather than a source of truth, so those fields are no
 * longer part of the contract at all: `mode`, `strictness`, `currentHintLevel`,
 * `grade`, the problem statement and the conversation transcript are read
 * server-side by `lib/session/policy-inputs.ts`.
 *
 * A request carrying them is not merely ignored, it is rejected, because a body
 * with a `strictness` field is either a stale client or an attack and both are
 * worth surfacing. That is stricter than section 29's "ignored, not sanitized",
 * and the sole caller was updated in the same change.
 */

export const STRICTNESS_VALUES = ['supportive', 'balanced', 'independence', 'assessment_safe'] as const;
/** Spec module 02 section 7 defines exactly four modes; `verify` is canonical, not `review`. */
export const MODE_VALUES = ['learn', 'practice', 'assignment', 'verify'] as const;

/** Level 7 is the full-solution rung of the hint ladder. */
export const MAX_HINT_LEVEL = 7;

/**
 * The values a client may never supply. Kept as a list so the schema and the
 * tests share one definition of the boundary.
 */
export const FORBIDDEN_REQUEST_FIELDS = [
  'sessionData',
  'priorTurns',
  'mode',
  'strictness',
  'currentHintLevel',
  'grade',
  'allowedHintLevel',
  'mayRevealFinalAnswer',
  'responsePlan',
  'rationaleCode',
  'policyVersion',
] as const;

export const chatRequestSchema = z
  .object({
    message: z.string().min(1).max(5000),
    sessionId: z.string().min(1).max(200),
  })
  .strict();

export type ChatRequest = z.infer<typeof chatRequestSchema>;
