import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

/**
 * The `auditLogs` writer.
 *
 * Section 28 lists five privileged actions that must be recorded -- transcript
 * access, role changes, classroom exports, safety case review, policy changes --
 * and section 39 says clients cannot write the collection directly. Neither
 * specifies a document shape, so one is defined here rather than being invented
 * separately at each call site.
 *
 * Until this session the collection was dead: `allow read, write: if false` with
 * nothing on the server writing it, which satisfies the rule trivially and the
 * requirement not at all. An audit trail that no code appends to is not an audit
 * trail.
 *
 * Writes are best-effort and never propagate: a failed audit write must not cost
 * a teacher their page. But the ordering matters and is deliberate -- callers
 * await the log **before** returning privileged data, so a successful read
 * cannot outrun its own record.
 */

export type AuditAction =
  | 'transcript_access'
  | 'role_change'
  | 'classroom_export'
  | 'safety_case_review'
  | 'policy_change'
  | 'student_summary_access';

export interface AuditEntry {
  /** The uid of the caller performing the privileged action. */
  actorId: string;
  actorRole: string;
  action: AuditAction;
  /** What was acted upon: a collection path, a classroom id, a student id. */
  targetType: 'classroom' | 'student' | 'session' | 'user' | 'assignment';
  targetId: string;
  /**
   * Section 5.8 requires transcript access to have "a clear reason". Stored
   * verbatim as the teacher typed it, so a review can judge whether the stated
   * reason was honest rather than only that a reason existed.
   */
  reason?: string;
  /** Additional non-content context. Never the educational content itself. */
  context?: Record<string, string | number | boolean | null>;
}

export async function writeAuditLog(entry: AuditEntry): Promise<boolean> {
  try {
    await adminDb.collection('auditLogs').add({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason ?? null,
      context: entry.context ?? {},
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (error) {
    // Logged loudly: a privileged read that could not be recorded is a gap in
    // the trail, and silence would hide it.
    console.error('Audit log write failed', {
      action: entry.action,
      targetId: entry.targetId,
      error,
    });
    return false;
  }
}
