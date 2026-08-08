'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MetricCard } from '@/components/teacher/MetricCard';
import { useTeacherApi, type ObservedMetricValue } from '@/hooks/use-teacher-api';

/**
 * One student's learning summary.
 *
 * This page said "Student details view is under development", which Phase 6's
 * last exit criterion forbids on a navigable page.
 *
 * What it deliberately does not show is the conversation. Section 5.8 says a
 * teacher should not automatically see every private student message, so the
 * endpoint behind this page never returns `sessionTurns` or attempt text, and
 * there is no affordance here offering them. Sessions are listed as evidence --
 * hint level reached, transfer outcome, whether the score was suppressed for
 * thin coverage -- not as readable transcripts.
 *
 * Suppression carries over from the student's own view: a session with too
 * little evidence reads "not enough evidence yet" to the teacher exactly as it
 * does to the student, rather than showing a number the student is not shown.
 */

interface SummaryResponse {
  student: {
    studentId: string;
    displayName: string | null;
    classroomId: string;
    classroomName: string;
  };
  summary: {
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
  } | null;
  topicMastery: {
    topic: string;
    subject: string;
    guidedAccuracy: number;
    independentAccuracy: number;
    transferSuccessRate: number;
    needsReview: boolean;
  }[];
  commonErrorCategories: { category: string; count: number }[];
  sessions: {
    sessionId: string;
    status: string;
    subject: string | null;
    topic: string | null;
    occurredAt: string | null;
    score: number | null;
    coverage: number;
    suppressed: boolean;
    excludedForSystemError: boolean;
    highestHintUsed: number | null;
    transferOutcome: string | null;
  }[];
  transcriptAvailable: boolean;
}

const BAND_LABELS: Record<string, string> = {
  increasingly_independent: 'Increasingly independent',
  developing_independence: 'Developing independence',
  benefits_from_guided_support: 'Benefits from guided support',
  needs_structured_practice: 'Needs structured practice',
};

function formatOutcome(outcome: string | null): string {
  if (!outcome) return 'No transfer task';
  return outcome.replace(/_/g, ' ');
}

