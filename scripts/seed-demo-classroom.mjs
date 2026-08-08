/**
 * `npm run seed` -- section 43 demo data.
 *
 * Creates, in the Firestore emulator:
 *
 *   - one teacher,
 *   - one classroom,
 *   - five obviously fictional students,
 *   - three assignments,
 *   - twenty historical sessions with transcripts,
 *   - topic mastery records,
 *   - independence snapshots forming a visible trend,
 *   - common misconceptions, as error categories on stored attempts.
 *
 * Two constraints shape it, and both are requirements rather than choices:
 *
 * 1. **Emulator only.** It writes through the emulator's REST surface with the
 *    owner token, so it cannot run against a real project even by accident.
 *    Section 43 asks for demo credentials "only for local development".
 * 2. **Obviously fictional names.** Section 43 says so twice, and section 24
 *    treats student data as minor data. Every name here is a placeholder that
 *    could not be mistaken for a real child.
 *
 * The generated data is deterministic given `--seed`, so the demo classroom
 * looks the same on every run and a screenshot stays accurate.
 *
 * Usage:
 *   npm run seed
 *   node scripts/seed-demo-classroom.mjs --base-url http://localhost:3000
 */

const args = process.argv.slice(2);
function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const PROJECT_ID = flag('project', 'thinkfirst-huythedeev');
const DATABASE_ID = 'ai-studio-thinkfirst-1bd3a5e3-9884-49d7-91b8-e5b1e8a4f1fa';
const DOCS = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

/** Deterministic pseudo-random, so the demo classroom is identical every run. */
let randomState = Number(flag('seed', '20260807'));
function random() {
  randomState = (randomState * 1103515245 + 12345) % 2147483648;
  return randomState / 2147483648;
}
function pick(list) {
  return list[Math.floor(random() * list.length)];
}
function between(low, high) {
  return low + Math.floor(random() * (high - low + 1));
}

async function ensureEmulator() {
  try {
    const response = await fetch(`http://${FIRESTORE_HOST}/`);
    if (!response.ok && response.status !== 404) throw new Error(String(response.status));
  } catch {
    console.error(
      `Cannot reach the Firestore emulator at ${FIRESTORE_HOST}.\n` +
        'Start it first with:  npm run emulators',
    );
    process.exit(1);
  }
}

async function signUp(email) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'demo-password', returnSecureToken: true }),
    },
  );
  const body = await response.json();

  // Re-running the seed must not fail. The Firestore writes are keyed by
  // deterministic document ids and simply overwrite, but account creation is
  // not idempotent on its own: the second run gets EMAIL_EXISTS. A seed command
  // that works exactly once is a trap, because the failure appears only when
  // someone is halfway through a demo.
  if (!body.idToken && body?.error?.message === 'EMAIL_EXISTS') {
    return signIn(email);
  }
  if (!body.idToken) throw new Error(`${email}: ${JSON.stringify(body)}`);
  return { idToken: body.idToken, uid: body.localId, email };
}

async function signIn(email) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'demo-password', returnSecureToken: true }),
    },
  );
  const body = await response.json();
  if (!body.idToken) throw new Error(`${email}: ${JSON.stringify(body)}`);
  return { idToken: body.idToken, uid: body.localId, email };
}

async function write(path, fields, documentId) {
  const url = documentId
    ? `${DOCS}/${path}?documentId=${encodeURIComponent(documentId)}`
    : `${DOCS}/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) {
    const text = await response.text();
    // A repeat run re-seeds the same ids; overwriting is the intended behavior.
    if (response.status === 409) {
      const patch = await fetch(`${DOCS}/${path}/${encodeURIComponent(documentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ fields }),
      });
      if (!patch.ok) throw new Error(`${path}/${documentId}: ${await patch.text()}`);
      return;
    }
    throw new Error(`${path}: ${text}`);
  }
}

const str = (stringValue) => ({ stringValue });
const int = (value) => ({ integerValue: String(value) });
const dbl = (doubleValue) => ({ doubleValue });
const bool = (booleanValue) => ({ booleanValue });
const time = (date) => ({ timestampValue: date.toISOString() });
const arr = (values) => ({ arrayValue: { values } });

// ---------------------------------------------------------------------------
// Fictional cast. Section 43: "Use obviously fictional names."
// ---------------------------------------------------------------------------

const TEACHER = { name: 'Demo Teacher Alpha', email: 'demo.teacher.alpha@example.invalid' };

