import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import {
  isActiveMember,
  requireClassroomOwner,
  teacherAuthResponseInit,
} from '@/lib/auth/teacher-access';
import { loadEvidenceForStudents } from '@/lib/analytics/classroom-server';
import { aggregateClassroomAnalytics } from '@/lib/analytics/classroom';
import { writeAuditLog } from '@/lib/audit/audit-log';

/**
 * One student's learning summary, for the teacher who owns their classroom.
 *
 * Two authorization checks, not one. Owning the classroom is not permission to
 * read an arbitrary uid: without the membership check a teacher could pass any
 * student id alongside a classroom they legitimately own and read a stranger's
 * independence profile. So the classroom must be theirs **and** the student must
 * be an active member of that classroom.
 *
 * What this deliberately does not return: `sessionTurns`. Section 5.8 says "do
 * not expose full student conversations to teachers by default" and section 6.2
 * closes with "a teacher should not automatically see every private student
 * message". The summary returns evidence about learning -- hint levels, transfer
 * outcomes, topic mastery, error categories -- and never the transcript, never
 * the student's attempt text, and never the scratchpad. There is consequently no
 * UI affordance offering a transcript, which is the branch Phase 6's third exit
 * criterion permits.
 *
 * The access is audited anyway. A summary is still one student's data being read
 * by someone other than that student, and an audit trail that only records the
 * most sensitive read tells you nothing about the ordinary ones.
 */

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ classroomId: string; studentId: string }> },
) {
  try {
    const { classroomId, studentId } = await context.params;

    const auth = await requireClassroomOwner(req, classroomId);
    if (!auth.ok) {
      const init = teacherAuthResponseInit(auth.reason);
      return NextResponse.json({ error: init.error }, { status: init.status });
    }

    const member = await isActiveMember(classroomId, studentId);
    if (!member) {
      // 404 again, for the same reason: a teacher must not be able to probe
      // which uids exist by watching the status code change.
      return NextResponse.json({ error: 'Student not found in this classroom.' }, { status: 404 });
    }

    const [userSnap, evidence] = await Promise.all([
      adminDb.collection('users').doc(studentId).get(),
      loadEvidenceForStudents([studentId]),
    ]);

    const displayName =
      typeof userSnap.data()?.displayName === 'string'
        ? (userSnap.data()?.displayName as string)
        : null;

    // Reuse the classroom aggregation over a single-member roster, so a
    // student's row on the classroom page and their own summary page are
    // computed by the same code and cannot drift apart.
    const analytics = aggregateClassroomAnalytics(classroomId, {
      now: new Date(),
      members: [{ studentId, displayName }],
      ...evidence,
    });

    const row = analytics.roster[0] ?? null;

    await writeAuditLog({
      actorId: auth.uid,
      actorRole: 'teacher',
      action: 'student_summary_access',
      targetType: 'student',
      targetId: studentId,
      reason: req.nextUrl.searchParams.get('reason') ?? undefined,
      context: { classroomId },
    });

    const sessions = evidence.sessions
      .slice()
      .sort(
        (left, right) =>
          (right.completedAt ?? right.startedAt ?? new Date(0)).getTime() -
          (left.completedAt ?? left.startedAt ?? new Date(0)).getTime(),
      )
      .slice(0, 20)
      .map((session) => {
        const snapshot = evidence.snapshots.find((entry) => entry.sessionId === session.id) ?? null;
        const metrics = snapshot?.metrics ?? null;
        return {
          sessionId: session.id,
          status: session.status ?? 'unknown',
          subject: session.subject ?? null,
          topic: session.topic ?? null,
          occurredAt: (session.completedAt ?? session.startedAt)?.toISOString() ?? null,
          // Suppression travels with the session score, so a thin session is
          // reported as unknown to the teacher exactly as it is to the student.
          score: snapshot && !snapshot.suppressed ? snapshot.totalScore : null,
          coverage: snapshot?.coverage ?? 0,
          suppressed: snapshot ? snapshot.suppressed : true,
          excludedForSystemError: snapshot?.excludedForSystemError ?? false,
          highestHintUsed:
            metrics?.hintState === 'observed' && typeof metrics.highestHintUsed === 'number'
              ? metrics.highestHintUsed
              : null,
          transferOutcome: metrics?.transfer?.issued ? (metrics.transfer.outcome ?? null) : null,
        };
      });

    return NextResponse.json({
      student: {
        studentId,
        displayName,
        classroomId,
        classroomName: auth.classroom.name,
      },
      summary: row
        ? {
            sessionsCompleted: row.sessionsCompleted,
            lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
            score: row.score,
            band: row.band,
            trend: row.trend,
            suppressed: row.suppressed,
            coverage: row.coverage,
            averageHintLevel: row.averageHintLevel,
            transferSuccessRate: row.transferSuccessRate,
            flags: row.flags,
          }
        : null,
      topicMastery: analytics.topicMastery,
      commonErrorCategories: analytics.commonErrorCategories,
      sessions,
      transcriptAvailable: false,
    });
  } catch (error) {
    console.error('Student summary failed:', error);
    return NextResponse.json({ error: 'Failed to load student summary.' }, { status: 500 });
  }
}
