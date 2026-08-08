import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { checkRateLimit, rateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { hashJoinCode } from '@/lib/security/join-code';

const joinRequest = /^[A-Z0-9]{6}$/;

/** Resolves a classroom code and creates the caller's membership atomically on the server. */
export async function POST(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (auth.verificationUnavailable) {
    return NextResponse.json({ error: 'Server is not configured to verify authentication.' }, { status: 503 });
  }
  if (!auth.uid) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const decision = await checkRateLimit({ policy: RATE_LIMITS.classroomJoin, uid: auth.uid, headers: req.headers });
  if (!decision.allowed) {
    return NextResponse.json({ error: 'Too many join attempts. Please try again later.' }, {
      status: 429,
      headers: rateLimitHeaders(decision),
    });
  }

  let code: unknown;
  try {
    code = (await req.json()).code;
  } catch {
    return NextResponse.json({ error: 'Enter a valid join code.' }, { status: 400 });
  }

  if (typeof code !== 'string' || !joinRequest.test(code.trim().toUpperCase())) {
    return NextResponse.json({ error: 'Enter a valid six-character join code.' }, { status: 400 });
  }

  try {
    const lookup = await adminDb.collection('classroomJoinCodes').doc(hashJoinCode(code)).get();
    if (!lookup.exists) {
      return NextResponse.json({ error: 'That join code does not match a classroom. Check it and try again.' }, { status: 404 });
    }

    const classroomId = lookup.data()?.classroomId;
    if (typeof classroomId !== 'string' || classroomId.length === 0) {
      return NextResponse.json({ error: 'That join code is not available.' }, { status: 404 });
    }

    const classroom = await adminDb.collection('classrooms').doc(classroomId).get();
    if (!classroom.exists) {
      return NextResponse.json({ error: 'That join code does not match a classroom. Check it and try again.' }, { status: 404 });
    }

    await adminDb.collection('classroomMemberships').doc(`${classroomId}__${auth.uid}`).set({
      classroomId,
      userId: auth.uid,
      role: 'student',
      status: 'active',
      joinedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ classroomId });
  } catch (error) {
    console.error('Classroom join failed.', error);
    return NextResponse.json({ error: 'Could not join the classroom. Please try again.' }, { status: 500 });
  }
}
