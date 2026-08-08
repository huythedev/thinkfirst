'use client';

import Link from 'next/link';
import { MetricCard, CoverageNote } from '@/components/teacher/MetricCard';
import { useTeacherApi, type ObservedMetricValue } from '@/hooks/use-teacher-api';
import { useTranslation } from '@/lib/i18n/client';

/**
 * The teacher dashboard.
 *
 * Every number here is derived from `/api/teacher/overview`, which aggregates
 * under Admin credentials over the classrooms the caller owns. Phase 6's first
 * exit criterion is explicit that "a literal, a dash or a zero placeholder in
 * the source fails this criterion outright"; this page previously rendered `0`,
 * `0`, `--%` and `--%` as hardcoded strings, and its two side panels were
 * hardcoded empty states that no query could ever fill.
 *
 * A metric with no observations still shows no number, but that is now a queried
 * result rather than a placeholder: the denominator was computed and came back
 * zero, and `MetricCard` says so in words instead of printing a confident 0%.
 */

interface OverviewClassroom {
  id: string;
  name: string;
  grade: number | null;
  subject: string | null;
  memberCount: number;
  activeStudentsThisWeek: number;
  sessionsCompletedThisWeek: number;
  independenceAverage: ObservedMetricValue;
  evidenceCoverage: number;
}

interface OverviewResponse {
  classrooms: OverviewClassroom[];
  totals: {
    classroomCount: number;
    studentCount: number;
    activeStudentsThisWeek: number;
    sessionsCompletedThisWeek: number;
    sessionsCompletedTotal: number;
    attemptBeforeHelpRate: ObservedMetricValue;
    transferSuccessRate: ObservedMetricValue;
    averageHintLevel: ObservedMetricValue;
    evidenceCoverage: number;
    openReportCount: number;
  };
  topicsNeedingReview: {
    topic: string;
    subject: string;
    classroomId: string;
    classroomName: string;
    gap: number;
    transferSuccessRate: number;
    studentCount: number;
  }[];
  generatedAt: string;
}

export default function TeacherDashboard() {
  const { data, loading, error, reload } = useTeacherApi<OverviewResponse>('/api/teacher/overview');
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="sr-only">Loading dashboard</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-red-200 rounded-lg p-6" role="alert">
        <h2 className="text-lg font-semibold text-foreground">{t('teacher.dashboardLoadError')}</h2>
        <p className="text-sm text-foreground-muted mt-2">{error}</p>
        <button
          onClick={reload}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          {t('teacher.tryAgain')}
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { totals, classrooms, topicsNeedingReview } = data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t('common.dashboard')}</h1>
        <p className="text-foreground-muted mt-2">
          {t('teacher.dashboardDesc', { classCount: totals.classroomCount, studentCount: totals.studentCount })}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          label={t('teacher.activeStudents')}
          metric={totals.activeStudentsThisWeek}
          format="count"
          caption={t('teacher.activeStudentsCaption')}
          help={t('teacher.activeStudentsHelp')}
        />
        <MetricCard
          label={t('teacher.sessionsCompleted')}
          metric={totals.sessionsCompletedThisWeek}
          format="count"
          caption={t('teacher.sessionsCompletedCaption', { total: totals.sessionsCompletedTotal })}
          help={t('teacher.sessionsCompletedHelp')}
        />
        <MetricCard
          label={t('teacher.attemptBeforeHelp')}
          metric={totals.attemptBeforeHelpRate}
          format="percent"
          help={t('teacher.attemptBeforeHelpHelp')}
        />
        <MetricCard
          label={t('teacher.transferSuccess')}
          metric={totals.transferSuccessRate}
          format="percent"
          help={t('teacher.transferSuccessHelp')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-background">
              <h2 className="text-lg font-semibold text-foreground">{t('teacher.yourClassrooms')}</h2>
              <Link
                href="/teacher/classrooms"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                {t('teacher.viewAll')}
              </Link>
            </div>
            {classrooms.length === 0 ? (
              <div className="p-12 text-center text-foreground-muted">
                <p className="mb-4">{t('teacher.noClassrooms')}</p>
                <Link
                  href="/teacher/classrooms/new"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 inline-block"
                >
                  {t('teacher.createClassroom')}
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {classrooms.map((classroom) => (
                  <li key={classroom.id}>
                    <Link
                      href={`/teacher/classrooms/${classroom.id}`}
                      className="block hover:bg-background p-6"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-lg font-medium text-blue-600">{classroom.name}</p>
                          <p className="text-sm text-foreground-muted mt-1">
                            Grade {classroom.grade} &middot; {classroom.subject} &middot;{' '}
                            {classroom.memberCount}{' '}
                            {classroom.memberCount === 1 ? 'student' : 'students'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm text-foreground-muted">{t('teacher.activeThisWeek')}</p>
                          <p className="text-xl font-semibold text-foreground">
                            {classroom.activeStudentsThisWeek}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-background">
              <h2 className="text-lg font-semibold text-foreground">{t('teacher.topicsReview')}</h2>
            </div>
            {topicsNeedingReview.length === 0 ? (
              <div className="p-8 text-center text-foreground-muted text-sm">
                <p>{t('teacher.noTopicsReview')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {topicsNeedingReview.map((topic) => (
                  <li key={`${topic.classroomId}-${topic.subject}-${topic.topic}`} className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">{topic.topic}</p>
                        <p className="text-sm text-foreground-muted mt-1">
                          {topic.classroomName} &middot; {topic.subject} &middot;{' '}
                          {topic.studentCount}{' '}
                          {topic.studentCount === 1 ? 'student' : 'students'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm text-foreground-muted">{t('teacher.gapPoints')}</p>
                        <p className="text-lg font-semibold text-amber-700">
                          {Math.round(topic.gap * 100)} points
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-surface rounded-lg border border-border shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">{t('teacher.classEvidence')}</h2>
            <div>
              <p className="text-sm text-foreground-muted">{t('teacher.avgHintLevel')}</p>
              <p className="text-2xl font-bold text-foreground">
                {totals.averageHintLevel.value === null
                  ? t('teacher.notMeasured')
                  : totals.averageHintLevel.value.toFixed(1)}
              </p>
              <p className="text-xs text-foreground-muted mt-1">
                {t('teacher.avgHintLevelDesc')}
              </p>
            </div>
            <div>
              <p className="text-sm text-foreground-muted">{t('teacher.reportedIssues')}</p>
              <p className="text-2xl font-bold text-foreground">{totals.openReportCount}</p>
              <p className="text-xs text-foreground-muted mt-1">{t('teacher.reportedIssuesDesc')}</p>
            </div>
            <CoverageNote coverage={totals.evidenceCoverage} />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-blue-900">{t('teacher.howToRead')}</h2>
            <p className="text-sm text-blue-800 mt-2">
              {t('teacher.howToReadDesc')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
