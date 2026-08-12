import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Does the tutoring endpoint *consume* the safety classification?
 *
 * This is the Phase 8 criterion, and it is deliberately tested against the real
 * route handler rather than a mirror of its logic. The existing coverage in
 * `tests/policy/section-18-rules.test.ts` proves `generateResponsePlan` returns
 * `safety_redirect`, and it passed happily while the route took that plan, called
 * the tutor model anyway, and shipped whatever came back. A pure-function test
 * cannot see what its caller does with the result — the same trap Phase 7 hit with
 * rule R6, recorded then and applicable again.
 *
 * So every collaborator is mocked and the handler itself is imported. The
 * load-bearing assertion is that the tutor model is never called: not a proxy for
 * correct behavior, but the behavior itself, since a model call is exactly what
 * puts the most sensitive response in the application on the far side of a trust
 * boundary.
 */

const verifyRequest = vi.fn();
const resolvePolicyInputs = vi.fn();
const loadTranscript = vi.fn();
const generateContent = vi.fn();
const checkRateLimit = vi.fn();
const recordSafetyEvent = vi.fn();
const recordLearningEvidenceProbe = vi.fn();
const turnSet = vi.fn();
const sessionUpdate = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContent(...args) };
  },
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    INTEGER: 'INTEGER',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
    ARRAY: 'ARRAY',
  },
}));

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: (...args: unknown[]) => verifyRequest(...args),
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: {},
  adminDb: {
    collection: (name: string) => {
      const coll = {
        doc: (id?: string) => ({
          id: id ?? 'generated-turn-id',
          set: (data: unknown) => {
            turnSet(name, data);
            return Promise.resolve();
          },
          update: (data: unknown) => {
            sessionUpdate(name, data);
            return Promise.resolve();
          },
        }),
        add: () => Promise.resolve({ id: 'generated-id' }),
        where: () => coll,
        get: () => Promise.resolve({ empty: true, docs: [] }),
      };
      return coll;
    },
    runTransaction: async (callback: (transaction: any) => unknown) => callback({
      get: async () => ({ exists: true, data: () => ({ status: 'active' }) }),
      set: (ref: { set: (data: unknown) => Promise<unknown> }, data: unknown) => ref.set(data),
      update: (ref: { update: (data: unknown) => Promise<unknown> }, data: unknown) => ref.update(data),
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}));

vi.mock('@/lib/session/policy-inputs', () => ({
  resolvePolicyInputs: (...args: unknown[]) => resolvePolicyInputs(...args),
  loadTranscript: (...args: unknown[]) => loadTranscript(...args),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  RATE_LIMITS: { tutorChat: { operation: 'tutor-chat', user: { limit: 12, windowSeconds: 60 }, ip: { limit: 60, windowSeconds: 60 } } },
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
  rateLimitHeaders: () => ({ 'Retry-After': '30' }),
}));

vi.mock('@/lib/safety/safety-event', () => ({
  recordSafetyEvent: (...args: unknown[]) => {
    return recordSafetyEvent(...args);
  },
}));

// The evidence pipeline. Every export is stubbed so that *any* call to it shows up
// as a failed expectation rather than a network attempt.
vi.mock('@/lib/session/evaluation', () => ({
  evaluateAttempt: (...args: unknown[]) => {
    recordLearningEvidenceProbe('evaluateAttempt', ...args);
    return Promise.resolve({ available: false, evaluation: null, modelName: 'stub' });
  },
  generateTransferProblem: (...args: unknown[]) => {
    recordLearningEvidenceProbe('generateTransferProblem', ...args);
    return Promise.resolve(null);
  },
  recordAttemptEvaluation: (...args: unknown[]) => {
    recordLearningEvidenceProbe('recordAttemptEvaluation', ...args);
    return Promise.resolve();
  },
  resolveTransferOutcome: (...args: unknown[]) => {
    recordLearningEvidenceProbe('resolveTransferOutcome', ...args);
    return Promise.resolve(null);
  },
}));

vi.mock('@/lib/scoring/server', () => ({
  persistSessionEvidence: (...args: unknown[]) => {
    recordLearningEvidenceProbe('persistSessionEvidence', ...args);
    return Promise.resolve(null);
  },
}));

const { POST } = await import('@/app/api/session/chat/route');