const STUDENTS = [
  { name: 'Sample Student One', email: 'sample.student.one@example.invalid', grade: 9, ability: 0.85 },
  { name: 'Sample Student Two', email: 'sample.student.two@example.invalid', grade: 9, ability: 0.62 },
  { name: 'Sample Student Three', email: 'sample.student.three@example.invalid', grade: 9, ability: 0.45 },
  { name: 'Sample Student Four', email: 'sample.student.four@example.invalid', grade: 9, ability: 0.72 },
  { name: 'Sample Student Five', email: 'sample.student.five@example.invalid', grade: 9, ability: 0.3 },
];

const CLASSROOM_ID = 'demo-classroom-algebra';
const JOIN_CODE = 'DEMO01';

const TOPICS = [
  { subject: 'mathematics', topic: 'quadratic equations' },
  { subject: 'mathematics', topic: 'linear equations' },
  { subject: 'mathematics', topic: 'fractions' },
  { subject: 'science', topic: 'kinematics' },
];

/** Section 43: "Common misconceptions." Drawn from section 21's error categories. */
const MISCONCEPTIONS = [
  { category: 'algebra_error', note: 'Sign lost when moving a term across the equals sign.' },
  { category: 'arithmetic_error', note: 'Slip when dividing by a two-digit number.' },
  { category: 'concept_error', note: 'Treats the zero-product rule as an arbitrary convention.' },
  { category: 'formula_selection', note: 'Chooses the perimeter formula for an area question.' },
  { category: 'unit_error', note: 'Reports a speed without units.' },
];

const PROBLEMS = [
  'Solve x^2 - 5x + 6 = 0.',
  'Solve 3x + 7 = 22.',
  'What is 2/3 + 1/4?',
  'A car travels 120 km in 1.5 hours. What is its average speed?',
  'Factor x^2 - 9.',
  'Solve 5(x - 2) = 20.',
];

await ensureEmulator();

console.log('Seeding the demo classroom into the Firestore emulator...');

// --- Teacher ---------------------------------------------------------------
const teacher = await signUp(TEACHER.email);
await write(
  'users',
  {
    id: str(teacher.uid),
    role: str('teacher'),
    displayName: str(TEACHER.name),
    email: str(TEACHER.email),
    preferredLanguage: str('en'),
    createdAt: time(new Date()),
  },
  teacher.uid,
);

// --- Classroom -------------------------------------------------------------
await write(
  'classrooms',
  {
    id: str(CLASSROOM_ID),
    name: str('Demo Algebra Class'),
    teacherId: str(teacher.uid),
    grade: int(9),
    subject: str('mathematics'),
    joinCodeHash: str(JOIN_CODE),
    defaultStrictness: str('balanced'),
    createdAt: time(new Date(Date.now() - 30 * 86400000)),
  },
  CLASSROOM_ID,
);

await write(
  'classroomJoinCodes',
  { classroomId: str(CLASSROOM_ID), createdAt: time(new Date()) },
  JOIN_CODE,
);

// --- Students and memberships ----------------------------------------------
const students = [];
for (const profile of STUDENTS) {
  const account = await signUp(profile.email);
  students.push({ ...profile, ...account });

  await write(
    'users',
    {
      id: str(account.uid),
      role: str('student'),
      displayName: str(profile.name),
      email: str(profile.email),
      preferredLanguage: str('en'),
      createdAt: time(new Date(Date.now() - 30 * 86400000)),
    },
    account.uid,
  );

  await write(
    'studentProfiles',
    {
      id: str(account.uid),
      grade: int(profile.grade),
      preferredLanguage: str('en'),
      createdAt: time(new Date(Date.now() - 30 * 86400000)),
    },
    account.uid,
  );

  // Deterministic membership id, as the security rules require.
  await write(
    'classroomMemberships',
    {
      id: str(`${CLASSROOM_ID}__${account.uid}`),
      classroomId: str(CLASSROOM_ID),
      userId: str(account.uid),
      role: str('student'),
      status: str('active'),
      joinedAt: time(new Date(Date.now() - 28 * 86400000)),
    },
    `${CLASSROOM_ID}__${account.uid}`,
  );
}

