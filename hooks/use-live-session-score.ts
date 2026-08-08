'use client';

import { useMemo } from 'react';
import { scoreSession } from '@/lib/scoring/independence';
import { deriveSessionMetrics, RawAttempt, RawSession, RawTurn } from '@/lib/scoring/metrics';
import { SessionMetrics, SessionScore } from '@/lib/types/scoring';

interface LiveSessionScore {
  metrics: SessionMetrics | null;
  score: SessionScore | null;
}

/**
 * Derives an in-progress view of the current session from data the workspace
 * already has: turns streaming in over `onSnapshot`, plus the stored attempt
 * evaluations the server wrote.
 *
 * This is a live *indicator*, not the score of record. The score that counts is
 * computed server-side and persisted to `independenceSnapshots`; this exists so
 * the panel can show which behaviors have registered as the student works,
 * without a model call or an extra query per keystroke.
 */
export function useLiveSessionScore(
  session: RawSession | null,
  turns: RawTurn[],
  attempts: RawAttempt[] = [],
): LiveSessionScore {
  return useMemo(() => {
    if (!session) return { metrics: null, score: null };

    const metrics = deriveSessionMetrics(session, turns, attempts);
    return { metrics, score: scoreSession(metrics) };
  }, [session, turns, attempts]);
}
