import { describe, it, expect } from 'vitest';
import { resolvePolicyFromDocuments } from '@/lib/session/policy-inputs';
import { generateResponsePlan } from '@/services/ai-gateway/src/policy';
import {
  LOW_EXTRACTION_CONFIDENCE_THRESHOLD,
  requiresExtractionConfirmation,
} from '@/lib/images/confidence';
import type { IntentAnalysis } from '@/lib/types/ai/schema';

/**
 * Phase 7 exit criterion: "Tutoring cannot begin on low-confidence extraction
 * without confirmation, and there is a test."
 *
 * `tests/policy/section-18-rules.test.ts` already covers rule R6 as a pure
 * function, and it passed for three phases while the rule was unreachable:
 * nothing built a `PolicyInput` with `extractionConfidence` set, so no real
 * request could ever take the branch. A test that calls the branch directly
 * cannot detect that.
 *
 * These tests therefore start one level out, from the Firestore documents, and
 * run the same resolve-then-plan sequence `app/api/session/chat/route.ts`
 * performs. That is what makes them regression tests for reachability rather
 * than for arithmetic.
 */

const STUDENT = 'student-1';

function intent(overrides: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return {
    intent: 'problem_solving',
    subject: 'mathematics',
    topic: 'quadratics',
    estimatedGradeLevel: 9,
    problemStatement: 'Solve x^2 - 5x + 6 = 0',
    studentProvidedAttempt: true,
    attemptQuality: 'meaningful',
    answerSeekingLikelihood: 0.1,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: 'en',
    safetyCategory: 'none',
    confidence: 0.9,
    ...overrides,
  };
}

function sessionDoc(overrides: Record<string, unknown> = {}) {
  return {
    studentId: STUDENT,
    subject: 'mathematics',
    grade: 9,
    language: 'en',
    mode: 'practice',
    status: 'active',
    originalProblem: 'Solve x^2 - 5x + 6 = 0',
    currentHintLevel: 3,
    imageId: 'image-1',
    ...overrides,
  };
}

function imageDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'image-1',
    studentId: STUDENT,
    extractedText: 'Solve x^2 - 5x + 6 = 0',
    extractionConfidence: 0.42,
    confirmationStatus: 'required',
    confirmedText: null,
    ...overrides,
  };
}

/** The exact sequence the chat endpoint runs, so the test exercises the real path. */
function planFor(documents: {
  session: Record<string, unknown>;
  problemImage?: Record<string, unknown> | null;
}) {
  const resolved = resolvePolicyFromDocuments('session-1', STUDENT, {
    session: documents.session,
    assignment: null,
    classroom: null,
    studentProfile: null,
    problemImage: documents.problemImage ?? null,
  });

  const plan = generateResponsePlan(intent(), {
    mode: resolved.mode,
    strictness: resolved.strictness,
    currentHintLevel: resolved.currentHintLevel,
    hasReceivedFullSolution: false,
    grade: resolved.grade,
    allowFullSolutions: resolved.allowFullSolutions,
    requireTransferProblem: resolved.requireTransferProblem,
    extractionConfidence: resolved.extractionConfirmed
      ? undefined
      : resolved.extractionConfidence,
  });

  return { resolved, plan };
}

