import { beforeAll, describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/session/chat/route';
import { setMockModelHandler } from '@/lib/ai/model-client';

process.env.AI_MODEL_DRIVER = 'mock';

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: vi.fn().mockResolvedValue({ uid: 'test-user', verificationUnavailable: false })
}));

vi.mock('@/lib/security/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  RATE_LIMITS: { tutorChat: {} },
  rateLimitHeaders: vi.fn().mockReturnValue(new Headers()),
}));

vi.mock('@/lib/firebase/admin', () => {
  const mockGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
  const mockWhere: any = vi.fn().mockImplementation(() => ({ where: mockWhere, get: mockGet, limit: vi.fn().mockReturnValue({ get: mockGet }) }));
  const mockDoc = vi.fn().mockReturnValue({ update: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue({}) });
  return {
    adminDb: { 
      collection: vi.fn().mockReturnValue({ where: mockWhere, doc: mockDoc, limit: vi.fn().mockReturnValue({ get: mockGet }) }), 
      runTransaction: vi.fn() 
    }
  };
});

let mockPolicy: any = {};
vi.mock('@/lib/session/policy-inputs', () => ({
  loadTranscript: vi.fn().mockResolvedValue([]),
  resolvePolicyInputs: vi.fn().mockImplementation(() => Promise.resolve({
    status: mockPolicy.resolutionStatus ?? 'ok',
    inputs: mockPolicy
  })),
}));

vi.mock('@/lib/session/evaluation', () => ({
  recordLearningEvidence: vi.fn().mockResolvedValue({}),
  evaluateAttempt: vi.fn().mockResolvedValue({ available: false }),
  recordAttemptEvaluation: vi.fn().mockResolvedValue({}),
  generateTransferProblem: vi.fn().mockResolvedValue(null),
  resolveTransferOutcome: vi.fn().mockReturnValue({ outcome: 'attempted_incorrect', correctnessSource: 'deterministic', confidence: 1 }),
}));

