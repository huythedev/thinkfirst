import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomOwner, teacherAuthResponseInit } from '@/lib/auth/teacher-access';
import { loadClassroomMembers } from '@/lib/analytics/classroom-server';
import { loadSafetyReview, markSafetyFlagReviewed } from '@/lib/safety/review';
import { writeAuditLog } from '@/lib/audit/audit-log';

/**
 * Safety flags raised for the students in one classroom.
 *
 * `safetyEvents` has no client read at all — section 24 forbids exposing safety
 * classifications to classmates, and the strongest guarantee of that is a rule
 * that denies every client. So this route is the only path by which a flag reaches
 * a human, and it runs under Admin credentials behind `requireClassroomOwner`.
 *
 * Ownership is decided against the stored `classrooms.teacherId`, and a teacher
 * who does not own the classroom receives **404 rather than 403**, so the route
 * cannot be used to discover which classroom ids exist.
 *
 * Reading the list is audited, unlike the analytics dashboard. Aggregate numbers
 * are ordinary teaching work; a list naming which children were flagged for a
 * welfare concern is exactly the "safety case review" section 28 requires to be
 * recorded, and the audit entry is awaited before the data is returned so a
 * successful read cannot outrun its own record.
 *
 * What the response deliberately omits: the student's message and the tutor's
 * reply. Reasoning is in `lib/safety/review.ts` and `docs/MINOR-SAFETY.md`.
 */

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ classroomId: string }> },
) {
  try {
    const { classroomId } = await context.params;
    const auth = await requireClassroomOwner(req, classroomId);
    if (!auth.ok) {
      const init = teacherAuthResponseInit(auth.reason);
      return NextResponse.json({ error: init.error }, { status: init.status });
    }

    const members = await loadClassroomMembers(classroomId);
    const review = await loadSafetyReview(members);

    await writeAuditLog({
      actorId: auth.uid,
      actorRole: 'teacher',
      action: 'safety_case_review',
      targetType: 'classroom',
      targetId: classroomId,
      reason: 'Teacher opened the safety review list.',
      context: { openCount: review.openCount, flagCount: review.flags.length },
    });

    return NextResponse.json({
      classroomId,
      openCount: review.openCount,
      rosterEmpty: review.rosterEmpty,
      flags: review.flags,
    });
  } catch (error) {
    console.error('Safety review failed', error);
    return NextResponse.json({ error: 'Failed to load safety review.' }, { status: 500 });
  }
}

/**
 * Marks one flag reviewed.
 *
 * Closing a flag is itself a privileged action and is audited with the same action
 * code, because "who decided this needed no further action" is precisely what an
 * audit of a safety process is for.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ classroomId: string }> },
) {
  try {
    const { classroomId } = await context.params;
    const auth = await requireClassroomOwner(req, classroomId);
    if (!auth.ok) {
      const init = teacherAuthResponseInit(auth.reason);
      return NextResponse.json({ error: init.error }, { status: init.status });
    }

    const body = await req.json().catch(() => null);
    const eventId = typeof body?.eventId === 'string' ? body.eventId : null;
    if (!eventId) {
      return NextResponse.json({ error: 'eventId is required.' }, { status: 400 });
    }

    // The flag must belong to a student on this teacher's roster. Without this
    // check, owning any one classroom would let a teacher close a flag for any
    // student in the project by supplying its id.
    const members = await loadClassroomMembers(classroomId);
    const review = await loadSafetyReview(members);
    if (!review.flags.some((flag) => flag.id === eventId)) {
      // 404, consistent with the ownership failure above: an id outside the
      // roster is indistinguishable from one that does not exist.
      return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
    }

    const updated = await markSafetyFlagReviewed(eventId, auth.uid);
    if (!updated) {
      return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
    }

    await writeAuditLog({
      actorId: auth.uid,
      actorRole: 'teacher',
      action: 'safety_case_review',
      targetType: 'classroom',
      targetId: classroomId,
      reason: 'Teacher marked a safety flag reviewed.',
      context: { eventId },
    });

    return NextResponse.json({ ok: true, eventId });
  } catch (error) {
    console.error('Safety review update failed', error);
    return NextResponse.json({ error: 'Failed to update the safety flag.' }, { status: 500 });
  }
}
