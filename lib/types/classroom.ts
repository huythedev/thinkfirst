/**
 * Shared shapes for classroom-scoped documents.
 *
 * Section 28 of module `06` defines these collections, but until now the
 * `Classroom`, `ClassroomMembership` and `Assignment` shapes existed only as
 * ad-hoc interfaces re-declared inside individual teacher pages, one of which
 * used `any`. Two components disagreeing about a field name is the kind of drift
 * a type catches and a test does not, because tests do not read JSX.
 */

import type { LearningMode } from '@/lib/types/ai/schema';

export type Strictness = 'supportive' | 'balanced' | 'independence' | 'assessment_safe';

export const STRICTNESS_VALUES: readonly Strictness[] = [
  'supportive',
  'balanced',
  'independence',
  'assessment_safe',
] as const;

export interface Classroom {
  id: string;
  name: string;
  teacherId: string;
  grade: number;
  subject: string;
  joinCodeHash: string;
  defaultStrictness: Strictness;
  createdAt?: unknown;
  archivedAt?: unknown;
}

export interface ClassroomMembership {
  id: string;
  classroomId: string;
  userId: string;
  role: 'student' | 'teacher';
  status: 'active' | 'invited' | 'removed';
  joinedAt?: unknown;
}

/**
 * Section 28's `Assignment`, plus the two fields section 12.6 requires that the
 * section 28 interface omits: a teacher reference answer and rubric notes.
 *
 * Both are teacher-authored and neither is ever returned to a student surface.
 * `referenceAnswer` in particular is the answer to the assigned problem, so it
 * sits in the same category as `transferProblems.internalAnswer`: readable by
 * the authoring teacher through a server route, never by the class.
 */
export interface Assignment {
  id: string;
  classroomId: string;
  teacherId: string;
  title: string;
  instructions: string;
  subject: string;
  topic?: string;
  grade: number;
  learningObjective: string;
  allowedModes: LearningMode[];
  strictness: Strictness;
  allowFullSolutions: boolean;
  requireTransferProblem: boolean;
  referenceAnswer?: string;
  keyConcepts?: string;
  dueAt?: unknown;
  status: 'active' | 'archived';
  createdAt?: unknown;
  updatedAt?: unknown;
}
