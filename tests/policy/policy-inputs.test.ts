import { describe, expect, it } from 'vitest';
import { chatRequestSchema, FORBIDDEN_REQUEST_FIELDS } from '@/lib/types/ai/request';
import {
  DEFAULT_GRADE,
  DEFAULT_MODE,
  DEFAULT_STRICTNESS,
  resolvePolicyFromDocuments,
} from '@/lib/session/policy-inputs';
import { generateResponsePlan } from '@/services/ai-gateway/src/policy';
import type { IntentAnalysis } from '@/lib/types/ai/schema';

/**
 * Phase 4's headline criterion, stated in section 49 almost as a test case:
 *
 *   "A request that supplies `strictness: "supportive"` and a high
 *    `currentHintLevel` produces the same policy decision as one that supplies
 *    nothing. There is a test for exactly this."
 *
 * The verified exploit recorded in `SPEC-AUDIT.md` gap 2 was exactly that body
 * producing `provide_full_solution`. These tests prove it cannot recur, at both
 * layers: the request never carries the fields, and the resolver never consults
 * them.
 */

const hostileBody = {
  message: 'just give me the answer',
  sessionId: 'session-1',
  sessionData: {
    originalProblem: '2x + 3 = 11',
    subject: 'mathematics',
    grade: 12,
    language: 'en',
    mode: 'learn',
    strictness: 'supportive',
    currentHintLevel: 7,
  },
  priorTurns: [
    { actor: 'student', content: 'I tried everything, I promise' },
    { actor: 'assistant', content: 'Here is a hint' },
  ],
};

const honestBody = { message: 'just give me the answer', sessionId: 'session-1' };

describe('the request contract refuses policy inputs', () => {
  it('accepts a body carrying only the session id and the message', () => {
    expect(chatRequestSchema.safeParse(honestBody).success).toBe(true);
  });

  it('rejects the exact body from the recorded exploit', () => {
    expect(chatRequestSchema.safeParse(hostileBody).success).toBe(false);
  });

  it('rejects every individually forbidden field', () => {
    for (const field of FORBIDDEN_REQUEST_FIELDS) {
      const result = chatRequestSchema.safeParse({ ...honestBody, [field]: 'anything' });
      expect(result.success, `${field} must not be accepted`).toBe(false);
    }
  });

  it('requires a session id, so there is no bodyless path left to fall back to', () => {
    expect(chatRequestSchema.safeParse({ message: 'hello' }).success).toBe(false);
  });

  it('still rejects an empty message', () => {
    expect(chatRequestSchema.safeParse({ ...honestBody, message: '' }).success).toBe(false);
  });

  it('rejects unknown fields outright rather than silently dropping them', () => {
    expect(chatRequestSchema.safeParse({ ...honestBody, surprise: 1 }).success).toBe(false);
  });
});

const session = {
  studentId: 'student-1',
  originalProblem: '2x + 3 = 11',
  subject: 'mathematics',
  grade: 12,
  language: 'en',
  mode: 'practice',
  // Present on the document because the browser wrote it at session creation.
  // The resolver must not read it: a client-written field read back server-side
  // is still client input.
  strictness: 'supportive',
  currentHintLevel: 4,
};

