import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { requireClassroomOwner, teacherAuthResponseInit } from '@/lib/auth/teacher-access';
import { MODE_VALUES, STRICTNESS_VALUES } from '@/lib/types/ai/request';

/**
 * Assignment listing and creation for one classroom.
 *
 * Creation runs server-side even though `firestore.rules` would permit a client
 * write, for one reason that is not stylistic: section 12.6 requires an optional
 * **teacher reference answer**, and the assignment document is readable by every
 * active member of the classroom. Storing the answer on the assignment would
 * publish it to the class.
 *
 * So the answer and the rubric notes are split into `assignmentReferences`,
 * which no client can read at all -- the same treatment `transferProblems`
 * received in Phase 5, and for the same reason: a reference answer is the answer.
 *
 * The remaining fields are policy inputs. `strictness`, `allowFullSolutions` and
 * `allowedModes` are read back by `lib/session/policy-inputs.ts` to decide what
 * the tutor may disclose, so they are validated here rather than trusted, and
 * `teacherId` is stamped from the verified token rather than from the body.
 */

const assignmentInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(10000),
    subject: z.string().trim().min(1).max(80),
    topic: z.string().trim().max(120).optional(),
    grade: z.number().int().min(1).max(13),
    learningObjective: z.string().trim().min(1).max(1000),
    allowedModes: z.array(z.enum(MODE_VALUES)).min(1),
    strictness: z.enum(STRICTNESS_VALUES),
    allowFullSolutions: z.boolean(),
    requireTransferProblem: z.boolean(),
    dueAt: z.string().datetime().optional(),
    referenceAnswer: z.string().trim().max(10000).optional(),
    keyConcepts: z.string().trim().max(5000).optional(),
  })
  .strict();

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

    const snapshot = await adminDb
      .collection('assignments')
      .where('classroomId', '==', classroomId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return NextResponse.json({
      assignments: snapshot.docs.map((docSnap) => {
        const data = docSnap.data() ?? {};
        return {
          id: docSnap.id,
          title: data.title ?? '',
          subject: data.subject ?? '',
          topic: data.topic ?? null,
          grade: data.grade ?? null,
          strictness: data.strictness ?? 'balanced',
          allowedModes: Array.isArray(data.allowedModes) ? data.allowedModes : [],
          allowFullSolutions: data.allowFullSolutions === true,
          requireTransferProblem: data.requireTransferProblem === true,
          status: data.status ?? 'active',
          dueAt: data.dueAt?.toDate?.()?.toISOString?.() ?? null,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        };
      }),
    });
  } catch (error) {
    console.error('Assignment listing failed:', error);
    return NextResponse.json({ error: 'Failed to load assignments.' }, { status: 500 });
  }
}

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const parsed = assignmentInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid assignment.', issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const ref = adminDb.collection('assignments').doc();

    await ref.set({
      id: ref.id,
      classroomId,
      teacherId: auth.uid,
      title: input.title,
      instructions: input.instructions,
      subject: input.subject,
      topic: input.topic ?? null,
      grade: input.grade,
      learningObjective: input.learningObjective,
      allowedModes: input.allowedModes,
      strictness: input.strictness,
      allowFullSolutions: input.allowFullSolutions,
      requireTransferProblem: input.requireTransferProblem,
      status: 'active',
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (input.referenceAnswer || input.keyConcepts) {
      await adminDb.collection('assignmentReferences').doc(ref.id).set({
        assignmentId: ref.id,
        classroomId,
        teacherId: auth.uid,
        referenceAnswer: input.referenceAnswer ?? null,
        keyConcepts: input.keyConcepts ?? null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ assignmentId: ref.id }, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment.' }, { status: 500 });
  }
}
