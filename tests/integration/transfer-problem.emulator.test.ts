import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/session/[sessionId]/transfer/route';

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = typeof import('@/lib/firebase/admin')['adminDb'];
let adminDb: AdminDb;

const STUDENT = 'transfer-student-1';
const SESSION = 'transfer-session-1';

vi.mock('@/lib/firebase/verify-request', () => ({
  verifyRequest: async () => ({ uid: 'transfer-student-1', verificationUnavailable: false })
}));

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  await adminDb.collection('learningSessions').doc(SESSION).set({
    studentId: STUDENT,
    status: 'active',
  });
  
  // Seed a pending transfer problem
  await adminDb.collection('transferProblems').doc('transfer-1').set({
    sessionId: SESSION,
    studentId: STUDENT,
    problemMarkdown: 'Solve 2x = 4',
    topic: 'linear equations',
    difficulty: 'easy',
    expectedConcepts: ['algebra'],
    internalAnswer: 'x = 2',
    internalSolutionSteps: ['divide by 2'],
    validationNotes: 'Simple equation',
    status: 'issued',
    createdAt: new Date(),
  });
  
  // Seed a second transfer problem that is evaluated
  await adminDb.collection('transferProblems').doc('transfer-2').set({
    sessionId: SESSION,
    studentId: STUDENT,
    problemMarkdown: 'Solve 3x = 9',
    topic: 'linear equations',
    difficulty: 'easy',
    expectedConcepts: ['algebra'],
    internalAnswer: 'x = 3',
    internalSolutionSteps: ['divide by 3'],
    validationNotes: 'Simple equation',
    status: 'evaluated',
    createdAt: new Date(Date.now() - 10000), // Older
  });
});

describe('GET /api/session/[sessionId]/transfer', () => {
  it('transfer data returned without private answer fields and selects correct pending transfer', async () => {
    const req = new NextRequest('http://localhost/api/session/transfer-session-1/transfer');
    const params = Promise.resolve({ sessionId: SESSION });
    
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.transferProblem).toBeDefined();
    expect(data.transferProblem.id).toBe('transfer-1');
    expect(data.transferProblem.problemMarkdown).toBe('Solve 2x = 4');
    expect(data.transferProblem.internalAnswer).toBeUndefined();
    expect(data.transferProblem.internalSolutionSteps).toBeUndefined();
    expect(data.transferProblem.validationNotes).toBeUndefined();
  });
});
