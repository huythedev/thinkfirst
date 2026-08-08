'use client';

import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { useIndependenceProfile } from '@/hooks/use-independence-profile';
import { COMPONENT_WEIGHTS, INDEPENDENCE_BANDS, mayDisplayScore } from '@/lib/scoring/independence';
import { ComponentScore } from '@/lib/types/scoring';

/**
 * The student's own progress view.
 *
 * Two section 56 rules shape this page, and both are visible in the markup:
 *
 * - The numbers are **read**, never computed here. They come from
 *   `independenceSnapshots` through `/api/session/progress`. Phase 5's exit
 *   criterion rules out recomputation in the browser on read.
 * - When suppression applies, no score, no band and no trend are rendered at
 *   all. §56.4 requires an unknown score to look unknown, so the breakdown is
 *   shown with "Not enough practice yet to estimate this." rather than a number
 *   the evidence cannot support.
 */

const BAND_STYLES: Record<string, { ring: string; text: string; chip: string }> = {
  increasingly_independent: {
    ring: 'border-green-500',
    text: 'text-green-700',
    chip: 'bg-green-100 text-green-700',
  },
  developing_independence: {
    ring: 'border-blue-500',
    text: 'text-blue-700',
    chip: 'bg-blue-100 text-blue-700',
  },
  benefits_from_guided_support: {
    ring: 'border-amber-500',
    text: 'text-amber-700',
    chip: 'bg-amber-100 text-amber-700',
  },
  needs_structured_practice: {
    ring: 'border-orange-500',
    text: 'text-orange-700',
    chip: 'bg-orange-100 text-orange-700',
  },
};

const STATE_LABELS: Record<string, string> = {
  observed: '',
  not_applicable: 'did not come up',
  declined: 'offered, not taken',
  unavailable: 'not recorded',
};

function ComponentBar({ component }: { component: ComponentScore }) {
  const scored = component.value !== null && component.confidence > 0;
  const percentage = scored ? Math.round((component.value ?? 0) * 100) : 0;
  const stateLabel = STATE_LABELS[component.state] ?? '';

  return (
    <div className="py-4 border-b border-gray-100 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium text-gray-800">{component.label}</p>
        <p className="text-sm text-gray-500 shrink-0">
          {scored ? `${percentage}%` : stateLabel || '—'}
        </p>
      </div>
      <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            component.state === 'declined' ? 'bg-amber-500' : scored ? 'bg-blue-500' : 'bg-gray-200'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-sm text-gray-500 mt-2">{component.rationale}</p>
      {scored && component.confidence < 1 && (
        <p className="text-xs text-gray-400 mt-1">
          Measured with {Math.round(component.confidence * 100)}% confidence.
        </p>
      )}
    </div>
  );
}

