import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/session/chat/route';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = typeof import('@/lib/firebase/admin')['adminDb'];
let adminDb: AdminDb;

const STUDENT = 'transfer-chat-student';
const SESSION = 'transfer-chat-session';

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: async () => ({ uid: 'transfer-chat-student', verificationUnavailable: false })
}));

vi.mock('@/lib/security/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/rate-limit')>();
  return {
    ...actual,
    checkRateLimit: async () => ({ allowed: true }),
  };
});

const evaluationSpy = vi.fn();
vi.mock('@/lib/session/evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session/evaluation')>();
  return {
    ...actual,
    evaluateAttempt: async (...args: any[]) => {
      evaluationSpy(...args);
      return {
        evaluation: {
          relevance: 1,
          correctness: 0,
          reasoningQuality: 0,
          earliestMeaningfulError: null,
          errorCategory: 'none',
          understands: '',
          missingPrerequisite: null,
          smallestUsefulNextHint: null,
          feedbackSummary: '',
          confidence: 1,
          reasoningRubric: { identifiedMethod: false, explainedIntermediateStep: false, connectedToConcept: false, interpretedResult: false, confidence: 1, evidenceSpans: [] },
          verificationRubric: { recomputedOrSubstituted: false, checkedUnitsOrPlausibility: false, statedAssumptionOrLimitation: false, correctlyJudgedContent: false, confidence: 1 },
          extractedAnswer: 'wrong-eval-answer',
        },
        available: true,
        modelName: 'mock',
      };
    },
  };
});

describe('Transfer Chat Integration', () => {
  beforeAll(async () => {
    process.env.AI_MODEL_DRIVER = 'mock';
    adminDb = (await import('@/lib/firebase/admin')).adminDb;
  });

  beforeEach(async () => {
    evaluationSpy.mockClear();

    // Reset session and transcript
    await adminDb.collection('learningSessions').doc(SESSION).set({
      studentId: STUDENT,
      subject: 'mathematics',
      topic: 'algebra',
      grade: 9,
      mode: 'practice',
      strictness: 'standard',
      status: 'active',
      originalProblem: 'Original problem text',
      currentHintLevel: 1,
    });
    
    const turns = await adminDb.collection('sessionTurns').where('sessionId', '==', SESSION).get();
    for (const doc of turns.docs) await doc.ref.delete();
    const attempts = await adminDb.collection('studentAttempts').where('sessionId', '==', SESSION).get();
    for (const doc of attempts.docs) await doc.ref.delete();
    const problems = await adminDb.collection('transferProblems').where('sessionId', '==', SESSION).get();
    for (const doc of problems.docs) await doc.ref.delete();
    const metadata = await adminDb.collection('sessionTurnInternalMetadata').where('sessionId', '==', SESSION).get();
    for (const doc of metadata.docs) await doc.ref.delete();
    const ledger = await adminDb.collection('sessionRequestLedger').where('sessionId', '==', SESSION).get();
    for (const doc of ledger.docs) await doc.ref.delete();
  });

  it('c. evaluator is CALLED only after validateAnswer() returns unsupported', async () => {
    await adminDb.collection('transferProblems').doc('tp1').set({
      sessionId: SESSION,
      studentId: STUDENT,
      problemMarkdown: 'Solve x = 2',
      topic: 'algebra',
      difficulty: 'easy',
      expectedConcepts: [],
      internalAnswer: 'x = 2',
      status: 'issued',
      hintLevelAtIssue: 1,
      createdAt: new Date(),
    });

    // 1. Equivalent (deterministic correct) -> no evaluator
    let req = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SESSION, message: 'x = 2' }),
    });
    await POST(req);
    expect(evaluationSpy).not.toHaveBeenCalled();

    await adminDb.collection('transferProblems').doc('tp1').update({ status: 'issued' });
    
    // 2. Not equivalent (deterministic incorrect) -> no evaluator
    req = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SESSION, message: 'x = 3' }),
    });
    await POST(req);
    expect(evaluationSpy).not.toHaveBeenCalled();

    await adminDb.collection('transferProblems').doc('tp1').update({ status: 'issued' });

    // 3. Unsupported (fallback) -> evaluator IS called
    req = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SESSION, message: 'I am not sure' }),
    });
    await POST(req);
    expect(evaluationSpy).toHaveBeenCalledTimes(1);

    // d. evaluator receives pendingTransfer.problemMarkdown, not the original problem
    expect(evaluationSpy).toHaveBeenCalledWith(expect.objectContaining({
      problem: 'Solve x = 2',
    }));
  });

  it('e. a wrong evaluator extractedAnswer cannot change a correct raw transfer answer', async () => {
    await adminDb.collection('transferProblems').doc('tp2').set({
      sessionId: SESSION,
      studentId: STUDENT,
      problemMarkdown: 'Solve x = 4',
      topic: 'algebra',
      difficulty: 'easy',
      expectedConcepts: [],
      internalAnswer: 'x = 4',
      status: 'issued',
      hintLevelAtIssue: 1,
      createdAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SESSION, message: 'x = 4' }),
    });
    await POST(req);

    // Deterministic correct should be used. The evaluator shouldn't have been called anyway, 
    // but even if it was, the DB should contain the raw answer.
    const attempts = await adminDb.collection('studentAttempts')
      .where('sessionId', '==', SESSION)
      .where('attemptType', '==', 'transfer')
      .get();
      
    expect(attempts.size).toBeGreaterThan(0);
    const data = attempts.docs[0].data();
    
    // Transfer evidence is persisted inside the server-authored evaluation
    // payload, which is the schema `deriveSessionMetrics` consumes.
    expect(data.evaluation.transferOutcome).toBe('independent_correct');
    expect(data.evaluation.correctnessSource).toBe('deterministic');
    expect(data.evaluation.studentAnswer).toBe('x = 4'); // NOT 'wrong-eval-answer'
  });

  it('commits exactly one ordered exchange when two requests resolve revision zero together', async () => {
    const request = (message: string, clientRequestId: string) => new NextRequest('http://localhost/api/session/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: SESSION, message, clientRequestId }),
    });

    const [a, b] = await Promise.all([
      POST(request('I tried subtracting 2 first.', '00000000-0000-4000-8000-000000000001')),
      POST(request('I tried dividing both sides.', '00000000-0000-4000-8000-000000000002')),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const session = (await adminDb.collection('learningSessions').doc(SESSION).get()).data()!;
    expect(session.revision).toBe(1);
    expect(session.nextTurnSequence).toBe(2);

    const turns = await adminDb.collection('sessionTurns').where('sessionId', '==', SESSION).get();
    const ordered = turns.docs.map((doc) => doc.data()).sort((left, right) => left.sequence - right.sequence);
    expect(ordered).toHaveLength(2);
    expect(ordered.map((turn) => [turn.sequence, turn.actor])).toEqual([[0, 'student'], [1, 'assistant']]);
  });

  it('replays a stable request id without another exchange', async () => {
    const body = JSON.stringify({
      sessionId: SESSION,
      message: 'I tried subtracting 2 first.',
      clientRequestId: '00000000-0000-4000-8000-000000000003',
    });
    const first = await POST(new NextRequest('http://localhost/api/session/chat', { method: 'POST', body }));
    const replay = await POST(new NextRequest('http://localhost/api/session/chat', { method: 'POST', body }));

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await replay.json()).idempotentReplay).toBe(true);
    expect((await adminDb.collection('sessionTurns').where('sessionId', '==', SESSION).get()).size).toBe(2);
  });
});
