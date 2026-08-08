'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useIndependenceProfile } from '@/hooks/use-independence-profile';
import { INDEPENDENCE_BANDS, mayDisplayScore } from '@/lib/scoring/independence';

const BAND_STYLES: Record<string, string> = {
  increasingly_independent: 'bg-green-100 text-green-700',
  developing_independence: 'bg-blue-100 text-blue-700',
  benefits_from_guided_support: 'bg-amber-100 text-amber-700',
  needs_structured_practice: 'bg-orange-100 text-orange-700',
};

export default function StudentDashboard() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { profile: independence, loading, error } = useIndependenceProfile(user?.uid);

  if (!profile) return null;

  // The snapshot stores the band id, so the label and description are looked up
  // rather than recomputed: §56.4 requires the displayed value to come from the
  // stored score, not from a second calculation that could disagree with it.
  const band = independence?.band
    ? INDEPENDENCE_BANDS.find((entry) => entry.id === independence.band)
    : undefined;
  const bandStyle = band ? BAND_STYLES[band.id] : 'bg-gray-100 text-gray-500';

  // §56.4 suppression: no score and no band unless the server produced one. Shared
  // with the progress page so the rule lives in exactly one place.
  const showScore = mayDisplayScore(independence);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Welcome, {profile.displayName}</h1>
        <p className="text-gray-600 mt-2">Ready to learn today?</p>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-start">
          <h2 className="text-xl font-bold text-gray-800 mb-2">Start a new session</h2>
          <p className="text-gray-600 mb-6 flex-1">Practice math or science with your adaptive AI tutor.</p>
          <button 
            onClick={() => router.push('/student/session/new')}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
          >
            Start Learning
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold text-gray-800 mb-2">Your Progress</h2>
            <Link href="/student/progress" className="text-sm font-medium text-blue-600 hover:underline">
              Details
            </Link>
          </div>

          {loading && (
            <div className="flex items-center gap-4 mt-4 animate-pulse">
              <div className="h-16 w-16 rounded-full bg-gray-100" />
              <div className="space-y-2">
                <div className="h-4 w-32 bg-gray-100 rounded" />
                <div className="h-3 w-40 bg-gray-100 rounded" />
              </div>
            </div>
          )}

          {!loading && error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          {!loading && !error && (independence === null || !showScore) && (
            <div className="mt-4 flex-1">
              <p className="font-semibold text-gray-800">Independence Score</p>
              <p className="text-sm text-gray-500 mt-1">
                {independence?.suppressionReason ??
                  'Not enough practice yet to estimate this. Work through a session to see how you are learning.'}
              </p>
            </div>
          )}

          {!loading && !error && independence && showScore && (
            <div className="flex items-center gap-4 mt-4">
              <div
                className={`h-16 w-16 rounded-full flex items-center justify-center font-bold text-xl ${bandStyle}`}
              >
                {independence.score}
              </div>
              <div>
                <p className="font-semibold text-gray-800">Independence Score</p>
                <p className="text-sm text-gray-500">{band?.label}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Based on {independence.sessionsScored}{' '}
                  {independence.sessionsScored === 1 ? 'session' : 'sessions'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The join flow existed but nothing linked to it, so a student could not
          reach a classroom without typing the URL. */}
      <div className="mt-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">Classrooms</h2>
          <p className="text-gray-600">
            Have a join code from your teacher? Add yourself to their classroom.
          </p>
        </div>
        <Link
          href="/student/classrooms/join"
          className="px-6 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50"
        >
          Join a classroom
        </Link>
      </div>
    </div>
  );
}