// --- Three assignments ------------------------------------------------------
const ASSIGNMENTS = [
  {
    id: 'demo-assignment-quadratics',
    title: 'Quadratic equations by factoring',
    instructions: 'Solve each equation by factoring. Show the factor pair you used.',
    topic: 'quadratic equations',
    strictness: 'balanced',
    allowFullSolutions: true,
    requireTransferProblem: true,
    referenceAnswer: 'x = 2 or x = 3',
  },
  {
    id: 'demo-assignment-assessment',
    title: 'End-of-unit check (assessment-safe)',
    instructions: 'Work independently. The tutor will not provide final answers.',
    topic: 'linear equations',
    strictness: 'assessment_safe',
    allowFullSolutions: false,
    requireTransferProblem: false,
    referenceAnswer: 'x = 5',
  },
  {
    id: 'demo-assignment-fractions',
    title: 'Adding unlike fractions',
    instructions: 'Find a common denominator before adding.',
    topic: 'fractions',
    strictness: 'supportive',
    allowFullSolutions: true,
    requireTransferProblem: false,
    referenceAnswer: '11/12',
  },
];

for (const assignment of ASSIGNMENTS) {
  await write(
    'assignments',
    {
      id: str(assignment.id),
      classroomId: str(CLASSROOM_ID),
      teacherId: str(teacher.uid),
      title: str(assignment.title),
      instructions: str(assignment.instructions),
      subject: str('mathematics'),
      topic: str(assignment.topic),
      grade: int(9),
      learningObjective: str(`Reason independently about ${assignment.topic}.`),
      allowedModes: arr([str('assignment'), str('practice')]),
      strictness: str(assignment.strictness),
      allowFullSolutions: bool(assignment.allowFullSolutions),
      requireTransferProblem: bool(assignment.requireTransferProblem),
      status: str('active'),
      createdAt: time(new Date(Date.now() - 20 * 86400000)),
      dueAt: time(new Date(Date.now() + 7 * 86400000)),
    },
    assignment.id,
  );

  // The reference answer never lives on the assignment document: every active
  // member can read that one, so storing it there would publish the answer to
  // the class. Same pattern as `transferProblems.internalAnswer`.
  await write(
    'assignmentReferences',
    {
      id: str(assignment.id),
      assignmentId: str(assignment.id),
      classroomId: str(CLASSROOM_ID),
      teacherId: str(teacher.uid),
      referenceAnswer: str(assignment.referenceAnswer),
      keyConcepts: str('Factoring, the zero-product property, checking by substitution.'),
      createdAt: time(new Date(Date.now() - 20 * 86400000)),
    },
    assignment.id,
  );
}

// --- Twenty historical sessions ---------------------------------------------
let sessionCount = 0;
let turnCount = 0;
let attemptCount = 0;

for (let index = 0; index < 20; index += 1) {
  const student = students[index % students.length];
  const topic = TOPICS[index % TOPICS.length];
  const problem = PROBLEMS[index % PROBLEMS.length];
  const daysAgo = 21 - Math.floor(index * 1.05);
  const startedAt = new Date(Date.now() - daysAgo * 86400000);
  const sessionId = `demo-session-${String(index + 1).padStart(2, '0')}`;

  // A more able student climbs less far before solving.
  const hintLevel = Math.max(0, Math.min(7, Math.round(7 - student.ability * 6 + (random() - 0.5) * 2)));
  const mode = index % 5 === 0 ? 'assignment' : index % 3 === 0 ? 'learn' : 'practice';

  await write(
    'learningSessions',
    {
      id: str(sessionId),
      studentId: str(student.uid),
      subject: str(topic.subject),
      grade: int(student.grade),
      language: str('en'),
      mode: str(mode),
      strictness: str(mode === 'assignment' ? 'assessment_safe' : 'balanced'),
      status: str('completed'),
      originalProblem: str(problem),
      currentHintLevel: int(hintLevel),
      startedAt: time(startedAt),
      completedAt: time(new Date(startedAt.getTime() + between(8, 30) * 60000)),
      policyVersion: str('policy-v2'),
      scoringVersion: str('scoring-v2'),
    },
    sessionId,
  );
  sessionCount += 1;

  const transcript = [
    ['student', 'I am not sure how to start this one.'],
    ['assistant', 'What kind of equation is this, and what method have you seen for it?'],
    ['student', 'I think I should factor it.'],
    ['assistant', 'Good. What two numbers multiply to give the constant term?'],
  ];

  for (const [sequence, [actor, content]] of transcript.entries()) {
    await write(
      'sessionTurns',
      {
        id: str(`${sessionId}-turn-${sequence + 1}`),
        sessionId: str(sessionId),
        studentId: str(student.uid),
        sequence: int(sequence + 1),
        actor: str(actor),
        content: str(content),
        createdAt: time(new Date(startedAt.getTime() + sequence * 120000)),
      },
      `${sessionId}-turn-${sequence + 1}`,
    );
    turnCount += 1;
  }

  // One evaluated attempt per session, carrying a misconception so the teacher
  // "common error categories" panel has something real to aggregate.
  const misconception = pick(MISCONCEPTIONS);
  const correct = random() < student.ability;
  await write(
    'studentAttempts',
    {
      id: str(`${sessionId}-attempt`),
      sessionId: str(sessionId),
      studentId: str(student.uid),
      attemptType: str('first_attempt'),
      attemptText: str('I subtracted the constant from both sides and then divided.'),
      relevance: dbl(0.9),
      correctness: dbl(correct ? 0.95 : 0.35),
      reasoningQuality: dbl(student.ability),
      errorCategory: str(correct ? 'none' : misconception.category),
      feedbackSummary: str(correct ? 'Method and execution both sound.' : misconception.note),
      confidence: dbl(0.8),
      createdAt: time(new Date(startedAt.getTime() + 300000)),
    },
    `${sessionId}-attempt`,
  );
  attemptCount += 1;
}

