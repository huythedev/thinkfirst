import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration coverage for rate limiting and safety-event recording, against a
 * real Firestore emulator.
 *
 * A unit test with a mocked Firestore would prove the arithmetic and nothing
 * else. The two properties that actually matter here are properties of the store:
 *
 *   - the counter is shared, so it survives across callers and instances, and
 *   - the increment is atomic, so two concurrent requests cannot both pass the
 *     final slot.
 *
 * Neither is observable without a real transaction. This is the same lesson Phase
 * 7 recorded about rule R6: test at the boundary the requirement is about.
 */

process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST =
  process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
process.env.RATE_LIMIT_SALT = 'test-salt';

type AdminDb = (typeof import('@/lib/firebase/admin'))['adminDb'];
type RateLimit = typeof import('@/lib/security/rate-limit');
type SafetyEvent = typeof import('@/lib/safety/safety-event');
type SafetyReview = typeof import('@/lib/safety/review');

let adminDb: AdminDb;
let rateLimit: RateLimit;
let safetyEvent: SafetyEvent;
let safetyReview: SafetyReview;

beforeAll(async () => {
  adminDb = (await import('@/lib/firebase/admin')).adminDb;
  rateLimit = await import('@/lib/security/rate-limit');
  safetyEvent = await import('@/lib/safety/safety-event');
  safetyReview = await import('@/lib/safety/review');
});

function headers(ip?: string): Headers {
  const result = new Headers();
  if (ip) result.set('x-forwarded-for', ip);
  return result;
}

/** A window-aligned instant, so a test never straddles a rollover by accident. */
const BASE_MS = 1_800_000_000_000;

function policyFor(limit: number, ipLimit: number, operation: string) {
  return {
    operation,
    user: { limit, windowSeconds: 60 },
    ip: { limit: ipLimit, windowSeconds: 60 },
  };
}

