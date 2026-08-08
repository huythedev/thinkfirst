'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers/AuthProvider';
import { MODE_VALUES, STRICTNESS_VALUES } from '@/lib/types/ai/request';

/**
 * Assignment creation, section 12.6.
 *
 * This page said "Assignment creation is under development" and Phase 6's last
 * exit criterion forbids exactly that on a page reachable from teacher
 * navigation.
 *
 * The write goes through `/api/teacher/classrooms/[id]/assignments` rather than
 * a client `addDoc`, for a reason the rules cannot express: the optional
 * reference answer must not land on the assignment document, because every
 * active member of the classroom can read it. The endpoint splits it into
 * `assignmentReferences`, which no client reads.
 *
 * The policy fields are the same values `lib/session/policy-inputs.ts` reads
 * back to decide what the tutor may disclose, so the modes offered here are the
 * modes the policy engine implements, from one shared constant.
 */

const MODE_LABELS: Record<string, string> = {
  learn: 'Learn',
  practice: 'Practice',
  assignment: 'Assignment',
  verify: 'Verify',
};

const STRICTNESS_LABELS: Record<string, string> = {
  supportive: 'Supportive',
  balanced: 'Balanced',
  independence: 'Independence',
  assessment_safe: 'Assessment safe',
};

export default function NewAssignment() {
  const params = useParams();
  const classroomId = typeof params.classroomId === 'string' ? params.classroomId : '';
  const router = useRouter();
  const { user } = useAuth();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title: '',
    instructions: '',
    subject: 'Mathematics',
    topic: '',
    grade: 6,
    learningObjective: '',
    strictness: 'balanced',
    allowFullSolutions: false,
    requireTransferProblem: true,
    dueAt: '',
    referenceAnswer: '',
    keyConcepts: '',
  });
  const [allowedModes, setAllowedModes] = useState<string[]>(['learn', 'practice']);

  const toggleMode = (mode: string) => {
    setAllowedModes((current) =>
      current.includes(mode) ? current.filter((entry) => entry !== mode) : [...current, mode],
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    if (allowedModes.length === 0) {
      setError('Choose at least one learning mode.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: form.title,
          instructions: form.instructions,
          subject: form.subject,
          ...(form.topic ? { topic: form.topic } : {}),
          grade: Number(form.grade),
          learningObjective: form.learningObjective,
          allowedModes,
          strictness: form.strictness,
          allowFullSolutions: form.allowFullSolutions,
          requireTransferProblem: form.requireTransferProblem,
          ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {}),
          ...(form.referenceAnswer ? { referenceAnswer: form.referenceAnswer } : {}),
          ...(form.keyConcepts ? { keyConcepts: form.keyConcepts } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not create assignment.');
      }

      const body = (await response.json()) as { assignmentId: string };
      router.push(`/teacher/assignments/${body.assignmentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create assignment.');
      setSaving(false);
    }
  };

  const field = 'w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-sm font-medium text-foreground-muted mb-1';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/teacher/classrooms/${classroomId}`}
          className="text-foreground-muted hover:text-foreground"
        >
          &larr; Back
        </Link>
        <h1 className="text-3xl font-bold text-foreground">New assignment</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-surface p-8 rounded-lg border border-border shadow-sm max-w-3xl space-y-6"
      >
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="title" className={label}>
            Title
          </label>
          <input
            id="title"
            required
            maxLength={200}
            className={field}
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </div>

        <div>
          <label htmlFor="instructions" className={label}>
            Instructions
          </label>
          <textarea
            id="instructions"
            required
            rows={4}
            className={field}
            value={form.instructions}
            onChange={(event) => setForm({ ...form, instructions: event.target.value })}
          />
        </div>

        <div>
          <label htmlFor="objective" className={label}>
            Learning objective
          </label>
          <input
            id="objective"
            required
            className={field}
            value={form.learningObjective}
            onChange={(event) => setForm({ ...form, learningObjective: event.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="subject" className={label}>
              Subject
            </label>
            <input
              id="subject"
              required
              className={field}
              value={form.subject}
              onChange={(event) => setForm({ ...form, subject: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="topic" className={label}>
              Topic (optional)
            </label>
            <input
              id="topic"
              className={field}
              value={form.topic}
              onChange={(event) => setForm({ ...form, topic: event.target.value })}
            />
          </div>
          <div>
            <label htmlFor="grade" className={label}>
              Grade
            </label>
            <input
              id="grade"
              type="number"
              min={1}
              max={13}
              required
              className={field}
              value={form.grade}
              onChange={(event) => setForm({ ...form, grade: Number(event.target.value) })}
            />
          </div>
        </div>

        <fieldset>
          <legend className={label}>Allowed learning modes</legend>
          <div className="flex flex-wrap gap-4">
            {MODE_VALUES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm text-foreground-muted">
                <input
                  type="checkbox"
                  checked={allowedModes.includes(mode)}
                  onChange={() => toggleMode(mode)}
                  className="rounded border-border"
                />
                {MODE_LABELS[mode] ?? mode}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="strictness" className={label}>
              Assistance strictness
            </label>
            <select
              id="strictness"
              className={field}
              value={form.strictness}
              onChange={(event) => setForm({ ...form, strictness: event.target.value })}
            >
              {STRICTNESS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {STRICTNESS_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dueAt" className={label}>
              Due date (optional)
            </label>
            <input
              id="dueAt"
              type="date"
              className={field}
              value={form.dueAt}
              onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-foreground-muted">
            <input
              type="checkbox"
              checked={form.allowFullSolutions}
              onChange={(event) => setForm({ ...form, allowFullSolutions: event.target.checked })}
              className="mt-1 rounded border-border"
            />
            <span>
              Allow full solutions
              <span className="block text-xs text-foreground-muted">
                When off, the tutor may not reveal a complete worked answer for this assignment.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-foreground-muted">
            <input
              type="checkbox"
              checked={form.requireTransferProblem}
              onChange={(event) =>
                setForm({ ...form, requireTransferProblem: event.target.checked })
              }
              className="mt-1 rounded border-border"
            />
            <span>
              Require a transfer problem
              <span className="block text-xs text-foreground-muted">
                Students attempt a similar problem after guided help, which is how transfer is
                measured.
              </span>
            </span>
          </label>
        </div>

        <div className="border-t border-border pt-6 space-y-4">
          <div>
            <label htmlFor="referenceAnswer" className={label}>
              Teacher reference answer (optional)
            </label>
            <textarea
              id="referenceAnswer"
              rows={3}
              className={field}
              value={form.referenceAnswer}
              onChange={(event) => setForm({ ...form, referenceAnswer: event.target.value })}
            />
            <p className="text-xs text-foreground-muted mt-1">
              Stored separately from the assignment and never readable by students.
            </p>
          </div>
          <div>
            <label htmlFor="keyConcepts" className={label}>
              Rubric or key concepts (optional)
            </label>
            <textarea
              id="keyConcepts"
              rows={3}
              className={field}
              value={form.keyConcepts}
              onChange={(event) => setForm({ ...form, keyConcepts: event.target.value })}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Creating...' : 'Create assignment'}
          </button>
          <Link
            href={`/teacher/classrooms/${classroomId}`}
            className="px-4 py-2 border border-border rounded-lg font-medium text-foreground-muted hover:bg-background"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
