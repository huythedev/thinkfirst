'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { useIndependenceProfile } from '@/hooks/use-independence-profile';
import { COMPONENT_WEIGHTS, INDEPENDENCE_BANDS, mayDisplayScore } from '@/lib/scoring/independence';
import { ComponentScore } from '@/lib/types/scoring';
import { useTranslation } from '@/lib/i18n/client';
import { IndependenceScoreModal } from '@/components/ExplanationModals';

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

function ComponentBar({ component }: { component: ComponentScore }) {
  const { t } = useTranslation();
  const scored = component.value !== null && component.confidence > 0;
  const percentage = scored ? Math.round((component.value ?? 0) * 100) : 0;
  
  const getLabel = (id: string, originalLabel: string) => {
    switch (id) {
      case 'firstAttempt': return t('session.firstTry');
      case 'hintEfficiency': return t('session.hintUse');
      case 'reasoningExplanation': return t('session.explaining');
      case 'transferPerformance': return t('session.transfer');
      case 'verificationBehavior': return t('session.checking');
      default: return originalLabel;
    }
  };

  let stateLabel = '';
  switch (component.state) {
    case 'not_applicable': stateLabel = t('progress.notApplicable'); break;
    case 'declined': stateLabel = t('progress.declined'); break;
    case 'unavailable': stateLabel = t('progress.unavailable'); break;
    case 'observed': stateLabel = t('progress.observed'); break;
  }

  return (
    <div className="py-4 border-b border-border last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-medium text-foreground">{getLabel(component.id, component.label)}</p>
        <p className="text-sm text-foreground-muted shrink-0">
          {scored ? `${percentage}%` : stateLabel || '—'}
        </p>
      </div>
      <div className="h-2 bg-surface-muted rounded-full mt-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            component.state === 'declined' ? 'bg-background0' : scored ? 'bg-blue-500' : 'bg-gray-200'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <p className="text-sm text-foreground-muted mt-2">
        {component.rationaleCode ? t(`progress.evidence.${component.rationaleCode}`, {
          ceiling: component.rationale.match(/level (\d+) available/)?.[1] || '',
          effectiveHint: component.rationale.match(/up to level (\d+)/)?.[1] || '',
          met: component.rationale.match(/Met (\d+) of/)?.[1] || ''
        }) : component.rationale}
      </p>
      {scored && component.confidence < 1 && (
        <p className="text-xs text-gray-400 mt-1">
          {t('progress.measuredWithConfidence', { confidence: Math.round(component.confidence * 100) })}
        </p>
      )}
    </div>
  );
}