describe('rate limiting against a real Firestore', () => {
  it('allows requests up to the per-user limit and refuses the next one', async () => {
    const policy = policyFor(3, 100, `allow-then-refuse-${Date.now()}`);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = await rateLimit.checkRateLimit({
        policy,
        uid: 'student-1',
        headers: headers(),
        nowMs: BASE_MS,
      });
      expect(decision.allowed, `attempt ${attempt}`).toBe(true);
      expect(decision.unavailable).toBe(false);
    }

    const refused = await rateLimit.checkRateLimit({
      policy,
      uid: 'student-1',
      headers: headers(),
      nowMs: BASE_MS,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe('user');
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each user separately', async () => {
    const policy = policyFor(1, 100, `per-user-${Date.now()}`);

    const first = await rateLimit.checkRateLimit({
      policy,
      uid: 'student-a',
      headers: headers(),
      nowMs: BASE_MS,
    });
    const second = await rateLimit.checkRateLimit({
      policy,
      uid: 'student-b',
      headers: headers(),
      nowMs: BASE_MS,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('refuses on the IP limit even when each user is under their own', async () => {
    // The abuse case the per-IP limit exists for: many fresh accounts, one host.
    const policy = policyFor(50, 2, `per-ip-${Date.now()}`);

    const a = await rateLimit.checkRateLimit({
      policy,
      uid: 'ip-user-1',
      headers: headers('203.0.113.9'),
      nowMs: BASE_MS,
    });
    const b = await rateLimit.checkRateLimit({
      policy,
      uid: 'ip-user-2',
      headers: headers('203.0.113.9'),
      nowMs: BASE_MS,
    });
    const c = await rateLimit.checkRateLimit({
      policy,
      uid: 'ip-user-3',
      headers: headers('203.0.113.9'),
      nowMs: BASE_MS,
    });

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(false);
    expect(c.scope).toBe('ip');
  });

  it('does not spend an IP unit when the user is already over quota', async () => {
    // Otherwise one abusive account drains the allowance of every student behind
    // the same school NAT, which is the worst available failure mode.
    const policy = policyFor(1, 5, `no-ip-spend-${Date.now()}`);
    const ip = '198.51.100.7';

    await rateLimit.checkRateLimit({ policy, uid: 'greedy', headers: headers(ip), nowMs: BASE_MS });
    const refused = await rateLimit.checkRateLimit({
      policy,
      uid: 'greedy',
      headers: headers(ip),
      nowMs: BASE_MS,
    });
    expect(refused.scope).toBe('user');

    const ipDoc = await adminDb
      .collection('rateLimits')
      .doc(`${policy.operation}__ip__${rateLimit.hashIdentifier(ip)}`)
      .get();
    // Exactly one unit, from the single allowed request.
    expect(ipDoc.data()?.count).toBe(1);
  });

  it('resets when the window rolls over', async () => {
    const policy = policyFor(1, 100, `window-${Date.now()}`);

    const first = await rateLimit.checkRateLimit({
      policy,
      uid: 'window-user',
      headers: headers(),
      nowMs: BASE_MS,
    });
    const blocked = await rateLimit.checkRateLimit({
      policy,
      uid: 'window-user',
      headers: headers(),
      nowMs: BASE_MS + 30_000,
    });
    const afterWindow = await rateLimit.checkRateLimit({
      policy,
      uid: 'window-user',
      headers: headers(),
      nowMs: BASE_MS + 61_000,
    });

    expect(first.allowed).toBe(true);
    expect(blocked.allowed).toBe(false);
    expect(afterWindow.allowed).toBe(true);
  });

  it('is atomic: concurrent requests cannot both take the last slot', async () => {
    // The property a non-transactional read-then-write would fail. Ten parallel
    // callers against a limit of 4 must yield exactly 4 successes.
    const policy = policyFor(4, 500, `atomic-${Date.now()}`);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        rateLimit.checkRateLimit({
          policy,
          uid: 'concurrent-user',
          headers: headers(),
          nowMs: BASE_MS,
        }),
      ),
    );

    expect(results.filter((decision) => decision.allowed)).toHaveLength(4);
    expect(results.filter((decision) => !decision.allowed)).toHaveLength(6);
  });

  it('never stores a raw uid or IP address', async () => {
    // Section 25 data minimization: an IP is personal data, and a document id is
    // the most durable place to leak one.
    const ip = '192.0.2.44';
    const uid = 'privacy-user';
    const policy = policyFor(5, 5, `hashing-${Date.now()}`);

    await rateLimit.checkRateLimit({ policy, uid, headers: headers(ip), nowMs: BASE_MS });

    const snapshot = await adminDb.collection('rateLimits').get();
    const ids = snapshot.docs.map((entry) => entry.id).join('|');
    expect(ids).not.toContain(ip);
    expect(ids).not.toContain(uid);
    // But the hashed key is present, so the write did happen.
    expect(ids).toContain(rateLimit.hashIdentifier(ip));
  });

  it('applies the user limit when no forwarded address is present', async () => {
    // A missing header disables only the IP scope. If it disabled both, stripping
    // the header would be a complete bypass.
    const policy = policyFor(1, 1, `no-header-${Date.now()}`);

    await rateLimit.checkRateLimit({ policy, uid: 'headerless', headers: headers(), nowMs: BASE_MS });
    const refused = await rateLimit.checkRateLimit({
      policy,
      uid: 'headerless',
      headers: headers(),
      nowMs: BASE_MS,
    });

    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe('user');
  });

  it('takes the left-most hop from a multi-hop forwarded header', async () => {
    const chained = new Headers();
    chained.set('x-forwarded-for', '203.0.113.5, 70.41.3.18, 150.172.238.178');
    expect(rateLimit.clientAddress(chained)).toBe('203.0.113.5');
  });
});

describe('safety events against a real Firestore', () => {
  it('records an emergency disclosure and audits the review flag', async () => {
    const sessionId = `safety-session-${Date.now()}`;

    const written = await safetyEvent.recordSafetyEvent({
      sessionId,
      studentId: 'safety-student',
      turnId: 'turn-1',
      category: 'self_harm',
      responseClass: 'emergency_guidance',
      flagForTeacherReview: true,
      confidence: 0.91,
    });
    expect(written).toBe(true);

    const events = await adminDb
      .collection('safetyEvents')
      .where('sessionId', '==', sessionId)
      .get();
    expect(events.size).toBe(1);

    const event = events.docs[0].data();
    expect(event.category).toBe('self_harm');
    expect(event.responseClass).toBe('emergency_guidance');
    expect(event.flaggedForTeacherReview).toBe(true);
    // Nothing in the application closes this; a human must.
    expect(event.reviewStatus).toBe('awaiting_review');
    expect(event.createdAt).toBeTruthy();

    // Section 28 lists safety case review among the five audited privileged
    // actions, so raising the flag must leave an audit entry.
    const audit = await adminDb
      .collection('auditLogs')
      .where('targetId', '==', sessionId)
      .get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data().action).toBe('safety_case_review');
  });

  it('stores no student message content', async () => {
    // Section 25 forbids logging sensitive content. The disclosure already lives
    // on the turn under the student's ownership scope; copying it here would store
    // it twice, in a place the student cannot see.
    const sessionId = `safety-minimal-${Date.now()}`;

    await safetyEvent.recordSafetyEvent({
      sessionId,
      studentId: 'safety-student-2',
      turnId: 'turn-2',
      category: 'bullying',
      responseClass: 'teacher_review',
      flagForTeacherReview: true,
      confidence: 0.7,
    });

    const events = await adminDb
      .collection('safetyEvents')
      .where('sessionId', '==', sessionId)
      .get();
    const serialized = JSON.stringify(events.docs[0].data());
    expect(serialized).not.toContain('content');
    expect(serialized).not.toContain('message');
  });

  it('does not audit a redirect that needs no human review', async () => {
    // An audit trail that records every off-topic question is one nobody reads.
    const sessionId = `safety-noreview-${Date.now()}`;

    await safetyEvent.recordSafetyEvent({
      sessionId,
      studentId: 'safety-student-3',
      turnId: 'turn-3',
      category: 'personal_data',
      responseClass: 'educational_redirect',
      flagForTeacherReview: false,
      confidence: 0.6,
    });

    const events = await adminDb
      .collection('safetyEvents')
      .where('sessionId', '==', sessionId)
      .get();
    expect(events.docs[0].data().reviewStatus).toBe('no_review_required');

    const audit = await adminDb.collection('auditLogs').where('targetId', '==', sessionId).get();
    expect(audit.size).toBe(0);
  });
});

/**
 * The review path. Without these, `safetyEvents` would be written and never read,
 * which is the gap that made rule R6 dead for three phases: a record nobody
 * consumes is not a control.
 */
describe('safety review reaches a human', () => {
  const REVIEW_STUDENT = `review-student-${Date.now()}`;
  const OTHER_STUDENT = `other-student-${Date.now()}`;

  it('surfaces an open flag for a student on the roster', async () => {
    await safetyEvent.recordSafetyEvent({
      sessionId: 'review-session-1',
      studentId: REVIEW_STUDENT,
      turnId: 'turn-r1',
      category: 'bullying',
      responseClass: 'teacher_review',
      flagForTeacherReview: true,
      confidence: 0.77,
    });

    const review = await safetyReview.loadSafetyReview([
      { studentId: REVIEW_STUDENT, displayName: 'Mai' },
    ]);

    expect(review.rosterEmpty).toBe(false);
    expect(review.openCount).toBe(1);
    expect(review.flags[0].displayName).toBe('Mai');
    expect(review.flags[0].responseClass).toBe('teacher_review');
    expect(review.flags[0].classifierConfidence).toBeCloseTo(0.77);
  });

  it('never returns message content', async () => {
    const review = await safetyReview.loadSafetyReview([
      { studentId: REVIEW_STUDENT, displayName: 'Mai' },
    ]);
    const serialized = JSON.stringify(review.flags);
    expect(serialized).not.toContain('content');
    expect(serialized).not.toContain('messageMarkdown');
  });

  it('does not leak a flag for a student outside the roster', async () => {
    // The authorization property: owning one classroom must not reveal flags for
    // students in another.
    await safetyEvent.recordSafetyEvent({
      sessionId: 'review-session-2',
      studentId: OTHER_STUDENT,
      turnId: 'turn-r2',
      category: 'self_harm',
      responseClass: 'emergency_guidance',
      flagForTeacherReview: true,
      confidence: 0.95,
    });

    const review = await safetyReview.loadSafetyReview([
      { studentId: REVIEW_STUDENT, displayName: 'Mai' },
    ]);

    expect(review.flags.map((flag) => flag.studentId)).not.toContain(OTHER_STUDENT);
  });

  it('reports an empty roster distinctly from no flags', async () => {
    // Different facts about a classroom: nobody to flag, versus nobody flagged.
    const empty = await safetyReview.loadSafetyReview([]);
    expect(empty.rosterEmpty).toBe(true);
    expect(empty.flags).toHaveLength(0);

    const noFlags = await safetyReview.loadSafetyReview([
      { studentId: `nobody-${Date.now()}`, displayName: 'Nobody' },
    ]);
    expect(noFlags.rosterEmpty).toBe(false);
    expect(noFlags.flags).toHaveLength(0);
  });

  it('closes a flag and stops counting it as open', async () => {
    const sessionId = `review-close-${Date.now()}`;
    const student = `close-student-${Date.now()}`;

    await safetyEvent.recordSafetyEvent({
      sessionId,
      studentId: student,
      turnId: 'turn-r3',
      category: 'violence',
      responseClass: 'teacher_review',
      flagForTeacherReview: true,
      confidence: 0.6,
    });

    const before = await safetyReview.loadSafetyReview([{ studentId: student, displayName: null }]);
    expect(before.openCount).toBe(1);

    const closed = await safetyReview.markSafetyFlagReviewed(before.flags[0].id, 'teacher-1');
    expect(closed).toBe(true);

    const after = await safetyReview.loadSafetyReview([{ studentId: student, displayName: null }]);
    expect(after.openCount).toBe(0);
    // The flag is retained, not deleted: the record of what happened outlives the
    // review of it.
    expect(after.flags).toHaveLength(1);
    expect(after.flags[0].reviewStatus).toBe('reviewed');
  });

  it('reports a missing flag rather than throwing', async () => {
    expect(await safetyReview.markSafetyFlagReviewed('does-not-exist', 'teacher-1')).toBe(false);
  });
});
