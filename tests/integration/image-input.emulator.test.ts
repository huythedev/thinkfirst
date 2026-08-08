import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration coverage for the image-input policy path, against a real Firestore
 * emulator.
 *
 * The unit tests in `tests/images/extraction-confirmation.test.ts` drive
 * `resolvePolicyFromDocuments` with hand-built documents, which proves the
 * precedence logic. They cannot prove the part that was actually broken for three
 * phases: whether the resolver *reads* the image at all. Rule R6 was implemented,
 * unit-tested and unreachable simultaneously, because the Firestore read that
 * feeds it did not exist.
 *
 * So these tests write real documents through the Admin SDK and call
 * `resolvePolicyInputs`, the function the chat endpoint calls. A wrong collection
 * name, a missing field or a dropped `imageId` fails here and passes in a unit
 * test.
 */

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';

type AdminDb = (typeof import('@/lib/firebase/admin'))['adminDb'];
type PolicyInputs = typeof import('@/lib/session/policy-inputs');
type Policy = typeof import('@/services/ai-gateway/src/policy');

let adminDb: AdminDb;
let policyInputs: PolicyInputs;
let policy: Policy;

const STUDENT = 'img-student-a';
const OTHER_STUDENT = 'img-student-b';

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  policyInputs = await import('@/lib/session/policy-inputs');
  policy = await import('@/services/ai-gateway/src/policy');
  await seed();
});

async function writeImage(
  imageId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await adminDb
    .collection('problemImages')
    .doc(imageId)
    .set({
      id: imageId,
      studentId: STUDENT,
      storagePath: `problem-images/${STUDENT}/${imageId}`,
      contentType: 'image/png',
      extractedText: 'Solve x^2 - 5x + 6 = 0',
      extractionConfidence: 0.4,
      confirmationStatus: 'required',
      confirmedText: null,
      createdAt: new Date(),
      ...overrides,
    });
}

async function writeSession(
  sessionId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await adminDb
    .collection('learningSessions')
    .doc(sessionId)
    .set({
      studentId: STUDENT,
      subject: 'mathematics',
      grade: 9,
      language: 'en',
      mode: 'practice',
      strictness: 'balanced',
      status: 'active',
      originalProblem: 'Solve x^2 - 5x + 6 = 0',
      currentHintLevel: 4,
      startedAt: new Date(),
      ...overrides,
    });
}

async function seed(): Promise<void> {
  await adminDb.collection('studentProfiles').doc(STUDENT).set({ grade: 9 });

  // Low confidence, unconfirmed.
  await writeImage('img-low');
  await writeSession('imgsession-low', { imageId: 'img-low' });

  // Low confidence, confirmed with a correction.
  await writeImage('img-confirmed', {
    extractedText: 'Solve x^2 - 5x + 8 = O',
    confirmationStatus: 'confirmed',
    confirmedText: 'Solve x^2 - 5x + 6 = 0',
    confirmedAt: new Date(),
  });
  await writeSession('imgsession-confirmed', {
    imageId: 'img-confirmed',
    originalProblem: 'Solve x^2 - 5x + 8 = O',
  });

  // High confidence, no confirmation needed.
  await writeImage('img-high', {
    extractionConfidence: 0.95,
    confirmationStatus: 'not_required',
  });
  await writeSession('imgsession-high', { imageId: 'img-high' });

  // An image belonging to someone else, referenced by this student's session.
  await adminDb.collection('problemImages').doc('img-foreign').set({
    id: 'img-foreign',
    studentId: OTHER_STUDENT,
    extractedText: 'Another student problem',
    extractionConfidence: 0.99,
    confirmationStatus: 'confirmed',
    confirmedText: 'Another student problem',
  });
  await writeSession('imgsession-foreign', { imageId: 'img-foreign' });

  // A typed problem with no image at all.
  await writeSession('imgsession-typed');
}

async function resolve(sessionId: string) {
  const resolution = await policyInputs.resolvePolicyInputs(sessionId, STUDENT);
  if (resolution.status !== 'ok') throw new Error(`expected ok, got ${resolution.status}`);
  return resolution.inputs;
}

