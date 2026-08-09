import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UNAVAILABLE_EVALUATION } from '@/lib/types/ai/model-output';

const batchSet = vi.fn();
const batchUpdate = vi.fn();
const batchCommit = vi.fn();
const directSet = vi.fn();

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id?: string) => ({
        id: id ?? 'random-attempt-id',
        path: `${name}/${id ?? 'random-attempt-id'}`,
        set: (data: unknown) => directSet(name, id ?? 'random-attempt-id', data),
      }),
      where: () => ({
        where: () => ({
          get: () => Promise.resolve({ empty: true, docs: [] }),
        }),
      }),
    }),
    batch: () => ({
      set: (ref: unknown, data: unknown) => batchSet(ref, data),
      update: (ref: unknown, data: unknown) => batchUpdate(ref, data),
      commit: () => batchCommit(),
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

const { recordAttemptEvaluation } = await import('@/lib/session/evaluation');

beforeEach(() => {
  vi.clearAllMocks();
  directSet.mockResolvedValue(undefined);
  batchCommit.mockResolvedValue(undefined);
});

describe('transfer attempt persistence', () => {
  it('uses a deterministic attempt id and atomically evaluates the transfer', async () => {
    const id = await recordAttemptEvaluation({
      sessionId: 'session-1',
      studentId: 'student-1',
      attemptText: 'y = 4',
      attemptType: 'transfer',
      evaluation: UNAVAILABLE_EVALUATION,
      available: false,
      modelName: 'mock:evaluator',
      transfer: {
        problemId: 'transfer-1',
        outcome: 'independent_correct',
        correctnessSource: 'validator',
        confidence: 0.7,
        referenceAnswer: 'y = 4',
        studentAnswer: 'y = 4',
        semanticValidation: null,
      },
    });

    expect(id).toBe('transfer-1__evaluation');
    expect(batchSet).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(directSet).not.toHaveBeenCalled();

    const [attemptRef, attemptDoc] = batchSet.mock.calls[0];
    expect(attemptRef).toMatchObject({ path: 'studentAttempts/transfer-1__evaluation' });
    expect(attemptDoc).toMatchObject({
      id: 'transfer-1__evaluation',
      attemptType: 'transfer',
      evaluation: {
        transferOutcome: 'independent_correct',
        correctnessSource: 'validator',
        studentAnswer: 'y = 4',
      },
    });

    const serialized = JSON.stringify(attemptDoc);
    expect(serialized).not.toContain('referenceAnswer');
    expect(serialized).not.toContain('"y = 4","studentAnswer"');

    const [transferRef, transferUpdate] = batchUpdate.mock.calls[0];
    expect(transferRef).toMatchObject({ path: 'transferProblems/transfer-1' });
    expect(transferUpdate).toMatchObject({ status: 'evaluated' });
  });

  it('reuses the same evidence document on a retry of the same transfer', async () => {
    const input = {
      sessionId: 'session-1',
      studentId: 'student-1',
      attemptText: 'y = 4',
      attemptType: 'transfer' as const,
      evaluation: UNAVAILABLE_EVALUATION,
      available: false,
      modelName: 'mock:evaluator',
      transfer: {
        problemId: 'transfer-1',
        outcome: 'partial' as const,
        correctnessSource: 'validator' as const,
        confidence: 0.7,
        studentAnswer: 'y = 3.9',
      },
    };

    await recordAttemptEvaluation(input);
    await recordAttemptEvaluation(input);

    expect(batchSet).toHaveBeenCalledTimes(2);
    expect(batchSet.mock.calls[0][0]).toMatchObject({
      path: 'studentAttempts/transfer-1__evaluation',
    });
    expect(batchSet.mock.calls[1][0]).toMatchObject({
      path: 'studentAttempts/transfer-1__evaluation',
    });
  });
});
