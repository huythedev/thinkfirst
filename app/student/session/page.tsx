'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/components/providers/AuthProvider';
import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import { useTranslation } from '@/lib/i18n/client';

interface SessionRow {
  id: string;
  originalProblem: string;
  subject: string;
  mode: string;
  status: string;
  currentHintLevel: number;
  startedAt: Date | null;
}

/** Firestore Timestamp, Date, or absent. */
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  abandoned: 'bg-surface-muted text-foreground-muted',
};

export default function SessionListPage() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The signed-out case is derived at render time instead of pushed from here,
    // so the skeleton cannot render forever when the client SDK settles with no
    // user, and no cascading render is triggered.
    if (authLoading || !user) return;
    let cancelled = false;

    // No orderBy: ordering happens in memory so this needs no composite index,
    // matching the approach in lib/scoring/server.ts.
    getDocs(query(collection(db, 'learningSessions'), where('studentId', '==', user.uid)))
      .then((snapshot) => {
        if (cancelled) return;
        const rows = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            originalProblem: typeof data.originalProblem === 'string' ? data.originalProblem : '',
            subject: typeof data.subject === 'string' ? data.subject : '',
            mode: typeof data.mode === 'string' ? data.mode : '',
            status: typeof data.status === 'string' ? data.status : 'active',
            currentHintLevel: typeof data.currentHintLevel === 'number' ? data.currentHintLevel : 0,
            startedAt: toDate(data.startedAt),
          };
        });
        rows.sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));
        setSessions(rows);
        setError(null);
      })
      .catch((cause) => {
        console.error('Failed to load sessions', cause);
        if (!cancelled) {
          setSessions([]);
          setError(t('mySessions.error_fallback', { defaultValue: 'We could not load your sessions.' }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, t]);

  // The server cookie can be valid while the client SDK has no user. Firestore
  // reads would then hang unanswered, so treat it as an error state rather than
  // waiting on a query that will never resolve.
  const signedOut = !authLoading && !user;
  const rows = signedOut ? [] : sessions;
  const listError =
    error ?? (signedOut ? t('mySessions.sessionExpired') : null);

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('mySessions.title')}</h1>
          <p className="text-foreground-muted mt-1">{t('mySessions.subtitle')}</p>
        </div>
        <Link
          href="/student/session/new"
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
        >
          {t('mySessions.startSession')}
        </Link>
      </header>

      {rows === null && (
        <div className="space-y-3" role="status" aria-live="polite">
          <span className="sr-only">{t('mySessions.loading')}</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="bg-surface border border-border rounded-2xl p-5 animate-pulse space-y-3"
            >
              <div className="h-4 w-2/3 bg-surface-muted rounded" />
              <div className="h-3 w-1/3 bg-surface-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {listError && (
        <div role="alert" className="bg-red-50 text-red-700 rounded-2xl p-6">
          <p className="font-medium">{listError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm font-medium underline"
          >
            {t('mySessions.tryAgain')}
          </button>
        </div>
      )}

      {rows !== null && !listError && rows.length === 0 && (
        <div className="bg-surface border border-dashed border-border rounded-2xl p-12 text-center">
          <h2 className="text-lg font-semibold text-foreground">{t('mySessions.noSessionsTitle')}</h2>
          <p className="text-foreground-muted mt-2 max-w-md mx-auto">
            {t('mySessions.noSessionsDesc')}
          </p>
          <Link
            href="/student/session/new"
            className="inline-block mt-6 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
          >
            {t('mySessions.startFirst')}
          </Link>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((session) => (
            <li key={session.id}>
              <Link
                href={`/student/session/${session.id}`}
                className="block bg-surface border border-border rounded-2xl p-5 hover:border-blue-400 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium text-foreground line-clamp-2 flex-1">
                    {session.originalProblem || t('mySessions.untitledProblem')}
                  </p>
                  <span
                    className={`text-xs px-2 py-1 rounded font-medium capitalize shrink-0 ${
                      STATUS_STYLES[session.status] ?? STATUS_STYLES.abandoned
                    }`}
                  >
                    {t(`domain.sessionStatus.${session.status}`) || session.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-foreground-muted">
                  <span className="capitalize">{t(`domain.subjects.${session.subject}`) || session.subject}</span>
                  <span className="capitalize">{t(`domain.modes.${session.mode}`) || session.mode}</span>
                  <span>
                    {t('mySessions.hintLevel', { current: session.currentHintLevel, max: MAX_HINT_LEVEL })}
                  </span>
                  {session.startedAt && <span>{session.startedAt.toLocaleDateString()}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
