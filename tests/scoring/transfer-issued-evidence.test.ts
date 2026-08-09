import { describe, expect, it } from 'vitest';
import { deriveSessionMetrics } from '@/lib/scoring/metrics';

const session = {
  id: 'session-1',
  studentId: 'student-1',
  subject: 'mathematics',
  mode: 'practice',
};

describe('transfer evidence requires an actual delivered task', () => {
  it('does not mark a planned-but-never-generated transfer as declined', () => {
    const metrics = deriveSessionMetrics(session, [
      {
        sequence: 1,
        actor: 'student',
        content: 'I finished the explanation.',
      },
      {
        sequence: 2,
        actor: 'assistant',
        content: 'Good work.',
        responsePlan: { generateTransferProblem: true },
        tutorMetadata: {
          responseType: 'feedback',
          hintLevel: 1,
          finalAnswerIncluded: false,
        },
      },
    ]);

    expect(metrics.transfer.issued).toBe(false);
    expect(metrics.transfer.declined).toBe(false);
    expect(metrics.transferState).toBe('not_applicable');
  });

  it('marks a delivered transfer as declined only when no student reply follows it', () => {
    const metrics = deriveSessionMetrics(session, [
      {
        sequence: 1,
        actor: 'assistant',
        content: 'Solve x^2 - 7x + 12 = 0.',
        tutorMetadata: {
          responseType: 'transfer_problem',
          hintLevel: 0,
          finalAnswerIncluded: false,
        },
      },
    ]);

    expect(metrics.transfer.issued).toBe(true);
    expect(metrics.transfer.declined).toBe(true);
    expect(metrics.transferState).toBe('declined');
  });
});