// --- Independence snapshots, forming a visible trend -------------------------
let snapshotCount = 0;
for (const student of students) {
  for (let week = 0; week < 4; week += 1) {
    const base = 35 + student.ability * 45;
    // A gentle upward trend, so the teacher trend chart is not flat.
    const score = Math.round(Math.max(0, Math.min(100, base + week * 4 + (random() - 0.5) * 6)));
    const snapshotId = `demo-snapshot-${student.uid}-w${week}`;
    await write(
      'independenceSnapshots',
      {
        id: str(snapshotId),
        studentId: str(student.uid),
        sessionId: { nullValue: null },
        kind: str(week === 3 ? 'profile' : 'session'),
        totalScore: int(score),
        coverage: dbl(0.7 + student.ability * 0.25),
        suppressed: bool(false),
        components: {
          mapValue: {
            fields: {
              firstAttempt: int(Math.round(score * 0.25)),
              hintEfficiency: int(Math.round(score * 0.25)),
              explanation: int(Math.round(score * 0.2)),
              transfer: int(Math.round(score * 0.2)),
              verification: int(Math.round(score * 0.1)),
            },
          },
        },
        scoringVersion: str('scoring-v2'),
        generatedAt: time(new Date(Date.now() - (3 - week) * 7 * 86400000)),
      },
      snapshotId,
    );
    snapshotCount += 1;
  }
}

// --- Topic mastery -----------------------------------------------------------
let masteryCount = 0;
for (const student of students) {
  for (const topic of TOPICS) {
    const masteryId = `${student.uid}__${topic.subject}__${topic.topic}`.replace(/\s+/g, '-');
    const guided = Math.min(1, student.ability + 0.15);
    await write(
      'masteryRecords',
      {
        id: str(masteryId),
        studentId: str(student.uid),
        subject: str(topic.subject),
        topic: str(topic.topic),
        // Kept separate on purpose: a student accurate only while guided has
        // not mastered the topic, and blending the two hides exactly that.
        guidedAccuracy: dbl(Number(guided.toFixed(2))),
        independentAccuracy: dbl(Number(Math.max(0, student.ability - 0.1).toFixed(2))),
        averageHintLevel: dbl(Number((7 - student.ability * 5).toFixed(1))),
        transferSuccessRate: dbl(Number(student.ability.toFixed(2))),
        sessionCount: int(between(2, 6)),
        updatedAt: time(new Date()),
      },
      masteryId,
    );
    masteryCount += 1;
  }
}

console.log('');
console.log('Demo classroom seeded.');
console.log('');
console.log(`  Teacher       ${TEACHER.name}  <${TEACHER.email}>`);
console.log(`  Classroom     Demo Algebra Class   join code ${JOIN_CODE}`);
console.log(`  Students      ${students.length}`);
console.log(`  Assignments   ${ASSIGNMENTS.length}`);
console.log(`  Sessions      ${sessionCount}  (${turnCount} turns, ${attemptCount} attempts)`);
console.log(`  Snapshots     ${snapshotCount}`);
console.log(`  Mastery rows  ${masteryCount}`);
console.log('');
console.log('  Demo credentials (emulator only, local development):');
console.log(`    password for every account: demo-password`);
console.log('');
console.log('  Sign-in uses a Google popup that cannot be scripted. To open the');
console.log('  teacher dashboard directly, mint a session cookie with:');
console.log('    node scripts/seed-workspace-walk.mjs');