const POLICY = {
  mode: 'practice' as const,
  strictness: 'balanced' as const,
  currentHintLevel: 4,
  grade: 8,
  language: 'en' as const,
  subject: 'mathematics',
  originalProblem: 'Solve for x: 3x + 7 = 22',
  allowFullSolutions: true,
  requireTransferProblem: false,
  extractionConfidence: undefined,
  extractionConfirmed: true,
  sources: {},
};

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/session/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Queues the classifier reply; the tutor call, if it happens, gets a marker. */
function classifierReturns(safetyCategory: string, confidence = 0.9) {
  generateContent.mockImplementation(() =>
    Promise.resolve({
      text: JSON.stringify({
        intent: safetyCategory === 'none' ? 'problem_solving' : 'unsafe',
        subject: 'mathematics',
        topic: 'linear equations',
        estimatedGradeLevel: 8,
        problemStatement: 'Solve for x: 3x + 7 = 22',
        studentProvidedAttempt: false,
        attemptQuality: 'none',
        answerSeekingLikelihood: 0.2,
        ambiguityLevel: 'low',
        missingInformation: [],
        detectedLanguage: 'en',
        safetyCategory,
        confidence,
      }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyRequest.mockResolvedValue({
    uid: 'student-1',
    missingToken: false,
    verificationUnavailable: false,
  });
  checkRateLimit.mockResolvedValue({
    allowed: true,
    scope: null,
    remaining: 5,
    retryAfterSeconds: 0,
    limit: 12,
    unavailable: false,
  });
  recordSafetyEvent.mockResolvedValue(true);
  resolvePolicyInputs.mockResolvedValue({ status: 'ok', inputs: POLICY });
  loadTranscript.mockResolvedValue([
    { actor: 'student', content: 'I need help', sequence: 1 },
  ]);
});

describe('the endpoint consumes the safety classification', () => {
  it('never calls the tutor model on a self-harm disclosure', async () => {
    classifierReturns('self_harm');

    const response = await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    expect(response.status).toBe(200);
    // Exactly one model call: the classifier. The tutor is not consulted.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('returns the deterministic safety message with support guidance', async () => {
    classifierReturns('self_harm');

    const response = await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.tutorData.responseType).toBe('safety_message');
    expect(body.tutorData.messageMarkdown).toContain('adult you trust');
    expect(body.tutorData.finalAnswerIncluded).toBe(false);
    expect(body.tutorData.hintLevel).toBe(0);
    expect(body.safety.responseClass).toBe('emergency_guidance');
    expect(body.safety.reviewRequested).toBe(true);
    expect(body.safety.reviewRecorded).toBe(true);
  });

  it('records a safety event for the disclosure', async () => {
    classifierReturns('abuse', 0.82);

    await POST(request({ message: 'someone is hurting me', sessionId: 's1' }) as never);

    expect(recordSafetyEvent).toHaveBeenCalledTimes(1);
    const event = recordSafetyEvent.mock.calls[0][0];
    expect(event.category).toBe('abuse');
    expect(event.responseClass).toBe('emergency_guidance');
    expect(event.flagForTeacherReview).toBe(true);
    expect(event.confidence).toBe(0.82);
  });

  it('keeps deterministic safety guidance honest when review persistence fails', async () => {
    recordSafetyEvent.mockResolvedValue(false);
    classifierReturns('self_harm');

    const response = await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tutorData.messageMarkdown).toContain('adult you trust');
    expect(body.safety.reviewRequested).toBe(true);
    expect(body.safety.reviewRecorded).toBe(false);
    expect(JSON.stringify(body)).not.toContain('teacherNotified');
    expect(body.tutorData.messageMarkdown).not.toMatch(/school reviewer (has been|was) notified/i);
  });

  it('does not claim a school reviewer was informed when none is available', async () => {
    resolvePolicyInputs.mockResolvedValueOnce({
      status: 'ok', inputs: { ...POLICY, reviewerAvailable: false },
    });
    classifierReturns('self_harm');

    const response = await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.safety.reviewRecorded).toBe(true);
    expect(body.safety.reviewerAvailable).toBe(false);
    expect(body.tutorData.messageMarkdown).not.toMatch(/school reviewer (has been|was) notified/i);
  });

  it('does not score a safety turn as learning evidence', async () => {
    // §56.4 forbids scoring a student down for a system failure. Scoring them on a
    // disclosure of harm would be worse, and would also send it to the evaluator
    // model and copy it into a third collection.
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    expect(recordLearningEvidenceProbe).not.toHaveBeenCalled();
  });

  it('does not reset a hint level the student had already earned', async () => {
    // R8 sets allowedHintLevel to 0. Persisting that would undo real progress the
    // moment a conversation turned, which is a punishment for disclosing.
    classifierReturns('bullying');

    const response = await POST(request({ message: 'people are mean to me', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.sessionState.currentHintLevel).toBe(4);
    const levelWrites = sessionUpdate.mock.calls.filter(
      ([, data]) => (data as Record<string, unknown>).currentHintLevel !== undefined,
    );
    expect(levelWrites).toHaveLength(0);
  });

  it('writes the turn with the safety disposition and a scoring exclusion', async () => {
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    const turnWrite = turnSet.mock.calls.find(
      ([name, data]) => name === 'sessionTurns' && (data as Record<string, unknown>).actor === 'assistant',
    );
    expect(turnWrite).toBeDefined();
    const turn = turnWrite![1] as Record<string, any>;
    expect(turn.actor).toBe('assistant');
    expect(turn.excludedFromScoring).toBe(true);
    expect(turn.safetyMetadata.category).toBe('self_harm');
    expect(turn.safetyMetadata.responseClass).toBe('emergency_guidance');
    expect(turn.safetyMetadata.flaggedForTeacherReview).toBe(true);
    // Honest provenance: no model produced this text.
    expect(turn.tutorMetadata.modelName).toContain('deterministic');
  });

  it('redirects an off-limits question without flagging the student', async () => {
    classifierReturns('illegal_activity');

    const response = await POST(request({ message: 'how do I pick a lock', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.safety.responseClass).toBe('educational_redirect');
    expect(body.safety.reviewRequested).toBe(false);
    expect(body.safety.reviewRecorded).toBe(true);
    expect(recordSafetyEvent.mock.calls[0][0].flagForTeacherReview).toBe(false);
    // Still no tutor call: the redirect is deterministic too.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary turn on the normal path', async () => {
    // The negative case. Without it, a bug that treated every turn as unsafe would
    // pass every test above.
    classifierReturns('none');
    generateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          intent: 'problem_solving',
          subject: 'mathematics',
          topic: 'linear equations',
          estimatedGradeLevel: 8,
          problemStatement: 'Solve for x',
          studentProvidedAttempt: true,
          attemptQuality: 'meaningful',
          answerSeekingLikelihood: 0.1,
          ambiguityLevel: 'low',
          missingInformation: [],
          detectedLanguage: 'en',
          safetyCategory: 'none',
          confidence: 0.9,
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          messageMarkdown: 'What did you get when you subtracted 7 from both sides?',
          responseType: 'hint',
          hintLevel: 1,
          finalAnswerIncluded: false,
          internalConceptTags: ['linear-equations'],
        }),
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ verdict: 'safe', confidence: 0.95, reasonCode: 'no_disclosure' }),
      });

    const response = await POST(request({ message: 'I subtracted 7', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Classifier, tutor and semantic judge. The safety branch was not taken.
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(body.tutorData.responseType).not.toBe('safety_message');
    expect(body.safety).toBeUndefined();
  });
});

describe('the endpoint enforces the rate limit', () => {
  it('refuses with 429 and Retry-After when the limit is exceeded', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: false,
      scope: 'user',
      remaining: 0,
      retryAfterSeconds: 30,
      limit: 12,
      unavailable: false,
    });

    const response = await POST(request({ message: 'hello', sessionId: 's1' }) as never);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
  });

  it('spends no model call on a refused request', async () => {
    // The point of the limit: bounding spend, not merely returning an error.
    checkRateLimit.mockResolvedValue({
      allowed: false,
      scope: 'ip',
      remaining: 0,
      retryAfterSeconds: 15,
      limit: 60,
      unavailable: false,
    });

    await POST(request({ message: 'hello', sessionId: 's1' }) as never);

    expect(generateContent).not.toHaveBeenCalled();
    expect(resolvePolicyInputs).not.toHaveBeenCalled();
  });

  it('does not spend a rate-limit unit on an unauthenticated request', async () => {
    // Otherwise an anonymous flood exhausts a real student's quota, turning the
    // limiter into the denial-of-service it exists to prevent.
    verifyRequest.mockResolvedValue({
      uid: null,
      missingToken: true,
      verificationUnavailable: false,
    });

    const response = await POST(request({ message: 'hello', sessionId: 's1' }) as never);

    expect(response.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
