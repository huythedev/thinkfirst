import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { requireTeacher, teacherAuthResponseInit } from '@/lib/auth/teacher-access';
import { hashJoinCode } from '@/lib/security/join-code';

const requestSchema = {
  name: (value: unknown) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 120,
  grade: (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 12,
  subject: (value: unknown) => value === 'Mathematics' || value === 'Science',
  defaultStrictness: (value: unknown) => value === 'supportive' || value === 'balanced' || value === 'assessment_safe',
};

function newJoinCode(): string {
  let code = '';
  while (code.length < 6) {
    code += randomBytes(8).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }
  return code.slice(0, 6);
}

export async function POST(req: NextRequest) {
  const auth = await requireTeacher(req);
  if (!auth.ok) {
    const init = teacherAuthResponseInit(auth.reason);
    return NextResponse.json({ error: init.error }, { status: init.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid classroom request.' }, { status: 400 });
  }

  if (!requestSchema.name(body.name) || !requestSchema.grade(body.grade) ||
      !requestSchema.subject(body.subject) || !requestSchema.defaultStrictness(body.defaultStrictness)) {
    return NextResponse.json({ error: 'Invalid classroom details.' }, { status: 400 });
  }

  const joinCode = newJoinCode();
  const classroomRef = adminDb.collection('classrooms').doc();
  const batch = adminDb.batch();
  batch.set(classroomRef, {
    name: (body.name as string).trim(),
    teacherId: auth.uid,
    grade: body.grade,
    subject: body.subject,
    joinCodeHash: hashJoinCode(joinCode),
    defaultStrictness: body.defaultStrictness,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(adminDb.collection('classroomJoinCodes').doc(hashJoinCode(joinCode)), {
    classroomId: classroomRef.id,
    teacherId: auth.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(adminDb.collection('classroomJoinCodeSecrets').doc(classroomRef.id), {
    classroomId: classroomRef.id,
    teacherId: auth.uid,
    code: joinCode,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(adminDb.collection('teacherProfiles').doc(auth.uid), {
    classroomIds: FieldValue.arrayUnion(classroomRef.id),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  try {
    await batch.commit();
    return NextResponse.json({ classroomId: classroomRef.id });
  } catch (error) {
    console.error('Classroom creation failed.', error);
    return NextResponse.json({ error: 'Could not create the classroom.' }, { status: 500 });
  }
}