describe('the resolver reads extraction confidence from Firestore', () => {
  it('loads confidence from the image document the session names', async () => {
    const inputs = await resolve('imgsession-low');
    expect(inputs.extractionConfidence).toBe(0.4);
    expect(inputs.extractionConfirmed).toBe(false);
    expect(inputs.imageId).toBe('img-low');
  });

  it('reports no confidence for a typed problem', async () => {
    const inputs = await resolve('imgsession-typed');
    expect(inputs.extractionConfidence).toBeUndefined();
    expect(inputs.imageId).toBeUndefined();
  });

  it('prefers the confirmed text over what the browser wrote on the session', async () => {
    // The session document carries the misread text, because the browser wrote
    // it at creation. The confirmed correction must win.
    const inputs = await resolve('imgsession-confirmed');
    expect(inputs.originalProblem).toBe('Solve x^2 - 5x + 6 = 0');
    expect(inputs.extractionConfirmed).toBe(true);
  });

  it('ignores an image belonging to another student', async () => {
    const inputs = await resolve('imgsession-foreign');
    expect(inputs.extractionConfidence).toBeUndefined();
    expect(inputs.originalProblem).toBe('Solve x^2 - 5x + 6 = 0');
  });
});

describe('the policy engine blocks tutoring on the real read path', () => {
  const intent = {
    intent: 'problem_solving' as const,
    subject: 'mathematics' as const,
    topic: 'quadratics',
    estimatedGradeLevel: 9,
    problemStatement: 'Solve x^2 - 5x + 6 = 0',
    studentProvidedAttempt: true,
    attemptQuality: 'meaningful' as const,
    answerSeekingLikelihood: 0.1,
    ambiguityLevel: 'low' as const,
    missingInformation: [],
    detectedLanguage: 'en' as const,
    safetyCategory: 'none' as const,
    confidence: 0.9,
  };

  async function planFor(sessionId: string) {
    const inputs = await resolve(sessionId);
    return policy.generateResponsePlan(intent, {
      mode: inputs.mode,
      strictness: inputs.strictness,
      currentHintLevel: inputs.currentHintLevel,
      hasReceivedFullSolution: false,
      grade: inputs.grade,
      allowFullSolutions: inputs.allowFullSolutions,
      requireTransferProblem: inputs.requireTransferProblem,
      extractionConfidence: inputs.extractionConfirmed
        ? undefined
        : inputs.extractionConfidence,
    });
  }

  it('refuses to tutor an unconfirmed low-confidence extraction', async () => {
    const plan = await planFor('imgsession-low');
    expect(plan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(plan.allowedHintLevel).toBe(0);
    expect(plan.mayRevealFinalAnswer).toBe(false);
  });

  it('tutors once the extraction is confirmed', async () => {
    const plan = await planFor('imgsession-confirmed');
    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(plan.allowedHintLevel).toBeGreaterThan(0);
  });

  it('tutors a high-confidence extraction without confirmation', async () => {
    const plan = await planFor('imgsession-high');
    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
  });

  it('tutors a typed problem exactly as before', async () => {
    const plan = await planFor('imgsession-typed');
    expect(plan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(plan.allowedHintLevel).toBeGreaterThan(0);
  });
});

describe('the confirmation write path', () => {
  it('records confirmation server-side so the block lifts', async () => {
    await writeImage('img-flow', { extractionConfidence: 0.3 });
    await writeSession('imgsession-flow', { imageId: 'img-flow' });

    const before = await resolve('imgsession-flow');
    expect(before.extractionConfirmed).toBe(false);

    // What POST /api/problem-images/[imageId]/confirm writes.
    await adminDb.collection('problemImages').doc('img-flow').update({
      confirmedText: 'Solve x^2 - 5x + 6 = 0 for x',
      confirmationStatus: 'confirmed',
      correctedByStudent: true,
      confirmedAt: new Date(),
    });

    const after = await resolve('imgsession-flow');
    expect(after.extractionConfirmed).toBe(true);
    expect(after.originalProblem).toBe('Solve x^2 - 5x + 6 = 0 for x');
  });

  it('keeps the confidence recorded after confirmation', async () => {
    // Confirmation lifts the block; it does not rewrite history. The original
    // confidence stays readable for the section 35 confirmation-rate metric.
    const inputs = await resolve('imgsession-confirmed');
    expect(inputs.extractionConfidence).toBe(0.4);
  });
});
