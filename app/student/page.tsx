'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useIndependenceProfile } from '@/hooks/use-independence-profile';
import { INDEPENDENCE_BANDS, mayDisplayScore } from '@/lib/scoring/independence';
import { useTranslation } from '@/lib/i18n/client';

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
  const { t } = useTranslation();

  if (!profile) return null;

  // The snapshot stores the band id, so the label and description are looked up
  // rather than recomputed: §56.4 requires the displayed value to come from the
  // stored score, not from a second calculation that could disagree with it.
  const band = independence?.band
    ? INDEPENDENCE_BANDS.find((entry) => entry.id === independence.band)
    : undefined;
  const bandStyle = band ? BAND_STYLES[band.id] : 'bg-surface-muted text-foreground-muted';

  // §56.4 suppression: no score and no band unless the server produced one. Shared
  // with the progress page so the rule lives in exactly one place.
  const showScore = mayDisplayScore(independence);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">{t('student.welcome', { name: profile.displayName ?? 'Student' })}</h1>
        <p className="text-foreground-muted mt-2">{t('student.ready')}</p>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-surface p-6 rounded-2xl shadow-sm border border-border flex flex-col items-start">
          <h2 className="text-xl font-bold text-foreground mb-2">{t('student.startNew')}</h2>
          <p className="text-foreground-muted mb-6 flex-1">{t('student.practiceDesc')}</p>
          <button 
            onClick={() => router.push('/student/session/new')}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
          >
            {t('student.startLearning')}
          </button>
        </div>

        <div className="bg-surface p-6 rounded-2xl shadow-sm border border-border flex flex-col">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold text-foreground mb-2">{t('student.yourProgress')}</h2>
            <Link href="/student/progress" className="text-sm font-medium text-blue-600 hover:underline">
              {t('student.details')}
            </Link>
          </div>

          {loading && (
            <div className="flex items-center gap-4 mt-4 animate-pulse">
              <div className="h-16 w-16 rounded-full bg-surface-muted" />
              <div className="space-y-2">
                <div className="h-4 w-32 bg-surface-muted rounded" />
                <div className="h-3 w-40 bg-surface-muted rounded" />
              </div>
            </div>
          )}

          {!loading && error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          {!loading && !error && (independence === null || !showScore) && (
            <div className="mt-4 flex-1">
              <p className="font-semibold text-foreground">{t('student.independenceScore')}</p>
              <p className="text-sm text-foreground-muted mt-1">
                {independence?.suppressionReason ?? t('student.notEnoughPractice')}
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
                <p className="font-semibold text-foreground">{t('student.independenceScore')}</p>
                <p className="text-sm text-foreground-muted">{band?.label}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {t('student.basedOn', { count: independence.sessionsScored })}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-surface p-6 rounded-2xl shadow-sm border border-border flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground mb-1">{t('student.classrooms')}</h2>
          <p className="text-foreground-muted">
            {t('student.joinCodeDesc')}
          </p>
        </div>
        <Link
          href="/student/classrooms/join"
          className="px-6 py-3 bg-surface border border-border text-foreground-muted font-medium rounded-xl hover:bg-background"
        >
          {t('student.joinClassroom')}
        </Link>
      </div>
    </div>
  );
}
