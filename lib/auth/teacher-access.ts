import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';
import type { Classroom } from '@/lib/types/classroom';

/**
 * Authorization for teacher API routes.
 *
 * `verifyRequest` proves *who* is calling and nothing more. Every Phase 6
 * endpoint additionally needs two facts the caller must not be trusted to
 * supply: that the caller holds the teacher role, and that the classroom named
 * in the URL belongs to them.
 *
 * Both are read from Firestore under Admin credentials. Section 41.1 lists
 * "classroom membership, and any list of classroom IDs" among the values never
 * trusted from a client, and a teacher endpoint that took ownership on the
 * client's word would let any signed-in caller read any classroom's aggregates
 * by guessing an id -- the same defect class as the `sessionTurns` exposure
 * closed in Phase 2.
 *
 * The failure modes are kept distinct because they mean different things:
 * `verification_unavailable` is a server misconfiguration and must never be
 * reported as a rejected user.
 */

export type TeacherAuthFailure =
  | 'verification_unavailable'
  | 'unauthenticated'
  | 'not_a_teacher'
  | 'not_found';

export type TeacherAuthResult =
  | { ok: true; uid: string }
  | { ok: false; reason: TeacherAuthFailure };

export type ClassroomAuthResult =
  | { ok: true; uid: string; classroom: Classroom }
  | { ok: false; reason: TeacherAuthFailure };

/** Maps an authorization failure onto its HTTP status and a non-leaking message. */
export function teacherAuthResponseInit(reason: TeacherAuthFailure): {
  status: number;
  error: string;
} {
  switch (reason) {
    case 'verification_unavailable':
      return { status: 503, error: 'Server is not configured to verify authentication.' };
    case 'unauthenticated':
      return { status: 401, error: 'Authentication required.' };
    case 'not_a_teacher':
      return { status: 403, error: 'Teacher role required.' };
    case 'not_found':
      // Deliberately 404 rather than 403. A teacher who does not own a classroom
      // must not be able to tell "this id exists but is not yours" from "this id
      // does not exist", because the difference enumerates other teachers'
      // classrooms. Section 41 lists enumeration as a threat-model item.
      return { status: 404, error: 'Classroom not found.' };
  }
}

/** Verifies the bearer token and that the caller's stored role is `teacher`. */
export async function requireTeacher(req: NextRequest): Promise<TeacherAuthResult> {
  const auth = await verifyRequest(req);
  if (auth.verificationUnavailable) {
    return { ok: false, reason: 'verification_unavailable' };
  }
  if (!auth.uid) {
    return { ok: false, reason: 'unauthenticated' };
  }

  const userSnap = await adminDb.collection('users').doc(auth.uid).get();
  const role = userSnap.data()?.role;
  if (role !== 'teacher') {
    return { ok: false, reason: 'not_a_teacher' };
  }

  return { ok: true, uid: auth.uid };
}

/**
 * Verifies the caller is a teacher **and** owns the named classroom.
 *
 * This is the single gate every classroom-scoped read passes through, so the
 * negative test that proves "a teacher sees their own classrooms only" has one
 * place to aim at rather than one per endpoint.
 */
export async function requireClassroomOwner(
  req: NextRequest,
  classroomId: string,
): Promise<ClassroomAuthResult> {
  const teacher = await requireTeacher(req);
  if (!teacher.ok) return teacher;

  if (!classroomId || typeof classroomId !== 'string') {
    return { ok: false, reason: 'not_found' };
  }

  const snap = await adminDb.collection('classrooms').doc(classroomId).get();
  if (!snap.exists) {
    return { ok: false, reason: 'not_found' };
  }

  const data = snap.data() ?? {};
  if (data.teacherId !== teacher.uid) {
    return { ok: false, reason: 'not_found' };
  }

  return {
    ok: true,
    uid: teacher.uid,
    classroom: { id: snap.id, ...(data as Omit<Classroom, 'id'>) },
  };
}

/**
 * Confirms a student is an active member of a classroom before any of that
 * student's evidence is returned.
 *
 * Ownership of the classroom is not by itself permission to read an arbitrary
 * uid: without this check a teacher could pass any student id alongside a
 * classroom they legitimately own and read a stranger's independence profile.
 */
export async function isActiveMember(classroomId: string, studentId: string): Promise<boolean> {
  if (!classroomId || !studentId) return false;
  const membershipId = `${classroomId}__${studentId}`;
  const snap = await adminDb.collection('classroomMemberships').doc(membershipId).get();
  if (!snap.exists) return false;
  const data = snap.data() ?? {};
  return (
    data.classroomId === classroomId &&
    data.userId === studentId &&
    data.role === 'student' &&
    data.status === 'active'
  );
}
