import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { writeAuditLog } from '@/lib/audit/audit-log';
import type { SafetyCategory, SafetyResponseClass } from './response';

/**
 * The `safetyEvents` writer.
 *
 * Section 24 requires the application to "clearly distinguish" educational
 * redirection, immediate emergency guidance, teacher review flags and
 * administrative abuse reports. A distinction that exists only in a variable
 * inside one request is not recorded anywhere and cannot be reviewed, so the
 * disposition is persisted here with the turn it came from.
 *
 * Section 28 does not define this collection. It follows the pattern established
 * in Phases 5 and 6 for system-authored content that no client may read:
 * `transferProblems`, `assignmentReferences` and `studentAttempts`. Section 24 is
 * explicit that safety classifications must not be exposed to classmates, and the
 * safest way to guarantee that is a collection with no client read at all.
 *
 * ## What is deliberately not stored
 *
 * Not the student's message. Section 25 requires data minimization and forbids
 * logging sensitive content, and a self-harm disclosure copied into a second
 * collection is the same disclosure stored twice, now in a place the student
 * cannot see and cannot delete. The category, the disposition and a pointer to
 * the turn are enough for a human to follow up; the turn itself already holds the
 * content under the student's own ownership scope.
 */

export interface SafetyEventInput {
  sessionId: string;
  studentId: string;
  turnId: string;
  category: Exclude<SafetyCategory, 'none'>;
  responseClass: SafetyResponseClass;
  flagForTeacherReview: boolean;
  /** Classifier confidence, so a low-confidence flag can be weighted by a human. */
  confidence: number;
}

/**
 * Records a safety event and, when a human is asked to act, an audit entry.
 *
 * Best-effort and never propagating: a failed write must not turn a safety turn
 * into a 500, because the student would then see a generic error instead of the
 * message telling them where to get help. The failure is logged loudly instead.
 */
export async function recordSafetyEvent(input: SafetyEventInput): Promise<boolean> {
  try {
    await adminDb.collection('safetyEvents').add({
      sessionId: input.sessionId,
      studentId: input.studentId,
      turnId: input.turnId,
      category: input.category,
      responseClass: input.responseClass,
      flaggedForTeacherReview: input.flagForTeacherReview,
      classifierConfidence: input.confidence,
      // Open until a human records that they have looked. Nothing in this
      // application closes it automatically; that would defeat the purpose.
      reviewStatus: input.flagForTeacherReview ? 'awaiting_review' : 'no_review_required',
      createdAt: FieldValue.serverTimestamp(),
    });

    if (input.flagForTeacherReview) {
      // Section 28 lists safety case review among the five privileged actions the
      // audit trail must carry. The flag being *raised* is the auditable moment;
      // whether anyone acts on it is visible from `reviewStatus`.
      await writeAuditLog({
        actorId: 'system',
        actorRole: 'system',
        action: 'safety_case_review',
        targetType: 'session',
        targetId: input.sessionId,
        reason: 'Automatic safety flag raised for human review.',
        context: {
          category: input.category,
          responseClass: input.responseClass,
          studentId: input.studentId,
        },
      });
    }

    return true;
  } catch (error) {
    console.error('Safety event write failed', {
      sessionId: input.sessionId,
      category: input.category,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
