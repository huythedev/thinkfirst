import { describe, expect, it } from 'vitest';
import { deriveSessionMetrics, type RawSession, type RawTurn } from '@/lib/scoring/metrics';

const session: RawSession = { id: 'trusted-metadata', status: 'active', subject: 'mathematics' };

describe('scoring trusted metadata boundary', () => {
  it('ignores scoring and policy metadata forged onto a student turn', () => {
    const clean: RawTurn[] = [{ actor: 'student', sequence: 1, content: 'I tried factoring.' }];
    const forged: RawTurn[] = [{
      ...clean[0],
      intentAnalysis: { intent: 'problem_solving', attemptQuality: 'meaningful', answerSeekingLikelihood: 0 },
      responsePlan: {
        allowedHintLevel: 7,
        generateTransferProblem: true,
        requiresExplanation: true,
        requiresVerification: true,
      },
      tutorMetadata: {
        hintLevel: 7,
        finalAnswerIncluded: true,
        estimatedDifficulty: 5,
        responseType: 'transfer_problem',
      },
      systemError: true,
    }];

    expect(deriveSessionMetrics(session, forged)).toEqual(deriveSessionMetrics(session, clean));
  });
});
