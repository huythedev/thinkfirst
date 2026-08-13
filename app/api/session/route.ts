import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { AI_VERSIONS } from '@/lib/versions';
import { MODE_VALUES, STRICTNESS_VALUES } from '@/lib/types/ai/request';

export const runtime = 'nodejs';

const sessionInputSchema = z
  .object({
    classroomId: z.string().trim().min(1).max(400),
    assignmentId: z.string().trim().min(1).max(400).optional(),
    originalProblem: z.string().trim().min(1).max(20000),
    mode: z.enum(MODE_VALUES),
    imageId: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

class SessionCreationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Creates a classroom-bound session after proving every tenant binding server-side. */
export async function POST(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (auth.verificationUnavailable) {
    return NextResponse.json(
      { error: 'Server is not configured to verify authentication.' },
      { status: 503 },
    );
  }
  if (!auth.uid) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = sessionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid session request.' }, { status: 400 });
  }

  const input = parsed.data;
  const sessionRef = adminDb.collection('learningSessions').doc();

  try {
    await adminDb.runTransaction(async (transaction) => {
      const userRef = adminDb.collection('users').doc(auth.uid!);
      const profileRef = adminDb.collection('studentProfiles').doc(auth.uid!);
      const classroomRef = adminDb.collection('classrooms').doc(input.classroomId);
      const membershipRef = adminDb
        .collection('classroomMemberships')
        .doc(`${input.classroomId}__${auth.uid}`);
      const assignmentRef = input.assignmentId
        ? adminDb.collection('assignments').doc(input.assignmentId)
        : null;
      const imageRef = input.imageId
        ? adminDb.collection('problemImages').doc(input.imageId)
        : null;

      const userSnap = await transaction.get(userRef);
      const profileSnap = await transaction.get(profileRef);
      const classroomSnap = await transaction.get(classroomRef);
      const membershipSnap = await transaction.get(membershipRef);
      const assignmentSnap = assignmentRef ? await transaction.get(assignmentRef) : null;
      const imageSnap = imageRef ? await transaction.get(imageRef) : null;

      if (!userSnap.exists || userSnap.data()?.role !== 'student') {
        throw new SessionCreationError(403, 'Student role required.');
      }
      if (!classroomSnap.exists) {
        throw new SessionCreationError(404, 'Classroom session is not available.');
      }

      const membership = membershipSnap.data() ?? {};
      if (
        !membershipSnap.exists ||
        membership.classroomId !== input.classroomId ||
        membership.userId !== auth.uid ||
        membership.role !== 'student' ||
        membership.status !== 'active'
      ) {
        throw new SessionCreationError(404, 'Classroom session is not available.');
      }

      const classroom = classroomSnap.data() ?? {};
      const assignment = assignmentSnap?.exists ? assignmentSnap.data() ?? {} : null;
      if (input.assignmentId) {
        if (
          !assignment ||
          assignment.classroomId !== input.classroomId ||
          assignment.status !== 'active'
        ) {
          throw new SessionCreationError(404, 'Assignment session is not available.');
        }
        const allowedModes = Array.isArray(assignment.allowedModes)
          ? assignment.allowedModes.filter(
              (value): value is (typeof MODE_VALUES)[number] =>
                typeof value === 'string' && (MODE_VALUES as readonly string[]).includes(value),
            )
          : [];
        if (!allowedModes.includes(input.mode)) {
          throw new SessionCreationError(400, 'That learning mode is not allowed for this assignment.');
        }
      }

      if (input.imageId && (!imageSnap?.exists || imageSnap.data()?.studentId !== auth.uid)) {
        throw new SessionCreationError(404, 'Problem image is not available.');
      }

      const strictnessCandidate = assignment?.strictness ?? classroom.defaultStrictness;
      const strictness =
        typeof strictnessCandidate === 'string' &&
        (STRICTNESS_VALUES as readonly string[]).includes(strictnessCandidate)
          ? strictnessCandidate
          : 'balanced';
      const gradeCandidate = assignment?.grade ?? classroom.grade;
      const grade =
        typeof gradeCandidate === 'number' &&
        Number.isInteger(gradeCandidate) &&
        gradeCandidate >= 1 &&
        gradeCandidate <= 12
          ? gradeCandidate
          : 8;
      const subjectCandidate = assignment?.subject ?? classroom.subject;
      const subject =
        typeof subjectCandidate === 'string' && subjectCandidate.trim().length > 0
          ? subjectCandidate.trim().slice(0, 80)
          : 'mathematics';
      const topicCandidate = assignment?.topic;
      const profile = profileSnap.data() ?? {};
      const user = userSnap.data() ?? {};
      const language =
        profile.preferredLanguage === 'vi' || user.preferredLanguage === 'vi' ? 'vi' : 'en';

      transaction.create(sessionRef, {
        studentId: auth.uid,
        scope: input.assignmentId ? 'assignment' : 'classroom',
        classroomId: input.classroomId,
        ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
        subject,
        ...(typeof topicCandidate === 'string' && topicCandidate.trim()
          ? { topic: topicCandidate.trim().slice(0, 120) }
          : {}),
        grade,
        language,
        mode: input.mode,
        strictness,
        status: 'active',
        originalProblem: input.originalProblem,
        ...(input.imageId ? { imageId: input.imageId } : {}),
        currentHintLevel: 0,
        nextTurnSequence: 0,
        revision: 0,
        startedAt: FieldValue.serverTimestamp(),
        policyVersion: AI_VERSIONS.policy,
        scoringVersion: AI_VERSIONS.scoring,
      });
    });

    return NextResponse.json({ sessionId: sessionRef.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionCreationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Classroom session creation failed:', error);
    return NextResponse.json({ error: 'Failed to create session.' }, { status: 500 });
  }
}
