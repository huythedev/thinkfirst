import { beforeAll, describe, expect, test, vi, beforeEach } from 'vitest';
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
    status: 'resolved',
    inputs: mockPolicy
  })),
}));

vi.mock('@/lib/session/evaluation', () => ({
  recordLearningEvidence: vi.fn().mockResolvedValue({}),
  evaluateAttempt: vi.fn().mockResolvedValue({ available: false }),
  recordAttemptEvaluation: vi.fn().mockResolvedValue({}),
  generateTransferProblem: vi.fn().mockResolvedValue(null),
}));

describe('POST /api/session/chat', () => {
  let modelSpy: any;

  beforeAll(() => {
    process.env.AI_MODEL_DRIVER = 'mock';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    modelSpy = vi.fn();
    setMockModelHandler(modelSpy);
    mockPolicy = {
      grade: 9,
      originalProblem: 'Solve for x: x = 5',
      sources: { mode: 'assignment', strictness: 'balanced', studentProfile: {} },
      transcriptTurns: [],
    };
  });

  const validRequest = () => new NextRequest('http://localhost/api/session/chat', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'session1', message: 'Hello' })
  });

  const validClassifierOutput = {
    intent: 'answer_request',
    subject: 'mathematics',
    studentProvidedAttempt: false,
    attemptQuality: 'none',
    answerSeekingLikelihood: 1.0,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: 'en',
    safetyCategory: 'none',
    confidence: 0.9,
  };

  test('malformed/invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: 'invalid-json'
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(modelSpy).not.toHaveBeenCalled();
  });

  test('deterministic leak block', async () => {
    mockPolicy.currentHintLevel = 1;
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'The answer is 5.',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: true,
        internalConceptTags: [],
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
  });

  test('judge exception/timeout blocks', async () => {
    mockPolicy.currentHintLevel = 1;
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    mockPolicy.mathCheck = { referenceAnswer: 'x = 5' };
    
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'The answer is five.',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    
    modelSpy.mockRejectedValueOnce(new Error('timeout'));
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    expect(data.tutorData.messageMarkdown).toContain('I started to answer with more than you should see at this point');
  });

  test('high/low confidence handling', async () => {
    mockPolicy.currentHintLevel = 1;
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify({ ...validClassifierOutput, confidence: 0.1, studentProvidedAttempt: true, attemptQuality: 'meaningful' }) });
    
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A basic hint',
        responseType: 'hint',
        hintLevel: 0,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });

    const res = await POST(validRequest());
    const data = await res.json();
    expect(data.responsePlan.requiresVerification).toBe(true);
  });

  test('full-solution-authorized turns', async () => {
    mockPolicy.sources.mode = 'practice';
    mockPolicy.currentHintLevel = 7;
    
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify({ ...validClassifierOutput, attemptQuality: 'meaningful' }) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'The full answer is 5.',
        responseType: 'solution',
        hintLevel: 7,
        finalAnswerIncluded: true,
        internalConceptTags: [],
      })
    });
    
    const res = await POST(validRequest());
    const data = await res.json();
    expect(data.tutorData.messageMarkdown).toBe('The full answer is 5.');
  });
  
  test('absence of trusted assignment reference answers in student-readable surfaces', async () => {
    mockPolicy.currentHintLevel = 1;
    mockPolicy.mathCheck = { referenceAnswer: 'SECRET_REFERENCE_ANSWER' };
    
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify(validClassifierOutput) });
    modelSpy.mockResolvedValueOnce({
      text: JSON.stringify({
        messageMarkdown: 'A basic hint',
        responseType: 'hint',
        hintLevel: 1,
        finalAnswerIncluded: false,
        internalConceptTags: [],
      })
    });
    modelSpy.mockResolvedValueOnce({ text: JSON.stringify({ verdict: 'safe', confidence: 1.0 }) });
    
    const res = await POST(validRequest());
    const data = await res.json();
    
    const text = JSON.stringify(data);
    expect(text).not.toContain('SECRET_REFERENCE_ANSWER');
  });
});
