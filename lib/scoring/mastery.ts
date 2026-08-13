import { scoreSession } from '@/lib/scoring/independence';
import type { SessionMetrics } from '@/lib/types/scoring';

export interface DerivedMasteryRow {
  studentId: string;
  subject: string;
  topic: string;
  guidedAccuracy: number;
  independentAccuracy: number;
  averageHintLevel: number;
  transferSuccessRate: number;
  sessionCount: number;
}
/** Derives topic mastery from exactly the supplied session metrics. */
export function deriveMasteryRows(
  studentId: string,
  allMetrics: SessionMetrics[],
): DerivedMasteryRow[] {
  const scorable = allMetrics.filter(
    (metrics) => !metrics.endedWithSystemError && metrics.topic && metrics.subject,
  );
  if (scorable.length === 0) return [];

  const groups = new Map<string, SessionMetrics[]>();
  for (const metrics of scorable) {
    const key = `${metrics.subject}\u0000${metrics.topic}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(metrics);
    else groups.set(key, [metrics]);
  }

  return [...groups.values()].map((group) => {
    const guided = group.filter((metrics) => (metrics.highestHintUsed ?? 0) > 0);
    const independent = group.filter((metrics) => (metrics.highestHintUsed ?? 0) === 0);

    const accuracyOf = (sessions: SessionMetrics[]): number => {
      const scored = sessions
        .map((metrics) => scoreSession(metrics))
        .filter((score) => score.rawScore !== null);
      if (scored.length === 0) return 0;
      return (
        Math.round(
          (scored.reduce((sum, score) => sum + (score.rawScore ?? 0), 0) / scored.length) * 100,
        ) / 10000
      );
    };

    const hintLevels = group
      .map((metrics) => metrics.highestHintUsed)
      .filter((level): level is number => typeof level === 'number');
    const transferAttempts = group.filter((metrics) => metrics.transfer.issued);
    const transferSuccesses = transferAttempts.filter((metrics) =>
      ['independent_correct', 'minor_prompt', 'one_conceptual_hint'].includes(
        metrics.transfer.outcome ?? '',
      ),
    );

    return {
      studentId,
      subject: group[0].subject!,
      topic: group[0].topic!,
      guidedAccuracy: accuracyOf(guided),
      independentAccuracy: accuracyOf(independent),
      averageHintLevel:
        hintLevels.length === 0
          ? 0
          : Math.round(
              (hintLevels.reduce((sum, level) => sum + level, 0) / hintLevels.length) * 100,
            ) / 100,
      transferSuccessRate:
        transferAttempts.length === 0
          ? 0
          : Math.round((transferSuccesses.length / transferAttempts.length) * 10000) / 10000,
      sessionCount: group.length,
    };
  });
}
