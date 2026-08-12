import { adminDb } from '@/lib/firebase/admin';

/**
 * Signals that an in-flight educational request lost the session-finality race.
 * Callers deliberately return a conflict rather than treating this as a system
 * error, because no student behavior failed and no educational state was saved.
 */
export class SessionClosedDuringRequestError extends Error {
  constructor() {
    super('The learning session closed while this tutoring request was running.');
    this.name = 'SessionClosedDuringRequestError';
  }
}

/** A request resolved against an older session state and must not commit. */
export class SessionRevisionConflictError extends Error {
  constructor() {
    super('The learning session changed while this tutoring request was running.');
    this.name = 'SessionRevisionConflictError';
  }
}

/**
 * Runs writes with an atomic `status === active` precondition.  The precondition
 * and every supplied write share one Firestore transaction, so a completion
 * cannot interleave between a last read and the commit.
 */
export async function runWhileSessionActive<T>(
  sessionId: string,
  write: (transaction: FirebaseFirestore.Transaction) => Promise<T> | T,
): Promise<T> {
  const sessionRef = adminDb.collection('learningSessions').doc(sessionId);
  return adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(sessionRef);
    if (!current.exists || current.data()?.status !== 'active') {
      throw new SessionClosedDuringRequestError();
    }
    return write(transaction);
  });
}

/**
 * The final authoritative request commit. Model calls happen before this point;
 * this transaction only compares the revision and writes already-resolved facts.
 */
export async function commitForSessionRevision<T>(input: {
  sessionId: string;
  expectedRevision: number;
  write: (
    transaction: FirebaseFirestore.Transaction,
    sessionRef: FirebaseFirestore.DocumentReference,
    nextRevision: number,
    current: Record<string, unknown>,
  ) => Promise<T> | T;
}): Promise<T> {
  const sessionRef = adminDb.collection('learningSessions').doc(input.sessionId);
  return adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(sessionRef);
    const data = current.data() ?? {};
    if (!current.exists || data.status !== 'active') {
      throw new SessionClosedDuringRequestError();
    }
    const revision = typeof data.revision === 'number' && Number.isFinite(data.revision)
      ? Math.max(0, Math.trunc(data.revision))
      : 0;
    if (revision !== input.expectedRevision) {
      throw new SessionRevisionConflictError();
    }
    const result = await input.write(transaction, sessionRef, revision + 1, data);
    transaction.update(sessionRef, {
      revision: revision + 1,
      updatedAt: new Date(),
    });
    return result;
  });
}

/**
 * Records an unexpected request failure only if this request still owns the
 * session state it resolved.  A loser of the optimistic-concurrency race must
 * never turn a newer, successful tutoring exchange into a system-error session.
 */
export async function markSessionSystemErrorForRevision(
  sessionId: string,
  expectedRevision: number,
): Promise<boolean> {
  const sessionRef = adminDb.collection('learningSessions').doc(sessionId);
  return adminDb.runTransaction(async (transaction) => {
    const current = await transaction.get(sessionRef);
    const data = current.data() ?? {};
    if (!current.exists || data.status !== 'active') return false;
    const revision = typeof data.revision === 'number' && Number.isFinite(data.revision)
      ? Math.max(0, Math.trunc(data.revision))
      : 0;
    if (revision !== expectedRevision) return false;
    transaction.update(sessionRef, {
      endedWithSystemError: true,
      updatedAt: new Date(),
    });
    return true;
  });
}
