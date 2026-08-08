import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Rate limiting for the AI endpoints (section 41, Phase 8).
 *
 * Section 41 lists "rate-limit bypass" as a threat and "rate-limit by user and IP
 * where appropriate" as its mitigation; section 29 repeats it as a requirement on
 * the AI endpoints specifically.
 *
 * ## Why Firestore rather than an in-process counter
 *
 * A `Map` in module scope is the obvious implementation and is not a rate limit.
 * Next.js route handlers run per-instance, the deployment target is Cloud Run
 * (section 27), and instances scale horizontally: an attacker gets the configured
 * quota multiplied by however many instances happen to be warm, and gets a fresh
 * quota on every cold start. The counter has to live where all instances can see
 * it, and Firestore is already that place with an Admin write path in use.
 *
 * The cost is one transaction per request on the limited endpoints. That is
 * acceptable on endpoints that are about to spend up to four model calls, and it
 * is why cheap read endpoints are not wrapped.
 *
 * ## Fixed window, not a token bucket
 *
 * A fixed window is coarser: a caller can spend the whole quota at the end of one
 * window and again at the start of the next. For abuse prevention on an endpoint
 * whose real constraint is model spend, that is fine, and it costs one document
 * read instead of a stored refill rate. Chosen deliberately, not by default.
 *
 * ## The per-IP limit is a mitigation, not a control
 *
 * `NextRequest` exposes no trustworthy client address, so the IP is derived from
 * `x-forwarded-for`, which the client can set unless a trusted proxy overwrites
 * it. Section 41.1's rule applies: this narrows blast radius and is worth having,
 * but it is not a boundary, and it is recorded as such in `docs/ASSUMPTIONS.md`
 * and `docs/THREAT-MODEL.md` rather than described as secure. The per-user limit,
 * keyed on the uid from a verified ID token, is the real control.
 *
 * An IP address is personal data under section 25's minimization rule, so it is
 * stored as a salted hash and never in plain text.
 */

export type RateLimitScope = 'user' | 'ip';

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitPolicy {
  /** Stable name for the limited operation, used in the document key. */
  operation: string;
  user: RateLimitRule;
  ip: RateLimitRule;
}

/**
 * The configured limits.
 *
 * Numbers chosen against the real constraint rather than picked round: the
 * tutoring endpoint makes up to four model calls per turn, and the free tier
 * allows 20 requests per day, so a per-minute allowance well above human typing
 * speed still cannot be the thing that exhausts a quota. The per-IP allowance is
 * a small multiple of the per-user one so that a shared school NAT does not lock
 * out a classroom, which is the failure mode that would matter most here.
 */
export const RATE_LIMITS: Record<string, RateLimitPolicy> = {
  tutorChat: {
    operation: 'tutor-chat',
    user: { limit: 12, windowSeconds: 60 },
    ip: { limit: 60, windowSeconds: 60 },
  },
  imageUpload: {
    operation: 'image-upload',
    user: { limit: 10, windowSeconds: 300 },
    ip: { limit: 40, windowSeconds: 300 },
  },
  classroomJoin: {
    operation: 'classroom-join',
    user: { limit: 8, windowSeconds: 300 },
    ip: { limit: 40, windowSeconds: 300 },
  },
};

export interface RateLimitDecision {
  allowed: boolean;
  /** Which scope refused the request, when one did. */
  scope: RateLimitScope | null;
  /** Requests left in the current window for the scope that came closest. */
  remaining: number;
  /** Seconds until the current window resets. Suitable for `Retry-After`. */
  retryAfterSeconds: number;
  limit: number;
  /**
   * True when the limiter itself could not run. The caller decides what to do;
   * see `checkRateLimit`'s contract below.
   */
  unavailable: boolean;
}

const ALLOWED: RateLimitDecision = {
  allowed: true,
  scope: null,
  remaining: Number.POSITIVE_INFINITY,
  retryAfterSeconds: 0,
  limit: Number.POSITIVE_INFINITY,
  unavailable: false,
};

/**
 * Hashes an identifier before it becomes a document id.
 *
 * Two reasons, not one. Privacy: section 25 requires data minimization, and a
 * plain-text IP in a document id is an IP in a log forever. Correctness: a raw
 * IPv6 address or a uid containing `/` would produce an invalid Firestore path.
 *
 * The salt is `RATE_LIMIT_SALT` when configured. Without it the hash is still a
 * one-way function but is dictionary-attackable over the IPv4 space, so the
 * absence is recorded in ASSUMPTIONS rather than silently accepted.
 */
export function hashIdentifier(value: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? '';
  return createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32);
}

