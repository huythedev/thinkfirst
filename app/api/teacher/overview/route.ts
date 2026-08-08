import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { requireTeacher, teacherAuthResponseInit } from '@/lib/auth/teacher-access';
import { computeClassroomAnalytics } from '@/lib/analytics/classroom-server';

/**
 * The teacher dashboard's numbers, aggregated across every classroom the caller
 * owns.
 *
 * Phase 6's first exit criterion says "every number on the teacher dashboard is
 * derived from a query. A literal, a dash or a zero placeholder in the source
 * fails this criterion outright." The dashboard previously rendered `0`, `0`,
 * `--%` and `--%` as string literals; this endpoint is where those four numbers
 * now come from.
 *
 * Classrooms are resolved from `teacherId == uid`, never from a list supplied by
 * the caller, so a teacher cannot widen their own scope by naming a classroom.
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTeacher(req);
    if (!auth.ok) {
      const init = teacherAuthResponseInit(auth.reason);
      return NextResponse.json({ error: init.error }, { status: init.status });
    }

    const classroomsSnap = await adminDb
      .collection('classrooms')
      .where('teacherId', '==', auth.uid)
      .get();

    const classrooms = classroomsSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() ?? {}) }))
      .filter((classroom) => !(classroom as { archivedAt?: unknown }).archivedAt);

    if (classrooms.length === 0) {
      return NextResponse.json({
        classrooms: [],
        totals: {
          classroomCount: 0,
          studentCount: 0,
          activeStudentsThisWeek: 0,
          sessionsCompletedThisWeek: 0,
          sessionsCompletedTotal: 0,
          attemptBeforeHelpRate: { value: null, observed: 0, total: 0 },
          transferSuccessRate: { value: null, observed: 0, total: 0 },
          averageHintLevel: { value: null, observed: 0, total: 0 },
          evidenceCoverage: 0,
          openReportCount: 0,
        },
        topicsNeedingReview: [],
        generatedAt: new Date().toISOString(),
      });
    }

    const now = new Date();
    const perClassroom = await Promise.all(
      classrooms.map(async (classroom) => ({
        classroom,
        analytics: await computeClassroomAnalytics(classroom.id, now),
      })),
    );

    // Rates are re-derived from summed numerators and denominators rather than
    // averaged across classrooms. Averaging an average would weight a classroom
    // of three the same as a classroom of thirty, which is a real distortion and
    // not a rounding detail.
    let attemptObserved = 0;
    let attemptWeighted = 0;
    let transferObserved = 0;
    let transferWeighted = 0;
    let hintObserved = 0;
    let hintWeighted = 0;
    let coverageWeighted = 0;
    let coverageObserved = 0;
    let studentCount = 0;
    let activeStudents = 0;
    let sessionsThisWeek = 0;
    let sessionsTotal = 0;
    let openReports = 0;

    for (const { analytics } of perClassroom) {
      studentCount += analytics.memberCount;
      activeStudents += analytics.activeStudentsThisWeek;
      sessionsThisWeek += analytics.sessionsCompletedThisWeek;
      sessionsTotal += analytics.sessionsCompletedTotal;
      openReports += analytics.openReportCount;

      const attempt = analytics.attemptBeforeHelpRate;
      if (attempt.value !== null) {
        attemptObserved += attempt.observed;
        attemptWeighted += attempt.value * attempt.observed;
      }
      const transfer = analytics.transferSuccessRate;
      if (transfer.value !== null) {
        transferObserved += transfer.observed;
        transferWeighted += transfer.value * transfer.observed;
      }
      const hint = analytics.averageHintLevel;
      if (hint.value !== null) {
        hintObserved += hint.observed;
        hintWeighted += hint.value * hint.observed;
      }
      if (analytics.memberCount > 0) {
        coverageWeighted += analytics.evidenceCoverage;
        coverageObserved += 1;
      }
    }

    const ratio = (weighted: number, observed: number) => ({
      value: observed > 0 ? weighted / observed : null,
      observed,
      total: sessionsTotal,
    });

    const topicsNeedingReview = perClassroom
      .flatMap(({ classroom, analytics }) =>
        analytics.topicsNeedingReview.map((topic) => ({
          ...topic,
          classroomId: classroom.id,
          classroomName: (classroom as { name?: string }).name ?? 'Classroom',
        })),
      )
      .sort((left, right) => right.gap - left.gap)
      .slice(0, 6);

    return NextResponse.json({
      classrooms: perClassroom.map(({ classroom, analytics }) => ({
        id: classroom.id,
        name: (classroom as { name?: string }).name ?? 'Classroom',
        grade: (classroom as { grade?: number }).grade ?? null,
        subject: (classroom as { subject?: string }).subject ?? null,
        memberCount: analytics.memberCount,
        activeStudentsThisWeek: analytics.activeStudentsThisWeek,
        sessionsCompletedThisWeek: analytics.sessionsCompletedThisWeek,
        independenceAverage: analytics.independenceAverage,
        evidenceCoverage: analytics.evidenceCoverage,
      })),
      totals: {
        classroomCount: classrooms.length,
        studentCount,
        activeStudentsThisWeek: activeStudents,
        sessionsCompletedThisWeek: sessionsThisWeek,
        sessionsCompletedTotal: sessionsTotal,
        attemptBeforeHelpRate: ratio(attemptWeighted, attemptObserved),
        transferSuccessRate: ratio(transferWeighted, transferObserved),
        averageHintLevel: ratio(hintWeighted, hintObserved),
        evidenceCoverage: coverageObserved > 0 ? coverageWeighted / coverageObserved : 0,
        openReportCount: openReports,
      },
      topicsNeedingReview,
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error('Teacher overview failed:', error);
    return NextResponse.json({ error: 'Failed to load dashboard.' }, { status: 500 });
  }
}
