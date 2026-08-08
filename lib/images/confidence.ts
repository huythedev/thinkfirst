/**
 * The extraction-confidence threshold, in one place.
 *
 * Three surfaces need this decision and they must not be able to disagree: the
 * policy engine (rule R6, which blocks tutoring), the upload route (which stamps
 * `confirmationStatus` on the image document), and the workspace UI (which shows
 * the confirmation prompt). Written out three times, it drifts in two of them,
 * and the failure is invisible -- the UI would stop asking for confirmation
 * while the policy engine kept refusing to tutor, or worse, the reverse.
 *
 * This is the same extraction as `mayDisplayScore` in Phase 5, for the same
 * reason: a threshold is a rule, and a rule needs one implementation and a test.
 */

/**
 * Below this, section 34 step 10 requires the student to confirm the extracted
 * text before tutoring begins.
 *
 * The comparison is strictly less-than, so a value exactly at the threshold
 * passes. Stated here rather than left to each caller's `<` or `<=`, because
 * that is precisely the kind of difference that survives review.
 */
export const LOW_EXTRACTION_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Whether an extraction must be confirmed before tutoring may begin.
 *
 * A missing or malformed confidence returns `true`. Unknown confidence is not
 * high confidence: the safe direction is one extra confirmation tap, and the
 * unsafe direction is a tutor working confidently on text nobody checked.
 */
export function requiresExtractionConfirmation(confidence: unknown): boolean {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return true;
  return confidence < LOW_EXTRACTION_CONFIDENCE_THRESHOLD;
}