describe('the confirmation threshold has one definition', () => {
  it('treats a value below the threshold as requiring confirmation', () => {
    expect(requiresExtractionConfirmation(0.69)).toBe(true);
    expect(requiresExtractionConfirmation(0)).toBe(true);
  });

  it('treats the threshold itself and above as confident', () => {
    expect(requiresExtractionConfirmation(LOW_EXTRACTION_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(requiresExtractionConfirmation(0.95)).toBe(false);
  });

  it('treats an absent or malformed confidence as requiring confirmation', () => {
    // Unknown confidence is not high confidence.
    expect(requiresExtractionConfirmation(undefined)).toBe(true);
    expect(requiresExtractionConfirmation(null)).toBe(true);
    expect(requiresExtractionConfirmation('0.99')).toBe(true);
    expect(requiresExtractionConfirmation(Number.NaN)).toBe(true);
  });
});

describe('tutoring cannot begin on an unconfirmed low-confidence extraction', () => {
  it('blocks disclosure and asks the student to confirm', () => {
    const { plan } = planFor({ session: sessionDoc(), problemImage: imageDoc() });

    expect(plan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(plan.action).toBe('clarify_problem');
    expect(plan.allowedHintLevel).toBe(0);
    expect(plan.mayRevealFinalAnswer).toBe(false);
    expect(plan.requiresStudentResponse).toBe(true);
  });

  it('holds the student at level 0 even from an advanced position on the ladder', () => {
    // The session sits at hint level 3. Without R6 the plan would continue from
    // there; an unconfirmed extraction means the problem itself is in doubt, so
    // the ladder position is irrelevant until it is settled.
    const { resolved, plan } = planFor({
      session: sessionDoc({ currentHintLevel: 3 }),
      problemImage: imageDoc(),
    });

    expect(resolved.currentHintLevel).toBe(3);
    expect(plan.allowedHintLevel).toBe(0);
  });

  it('blocks when the image carries no confidence value at all', () => {
    // A malformed or partially written image document must not read as
    // "typed problem, no image", which would skip the rule entirely.
    const { plan } = planFor({
      session: sessionDoc(),
      problemImage: imageDoc({ extractionConfidence: undefined }),
    });

    expect(plan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
  });

  it('blocks when extraction failed outright', () => {
    const { plan } = planFor({
      session: sessionDoc(),
      problemImage: imageDoc({ extractionConfidence: 0, extractedText: '' }),
    });

    expect(plan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
  });
});

describe('confirmation releases the block', () => {
  it('tutors normally once the student has confirmed the text', () => {
    const { plan } = planFor({
      session: sessionDoc(),
      problemImage: imageDoc({
        confirmationStatus: 'confirmed',
        confirmedText: 'Solve x^2 - 5x + 6 = 0',
      }),
    });

    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(plan.allowedHintLevel).toBeGreaterThan(0);
  });

  it('uses the corrected text the student confirmed, not the misread extraction', () => {
    const { resolved } = planFor({
      session: sessionDoc({ originalProblem: 'Solve x^2 - 5x + 8 = O' }),
      problemImage: imageDoc({
        extractedText: 'Solve x^2 - 5x + 8 = O',
        confirmationStatus: 'confirmed',
        confirmedText: 'Solve x^2 - 5x + 6 = 0',
      }),
    });

    expect(resolved.originalProblem).toBe('Solve x^2 - 5x + 6 = 0');
  });

  it('does not require confirmation for a high-confidence extraction', () => {
    const { plan } = planFor({
      session: sessionDoc(),
      problemImage: imageDoc({ extractionConfidence: 0.94, confirmationStatus: 'not_required' }),
    });

    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
  });
});

describe('the confidence cannot be supplied by the client', () => {
  it('ignores a confidence written onto the session document', () => {
    // The browser creates `learningSessions`, so anything it writes there is
    // client input. A session claiming high confidence must not release R6; the
    // value is only read from `problemImages`, which no client can write.
    const { resolved, plan } = planFor({
      session: sessionDoc({
        extractionConfidence: 0.99,
        confirmationStatus: 'confirmed',
        extractionConfirmed: true,
      }),
      problemImage: imageDoc(),
    });

    expect(resolved.extractionConfidence).toBe(0.42);
    expect(plan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
  });

  it('ignores an image belonging to another student', () => {
    // Pointing a session at someone else's confirmed image must not inherit its
    // confirmation. The borrowed document is dropped entirely, which leaves no
    // image and no confidence rather than a usable one.
    const { resolved } = planFor({
      session: sessionDoc(),
      problemImage: imageDoc({
        studentId: 'student-2',
        extractionConfidence: 0.99,
        confirmationStatus: 'confirmed',
        confirmedText: 'Someone else problem',
      }),
    });

    expect(resolved.extractionConfidence).toBeUndefined();
    expect(resolved.originalProblem).toBe('Solve x^2 - 5x + 6 = 0');
  });

  it('leaves a typed problem completely unaffected', () => {
    const { resolved, plan } = planFor({
      session: sessionDoc({ imageId: undefined }),
      problemImage: null,
    });

    expect(resolved.extractionConfidence).toBeUndefined();
    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
  });
});
