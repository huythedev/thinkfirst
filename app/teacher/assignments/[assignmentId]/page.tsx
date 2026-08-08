'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { useTeacherApi } from '@/hooks/use-teacher-api';
import { MODE_VALUES, STRICTNESS_VALUES } from '@/lib/types/ai/request';

/**
 * A single assignment: view and edit.
 *
 * Section 30 lists `/teacher/assignments/[assignmentId]` among the required
 * routes and it did not exist on disk, so the assignment a teacher had just
 * created was unreachable.
 *
 * The reference answer is shown here because this page is reached through a
 * teacher-authorized endpoint that reads `assignmentReferences`, a collection no
 * client can read. It is never part of the assignment document the class can see.
 */

interface AssignmentResponse {
  assignment: {
    id: string;
    classroomId: string | null;
    classroomName: string | null;
    title: string;
    instructions: string;
    subject: string;
    topic: string | null;
    grade: number | null;
    learningObjective: string;
    allowedModes: string[];
    strictness: string;
    allowFullSolutions: boolean;
    requireTransferProblem: boolean;
    status: string;
    dueAt: string | null;
    createdAt: string | null;
    referenceAnswer: string | null;
    keyConcepts: string | null;
  };
}

const STRICTNESS_LABELS: Record<string, string> = {
  supportive: 'Supportive',
  balanced: 'Balanced',
  independence: 'Independence',
  assessment_safe: 'Assessment safe',
};

