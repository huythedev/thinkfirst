'use client';

import Link from 'next/link';
import { MetricCard, CoverageNote } from '@/components/teacher/MetricCard';
import { useTeacherApi, type ObservedMetricValue } from '@/hooks/use-teacher-api';

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
      <div className="bg-white border border-red-200 rounded-lg p-6" role="alert">
        <h2 className="text-lg font-semibold text-gray-900">Dashboard could not be loaded</h2>
        <p className="text-sm text-gray-600 mt-2">{error}</p>
        <button
          onClick={reload}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { totals, classrooms, topicsNeedingReview } = data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-2">
          Across {totals.classroomCount} {totals.classroomCount === 1 ? 'classroom' : 'classrooms'}{' '}
          and {totals.studentCount} {totals.studentCount === 1 ? 'student' : 'students'}.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          label="Active students"
          metric={totals.activeStudentsThisWeek}
          format="count"
          caption="In the last 7 days"
          help="Students who started or completed at least one learning session in the last seven days."
        />
        <MetricCard
          label="Sessions completed"
          metric={totals.sessionsCompletedThisWeek}
          format="count"
          caption={`${totals.sessionsCompletedTotal} in total`}
          help="Learning sessions marked completed in the last seven days."
        />
        <MetricCard
          label="Attempt before help"
          metric={totals.attemptBeforeHelpRate}
          format="percent"
          help="How often a student made a genuine attempt before asking for help. Sessions where this was not instrumented are excluded rather than counted as no attempt."
        />
        <MetricCard
          label="Transfer success"
          metric={totals.transferSuccessRate}
          format="percent"
          help="Transfer success measures performance on a similar problem after guided assistance. It is not an official grade."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">Your classrooms</h2>
              <Link
                href="/teacher/classrooms"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                View all
              </Link>
            </div>
            {classrooms.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <p className="mb-4">You have not created any classrooms yet.</p>
                <Link
                  href="/teacher/classrooms/new"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 inline-block"
                >
                  Create classroom
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {classrooms.map((classroom) => (
                  <li key={classroom.id}>
                    <Link
                      href={`/teacher/classrooms/${classroom.id}`}
                      className="block hover:bg-gray-50 p-6"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-lg font-medium text-blue-600">{classroom.name}</p>
                          <p className="text-sm text-gray-500 mt-1">
                            Grade {classroom.grade} &middot; {classroom.subject} &middot;{' '}
                            {classroom.memberCount}{' '}
                            {classroom.memberCount === 1 ? 'student' : 'students'}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm text-gray-500">Active this week</p>
                          <p className="text-xl font-semibold text-gray-900">
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

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">Topics needing review</h2>
            </div>
            {topicsNeedingReview.length === 0 ? (
              <div className="p-8 text-center text-gray-500 text-sm">
                <p>No topic currently shows a wide gap between guided and independent work.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {topicsNeedingReview.map((topic) => (
                  <li key={`${topic.classroomId}-${topic.subject}-${topic.topic}`} className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-gray-900">{topic.topic}</p>
                        <p className="text-sm text-gray-500 mt-1">
                          {topic.classroomName} &middot; {topic.subject} &middot;{' '}
                          {topic.studentCount}{' '}
                          {topic.studentCount === 1 ? 'student' : 'students'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm text-gray-500">Guided minus independent</p>
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
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Class-wide evidence</h2>
            <div>
              <p className="text-sm text-gray-500">Average highest hint level</p>
              <p className="text-2xl font-bold text-gray-900">
                {totals.averageHintLevel.value === null
                  ? 'Not yet measured'
                  : totals.averageHintLevel.value.toFixed(1)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                On the 0 to 7 hint ladder. A higher number means students needed more guidance
                to reach an answer.
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">AI answers reported as incorrect</p>
              <p className="text-2xl font-bold text-gray-900">{totals.openReportCount}</p>
              <p className="text-xs text-gray-500 mt-1">Open reports awaiting review.</p>
            </div>
            <CoverageNote coverage={totals.evidenceCoverage} />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-blue-900">How to read these numbers</h2>
            <p className="text-sm text-blue-800 mt-2">
              These figures describe learning behavior, not achievement. They are not grades,
              and a low number is a prompt to look closer rather than a judgment about a
              student.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
