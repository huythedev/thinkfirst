import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomOwner, teacherAuthResponseInit } from '@/lib/auth/teacher-access';
import { computeClassroomAnalytics } from '@/lib/analytics/classroom-server';
import { writeAuditLog } from '@/lib/audit/audit-log';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Aggregate analytics for one classroom.
 *
 * Authorization is `requireClassroomOwner`, which reads `classrooms/{id}` under
 * Admin credentials and compares `teacherId` against the verified uid. A teacher
 * who does not own the classroom receives 404 rather than 403, so the endpoint
 * cannot be used to discover which classroom ids exist.
 *
 * Export is audited. Reading the dashboard is ordinary teaching work and is not
 * logged; requesting the data as an export is one of section 28's five
 * privileged actions, so `?export=1` writes an `auditLogs` entry and only
 * returns once that write has been attempted.
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

    const analytics = await computeClassroomAnalytics(classroomId);
    const isExport = req.nextUrl.searchParams.get('export') === '1';

    if (isExport) {
      await writeAuditLog({
        actorId: auth.uid,
        actorRole: 'teacher',
        action: 'classroom_export',
        targetType: 'classroom',
        targetId: classroomId,
        reason: req.nextUrl.searchParams.get('reason') ?? undefined,
        context: { studentCount: analytics.memberCount },
      });
    }

    const secretSnap = await adminDb.collection('classroomJoinCodeSecrets').doc(classroomId).get();

    return NextResponse.json({
      classroom: {
        id: auth.classroom.id,
        name: auth.classroom.name,
        grade: auth.classroom.grade,
        subject: auth.classroom.subject,
        defaultStrictness: auth.classroom.defaultStrictness,
        joinCode: secretSnap.data()?.code ?? null,
      },
      analytics: {
        ...analytics,
        generatedAt: analytics.generatedAt.toISOString(),
        independenceTrend: analytics.independenceTrend.map((point) => ({
          ...point,
          weekStart: point.weekStart.toISOString(),
        })),
        roster: analytics.roster.map((row) => ({
          ...row,
          lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
        })),
      },
      exported: isExport,
    });
  } catch (error) {
    console.error('Classroom analytics failed:', error);
    return NextResponse.json({ error: 'Failed to load classroom analytics.' }, { status: 500 });
  }
}
