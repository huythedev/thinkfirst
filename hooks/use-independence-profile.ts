'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { ComponentScore } from '@/lib/types/scoring';

/**
 * Reads the student's **persisted** Independence Score snapshot.
 *
 * This hook used to load every session and transcript and recompute the profile
 * in the browser. Phase 5's exit criterion rules that out in as many words:
 * "Recomputation in the browser on read fails this criterion." The score is now
 * computed server-side when a turn is processed and written to
 * `independenceSnapshots`, which the client cannot write, and this hook fetches
 * that document through `/api/session/progress`.
 *
 * The difference is not merely architectural. A recomputed score is not covered
 * by the security rule that protects the stored one, and the browser held enough
 * of the algorithm to produce whatever number it liked.
 */

export interface StoredProfile {
  score: number | null;
  band: string | null;
  trend: number | null;
  suppressed: boolean;
  suppressionReason: string | null;
  evidenceWeight: number;
  sessionsScored: number;
  sessionsConsidered: number;
  sessionsExcluded: number;
  suggestion: string | null;
  suggestionCode?: string | null;
  components: ComponentScore[];
  generatedAt: string | null;
}

export interface StoredSessionScore {
  sessionId: string;
  totalScore: number | null;
  coverage: number;
  suppressed: boolean;
  excludedForSystemError: boolean;
  generatedAt: string | null;
}

interface UseIndependenceProfileResult {
  profile: StoredProfile | null;
  sessions: StoredSessionScore[];
  scoringVersion: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface LoadedState {
  key: string;
  profile: StoredProfile | null;
  sessions: StoredSessionScore[];
  scoringVersion: string | null;
  error: string | null;
}

export function useIndependenceProfile(studentId: string | undefined): UseIndependenceProfileResult {
  const { user } = useAuth();
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const key = `${studentId ?? ''}:${reloadToken}`;

  /**
   * The snapshot is fetched once, so a student returning from a session would
   * otherwise see the score they had when the page first loaded. Refetching when
   * the tab regains focus keeps it current without holding an extra realtime
   * listener open on every session.
   */
  useEffect(() => {
    if (!studentId) return;

    const refresh = () => {
      if (document.visibilityState === 'visible') reload();
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [studentId, reload]);

  useEffect(() => {
    if (!studentId || !user) return;

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(window.location.origin + '/api/session/progress');

        if (!response.ok) throw new Error(`progress request failed: ${response.status}`);

        const body = (await response.json()) as {
          profile: StoredProfile | null;
          sessions: StoredSessionScore[];
          scoringVersion: string;
        };

        if (!cancelled) {
          setLoaded({
            key,
            profile: body.profile,
            sessions: body.sessions ?? [],
            scoringVersion: body.scoringVersion ?? null,
            error: null,
          });
        }
      } catch (cause) {
        console.error('Failed to load independence profile', cause);
        if (!cancelled) {
          setLoaded({
            key,
            profile: null,
            sessions: [],
            scoringVersion: null,
            error: 'We could not load your progress right now.',
          });
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [studentId, user, key]);

  // Derived rather than stored, so the effect never calls setState synchronously
  // and a stale result from a previous studentId is ignored.
  const settled = loaded?.key === key ? loaded : null;

  return {
    profile: settled?.profile ?? null,
    sessions: settled?.sessions ?? [],
    scoringVersion: settled?.scoringVersion ?? null,
    loading: Boolean(studentId) && settled === null,
    error: settled?.error ?? null,
    reload,
  };
}
