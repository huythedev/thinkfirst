import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

const LOCK_COLLECTION = 'sessionProcessingLocks';
const LOCK_LEASE_MS = 6 * 60 * 1000;

function expiryMillis(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

export interface SessionRequestLock {
  sessionId: string;
  token: string;
}

/**
 * Acquire an expiring server-only lease for one learning session.
 *
 * The UI already prevents ordinary double-submit, but that is not a trust
 * boundary: multiple tabs or direct API clients can still race. Without this
 * lease two requests can read the same hint level and policy history, then both
 * generate help before either advances server state. The Firestore transaction
 * makes acquisition safe across Cloud Run instances.
 */
export async function acquireSessionRequestLock(
  sessionId: string,
): Promise<SessionRequestLock | null> {
  if (!sessionId) throw new Error('Session id is required for request locking.');

  const token = randomUUID();
  const ref = adminDb.collection(LOCK_COLLECTION).doc(sessionId);
  const now = Date.now();

  const acquired = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    const existingExpiry = expiryMillis(data.expiresAt);

    if (snapshot.exists && existingExpiry > now) {
      return false;
    }

    transaction.set(ref, {
      sessionId,
      token,
      expiresAt: Timestamp.fromMillis(now + LOCK_LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });

  return acquired ? { sessionId, token } : null;
}

/** Release only the lease acquired by this request; never delete a newer lease. */
export async function releaseSessionRequestLock(lock: SessionRequestLock): Promise<void> {
  const ref = adminDb.collection(LOCK_COLLECTION).doc(lock.sessionId);

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.token !== lock.token) return;
    transaction.delete(ref);
  });
}