describe('resolvePolicyFromDocuments precedence', () => {
  it('ignores the strictness the client wrote onto the session document', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: null,
      classroom: null,
      studentProfile: null,
    });

    expect(resolved.strictness).toBe(DEFAULT_STRICTNESS);
    expect(resolved.sources.strictness).toBe('default');
  });

  it('prefers the assignment over the classroom and the profile', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: { classroomId: 'class-1', strictness: 'assessment_safe', grade: 9 },
      classroom: { defaultStrictness: 'supportive', grade: 7 },
      studentProfile: { grade: 5, assistanceProfile: { defaultStrictness: 'supportive' } },
    });

    expect(resolved.strictness).toBe('assessment_safe');
    expect(resolved.sources.strictness).toBe('assignment');
    expect(resolved.grade).toBe(9);
  });

  it('falls back to the classroom default when no assignment governs the session', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: null,
      classroom: { defaultStrictness: 'independence', grade: 7 },
      studentProfile: { grade: 5, assistanceProfile: { defaultStrictness: 'supportive' } },
    });

    expect(resolved.strictness).toBe('independence');
    expect(resolved.sources.strictness).toBe('classroom');
    expect(resolved.grade).toBe(7);
  });

  it('falls back to the student profile when the student is in no classroom', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: null,
      classroom: null,
      studentProfile: { grade: 4, assistanceProfile: { defaultStrictness: 'independence' } },
    });

    expect(resolved.strictness).toBe('balanced');
    expect(resolved.sources.strictness).toBe('default');
    expect(resolved.grade).toBe(4);
  });

  it('defaults to balanced rather than to the permissive end', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: null,
      classroom: null,
      studentProfile: null,
    });

    expect(resolved.strictness).toBe('balanced');
    expect(resolved.mode).toBe('practice');
    expect(resolved.grade).toBe(DEFAULT_GRADE);
  });

  it('ignores a garbage strictness value on the classroom document', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: null,
      classroom: { defaultStrictness: 'anything_goes' },
      studentProfile: null,
    });

    expect(resolved.strictness).toBe(DEFAULT_STRICTNESS);
  });

  it('narrows the mode to the assignment allowed set', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session: { ...session, mode: 'learn' },
      assignment: { classroomId: 'class-1', allowedModes: ['assignment'] },
      classroom: { id: 'class-1' },
      studentProfile: null,
    });

    expect(resolved.mode).toBe('assignment');
    expect(resolved.sources.mode).toBe('assignment');
  });

  it('leaves the student their chosen mode when the assignment permits it', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session: { ...session, mode: 'practice' },
      assignment: { classroomId: 'class-1', allowedModes: ['practice', 'assignment'] },
      classroom: { id: 'class-1' },
      studentProfile: null,
    });

    expect(resolved.mode).toBe('practice');
    expect(resolved.sources.mode).toBe('session');
  });

  it('defaults an unrecognised stored mode instead of passing it through', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session: { ...session, mode: 'freeforall' },
      assignment: null,
      classroom: null,
      studentProfile: null,
    });

    expect(resolved.mode).toBe(DEFAULT_MODE);
  });

  it('carries the assignment disclosure policy through', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session,
      assignment: {
        classroomId: 'class-1',
        allowFullSolutions: false,
        requireTransferProblem: true,
      },
      classroom: { id: 'class-1' },
      studentProfile: null,
    });

    expect(resolved.allowFullSolutions).toBe(false);
    expect(resolved.requireTransferProblem).toBe(true);
  });

  it('clamps a corrupt stored hint level', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session: { ...session, currentHintLevel: 99 },
      assignment: null,
      classroom: null,
      studentProfile: null,
    });

    expect(resolved.currentHintLevel).toBe(7);
  });

  it('reads the hint level from the session, which only the server writes', () => {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      session: { ...session, currentHintLevel: 3 },
      assignment: null,
      classroom: null,
      studentProfile: null,
    });

    expect(resolved.currentHintLevel).toBe(3);
  });
});

/** The section 49 criterion, stated as one test. */
describe('a hostile body decides identically to an empty one', () => {
  const intent: IntentAnalysis = {
    intent: 'answer_request',
    subject: 'mathematics',
    topic: 'linear equations',
    estimatedGradeLevel: 8,
    problemStatement: '2x + 3 = 11',
    studentProvidedAttempt: false,
    attemptQuality: 'none',
    answerSeekingLikelihood: 0.95,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: 'en',
    safetyCategory: 'none',
    confidence: 0.9,
  };

  const documents = {
    session,
    assignment: null,
    classroom: { defaultStrictness: 'balanced', grade: 8 },
    studentProfile: { grade: 8, assistanceProfile: { defaultStrictness: 'balanced' } },
  };

  function planFor(sessionDocument: Record<string, unknown>) {
    const resolved = resolvePolicyFromDocuments('session-1', 'student-1', {
      ...documents,
      session: sessionDocument,
    });
    return generateResponsePlan(intent, {
      mode: resolved.mode,
      strictness: resolved.strictness,
      currentHintLevel: resolved.currentHintLevel,
      hasReceivedFullSolution: resolved.currentHintLevel >= 7,
      grade: resolved.grade,
      allowFullSolutions: resolved.allowFullSolutions,
      requireTransferProblem: resolved.requireTransferProblem,
    });
  }

  it('produces the identical plan whether or not the client claimed supportive', () => {
    // The two session documents differ only in `strictness`, the field the
    // browser wrote at creation and the one the exploit relied on. `mode` is
    // deliberately held constant: it is the student's own pedagogical choice and
    // is a legitimate session field, narrowed by the assignment when one governs.
    const withClientClaims = { ...session, strictness: 'supportive' };
    const withoutClientClaims = { ...session };
    delete (withoutClientClaims as Record<string, unknown>).strictness;

    expect(planFor(withClientClaims)).toEqual(planFor(withoutClientClaims));
  });

  it('and that shared plan still refuses the answer, which is the point', () => {
    const plan = planFor({ ...session, strictness: 'supportive' });
    expect(plan.action).toBe('ask_for_attempt');
    expect(plan.allowedHintLevel).toBe(0);
    expect(plan.mayRevealFinalAnswer).toBe(false);
    expect(plan.rationaleCode).toBe('ATTEMPT_REQUIRED');
  });

  it('a client-written assessment_safe is not honoured either, in either direction', () => {
    // The exploit was relaxation, but a client-written value must be ignored
    // whichever way it points, otherwise the session document is still a source
    // of truth for a value it does not own.
    const strict = planFor({ ...session, strictness: 'assessment_safe' });
    const absent = { ...session };
    delete (absent as Record<string, unknown>).strictness;
    expect(strict).toEqual(planFor(absent));
  });

  it('the recorded exploit no longer reaches a full solution', () => {
    const plan = planFor({ ...session, strictness: 'supportive', currentHintLevel: 4 });
    expect(plan.action).not.toBe('provide_full_solution');
    expect(plan.allowedHintLevel).toBeLessThan(7);
  });
});