/**
 * Extracts the client address from proxy headers.
 *
 * Returns null when no header is present, which is the normal case for a direct
 * local request. A null address disables only the IP limit; the user limit still
 * applies, so a missing header is not a bypass of everything.
 */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxies. Untrusted
    // either way, per the module comment.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip')?.trim();
  return realIp && realIp.length > 0 ? realIp : null;
}

function windowStart(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Consumes one unit against a single key, atomically.
 *
 * The transaction is what makes this a limit rather than an approximation: two
 * concurrent requests reading `count: 9` against a limit of 10 would both be
 * allowed by a read-then-write, and a caller spending four model calls per
 * request would notice the difference.
 */
async function consume(
  documentId: string,
  rule: RateLimitRule,
  nowMs: number,
): Promise<ConsumeResult> {
  const ref = adminDb.collection('rateLimits').doc(documentId);
  const start = windowStart(nowMs, rule.windowSeconds);
  const resetMs = start + rule.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));

  return adminDb.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const data = snapshot.data();

    // A document from an earlier window is stale rather than relevant. Comparing
    // the stored boundary is what rolls the window over; nothing expires it.
    const sameWindow = data?.windowStart instanceof Timestamp
      ? data.windowStart.toMillis() === start
      : false;
    const count = sameWindow ? Number(data?.count ?? 0) : 0;

    if (count >= rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    tx.set(
      ref,
      {
        count: count + 1,
        windowStart: Timestamp.fromMillis(start),
        // Retention marker: a window document is disposable once its window has
        // passed, and section 25 requires configurable retention.
        expiresAt: Timestamp.fromMillis(resetMs),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - (count + 1)),
      retryAfterSeconds,
    };
  });
}

export interface RateLimitRequest {
  policy: RateLimitPolicy;
  /** The uid from a *verified* token. Never a value from the request body. */
  uid: string;
  headers: Headers;
  /** Injectable for tests; defaults to the server clock. */
  nowMs?: number;
}

/**
 * Checks both scopes and consumes a unit from each that passes.
 *
 * The user scope is checked first and deliberately: if the user is already over
 * quota, no IP unit is spent, so one abusive account cannot exhaust the shared
 * allowance of everyone behind the same school NAT.
 *
 * ## Fail-open, stated plainly
 *
 * If Firestore is unreachable the limiter reports `unavailable: true` and allows
 * the request. This is the one place in this codebase that does not fail closed,
 * and it is a judgment rather than an oversight: a rate limiter is an abuse
 * control, not an authorization control, and every authorization check on these
 * endpoints has already run and still fails closed. Failing closed here would
 * turn a Firestore blip into a total outage of the tutor for legitimate students.
 * The decision is recorded in `docs/THREAT-MODEL.md` under rate-limit bypass so
 * it is reviewable rather than buried.
 */
export async function checkRateLimit(request: RateLimitRequest): Promise<RateLimitDecision> {
  const nowMs = request.nowMs ?? Date.now();
  const { policy, uid, headers } = request;

  try {
    const userKey = `${policy.operation}__user__${hashIdentifier(uid)}`;
    const userResult = await consume(userKey, policy.user, nowMs);

    if (!userResult.allowed) {
      return {
        allowed: false,
        scope: 'user',
        remaining: 0,
        retryAfterSeconds: userResult.retryAfterSeconds,
        limit: policy.user.limit,
        unavailable: false,
      };
    }

    const address = clientAddress(headers);
    if (!address) {
      return {
        allowed: true,
        scope: null,
        remaining: userResult.remaining,
        retryAfterSeconds: 0,
        limit: policy.user.limit,
        unavailable: false,
      };
    }

    const ipKey = `${policy.operation}__ip__${hashIdentifier(address)}`;
    const ipResult = await consume(ipKey, policy.ip, nowMs);

    if (!ipResult.allowed) {
      return {
        allowed: false,
        scope: 'ip',
        remaining: 0,
        retryAfterSeconds: ipResult.retryAfterSeconds,
        limit: policy.ip.limit,
        unavailable: false,
      };
    }

    return {
      allowed: true,
      scope: null,
      remaining: Math.min(userResult.remaining, ipResult.remaining),
      retryAfterSeconds: 0,
      limit: policy.user.limit,
      unavailable: false,
    };
  } catch (error) {
    console.error('Rate limiter unavailable; allowing the request', {
      operation: policy.operation,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...ALLOWED, unavailable: true };
  }
}

/**
 * Standard headers for a refused request.
 *
 * `Retry-After` is the one that matters: without it a client retries immediately
 * and the refusal costs more than it saves.
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'Retry-After': String(decision.retryAfterSeconds),
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
  };
}
