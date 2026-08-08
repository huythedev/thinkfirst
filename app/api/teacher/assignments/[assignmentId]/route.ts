import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { requireTeacher, teacherAuthResponseInit } from '@/lib/auth/teacher-access';
import { MODE_VALUES, STRICTNESS_VALUES } from '@/lib/types/ai/request';

/**
 * A single assignment: read, edit, archive.
 *
 * Ownership is checked against the stored `teacherId` on the assignment itself
 * rather than against anything in the request. A non-owner receives 404, so the
 * endpoint cannot be used to learn which assignment ids exist.
 *
 * The reference answer lives in `assignmentReferences`, which is server-only,
 * and is returned here **because** this route is teacher-authorized. It is never
 * merged into the assignment document, which students can read.
 */

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    instructions: z.string().trim().min(1).max(10000).optional(),
    subject: z.string().trim().min(1).max(80).optional(),
    topic: z.string().trim().max(120).nullable().optional(),
    grade: z.number().int().min(1).max(13).optional(),
    learningObjective: z.string().trim().min(1).max(1000).optional(),
    allowedModes: z.array(z.enum(MODE_VALUES)).min(1).optional(),
    strictness: z.enum(STRICTNESS_VALUES).optional(),
    allowFullSolutions: z.boolean().optional(),
    requireTransferProblem: z.boolean().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
    referenceAnswer: z.string().trim().max(10000).nullable().optional(),
    keyConcepts: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

async function loadOwned(assignmentId: string, uid: string) {
  const snap = await adminDb.collection('assignments').doc(assignmentId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.teacherId !== uid) return null;
  return data;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const { assignmentId } = await context.params;
    const auth = await requireTeacher(req);
    if (!auth.ok) {
      const init = teacherAuthResponseInit(auth.reason);
      return NextResponse.json({ error: init.error }, { status: init.status });
    }

    const data = await loadOwned(assignmentId, auth.uid);
    if (!data) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    const referenceSnap = await adminDb
      .collection('assignmentReferences')
      .doc(assignmentId)
      .get();
    const reference = referenceSnap.data() ?? {};

    const classroomSnap = await adminDb
      .collection('classrooms')
      .doc(String(data.classroomId ?? ''))
      .get();

    return NextResponse.json({
      assignment: {
        id: assignmentId,
        classroomId: data.classroomId ?? null,
        classroomName: classroomSnap.data()?.name ?? null,
        title: data.title ?? '',
        instructions: data.instructions ?? '',
        subject: data.subject ?? '',
        topic: data.topic ?? null,
        grade: data.grade ?? null,
        learningObjective: data.learningObjective ?? '',
        allowedModes: Array.isArray(data.allowedModes) ? data.allowedModes : [],
        strictness: data.strictness ?? 'balanced',
        allowFullSolutions: data.allowFullSolutions === true,
        requireTransferProblem: data.requireTransferProblem === true,
        status: data.status ?? 'active',
        dueAt: data.dueAt?.toDate?.()?.toISOString?.() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        referenceAnswer: reference.referenceAnswer ?? null,
        keyConcepts: reference.keyConcepts ?? null,
      },
    });
  } catch (error) {
    console.error('Assignment read failed:', error);
    return NextResponse.json({ error: 'Failed to load assignment.' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const { assignmentId } = await context.params;
    const auth = await requireTeacher(req);
    if (!auth.ok) {
      const init = teacherAuthResponseInit(auth.reason);
      return NextResponse.json({ error: init.error }, { status: init.status });
    }

    const existing = await loadOwned(assignmentId, auth.uid);
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid assignment update.',
          issues: parsed.error.issues.map((issue) => issue.path.join('.')),
        },
        { status: 400 },
      );
    }

    const { referenceAnswer, keyConcepts, dueAt, ...assignmentFields } = parsed.data;

    const update: Record<string, unknown> = {
      ...assignmentFields,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (dueAt !== undefined) {
      update.dueAt = dueAt ? new Date(dueAt) : null;
    }

    await adminDb.collection('assignments').doc(assignmentId).update(update);

    if (referenceAnswer !== undefined || keyConcepts !== undefined) {
      const referenceUpdate: Record<string, unknown> = {
        assignmentId,
        classroomId: existing.classroomId ?? null,
        teacherId: auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (referenceAnswer !== undefined) referenceUpdate.referenceAnswer = referenceAnswer;
      if (keyConcepts !== undefined) referenceUpdate.keyConcepts = keyConcepts;
      await adminDb
        .collection('assignmentReferences')
        .doc(assignmentId)
        .set(referenceUpdate, { merge: true });
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Assignment update failed:', error);
    return NextResponse.json({ error: 'Failed to update assignment.' }, { status: 500 });
  }
}
