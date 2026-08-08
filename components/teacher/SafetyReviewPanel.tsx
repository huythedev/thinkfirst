'use client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTeacherApi } from '@/hooks/use-teacher-api';

/**
 * Safety flags for one classroom.
 *
 * This panel is the reason `safetyEvents` is not a dead collection. The tutoring
 * endpoint records `reviewStatus: 'awaiting_review'` when a welfare concern is
 * detected, and without a surface a teacher can see, that record is an escalation
 * nobody receives.
 *
 * Three deliberate choices about what a teacher sees:
 *
 * - **No message content.** Not the student's words and not the tutor's reply.
 *   Showing them would publish a child's private sentence to their teacher on
 *   every classifier false positive, and the classifier is one model call with no
 *   second opinion. The flag says "check on this student", not "here is what they
 *   typed".
 * - **Confidence is shown.** A teacher weighing a marginal flag should be able to
 *   see that it was marginal.
 * - **The empty state is a good outcome**, so it reads as reassurance rather than
 *   as a missing feature.
 */

interface SafetyFlag {
  id: string;
  studentId: string;
  displayName: string | null;
  sessionId: string;
  responseClass: string;
  classifierConfidence: number;
  raisedAt: string | null;
  reviewStatus: string;
}

interface SafetyResponse {
  openCount: number;
  rosterEmpty: boolean;
  flags: SafetyFlag[];
}

const CLASS_LABELS: Record<string, string> = {
  emergency_guidance: 'Possible immediate concern',
  teacher_review: 'Wellbeing concern',
  educational_redirect: 'Redirected',
  abuse_report: 'Platform misuse',
};

function formatRaised(value: string | null): string {
  if (!value) return 'Just now';
  const raised = new Date(value);
  if (Number.isNaN(raised.getTime())) return 'Unknown';
  return raised.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SafetyReviewPanel({ classroomId }: { classroomId: string }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useTeacherApi<SafetyResponse>(
    `/api/teacher/classrooms/${classroomId}/safety`,
  );
  const [updating, setUpdating] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const markReviewed = async (eventId: string) => {
    if (!user) return;
    setUpdating(eventId);
    setUpdateError(null);
    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/safety`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      if (!response.ok) throw new Error('Could not update this flag.');
      reload();
    } catch (caught) {
      setUpdateError(caught instanceof Error ? caught.message : 'Could not update this flag.');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <section className="bg-surface p-6 rounded-lg border border-border shadow-sm" aria-busy="true">
        <h2 className="text-lg font-semibold text-foreground">Wellbeing flags</h2>
        <div className="mt-4 h-4 w-2/3 bg-surface-muted rounded animate-pulse" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-surface p-6 rounded-lg border border-border shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Wellbeing flags</h2>
        <p className="mt-2 text-sm text-red-700">{error}</p>
      </section>
    );
  }

  const open = data?.flags.filter((flag) => flag.reviewStatus === 'awaiting_review') ?? [];
  const reviewed = data?.flags.filter((flag) => flag.reviewStatus !== 'awaiting_review') ?? [];

  return (
    <section
      className={`p-6 rounded-lg border shadow-sm ${
        open.length > 0 ? 'bg-background border-amber-300' : 'bg-surface border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Wellbeing flags</h2>
          <p className="text-sm text-foreground-muted mt-1">
            Raised automatically when a student says something the tutor is not the right help
            for. What the student wrote is not shown here.
          </p>
        </div>
        {open.length > 0 && (
          <span className="shrink-0 rounded-full bg-amber-200 text-amber-900 text-sm font-semibold px-3 py-1">
            {open.length} to review
          </span>
        )}
      </div>

      {updateError && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {updateError}
        </p>
      )}

      {open.length === 0 && reviewed.length === 0 && (
        <p className="mt-4 text-sm text-foreground-muted">
          {data?.rosterEmpty
            ? 'No students have joined this classroom yet.'
            : 'No flags have been raised for this classroom.'}
        </p>
      )}

      {open.length > 0 && (
        <ul className="mt-4 space-y-3">
          {open.map((flag) => (
            <li
              key={flag.id}
              className="bg-surface border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
            >
              <div>
                <p className="font-medium text-foreground">
                  {flag.displayName ?? 'Student'}{' '}
                  <span className="font-normal text-foreground-muted">
                    &middot; {CLASS_LABELS[flag.responseClass] ?? 'Flagged'}
                  </span>
                </p>
                <p className="text-sm text-foreground-muted mt-1">
                  {formatRaised(flag.raisedAt)} &middot; detection confidence{' '}
                  {Math.round(flag.classifierConfidence * 100)}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => markReviewed(flag.id)}
                disabled={updating === flag.id}
                className="shrink-0 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-60"
              >
                {updating === flag.id ? 'Saving...' : 'Mark reviewed'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {reviewed.length > 0 && (
        <p className="mt-4 text-sm text-foreground-muted">
          {reviewed.length} flag{reviewed.length === 1 ? '' : 's'} already reviewed.
        </p>
      )}
    </section>
  );
}
