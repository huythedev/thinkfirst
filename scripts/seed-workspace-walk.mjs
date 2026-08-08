/**
 * Mints an emulator student, a session with a transcript, and a session cookie,
 * then prints a URL and cookie for a browser walk of the learning workspace.
 *
 * This exists because sign-in uses a Google popup that cannot be automated. The
 * cookie is issued by the real /api/auth/session route, so the walk exercises
 * the same server-side gate a human sign-in would.
 *
 * Usage: node scripts/seed-workspace-walk.mjs [baseUrl]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:3300';
const AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const PROJECT_ID = 'thinkfirst-huythedeev';
const DATABASE_ID = 'ai-studio-thinkfirst-1bd3a5e3-9884-49d7-91b8-e5b1e8a4f1fa';
const DOCS = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

async function signUp(email) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'emulator-password', returnSecureToken: true }),
    },
  );
  const body = await response.json();
  if (!body.idToken) throw new Error(JSON.stringify(body));
  return { idToken: body.idToken, uid: body.localId };
}

async function write(path, fields, documentId) {
  const url = documentId ? `${DOCS}/${path}?documentId=${documentId}` : `${DOCS}/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
  return response.json();
}

const stamp = Date.now();
const student = await signUp(`walk-${stamp}@example.com`);

await write(
  'users',
  {
    id: { stringValue: student.uid },
    role: { stringValue: 'student' },
    displayName: { stringValue: 'Walk Student' },
    preferredLanguage: { stringValue: 'en' },
  },
  student.uid,
);

await write(
  'studentProfiles',
  {
    id: { stringValue: student.uid },
    grade: { integerValue: '8' },
  },
  student.uid,
);

// Two sessions, so the list has both an in-progress and a completed row, and one
// of them carries a hint level the browser could never have written.
const sessionId = `walk-${stamp}-a`;
await write(
  'learningSessions',
  {
    studentId: { stringValue: student.uid },
    subject: { stringValue: 'mathematics' },
    grade: { integerValue: '8' },
    language: { stringValue: 'en' },
    mode: { stringValue: 'practice' },
    strictness: { stringValue: 'balanced' },
    status: { stringValue: 'active' },
    originalProblem: { stringValue: 'Solve 2x + 3 = 11 for x.' },
    currentHintLevel: { integerValue: '3' },
    scratchpad: { stringValue: 'subtract 3 from both sides -> 2x = 8' },
    startedAt: { timestampValue: new Date().toISOString() },
    policyVersion: { stringValue: 'policy-v1' },
    scoringVersion: { stringValue: 'scoring-v1' },
  },
  sessionId,
);

await write(
  'learningSessions',
  {
    studentId: { stringValue: student.uid },
    subject: { stringValue: 'science' },
    grade: { integerValue: '8' },
    language: { stringValue: 'en' },
    mode: { stringValue: 'learn' },
    strictness: { stringValue: 'balanced' },
    status: { stringValue: 'completed' },
    originalProblem: { stringValue: 'Why does ice float on water?' },
    currentHintLevel: { integerValue: '1' },
    startedAt: { timestampValue: new Date(Date.now() - 86400000).toISOString() },
    policyVersion: { stringValue: 'policy-v1' },
    scoringVersion: { stringValue: 'scoring-v1' },
  },
  `walk-${stamp}-b`,
);

const turns = [
  ['student', 'I think I need to get x on its own first.'],
  ['assistant', 'Good instinct. What operation undoes the **+ 3** on the left side?'],
  ['student', 'Subtract 3, so 2x = 8.'],
  ['assistant', 'Exactly right. Now what undoes multiplying x by 2?'],
];

for (const [index, [actor, content]] of turns.entries()) {
  await write(
    'sessionTurns',
    {
      sessionId: { stringValue: sessionId },
      studentId: { stringValue: student.uid },
      sequence: { integerValue: String(index + 1) },
      actor: { stringValue: actor },
      content: { stringValue: content },
      createdAt: { timestampValue: new Date(Date.now() - (4 - index) * 60000).toISOString() },
    },
    `${sessionId}-turn-${index + 1}`,
  );
}

const sessionResponse = await fetch(`${baseUrl}/api/auth/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idToken: student.idToken }),
});
const setCookie = sessionResponse.headers.get('set-cookie') ?? '';
const match = /thinkfirst_session=([^;]+)/.exec(setCookie);
if (!match) throw new Error(`no cookie: ${sessionResponse.status} ${await sessionResponse.text()}`);

console.log(JSON.stringify({ cookie: match[1], sessionId, uid: student.uid }, null, 2));
