import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

const COUNTER_COLLECTION = 'sessionTurnCounters';

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

/**
 * Reserve one or more monotonically increasing sequence numbers for a session.
 *
 * `minimumNextSequence` comes from the already-persisted transcript and lets the
 * counter bootstrap safely for sessions created before this allocator existed.
 * The stored counter itself lives in a server-only collection so a browser cannot
 * pre-seed or rewind it through the client-created `learningSessions` document.
 */
export async function reserveTurnSequences(
  sessionId: string,
  minimumNextSequence: number,
  count: number,
): Promise<number[]> {
  const minimum = positiveInteger(minimumNextSequence);
  if (!sessionId || !minimum || !Number.isInteger(count) || count < 1 || count > 10) {
    throw new Error('Invalid turn-sequence reservation request.');
  }

  const ref = adminDb.collection(COUNTER_COLLECTION).doc(sessionId);

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const storedNext = positiveInteger(snapshot.data()?.nextSequence);
    const start = Math.max(minimum, storedNext ?? minimum);
    const nextSequence = start + count;

    transaction.set(
      ref,
      {
        sessionId,
        nextSequence,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return Array.from({ length: count }, (_, index) => start + index);
  });
}