export default function StudentProgress() {
  const { user } = useAuth();
  const { profile, sessions, scoringVersion, loading, error, reload } = useIndependenceProfile(
    user?.uid,
  );

  const bandId = profile?.band ?? null;
  const band = bandId ? INDEPENDENCE_BANDS.find((entry) => entry.id === bandId) : undefined;
  const bandStyle = bandId ? BAND_STYLES[bandId] : null;

  // One decision point, shared with the dashboard and covered by tests, so the
  // §56.4 suppression rule cannot be right on one surface and wrong on another.
  const showScore = mayDisplayScore(profile);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">Your Progress</h1>
        <p className="text-gray-600 mt-2">
          This describes how you learn, not how smart you are. It is never shown as a grade or a
          ranking.
        </p>
      </header>

      {loading && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 animate-pulse space-y-4">
          <div className="h-24 w-24 rounded-full bg-gray-100" />
          <div className="h-4 w-48 bg-gray-100 rounded" />
          <div className="h-3 w-full bg-gray-100 rounded" />
          <div className="h-3 w-2/3 bg-gray-100 rounded" />
        </div>
      )}

      {!loading && error && (
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-8">
          <p className="text-red-700 font-medium">{error}</p>
          <button
            onClick={reload}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && profile === null && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <h2 className="text-xl font-bold text-gray-800">No progress data yet</h2>
          <p className="text-gray-600 mt-2 max-w-md mx-auto">
            Your Independence Score appears once you have worked through a session. It is built from
            what you do while solving, not from right answers alone.
          </p>
          <Link
            href="/student/session/new"
            className="inline-block mt-6 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
          >
            Start a session
          </Link>
        </div>
      )}

      {/*
        Suppression, per §56.4. Deliberately renders no number, no band and no
        trend: the point of the rule is that thin evidence must not be dressed up
        as a confident measurement. The breakdown is still shown, because it is
        true and useful.
      */}
      {!loading && !error && profile && !showScore && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <h2 className="text-xl font-bold text-gray-900">Independence Score</h2>
          <p className="text-gray-600 mt-2">
            {profile.suppressionReason ?? 'Not enough practice yet to estimate this.'}
          </p>
          <p className="text-sm text-gray-500 mt-3">
            You have {profile.sessionsScored} scored{' '}
            {profile.sessionsScored === 1 ? 'session' : 'sessions'}. A score appears once there is
            enough evidence for it to mean something.
          </p>
        </section>
      )}

      {!loading && !error && profile && showScore && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div
              className={`h-24 w-24 shrink-0 rounded-full border-4 flex items-center justify-center ${
                bandStyle?.ring ?? 'border-gray-300'
              }`}
            >
              <span className={`text-3xl font-bold ${bandStyle?.text ?? 'text-gray-700'}`}>
                {profile.score}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold text-gray-900">Independence Score</h2>
                {band && (
                  <span className={`text-xs font-medium px-3 py-1 rounded-full ${bandStyle?.chip}`}>
                    {band.label}
                  </span>
                )}
              </div>
              {band && <p className="text-gray-600 mt-2">{band.description}</p>}
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500">
                <span>
                  {profile.sessionsScored} scored{' '}
                  {profile.sessionsScored === 1 ? 'session' : 'sessions'}
                </span>
                {profile.trend !== null && (
                  <span className={profile.trend >= 0 ? 'text-green-600' : 'text-amber-600'}>
                    {profile.trend >= 0 ? '▲' : '▼'} {Math.abs(profile.trend)} points vs earlier
                    sessions
                  </span>
                )}
                {profile.sessionsExcluded > 0 && (
                  <span>
                    {profile.sessionsExcluded} not scored because something went wrong on our side
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {!loading && !error && profile?.suggestion && (
        <section className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
          <h2 className="font-bold text-blue-900">One thing to try next</h2>
          <p className="text-blue-800 mt-2">{profile.suggestion}</p>
        </section>
      )}

      {!loading && !error && profile && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <h2 className="text-xl font-bold text-gray-900">What makes up your score</h2>
          <p className="text-gray-600 mt-1 text-sm">
            Each part is measured only when a session gives evidence for it. Parts that did not come
            up are not counted against you.
          </p>
          <div className="mt-4">
            {profile.components.map((component) => (
              <ComponentBar key={component.id} component={component} />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Weights: first attempt {COMPONENT_WEIGHTS.firstAttempt}, hint efficiency{' '}
            {COMPONENT_WEIGHTS.hintEfficiency}, reasoning {COMPONENT_WEIGHTS.reasoningExplanation},
            transfer {COMPONENT_WEIGHTS.transferPerformance}, verification{' '}
            {COMPONENT_WEIGHTS.verificationBehavior}. Scoring version{' '}
            {scoringVersion ?? 'unknown'}.
          </p>
        </section>
      )}

      {!loading && !error && sessions.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <h2 className="text-xl font-bold text-gray-900">Recent sessions</h2>
          <div className="mt-4 divide-y divide-gray-100">
            {sessions.slice(0, 10).map((session) => (
              <div
                key={session.sessionId}
                className="py-3 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/student/session/${session.sessionId}`}
                    className="text-blue-600 hover:underline font-medium text-sm"
                  >
                    {session.generatedAt
                      ? new Date(session.generatedAt).toLocaleDateString()
                      : 'Session'}
                  </Link>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {session.excludedForSystemError
                      ? 'Not scored: something went wrong on our side'
                      : session.suppressed
                        ? 'Not enough activity to score'
                        : `Covered ${Math.round(session.coverage * 100)}% of what we look at`}
                  </p>
                </div>
                <span className="text-sm font-semibold text-gray-700 shrink-0">
                  {session.suppressed || session.totalScore === null
                    ? '—'
                    : Math.round(session.totalScore)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
