'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MetricCard, CoverageNote } from '@/components/teacher/MetricCard';
import { useTeacherApi, type ObservedMetricValue } from '@/hooks/use-teacher-api';
import { SafetyReviewPanel } from '@/components/teacher/SafetyReviewPanel';

/**
 * One classroom: roster, aggregate analytics and assignments.
 *
 * All three panels were hardcoded empty states before, including the student
 * roster, which never queried `classroomMemberships` at all. They now read
 * `/api/teacher/classrooms/[classroomId]/analytics`, which authorizes ownership
 * server-side. The classroom document itself is returned by that endpoint too,
 * so the page makes one authorized request instead of a client `getDoc` plus a
 * separate aggregate call.
 *
 * There is no transcript affordance anywhere on this page, which is the branch
 * Phase 6's third exit criterion permits when transcript access is not
 * implemented. Section 5.8 is the reason: a teacher should not automatically
 * see every private student message.
 */

interface RosterRow {
  studentId: string;
  displayName: string | null;
  sessionsCompleted: number;
  lastActiveAt: string | null;
  score: number | null;
  band: string | null;
  trend: number | null;
  suppressed: boolean;
  coverage: number;
  averageHintLevel: ObservedMetricValue;
  transferSuccessRate: ObservedMetricValue;
  flags: string[];
}

interface TopicCell {
  topic: string;
  subject: string;
  guidedAccuracy: number;
  independentAccuracy: number;
  averageHintLevel: number;
  transferSuccessRate: number;
  studentCount: number;
  gap: number;
  needsReview: boolean;
}

interface AnalyticsResponse {
  classroom: {
    id: string;
    name: string;
    grade: number;
    subject: string;
    defaultStrictness: string;
    joinCode: string;
  };
  analytics: {
    memberCount: number;
    activeStudentsThisWeek: number;
    sessionsCompletedThisWeek: number;
    sessionsCompletedTotal: number;
    attemptBeforeHelpRate: ObservedMetricValue;
    averageHintLevel: ObservedMetricValue;
    transferSuccessRate: ObservedMetricValue;
    guidedIndependentGap: ObservedMetricValue;
    evidenceCoverage: number;
    openReportCount: number;
    hintLevelDistribution: { level: number; sessions: number }[];
    topicMastery: TopicCell[];
    commonErrorCategories: { category: string; count: number }[];
    roster: RosterRow[];
  };
}

interface AssignmentRow {
  id: string;
  title: string;
  subject: string;
  topic: string | null;
  strictness: string;
  status: string;
  dueAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return 'No activity yet';
  return new Date(value).toLocaleDateString();
}