export default function AssignmentDetail() {
  const params = useParams();
  const assignmentId = typeof params.assignmentId === 'string' ? params.assignmentId : null;
  const { user } = useAuth();

  const { data, loading, error, notFound, reload } = useTeacherApi<AssignmentResponse>(
    assignmentId ? `/api/teacher/assignments/${assignmentId}` : null,
  );

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  /**
   * Edits are held keyed by assignment id and reconciled at render, rather than
   * copied into state from an effect. Pushing fetched data into state inside an
   * effect is the `react-hooks/set-state-in-effect` pattern that failed lint in
   * two workspace components in session 07: it renders once with stale state and
   * then again with fresh, and here it would also silently discard an in-flight
   * edit whenever the fetch refreshed.
   */
  const [edits, setEdits] = useState<{
    key: string;
    value: AssignmentResponse['assignment'];
  } | null>(null);

  const loaded = data?.assignment ?? null;
  const draft = loaded ? (edits?.key === loaded.id ? edits.value : loaded) : null;

  const setDraft = (value: AssignmentResponse['assignment']) => {
    setEdits({ key: value.id, value });
  };

  const save = async () => {
    if (!user || !draft || !assignmentId) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch(`/api/teacher/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: draft.title,
          instructions: draft.instructions,
          subject: draft.subject,
          topic: draft.topic,
          learningObjective: draft.learningObjective,
          allowedModes: draft.allowedModes,
          strictness: draft.strictness,
          allowFullSolutions: draft.allowFullSolutions,
          requireTransferProblem: draft.requireTransferProblem,
          status: draft.status === 'archived' ? 'archived' : 'active',
          referenceAnswer: draft.referenceAnswer,
          keyConcepts: draft.keyConcepts,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save.');
      }
      setEditing(false);
      setEdits(null);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="sr-only">Loading assignment</span>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="text-center p-12">
        <h2 className="text-2xl font-bold text-foreground">Assignment not found</h2>
        <Link href="/teacher/classrooms" className="text-blue-600 hover:underline mt-4 inline-block">
          Return to classrooms
        </Link>
      </div>
    );
  }

  if (error || !data || !draft) {
    return (
      <div className="bg-surface border border-red-200 rounded-lg p-6" role="alert">
        <h2 className="text-lg font-semibold text-foreground">Assignment could not be loaded</h2>
        <p className="text-sm text-foreground-muted mt-2">{error}</p>
      </div>
    );
  }

  const assignment = data.assignment;
  const field =
    'w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/teacher/classrooms/${assignment.classroomId ?? ''}`}
            className="text-foreground-muted hover:text-foreground"
          >
            &larr; Back
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-foreground">{assignment.title}</h1>
            <p className="text-sm text-foreground-muted">{assignment.classroomName}</p>
          </div>
        </div>
        <button
          onClick={() => setEditing((current) => !current)}
          className="px-4 py-2 border border-border rounded-lg text-sm font-medium text-foreground-muted hover:bg-background"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {saveError && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
          {saveError}
        </p>
      )}

      <div className="bg-surface p-8 rounded-lg border border-border shadow-sm max-w-3xl space-y-6">
        {editing ? (
          <>
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-foreground-muted mb-1">
                Title
              </label>
              <input
                id="title"
                className={field}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="instructions" className="block text-sm font-medium text-foreground-muted mb-1">
                Instructions
              </label>
              <textarea
                id="instructions"
                rows={4}
                className={field}
                value={draft.instructions}
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="objective" className="block text-sm font-medium text-foreground-muted mb-1">
                Learning objective
              </label>
              <input
                id="objective"
                className={field}
                value={draft.learningObjective}
                onChange={(event) => setDraft({ ...draft, learningObjective: event.target.value })}
              />
            </div>
            <fieldset>
              <legend className="block text-sm font-medium text-foreground-muted mb-1">
                Allowed learning modes
              </legend>
              <div className="flex flex-wrap gap-4">
                {MODE_VALUES.map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm text-foreground-muted">
                    <input
                      type="checkbox"
                      checked={draft.allowedModes.includes(mode)}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          allowedModes: draft.allowedModes.includes(mode)
                            ? draft.allowedModes.filter((entry) => entry !== mode)
                            : [...draft.allowedModes, mode],
                        })
                      }
                      className="rounded border-border"
                    />
                    <span className="capitalize">{mode}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="strictness" className="block text-sm font-medium text-foreground-muted mb-1">
                Assistance strictness
              </label>
              <select
                id="strictness"
                className={field}
                value={draft.strictness}
                onChange={(event) => setDraft({ ...draft, strictness: event.target.value })}
              >
                {STRICTNESS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {STRICTNESS_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-foreground-muted">
                <input
                  type="checkbox"
                  checked={draft.allowFullSolutions}
                  onChange={(event) =>
                    setDraft({ ...draft, allowFullSolutions: event.target.checked })
                  }
                  className="rounded border-border"
                />
                Allow full solutions
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground-muted">
                <input
                  type="checkbox"
                  checked={draft.requireTransferProblem}
                  onChange={(event) =>
                    setDraft({ ...draft, requireTransferProblem: event.target.checked })
                  }
                  className="rounded border-border"
                />
                Require a transfer problem
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground-muted">
                <input
                  type="checkbox"
                  checked={draft.status === 'archived'}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.checked ? 'archived' : 'active' })
                  }
                  className="rounded border-border"
                />
                Archived
              </label>
            </div>
            <div>
              <label htmlFor="reference" className="block text-sm font-medium text-foreground-muted mb-1">
                Teacher reference answer
              </label>
              <textarea
                id="reference"
                rows={3}
                className={field}
                value={draft.referenceAnswer ?? ''}
                onChange={(event) => setDraft({ ...draft, referenceAnswer: event.target.value })}
              />
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-medium text-foreground-muted">Instructions</h2>
              <p className="text-foreground mt-1 whitespace-pre-wrap">{assignment.instructions}</p>
            </div>
            <div>
              <h2 className="text-sm font-medium text-foreground-muted">Learning objective</h2>
              <p className="text-foreground mt-1">{assignment.learningObjective}</p>
            </div>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-foreground-muted">Subject</dt>
                <dd className="text-foreground font-medium">{assignment.subject}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">Grade</dt>
                <dd className="text-foreground font-medium">{assignment.grade}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">Strictness</dt>
                <dd className="text-foreground font-medium">
                  {STRICTNESS_LABELS[assignment.strictness] ?? assignment.strictness}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">Allowed modes</dt>
                <dd className="text-foreground font-medium capitalize">
                  {assignment.allowedModes.join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">Full solutions</dt>
                <dd className="text-foreground font-medium">
                  {assignment.allowFullSolutions ? 'Allowed' : 'Not allowed'}
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">Transfer problem</dt>
                <dd className="text-foreground font-medium">
                  {assignment.requireTransferProblem ? 'Required' : 'Optional'}
                </dd>
              </div>
            </dl>
            {assignment.referenceAnswer && (
              <div className="border-t border-border pt-4">
                <h2 className="text-sm font-medium text-foreground-muted">
                  Teacher reference answer
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    Never visible to students
                  </span>
                </h2>
                <p className="text-foreground mt-1 whitespace-pre-wrap">
                  {assignment.referenceAnswer}
                </p>
              </div>
            )}
            {assignment.keyConcepts && (
              <div>
                <h2 className="text-sm font-medium text-foreground-muted">Key concepts</h2>
                <p className="text-foreground mt-1 whitespace-pre-wrap">{assignment.keyConcepts}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
