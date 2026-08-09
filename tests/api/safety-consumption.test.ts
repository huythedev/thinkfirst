import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Does the tutoring endpoint consume and independently verify the safety
 * classification before deterministic policy? A crisis turn may spend the
 * classifier + classifier-verifier calls, but it must never call the tutor or
 * learning-evidence pipeline; response composition remains deterministic.
 */

const verifyRequest = vi.fn();
const resolvePolicyInputs = vi.fn();
const loadTranscript = vi.fn();
const generateContent = vi.fn();
const checkRateLimit = vi.fn();
const recordSafetyEvent = vi.fn();
const recordLearningEvidenceProbe = vi.fn();
const runSemanticValidation = vi.fn();
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
    collection: (name: string) => ({
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
    recordSafetyEvent(...args);
    return Promise.resolve(true);
  },
}));

vi.mock('@/lib/ai/semantic-validation', () => ({
  runSemanticValidation: (...args: unknown[]) => runSemanticValidation(...args),
}));

vi.mock('@/lib/session/evaluation', () => ({
  evaluateAttempt: (...args: unknown[]) => {
    recordLearningEvidenceProbe('evaluateAttempt', ...args);
    return Promise.resolve({
      available: false,
      evaluation: null,
      modelName: 'stub',
      semanticValidation: null,
    });
  },
  generateTransferProblem: (...args: unknown[]) => {
    recordLearningEvidenceProbe('generateTransferProblem', ...args);
    return Promise.resolve(null);
  },
  recordAttemptEvaluation: (...args: unknown[]) => {
    recordLearningEvidenceProbe('recordAttemptEvaluation', ...args);
    return Promise.resolve();
  },
  validateTransferOutcome: (...args: unknown[]) => {
    recordLearningEvidenceProbe('validateTransferOutcome', ...args);
    return Promise.resolve({
      outcome: null,
      correctnessSource: 'unavailable',
      confidence: 0,
      semanticValidation: null,
    });
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

const semanticApproval = {
  available: true,
  approved: true,
  modelName: 'mock:validator',
  promptVersion: 'semantic-validator-v2',
  validation: {
    approved: true,
    verdict: 'approved',
    confidence: 0.95,
    issues: [],
    correctedValue: null,
  },
};

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
  resolvePolicyInputs.mockResolvedValue({ status: 'ok', inputs: POLICY });
  loadTranscript.mockResolvedValue([
    { actor: 'student', content: 'I need help', sequence: 1 },
  ]);
  runSemanticValidation.mockResolvedValue(semanticApproval);
});

describe('the endpoint consumes and verifies the safety classification', () => {
  it('verifies classification but never calls the tutor model on a self-harm disclosure', async () => {
    classifierReturns('self_harm');

    const response = await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(runSemanticValidation).toHaveBeenCalledTimes(1);
    expect(runSemanticValidation.mock.calls[0][0].validationKind).toBe('intent_classification');
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
    expect(body.safety.teacherNotified).toBe(true);
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

  it('does not score a safety turn as learning evidence', async () => {
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    expect(recordLearningEvidenceProbe).not.toHaveBeenCalled();
  });

  it('does not reset a hint level the student had already earned', async () => {
    classifierReturns('bullying');

    const response = await POST(request({ message: 'people are mean to me', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.sessionState.currentHintLevel).toBe(4);
    const levelWrites = sessionUpdate.mock.calls.filter(
      ([, data]) => (data as Record<string, unknown>).currentHintLevel !== undefined,
    );
    expect(levelWrites).toHaveLength(0);
  });

  it('writes safety and classifier-verifier provenance on the turn', async () => {
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    const turnWrite = turnSet.mock.calls.find(([name]) => name === 'sessionTurns');
    expect(turnWrite).toBeDefined();
    const turn = turnWrite![1] as Record<string, any>;
    expect(turn.actor).toBe('assistant');
    expect(turn.excludedFromScoring).toBe(true);
    expect(turn.safetyMetadata.category).toBe('self_harm');
    expect(turn.safetyMetadata.responseClass).toBe('emergency_guidance');
    expect(turn.safetyMetadata.flaggedForTeacherReview).toBe(true);
    expect(turn.tutorMetadata.modelName).toContain('deterministic');
    expect(turn.tutorMetadata.classifierSemanticValidation.promptVersion).toBe('semantic-validator-v2');
  });

  it('redirects an off-limits question without flagging the student', async () => {
    classifierReturns('illegal_activity');

    const response = await POST(request({ message: 'how do I pick a lock', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.safety.responseClass).toBe('educational_redirect');
    expect(body.safety.teacherNotified).toBe(false);
    expect(recordSafetyEvent.mock.calls[0][0].flagForTeacherReview).toBe(false);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('uses a verifier-detected safety correction conservatively', async () => {
    classifierReturns('none');
    runSemanticValidation.mockResolvedValueOnce({
      available: true,
      approved: false,
      modelName: 'mock:validator',
      promptVersion: 'semantic-validator-v2',
      validation: {
        approved: false,
        verdict: 'rejected',
        confidence: 0.93,
        issues: ['The message contains a self-harm disclosure.'],
        correctedValue: 'self_harm',
      },
    });

    const response = await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(body.tutorData.responseType).toBe('safety_message');
    expect(body.safety.teacherNotified).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary turn on the normal path and verifies classifier then tutor', async () => {
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
      });

    const response = await POST(request({ message: 'I subtracted 7', sessionId: 's1' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(runSemanticValidation).toHaveBeenCalledTimes(2);
    expect(runSemanticValidation.mock.calls[0][0].validationKind).toBe('intent_classification');
    expect(runSemanticValidation.mock.calls[1][0].validationKind).toBe('tutor_response');
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
    expect(runSemanticValidation).not.toHaveBeenCalled();
    expect(resolvePolicyInputs).not.toHaveBeenCalled();
  });

  it('does not spend a rate-limit unit on an unauthenticated request', async () => {
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
