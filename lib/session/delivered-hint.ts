import type { TutorResponse, TutorResponsePlan } from '@/lib/types/ai/schema';
import { nextHintLevel } from '@/lib/session/hint-ladder';

/**
 * Computes progress from assistance that reached the student, never from a plan
 * ceiling or the model's self-reported metadata.  The withheld fallback is a
 * request for the student's work, not a mathematical hint, so it consumes no
 * rung even when the candidate would have been permitted to do so.
 */
export function effectiveHintLevelAfterDelivery(input: {
  previousHintLevel: number;
  responsePlan: TutorResponsePlan;
  deliveredResponse: TutorResponse;
  messageWithheld: boolean;
}): number {
  if (input.messageWithheld) return input.previousHintLevel;

  return nextHintLevel(
    input.previousHintLevel,
    Math.min(input.deliveredResponse.hintLevel, input.responsePlan.allowedHintLevel),
  );
}