export default function ClassroomView() {
  const params = useParams();
  const classroomId = typeof params.classroomId === 'string' ? params.classroomId : null;

  const { data, loading, error, notFound } = useTeacherApi<AnalyticsResponse>(
    classroomId ? `/api/teacher/classrooms/${classroomId}/analytics` : null,
  );
  const assignments = useTeacherApi<{ assignments: AssignmentRow[] }>(
    classroomId ? `/api/teacher/classrooms/${classroomId}/assignments` : null,
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="sr-only">Loading classroom</span>
      </div>
    );
  }

  if (notFound || (!data && !error)) {
    return (
      <div className="text-center p-12">
        <h2 className="text-2xl font-bold text-foreground">Classroom not found</h2>
        <p className="text-foreground-muted mt-2">
          It may have been deleted, or it belongs to another teacher.
        </p>
        <Link href="/teacher/classrooms" className="text-blue-600 hover:underline mt-4 inline-block">
          Return to classrooms
        </Link>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-surface border border-red-200 rounded-lg p-6" role="alert">
        <h2 className="text-lg font-semibold text-foreground">Classroom could not be loaded</h2>
        <p className="text-sm text-foreground-muted mt-2">{error}</p>
      </div>
    );
  }

  const { classroom, analytics } = data;
  const maxHintSessions = Math.max(
    1,
    ...analytics.hintLevelDistribution.map((bucket) => bucket.sessions),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/teacher/classrooms" className="text-foreground-muted hover:text-foreground">
          &larr; Back
        </Link>
        <h1 className="text-3xl font-bold text-foreground">{classroom.name}</h1>
      </div>

      <div className="bg-surface p-6 rounded-lg border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground-muted">Subject</p>
          <p className="font-medium text-foreground">
            {classroom.subject} (Grade {classroom.grade})
          </p>
        </div>
        <div>
          <p className="text-sm text-foreground-muted">Join code</p>
          <p className="font-mono text-lg font-bold text-blue-600 tracking-wider bg-blue-50 px-3 py-1 rounded inline-block">
            {classroom.joinCode}
          </p>
        </div>
        <div>
          <p className="text-sm text-foreground-muted">Assistance policy</p>
          <p className="font-medium text-foreground capitalize">
            {classroom.defaultStrictness.replace('_', ' ')}
          </p>
        </div>
      </div>

      {/* Above the metrics deliberately: a student who needs checking on matters
          more than an aggregate, and a panel below four cards is a panel nobody
          scrolls to. */}
        {/* The id from the authorized response, not the URL parameter: by this point
          the server has confirmed this teacher owns it. */}
        <SafetyReviewPanel classroomId={classroom.id} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          label="Students"
          metric={analytics.memberCount}
          format="count"
          caption={`${analytics.activeStudentsThisWeek} active this week`}
          help="Active members of this classroom."
        />
        <MetricCard
          label="Sessions completed"
          metric={analytics.sessionsCompletedThisWeek}
          format="count"
          caption={`${analytics.sessionsCompletedTotal} in total`}
          help="Sessions marked completed in the last seven days."
        />
        <MetricCard
          label="Attempt before help"
          metric={analytics.attemptBeforeHelpRate}
          format="percent"
          help="How often a student made a genuine attempt before asking for help."
        />
        <MetricCard
          label="Transfer success"
          metric={analytics.transferSuccessRate}
          format="percent"
          help="Transfer success measures performance on a similar problem after guided assistance. It is not an official grade."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-background">
              <h2 className="text-lg font-semibold text-foreground">Students</h2>
            </div>
            {analytics.roster.length === 0 ? (
              <div className="p-12 text-center text-foreground-muted">
                <p>No students have joined yet.</p>
                <p className="mt-2 text-sm">
                  Share the join code{' '}
                  <span className="font-mono bg-surface-muted px-1 rounded">{classroom.joinCode}</span>{' '}
                  with your students.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <caption className="sr-only">
                    Students in this classroom, with independence evidence
                  </caption>
                  <thead className="bg-background">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                        Student
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                        Sessions
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                        Independence
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase">
                        Last active
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {analytics.roster.map((row) => (
                      <tr key={row.studentId} className="hover:bg-background">
                        <td className="px-6 py-4">
                          <Link
                            href={`/teacher/classrooms/${classroom.id}/students/${row.studentId}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            {row.displayName ?? 'Student'}
                          </Link>
                          {row.flags.length > 0 && (
                            <ul className="mt-1 space-y-1">
                              {row.flags.map((flag) => (
                                <li key={flag} className="text-xs text-amber-700">
                                  {flag}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground">{row.sessionsCompleted}</td>
                        <td className="px-6 py-4 text-sm">
                          {row.suppressed || row.score === null ? (
                            <span className="text-foreground-muted">Not enough evidence yet</span>
                          ) : (
                            <span className="font-medium text-foreground">{row.score}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-foreground-muted">
                          {formatDate(row.lastActiveAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-background">
              <h2 className="text-lg font-semibold text-foreground">Topic mastery</h2>
            </div>
            {analytics.topicMastery.length === 0 ? (
              <div className="p-8 text-center text-foreground-muted text-sm">
                <p>No topic evidence yet. Mastery appears once students complete sessions.</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {analytics.topicMastery.map((topic) => (
                  <li key={`${topic.subject}-${topic.topic}`} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium text-foreground">{topic.topic}</p>
                        <p className="text-xs text-foreground-muted mt-1">
                          {topic.subject} &middot; {topic.studentCount}{' '}
                          {topic.studentCount === 1 ? 'student' : 'students'}
                        </p>
                      </div>
                      <div className="text-right text-sm shrink-0">
                        <p className="text-foreground-muted">
                          Guided {Math.round(topic.guidedAccuracy * 100)}% &middot; Independent{' '}
                          {Math.round(topic.independentAccuracy * 100)}%
                        </p>
                        {topic.needsReview && (
                          <p className="text-amber-700 mt-1">May benefit from teacher review.</p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-background flex justify-between items-center">
              <h2 className="text-lg font-semibold text-foreground">Assignments</h2>
              <Link
                href={`/teacher/classrooms/${classroom.id}/assignments/new`}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                + New
              </Link>
            </div>
            {assignments.data && assignments.data.assignments.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {assignments.data.assignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Link
                      href={`/teacher/assignments/${assignment.id}`}
                      className="block px-6 py-4 hover:bg-background"
                    >
                      <p className="font-medium text-foreground">{assignment.title}</p>
                      <p className="text-xs text-foreground-muted mt-1">
                        {assignment.subject}
                        {assignment.topic ? ` \u00b7 ${assignment.topic}` : ''} &middot;{' '}
                        {assignment.strictness.replace('_', ' ')}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-6 text-center text-foreground-muted text-sm">
                <p>{assignments.loading ? 'Loading assignments...' : 'No assignments yet.'}</p>
              </div>
            )}
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm p-6">
            <h2 className="text-lg font-semibold text-foreground">Hint level distribution</h2>
            <p className="text-xs text-foreground-muted mt-1 mb-4">
              Highest hint level reached per session, on the 0 to 7 ladder.
            </p>
            <ul className="space-y-2">
              {analytics.hintLevelDistribution.map((bucket) => (
                <li key={bucket.level} className="flex items-center gap-3">
                  <span className="text-xs text-foreground-muted w-10 shrink-0">L{bucket.level}</span>
                  <span className="flex-1 bg-surface-muted rounded h-3 overflow-hidden">
                    <span
                      className="block bg-blue-500 h-3"
                      style={{ width: `${(bucket.sessions / maxHintSessions) * 100}%` }}
                    />
                  </span>
                  <span className="text-xs text-foreground-muted w-6 text-right shrink-0">
                    {bucket.sessions}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm p-6">
            <h2 className="text-lg font-semibold text-foreground">Common error categories</h2>
            {analytics.commonErrorCategories.length === 0 ? (
              <p className="text-sm text-foreground-muted mt-2">No error categories recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {analytics.commonErrorCategories.map((entry) => (
                  <li key={entry.category} className="flex justify-between text-sm">
                    <span className="text-foreground-muted capitalize">
                      {entry.category.replace(/_/g, ' ')}
                    </span>
                    <span className="text-foreground-muted">{entry.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm p-6">
            <CoverageNote coverage={analytics.evidenceCoverage} />
          </div>
        </div>
      </div>
    </div>
  );
}
