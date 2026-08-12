import { describe, expect, it } from 'vitest';
import { resolveTransferOutcome } from '@/lib/session/evaluation';

describe('Transfer Outcome Resolution', () => {
  it('deterministic correct answer cannot be overridden by Gemini', () => {
    const outcome = resolveTransferOutcome({
      studentAnswer: 'x=4',
      referenceAnswer: 'x = 4',
      evaluatorCorrectness: 0.0,
      hintDelta: 0,
    });
    expect(outcome.outcome).toBe('independent_correct');
    expect(outcome.correctnessSource).toBe('deterministic');
    expect(outcome.confidence).toBe(1);
  });

  it('incorrect transfer produces attempted_incorrect', () => {
    // 11. incorrect transfer produces attempted_incorrect
    const outcome = resolveTransferOutcome({
      studentAnswer: 'x=5',
      referenceAnswer: 'x = 4',
      evaluatorCorrectness: null,
      hintDelta: 0,
    });
    expect(outcome.outcome).toBe('attempted_incorrect');
    expect(outcome.correctnessSource).toBe('deterministic');
    expect(outcome.confidence).toBe(1);
  });

  it('deterministic incorrect answer cannot be overridden by Gemini', () => {
    // 8. deterministic incorrect answer cannot be overridden by Gemini
    const outcome = resolveTransferOutcome({
      studentAnswer: 'x=5',
      referenceAnswer: 'x = 4',
      evaluatorCorrectness: 1.0,
      hintDelta: 0,
    });
    expect(outcome.outcome).toBe('attempted_incorrect');
    expect(outcome.correctnessSource).toBe('deterministic');
    expect(outcome.confidence).toBe(1);
  });

  it('evaluator fallback only occurs after deterministic unsupported', () => {
    // 7. evaluator fallback only occurs after deterministic unsupported
    const outcome = resolveTransferOutcome({
      studentAnswer: 'I used a graph to find it',
      referenceAnswer: 'x = 4',
      evaluatorCorrectness: 0.9,
      hintDelta: 0,
    });
    expect(outcome.outcome).toBe('independent_correct');
    expect(outcome.correctnessSource).toBe('evaluator');
    expect(outcome.confidence).toBe(0.7);
  });

  it('unavailable deterministic + unavailable evaluator produces unavailable evidence', () => {
    // 12. unavailable deterministic + unavailable evaluator produces unavailable evidence
    const outcome = resolveTransferOutcome({
      studentAnswer: 'I used a graph',
      referenceAnswer: 'x = 4',
      evaluatorCorrectness: null,
      hintDelta: 0,
    });
    expect(outcome.outcome).toBe(null);
    expect(outcome.correctnessSource).toBe('unavailable');
    expect(outcome.confidence).toBe(0);
  });
});
