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
