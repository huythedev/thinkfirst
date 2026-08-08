/**
 * Manual verification probe for the Phase 2 server-side role gate.
 *
 * Issues unauthenticated and cookie-bearing requests to protected routes with
 * redirects disabled, and reports the status, the redirect target, and whether
 * any protected markup came back in the body. The point is that a denial must
 * happen before rendering: a 200 carrying the page plus a client redirect would
 * pass a naive browser check and fail the criterion.
 *
 * Usage: node scripts/verify-route-guards.mjs [baseUrl] [sessionCookie]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:3200';
const sessionCookie = process.argv[3];

const PROTECTED_ROUTES = [
  '/student',
  '/student/settings',
  '/student/progress',
  '/student/session/new',
  '/student/classrooms/join',
  '/teacher',
  '/teacher/classrooms',
  '/teacher/classrooms/new',
  '/teacher/settings',
];

// Strings that only appear once a protected layout has rendered.
const PROTECTED_MARKERS = ['Sign out', 'for Teachers', 'Join a classroom', 'Create New Classroom'];

async function probe(path) {
  const headers = sessionCookie ? { cookie: `thinkfirst_session=${sessionCookie}` } : {};
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', headers });
  const body = await response.text();
  const leaked = PROTECTED_MARKERS.filter((marker) => body.includes(marker));

  return {
    path,
    status: response.status,
    location: response.headers.get('location') ?? '',
    bytes: body.length,
    leaked: leaked.join(',') || 'none',
  };
}

const results = [];
for (const route of PROTECTED_ROUTES) {
  results.push(await probe(route));
}

console.table(results);

const admitted = results.filter((result) => result.status === 200 || result.leaked !== 'none');
if (!sessionCookie && admitted.length > 0) {
  console.error(`FAIL: ${admitted.length} protected route(s) served content without a session.`);
  process.exit(1);
}
console.log(sessionCookie ? 'Probe complete (authenticated run).' : 'PASS: every protected route denied before rendering.');
