'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * Fetches a teacher API endpoint with the caller's ID token attached.
 *
 * Every teacher surface reads through `/api/teacher/*` rather than through a
 * Firestore query, because none of this data is client-readable: aggregates are
 * cross-user, and `firestore.rules` gives teachers no read over student
 * sessions, snapshots or attempts. Authorization happens server-side in
 * `requireClassroomOwner`.
 *
 * `notFound` is separated from `error` because a 404 here is a normal state --
 * a classroom that was deleted, or one that is not yours -- and should render as
 * "not found", not as a failure banner.
 */

interface TeacherApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  reload: () => void;
}

export function useTeacherApi<T>(path: string | null): TeacherApiState<T> {
  const { user } = useAuth();
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    notFound: boolean;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const key = `${path ?? ''}:${reloadToken}`;

  useEffect(() => {
    if (!path || !user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(path, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });

        if (response.status === 404) {
          if (!cancelled) setState({ key, data: null, error: null, notFound: true });
          return;
        }

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            typeof body.error === 'string' ? body.error : `Request failed (${response.status})`,
          );
        }

        const body = (await response.json()) as T;
        if (!cancelled) setState({ key, data: body, error: null, notFound: false });
      } catch (error) {
        if (!cancelled) {
          setState({
            key,
            data: null,
            notFound: false,
            error: error instanceof Error ? error.message : 'Request failed.',
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [path, user, key]);

  const settled = state?.key === key;

  return {
    data: settled ? state.data : null,
    loading: Boolean(path) && (!user || !settled),
    error: settled ? state.error : null,
    notFound: settled ? state.notFound : false,
    reload,
  };
}

/** The shape every aggregate metric arrives in. Mirrors `ObservedMetric`. */
export interface ObservedMetricValue {
  value: number | null;
  observed: number;
  total: number;
}
