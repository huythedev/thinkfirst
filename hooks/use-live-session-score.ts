'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { SCORING_VERSION, type ComponentScore, type SessionScore } from '@/lib/types/scoring';

function snapshotToSessionScore(data: Record<string, unknown>, sessionId: string): SessionScore | null {
  if (data.kind !== 'session' || data.sessionId !== sessionId) return null;
  const rawScore = typeof data.totalScore === 'number' ? data.totalScore : null;
  const coverage = typeof data.coverage === 'number' ? data.coverage : 0;
  const componentDetail = Array.isArray(data.componentDetail)
    ? data.componentDetail as ComponentScore[]
    : [];

  return {
    sessionId,
    occurredAt: null,
    rawScore,
    coverage,
    displaySuppressed: data.suppressed === true,
    components: componentDetail,
    excludedForSystemError: data.excludedForSystemError === true,
    scoringVersion: typeof data.scoringVersion === 'string' ? data.scoringVersion : SCORING_VERSION,
  };
}

/**
 * Reads the server-persisted session snapshot.  The browser intentionally does
 * not derive metrics or score a transcript: evaluator evidence is server-owned
 * and the persisted snapshot is the sole score of record.
 */
export function useLiveSessionScore(sessionId: string | null): { score: SessionScore | null } {
  const [score, setScore] = useState<SessionScore | null>(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    return onSnapshot(
      doc(db, 'independenceSnapshots', `${sessionId}__${SCORING_VERSION}`),
      (snapshot) => setScore(snapshot.exists() ? snapshotToSessionScore(snapshot.data(), sessionId) : null),
      () => setScore(null),
    );
  }, [sessionId]);

  return { score };
}
