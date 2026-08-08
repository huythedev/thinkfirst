/**
 * End-to-end Phase 2 authorization walk against the emulators.
 *
 * Creates a student and a teacher in the Auth emulator, writes their user
 * documents, exchanges each ID token for a session cookie through the real
 * /api/auth/session route, and then requests every protected route as each
 * identity with redirects disabled.
 *
 * This is what proves the role gate is server-side. The unauthenticated probe
 * only shows that a visitor with no cookie is turned away; the criterion also
 * requires that a signed-in student is refused the teacher area by the server.
 *
 * Usage: node scripts/verify-role-gate-e2e.mjs [baseUrl]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:3200';
const AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const PROJECT_ID = 'thinkfirst-huythedeev';
const DATABASE_ID = 'ai-studio-thinkfirst-1bd3a5e3-9884-49d7-91b8-e5b1e8a4f1fa';

const STUDENT_ROUTES = ['/student', '/student/settings', '/student/session/new'];
const TEACHER_ROUTES = ['/teacher', '/teacher/classrooms', '/teacher/classrooms/new'];

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
  if (!body.idToken) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return { idToken: body.idToken, uid: body.localId };
}

/** Writes the user document directly, standing in for completed onboarding. */
async function writeUserDoc(uid, role) {
  const url =
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}` +
    `/documents/users?documentId=${uid}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      fields: {
        id: { stringValue: uid },
        role: { stringValue: role },
        displayName: { stringValue: `${role} probe` },
        preferredLanguage: { stringValue: 'en' },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Firestore emulator write failed: ${response.status} ${await response.text()}`);
  }
}

/** Exchanges an ID token for a session cookie through the application route. */
async function establishSession(idToken) {
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = /thinkfirst_session=([^;]+)/.exec(setCookie);
  if (!match) {
    throw new Error(`No session cookie issued: ${response.status} ${await response.text()}`);
  }
  return match[1];
}

async function request(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    headers: { cookie: `thinkfirst_session=${cookie}` },
  });
  return { status: response.status, location: response.headers.get('location') ?? '' };
}

const failures = [];

function check(label, condition, detail) {
  const verdict = condition ? 'PASS' : 'FAIL';
  if (!condition) failures.push(label);
  console.log(`${verdict}  ${label}  ${detail}`);
}

const stamp = Date.now();
const student = await signUp(`student-${stamp}@example.com`);
const teacher = await signUp(`teacher-${stamp}@example.com`);

await writeUserDoc(student.uid, 'student');
await writeUserDoc(teacher.uid, 'teacher');

const studentCookie = await establishSession(student.idToken);
const teacherCookie = await establishSession(teacher.idToken);
console.log('Session cookies issued for both identities.\n');

for (const route of STUDENT_ROUTES) {
  const own = await request(route, studentCookie);
  check(`student may open ${route}`, own.status === 200, `status=${own.status}`);

  const crossed = await request(route, teacherCookie);
  check(
    `teacher is refused ${route}`,
    crossed.status === 307 && crossed.location === '/teacher',
    `status=${crossed.status} location=${crossed.location}`,
  );
}

for (const route of TEACHER_ROUTES) {
  const own = await request(route, teacherCookie);
  check(`teacher may open ${route}`, own.status === 200, `status=${own.status}`);

  const crossed = await request(route, studentCookie);
  check(
    `student is refused ${route}`,
    crossed.status === 307 && crossed.location === '/student',
    `status=${crossed.status} location=${crossed.location}`,
  );
}

// An onboarded role is required, not merely a verified identity.
const newcomer = await signUp(`newcomer-${stamp}@example.com`);
const newcomerCookie = await establishSession(newcomer.idToken);
const onboarding = await request('/student', newcomerCookie);
check(
  'a signed-in user with no role is sent to onboarding',
  onboarding.status === 307 && onboarding.location === '/onboarding',
  `status=${onboarding.status} location=${onboarding.location}`,
);

// A forged cookie must not be accepted.
const forged = await request('/student', 'not-a-real-session-cookie');
check(
  'a forged session cookie is refused',
  forged.status === 307 && forged.location.startsWith('/sign-in'),
  `status=${forged.status} location=${forged.location}`,
);

console.log('');
if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('All role gate checks passed.');
