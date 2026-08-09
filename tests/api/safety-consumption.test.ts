import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level trust-boundary tests. Student turns are server-authored by the chat
 * endpoint, so the transcript mock contains only trusted history. The route must
 * serialize per-session work and must not duplicate an orphaned student turn when
 * a failed model call is retried.
 */

const verifyRequest = vi.fn();
const resolvePolicyInputs = vi.fn();
const loadTranscript = vi.fn();
const acquireSessionRequestLock = vi.fn();
const releaseSessionRequestLock = vi.fn();
const reserveTurnSequences = vi.fn();
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

vi.mock('@/lib/firebase/admin', () => {
  const collection = (name: string): any => ({
    doc: (id?: string) => ({
      id: id ?? 'generated-turn-id',
      __collection: name,
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
    where: () => collection(name),
    get: () => Promise.resolve({ empty: true, docs: [] }),
  });

  return {
    adminAuth: {},
    adminDb: {
      collection,
      batch: () => ({
        set: (ref: { __collection?: string }, data: unknown) => {
          turnSet(ref.__collection ?? 'unknown', data);
        },
        update: (ref: { __collection?: string }, data: unknown) => {
          sessionUpdate(ref.__collection ?? 'unknown', data);
        },
        commit: () => Promise.resolve(),
      }),
    },
  };
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}));

vi.mock('@/lib/session/policy-inputs', () => ({
  resolvePolicyInputs: (...args: unknown[]) => resolvePolicyInputs(...args),
  loadTranscript: (...args: unknown[]) => loadTranscript(...args),
}));

vi.mock('@/lib/session/request-lock', () => ({
  acquireSessionRequestLock: (...args: unknown[]) => acquireSessionRequestLock(...args),
  releaseSessionRequestLock: (...args: unknown[]) => releaseSessionRequestLock(...args),
}));

vi.mock('@/lib/session/turn-sequence', () => ({
  reserveTurnSequences: (...args: unknown[]) => reserveTurnSequences(...args),
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
      evaluation: { extractedAnswer: null },
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
    return Promise.resolve({
      profile: { score: null, suppressed: true },
      sessionScore: { coverage: 0 },
    });
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
  acquireSessionRequestLock.mockResolvedValue({ sessionId: 's1', token: 'lock-1' });
  releaseSessionRequestLock.mockResolvedValue(undefined);
  loadTranscript.mockResolvedValue([
    { actor: 'student', content: 'Earlier attempt', sequence: 1 },
    {
      actor: 'assistant',
      content: 'Try the next step.',
      sequence: 2,
      responsePlan: {
        action: 'provide_hint',
        allowedHintLevel: 1,
        requiresExplanation: false,
        requiresVerification: false,
        learningObjective: 'delivered-objective',
      },
      tutorMetadata: { responseType: 'hint', studentActionRequired: 'Try the next step.' },
    },
  ]);
  reserveTurnSequences.mockImplementation(
    (_sessionId: string, minimumNextSequence: number, count: number) =>
      Promise.resolve(Array.from({ length: count }, (_, index) => minimumNextSequence + index)),
  );
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

  it('serializes work per session and releases the lease after the response', async () => {
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    expect(acquireSessionRequestLock).toHaveBeenCalledWith('s1');
    expect(releaseSessionRequestLock).toHaveBeenCalledWith({ sessionId: 's1', token: 'lock-1' });
  });

  it('returns 409 without model work when another request owns the session lease', async () => {
    acquireSessionRequestLock.mockResolvedValue(null);

    const response = await POST(request({ message: 'parallel request', sessionId: 's1' }) as never);

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(generateContent).not.toHaveBeenCalled();
    expect(reserveTurnSequences).not.toHaveBeenCalled();
  });

  it('reserves ordered server sequence numbers and persists a fresh student turn', async () => {
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    expect(reserveTurnSequences).toHaveBeenCalledWith('s1', 3, 2);
    const studentWrite = turnSet.mock.calls.find(
      ([name, data]) => name === 'sessionTurns' && (data as Record<string, unknown>).actor === 'student',
    );
    expect(studentWrite).toBeDefined();
    expect(studentWrite![1]).toMatchObject({
      studentId: 'student-1',
      sequence: 3,
      serverAuthored: true,
    });
  });

  it('reuses an orphaned trusted student turn when the same failed message is retried', async () => {
    const message = 'retry-this-message';
    loadTranscript.mockResolvedValue([
      { actor: 'assistant', content: 'Previous tutor turn', sequence: 1 },
      { actor: 'student', content: message, sequence: 2 },
    ]);
    classifierReturns('self_harm');

    const response = await POST(request({ message, sessionId: 's1' }) as never);

    expect(response.status).toBe(200);
    expect(reserveTurnSequences).toHaveBeenCalledWith('s1', 3, 1);
    const studentWrites = turnSet.mock.calls.filter(
      ([name, data]) => name === 'sessionTurns' && (data as Record<string, unknown>).actor === 'student',
    );
    expect(studentWrites).toHaveLength(0);
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

  it('writes safety and classifier-verifier provenance on the assistant turn', async () => {
    classifierReturns('self_harm');

    await POST(request({ message: 'I want to hurt myself', sessionId: 's1' }) as never);

    const assistantWrite = turnSet.mock.calls.find(
      ([name, data]) => name === 'sessionTurns' && (data as Record<string, unknown>).actor === 'assistant',
    );
    expect(assistantWrite).toBeDefined();
    const turn = assistantWrite![1] as Record<string, any>;
    expect(turn.excludedFromScoring).toBe(true);
    expect(turn.safetyMetadata.category).toBe('self_harm');
    expect(turn.tutorMetadata.modelName).toContain('deterministic');
    expect(turn.tutorMetadata.classifierSemanticValidation.promptVersion).toBe('semantic-validator-v2');
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

  it('does not duplicate the current student message in classifier context', async () => {
    classifierReturns('self_harm');
    const message = 'unique-current-message-12345';

    await POST(request({ message, sessionId: 's1' }) as never);

    const classifierRequest = generateContent.mock.calls[0][0] as any;
    const userText = classifierRequest.contents[0].parts[0].text as string;
    expect(userText.split(message)).toHaveLength(2);
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
    expect(recordLearningEvidenceProbe).toHaveBeenCalledWith('persistSessionEvidence', 'student-1', 's1');

    const evaluatorCall = recordLearningEvidenceProbe.mock.calls.find(([kind]) => kind === 'evaluateAttempt');
    expect(evaluatorCall?.[1]).toMatchObject({ learningObjective: 'delivered-objective' });
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