export default function StudentProgress() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [isScoreModalOpen, setIsScoreModalOpen] = useState(false);

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
    <>
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-foreground">{t('progress.title')}</h1>
          <p className="text-foreground-muted mt-2">
            {t('progress.desc')}
          </p>
        </header>

        {loading && (
          <div className="bg-surface rounded-2xl border border-border shadow-sm p-8 animate-pulse space-y-4">
            <div className="h-24 w-24 rounded-full bg-surface-muted" />
            <div className="h-4 w-48 bg-surface-muted rounded" />
            <div className="h-3 w-full bg-surface-muted rounded" />
            <div className="h-3 w-2/3 bg-surface-muted rounded" />
          </div>
        )}

        {!loading && error && (
          <div className="bg-surface rounded-2xl border border-red-100 shadow-sm p-8">
            <p className="text-red-700 font-medium">{error}</p>
            <button
              onClick={reload}
              className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              {t('teacher.tryAgain')}
            </button>
          </div>
        )}

        {!loading && !error && profile === null && (
          <div className="bg-surface rounded-2xl border border-border shadow-sm p-10 text-center">
            <h2 className="text-xl font-bold text-foreground">{t('progress.noDataTitle')}</h2>
            <p className="text-foreground-muted mt-2 max-w-md mx-auto">
              {t('progress.noDataDesc')}
            </p>
            <Link
              href="/student/session/new"
              className="inline-block mt-6 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
            >
              {t('progress.startSession')}
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
          <section className="bg-surface rounded-2xl border border-border shadow-sm p-8">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-foreground">{t('progress.score')}</h2>
              <button
                type="button"
                onClick={() => setIsScoreModalOpen(true)}
                className="text-gray-400 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                aria-label={t('progress.infoBtn')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              </button>
            </div>
            <p className="text-foreground-muted">
              {profile.suppressionReason ?? t('progress.suppressedDesc')}
            </p>
            <p className="text-sm text-foreground-muted mt-3">
              {t('progress.sessionsScored', { count: profile.sessionsScored })}
            </p>
          </section>
        )}

        {!loading && !error && profile && showScore && (
          <section className="bg-surface rounded-2xl border border-border shadow-sm p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div
                className={`h-24 w-24 shrink-0 rounded-full border-4 flex items-center justify-center ${
                  bandStyle?.ring ?? 'border-border'
                }`}
              >
                <span className={`text-3xl font-bold ${bandStyle?.text ?? 'text-foreground-muted'}`}>
                  {profile.score}
                </span>
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-foreground">{t('progress.score')}</h2>
                    <button
                      type="button"
                      onClick={() => setIsScoreModalOpen(true)}
                      className="text-gray-400 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                      aria-label={t('progress.infoBtn')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </button>
                  </div>
                  {band && (
                    <span className={`text-xs font-medium px-3 py-1 rounded-full ${bandStyle?.chip}`}>
                      {band.label}
                    </span>
                  )}
                </div>
                {band && <p className="text-foreground-muted mt-2">{band.description}</p>}
                <div className="flex flex-wrap gap-4 mt-3 text-sm text-foreground-muted">
                  <span>
                    {t('progress.scoredSessions', { count: profile.sessionsScored })}
                  </span>
                  {profile.trend !== null && (
                    <span className={profile.trend >= 0 ? 'text-green-600' : 'text-amber-600'}>
                      {profile.trend >= 0 
                        ? t('progress.trendUp', { points: Math.abs(profile.trend) }) 
                        : t('progress.trendDown', { points: Math.abs(profile.trend) })}
                    </span>
                  )}
                  {profile.sessionsExcluded > 0 && (
                    <span>
                      {t('progress.excluded', { count: profile.sessionsExcluded })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {!loading && !error && (profile?.suggestionCode || profile?.suggestion) && (
          <section className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <h2 className="font-bold text-blue-900">{t('progress.tryNext')}</h2>
            <p className="text-blue-800 mt-2">{profile.suggestionCode ? t(`progress.recommendations.${profile.suggestionCode}`) : profile.suggestion}</p>
          </section>
        )}

        {!loading && !error && profile && (
          <section className="bg-surface rounded-2xl border border-border shadow-sm p-8">
            <h2 className="text-xl font-bold text-foreground">{t('progress.whatMakesUpScore')}</h2>
            <p className="text-foreground-muted mt-1 text-sm">
              {t('progress.whatMakesUpScoreDesc')}
            </p>
            <div className="mt-4">
              {profile.components.map((component) => (
                <ComponentBar key={component.id} component={component} />
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-4">
              {t('progress.weights', { 
                firstAttempt: COMPONENT_WEIGHTS.firstAttempt, 
                hintEfficiency: COMPONENT_WEIGHTS.hintEfficiency, 
                reasoningExplanation: COMPONENT_WEIGHTS.reasoningExplanation, 
                transferPerformance: COMPONENT_WEIGHTS.transferPerformance, 
                verificationBehavior: COMPONENT_WEIGHTS.verificationBehavior,
                scoringVersion: scoringVersion ?? 'unknown'
              })}
            </p>
          </section>
        )}

        {!loading && !error && sessions.length > 0 && (
          <section className="bg-surface rounded-2xl border border-border shadow-sm p-8">
            <h2 className="text-xl font-bold text-foreground">{t('progress.recentSessions')}</h2>
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
                    <p className="text-xs text-foreground-muted mt-0.5">
                      {session.excludedForSystemError
                        ? t('progress.notScoredError')
                        : session.suppressed
                          ? t('progress.notScoredSuppressed')
                          : t('progress.covered', { coverage: Math.round(session.coverage * 100) })}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-foreground-muted shrink-0">
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
      
      <IndependenceScoreModal 
        isOpen={isScoreModalOpen}
        onClose={() => setIsScoreModalOpen(false)}
      />
    </>
  );
}