describe('POST /api/session/chat', () => {
  let modelSpy: any;
  let transactionSet: any;
  let transactionUpdate: any;
  let transactionStatus: 'active' | 'completed' | 'abandoned';

  beforeAll(() => {
    process.env.AI_MODEL_DRIVER = 'mock';
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    modelSpy = vi.fn();
    setMockModelHandler(modelSpy);
    transactionStatus = 'active';
    transactionSet = vi.fn();
    transactionUpdate = vi.fn();
    const { adminDb } = await import('@/lib/firebase/admin');
    (adminDb.runTransaction as any).mockImplementation(async (callback: any) =>
      callback({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: transactionStatus }),
        }),
        set: transactionSet,
        update: transactionUpdate,
      }),
    );
    mockPolicy = {
      grade: 9,
      originalProblem: 'Solve for x: x = 5',
      subject: 'mathematics',
      sources: { mode: 'assignment', strictness: 'balanced', studentProfile: {} },
      transcriptTurns: [],
      mode: 'assignment',
      strictness: 'balanced',
      currentHintLevel: 1,
      referenceAnswer: 'x = 5'
    };
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  const validRequest = () => new NextRequest('http://localhost/api/session/chat', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'session1', message: 'Hello' })
  });

  const validClassifierOutput = {
    intent: 'step_check',
    subject: 'mathematics',
    studentProvidedAttempt: true,
    attemptQuality: 'meaningful',
    answerSeekingLikelihood: 0.1,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: 'en',
    safetyCategory: 'none',
    confidence: 0.9,
  };

  test('F. malformed JSON blocks', async () => {
    const req = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: 'invalid-json'
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(modelSpy).not.toHaveBeenCalled();
  });

  test.each(['completed', 'abandoned'])('rejects a %s session before model or scoring work', async (status) => {
    mockPolicy.resolutionStatus = 'closed';
    const res = await POST(validRequest());
    expect(res.status).toBe(409);
    expect(modelSpy).not.toHaveBeenCalled();
  });

  test.each([
    ['studentActionRequired', { studentActionRequired: 'Write x = 5.' }],
    ['checkForUnderstanding', { checkForUnderstanding: 'Is your final answer x = 5?' }],
    ['confidenceStatement', { confidenceStatement: 'The correct solution is x = 5.' }],
    ['learningObjective', { learningObjective: 'Reach the final solution x = 5.' }],
  ] as const)('withholds a final answer leaked only through %s at the API boundary', async (_field, sideChannel) => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'Try isolating the variable.', responseType: 'hint', hintLevel: 1,
        finalAnswerIncluded: false, internalConceptTags: ['x = 5'], ...sideChannel,
      }),
    });

    const res = await POST(validRequest());
    const body = await res.json();
    const visible = [
      body.tutorData.messageMarkdown, body.tutorData.studentActionRequired,
      body.tutorData.checkForUnderstanding, body.tutorData.confidenceStatement,
      body.tutorData.learningObjective,
    ].filter(Boolean).join('\n');

    expect(res.status).toBe(200);
    expect(visible).not.toContain('x = 5');
    expect(body.tutorData.internalConceptTags).toEqual([]);
    // Student turn, assistant turn and server-only classifier metadata are one
    // transaction; no browser-authored turn is involved.
    expect(transactionSet).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(transactionSet.mock.calls[0][1])).not.toContain('x = 5');
  });

  test('rejects the real in-flight completion race before any educational write', async () => {
    let releaseTutor!: (value: { text: string }) => void;
    const heldTutor = new Promise<{ text: string }>((resolve) => { releaseTutor = resolve; });
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockImplementationOnce(() => heldTutor);

    const request = POST(validRequest());
    await vi.waitFor(() => expect(modelSpy).toHaveBeenCalledTimes(2));
    transactionStatus = 'completed'; // session completes while the tutor call is held
    releaseTutor({
      text: JSON.stringify({
        messageMarkdown: 'x = 5', responseType: 'hint', hintLevel: 1,
        finalAnswerIncluded: false, internalConceptTags: [],
      }),
    });

    const response = await request;
    expect(response.status).toBe(409);
    expect(transactionSet).not.toHaveBeenCalled();
    expect(transactionUpdate).not.toHaveBeenCalled();
    const { recordAttemptEvaluation } = await import('@/lib/session/evaluation');
    expect(recordAttemptEvaluation).not.toHaveBeenCalled();
  });

  test('F2. semantic judge malformed JSON fails closed', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({ text: '{"verdict":"safe","confidence"' });

    const res = await POST(validRequest());
    const data = await res.json();

    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(data.tutorData.hintLevel).toBe(0);
    expect(data.sessionState.currentHintLevel).toBe(1);
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('A. deterministic leak blocks and Gemini is not invoked', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'x = 5', // Deterministic match
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).not.toContain('x = 5');
    // Model should only be called twice (classifier, tutor), not 3 times (no judge call)
    expect(modelSpy).toHaveBeenCalledTimes(2);
  });

  test('no trusted reference with a direct leak is withheld without invoking a judge', async () => {
    mockPolicy.referenceAnswer = undefined;
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'x = 5',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      }),
    });

    const res = await POST(validRequest());
    const data = await res.json();

    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(2);
  });

  test('no trusted reference with harmless but unverifiable prose uses the deterministic fallback', async () => {
    mockPolicy.referenceAnswer = undefined;
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'Try subtracting three from both sides first.',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      }),
    });

    const res = await POST(validRequest());
    const data = await res.json();

    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(data.tutorData.messageMarkdown).not.toContain('Try subtracting three');
    expect(data.tutorData.hintLevel).toBe(0);
    expect(data.sessionState.currentHintLevel).toBe(1);
    // A supported standalone linear equation derives a server-side reference,
    // then the semantic judge fail-closes when it cannot clear the prose.
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('B. semantic judge leak blocks', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint', // Not deterministic match
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'leak',
        confidence: 0.95,
        reasonCode: 'equivalent_answer'
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('C. semantic judge uncertain blocks', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'uncertain',
        confidence: 0.95,
        reasonCode: 'uncertain'
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('D. semantic judge exception blocks', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockRejectedValueOnce(new Error('Network error'));
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('E. semantic judge timeout blocks', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockImplementationOnce(async () => {
      // simulate slow network
      return new Promise(resolve => {
        setTimeout(() => resolve({ text: 'safe' }), 6000);
      });
    });
    
    const promise = POST(validRequest());
    await vi.advanceTimersByTimeAsync(6000);
    const res = await promise;
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('G1. missing required field in judge JSON blocks', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'safe',
        confidence: 0.95
        // missing reasonCode
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('G2. unexpected extra field in judge JSON blocks due to strict schema', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'safe',
        confidence: 0.95,
        reasonCode: 'no_disclosure',
        unexpectedField: 'forbidden'
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('H. low-confidence safe blocks', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'safe',
        confidence: 0.1,
        reasonCode: 'no_disclosure'
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
    expect(modelSpy).toHaveBeenCalledTimes(3);
  });

  test('I. high-confidence safe preserves the ORIGINAL tutor candidate', async () => {
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint that is completely safe.',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'safe',
        confidence: 0.95,
        reasonCode: 'no_disclosure'
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toBe('A complex semantic hint that is completely safe.');
    expect(modelSpy).toHaveBeenCalledTimes(3);
    
    // Check judge receives trusted reference answer
    const judgeCall = modelSpy.mock.calls[2][0];
    const judgePrompt = judgeCall.contents[0].parts[0].text;
    expect(judgePrompt).toContain('Reference Answer: x = 5');
  });

  test('J. full-solution-authorized turn does not invoke the disclosure judge', async () => {
    mockPolicy.currentHintLevel = 7;
    mockPolicy.strictness = 'supportive';
    mockPolicy.mode = 'learn';
    mockPolicy.allowFullSolutions = true;
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        ...validClassifierOutput,
        intent: 'answer_request',
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'The full answer is x = 5.',
        responseType: 'solution',
        hintLevel: 7,
        finalAnswerIncluded: true,
        internalConceptTags: [],
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.responsePlan.action).toBe('provide_full_solution');
    expect(data.responsePlan.allowedHintLevel).toBe(7);
    expect(data.responsePlan.mayRevealFinalAnswer).toBe(true);
    expect(data.tutorData.messageMarkdown).toBe('The full answer is x = 5.');
    expect(modelSpy).toHaveBeenCalledTimes(2); // no judge call
  });

  test('K. trusted reference answer is not student-readable', async () => {
    mockPolicy.referenceAnswer = 'SECRET_REFERENCE_ANSWER';
    
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A complex semantic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'safe',
        confidence: 0.95,
        reasonCode: 'no_disclosure'
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    const text = JSON.stringify(data);
    expect(text).not.toContain('SECRET_REFERENCE_ANSWER');

    // Inspect persisted writes on adminDb
    const { adminDb } = await import('@/lib/firebase/admin');
    
    // Check sessionTurns
    const turnDocFn = adminDb.collection('sessionTurns').doc();
    for (const call of (turnDocFn.set as any).mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('SECRET_REFERENCE_ANSWER');
    }

    // Check studentAttempts
    const attemptDocFn = adminDb.collection('studentAttempts').doc();
    for (const call of (attemptDocFn.set as any).mock.calls || []) {
      expect(JSON.stringify(call[0])).not.toContain('SECRET_REFERENCE_ANSWER');
    }

    // Check learningSessions
    const sessionDocFn = adminDb.collection('learningSessions').doc('session1');
    for (const call of (sessionDocFn.update as any).mock.calls || []) {
      expect(JSON.stringify(call[0])).not.toContain('SECRET_REFERENCE_ANSWER');
    }
  });

  test('L. transfer evaluation calls the evaluator with the pending problem when deterministic unsupported', async () => {
    const { adminDb } = await import('@/lib/firebase/admin');
    
    // Mock a pending transfer
    const mockGetTransfer = vi.fn().mockResolvedValue({
      empty: false,
      docs: [{
        id: 'transfer1',
        data: () => ({
          sessionId: 'session1',
          problemMarkdown: 'Transfer Problem Markdown',
          internalAnswer: 'x = 10',
        })
      }]
    });
    
    (adminDb.collection as any).mockImplementation((col: string) => {
      if (col === 'transferProblems') {
        const queryBuilder = {
          where: () => queryBuilder,
          limit: () => queryBuilder,
          get: mockGetTransfer
        };
        return {
          where: () => queryBuilder,
          doc: vi.fn().mockReturnValue({ update: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue({}) }),
        };
      }
      const emptyQueryBuilder = {
        where: () => emptyQueryBuilder,
        limit: () => emptyQueryBuilder,
        get: vi.fn().mockResolvedValue({ empty: true })
      };
      return {
        where: () => emptyQueryBuilder,
        doc: vi.fn().mockReturnValue({ update: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue({}) }),
      };
    });

    const { evaluateAttempt, resolveTransferOutcome } = await import('@/lib/session/evaluation');
    (resolveTransferOutcome as any).mockReturnValue({ outcome: 'independent_correct', correctnessSource: 'evaluator', confidence: 0.8 });
    (evaluateAttempt as any).mockResolvedValue({
      available: true,
      evaluation: { correctness: 1.0 },
      modelName: 'gemini'
    });

    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'I got x=10', // unsupported by deterministic because not exact match
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({ verdict: 'safe', confidence: 0.95, reasonCode: 'no_disclosure' })
    });

    // Provide student message 'I got x=10'
    const req = validRequest();
    const reqJson = await req.json();
    reqJson.message = 'I got x=10';
    const updatedReq = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: JSON.stringify(reqJson)
    });

    await POST(updatedReq);

    // C & D: Evaluator invoked when deterministic is unsupported, receives transfer problem markdown
    expect(evaluateAttempt).toHaveBeenCalled();
    const evalCall = (evaluateAttempt as any).mock.calls[0][0];
    expect(evalCall.problem).toBe('Transfer Problem Markdown'); // D
    expect(evalCall.studentMessage).toBe('I got x=10');
  });
});