export default function StudentDetails() {
  const params = useParams();
  const classroomId = typeof params.classroomId === 'string' ? params.classroomId : null;
  const studentId = typeof params.studentId === 'string' ? params.studentId : null;

  const { data, loading, error, notFound } = useTeacherApi<SummaryResponse>(
    classroomId && studentId
      ? `/api/teacher/classrooms/${classroomId}/students/${studentId}`
      : null,
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="sr-only">Loading student summary</span>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-center p-12">
        <h2 className="text-2xl font-bold text-foreground">Student not found</h2>
        <p className="text-foreground-muted mt-2">
          This student is not an active member of a classroom you teach.
        </p>
        <Link
          href={`/teacher/classrooms/${classroomId ?? ''}`}
          className="text-blue-600 hover:underline mt-4 inline-block"
        >
          Return to classroom
        </Link>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-surface border border-red-200 rounded-lg p-6" role="alert">
        <h2 className="text-lg font-semibold text-foreground">Summary could not be loaded</h2>
        <p className="text-sm text-foreground-muted mt-2">{error}</p>
      </div>
    );
  }

  const { student, summary, topicMastery, commonErrorCategories, sessions } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/teacher/classrooms/${student.classroomId}`}
          className="text-foreground-muted hover:text-foreground"
        >
          &larr; Back
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            {student.displayName ?? 'Student'}
          </h1>
          <p className="text-sm text-foreground-muted">{student.classroomName}</p>
        </div>
      </div>

      {summary === null ? (
        <div className="bg-surface p-8 rounded-lg border border-border shadow-sm">
          <p className="text-foreground-muted">
            This student has not yet produced any learning evidence in this classroom.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              label="Sessions completed"
              metric={summary.sessionsCompleted}
              format="count"
              caption={
                summary.lastActiveAt
                  ? `Last active ${new Date(summary.lastActiveAt).toLocaleDateString()}`
                  : 'No activity yet'
              }
              help="Learning sessions this student has marked completed."
            />
            <MetricCard
              label="Independence"
              metric={summary.suppressed ? null : summary.score}
              format="number"
              caption={
                summary.suppressed
                  ? undefined
                  : summary.band
                    ? (BAND_LABELS[summary.band] ?? summary.band)
                    : undefined
              }
              help="An indicator of how independently this student works. It is not a grade, and it is withheld entirely until there is enough evidence to be meaningful."
            />
            <MetricCard
              label="Average hint level"
              metric={summary.averageHintLevel}
              format="level"
              help="The average highest rung reached on the 0 to 7 hint ladder."
            />
            <MetricCard
              label="Transfer success"
              metric={summary.transferSuccessRate}
              format="percent"
              help="Transfer success measures performance on a similar problem after guided assistance. It is not an official grade."
            />
          </div>

          {summary.flags.length > 0 && (
            <div className="bg-background border border-amber-200 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-amber-900">Worth a closer look</h2>
              <ul className="mt-2 space-y-1">
                {summary.flags.map((flag) => (
                  <li key={flag} className="text-sm text-amber-800">
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-background">
            <h2 className="text-lg font-semibold text-foreground">Recent sessions</h2>
            <p className="text-xs text-foreground-muted mt-1">
              Evidence of how each session went. Conversations are private to the student and
              are not shown here.
            </p>
          </div>
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-foreground-muted text-sm">
              <p>No sessions yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {sessions.map((session) => (
                <li key={session.sessionId} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-foreground">
                        {session.topic ?? session.subject ?? 'Learning session'}
                      </p>
                      <p className="text-xs text-foreground-muted mt-1">
                        {session.occurredAt
                          ? new Date(session.occurredAt).toLocaleDateString()
                          : 'Date unknown'}{' '}
                        &middot; {session.status}
                      </p>
                    </div>
                    <div className="text-right text-sm shrink-0">
                      {session.excludedForSystemError ? (
                        <p className="text-foreground-muted">Excluded: system error</p>
                      ) : session.suppressed || session.score === null ? (
                        <p className="text-foreground-muted">Not enough evidence yet</p>
                      ) : (
                        <p className="font-medium text-foreground">{session.score}</p>
                      )}
                      <p className="text-xs text-foreground-muted mt-1">
                        {session.highestHintUsed === null
                          ? 'Hint level not recorded'
                          : `Highest hint level ${session.highestHintUsed}`}
                      </p>
                      <p className="text-xs text-foreground-muted capitalize">
                        {formatOutcome(session.transferOutcome)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-surface rounded-lg border border-border shadow-sm p-6">
            <h2 className="text-lg font-semibold text-foreground">Topic mastery</h2>
            {topicMastery.length === 0 ? (
              <p className="text-sm text-foreground-muted mt-2">No topic evidence yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {topicMastery.map((topic) => (
                  <li key={`${topic.subject}-${topic.topic}`}>
                    <p className="text-sm font-medium text-foreground">{topic.topic}</p>
                    <p className="text-xs text-foreground-muted">
                      Guided {Math.round(topic.guidedAccuracy * 100)}% &middot; Independent{' '}
                      {Math.round(topic.independentAccuracy * 100)}%
                    </p>
                    {topic.needsReview && (
                      <p className="text-xs text-amber-700 mt-1">May benefit from teacher review.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-surface rounded-lg border border-border shadow-sm p-6">
            <h2 className="text-lg font-semibold text-foreground">Common error categories</h2>
            {commonErrorCategories.length === 0 ? (
              <p className="text-sm text-foreground-muted mt-2">No error categories recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {commonErrorCategories.map((entry) => (
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

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <p className="text-sm text-blue-800">
              This summary describes learning behavior, not achievement. Viewing it is
              recorded in the audit log.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
