'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/components/providers/AuthProvider';
import { MAX_HINT_LEVEL } from '@/lib/types/ai/request';

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
  abandoned: 'bg-gray-100 text-gray-600',
};

export default function SessionListPage() {
  const { user, loading: authLoading } = useAuth();
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
          setError('We could not load your sessions.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // The server cookie can be valid while the client SDK has no user. Firestore
  // reads would then hang unanswered, so treat it as an error state rather than
  // waiting on a query that will never resolve.
  const signedOut = !authLoading && !user;
  const rows = signedOut ? [] : sessions;
  const listError =
    error ?? (signedOut ? 'Your sign-in has expired. Reload the page to continue.' : null);

  return (
    <div className="max-w-4xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My sessions</h1>
          <p className="text-gray-600 mt-1">Pick up where you left off, or start something new.</p>
        </div>
        <Link
          href="/student/session/new"
          className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
        >
          Start a session
        </Link>
      </header>

      {rows === null && (
        <div className="space-y-3" role="status" aria-live="polite">
          <span className="sr-only">Loading your sessions</span>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="bg-white border border-gray-200 rounded-2xl p-5 animate-pulse space-y-3"
            >
              <div className="h-4 w-2/3 bg-gray-100 rounded" />
              <div className="h-3 w-1/3 bg-gray-100 rounded" />
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
            Try again
          </button>
        </div>
      )}

      {rows !== null && !listError && rows.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-12 text-center">
          <h2 className="text-lg font-semibold text-gray-800">No sessions yet</h2>
          <p className="text-gray-600 mt-2 max-w-md mx-auto">
            Start a session with a problem you are working on, and your conversation will be
            saved here so you can come back to it.
          </p>
          <Link
            href="/student/session/new"
            className="inline-block mt-6 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
          >
            Start your first session
          </Link>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((session) => (
            <li key={session.id}>
              <Link
                href={`/student/session/${session.id}`}
                className="block bg-white border border-gray-200 rounded-2xl p-5 hover:border-blue-400 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium text-gray-900 line-clamp-2 flex-1">
                    {session.originalProblem || 'Untitled problem'}
                  </p>
                  <span
                    className={`text-xs px-2 py-1 rounded font-medium capitalize shrink-0 ${
                      STATUS_STYLES[session.status] ?? STATUS_STYLES.abandoned
                    }`}
                  >
                    {session.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-gray-500">
                  <span className="capitalize">{session.subject}</span>
                  <span className="capitalize">{session.mode}</span>
                  <span>
                    Hint level {session.currentHintLevel} / {MAX_HINT_LEVEL}
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
