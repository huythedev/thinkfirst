import { adminDb } from '@/lib/firebase/admin';
import type { SafetyResponseClass } from '@/lib/safety/response';

/**
 * Loads open safety flags for one classroom's roster.
 *
 * ## Why this exists
 *
 * `recordSafetyEvent` writes `reviewStatus: 'awaiting_review'` and, until this
 * module, nothing ever read it. A flag nobody sees is not an escalation, and
 * section 24's requirement that the application "clearly distinguish ... teacher
 * review flags" is not satisfied by recording a distinction no human receives.
 *
 * ## What a teacher is deliberately not given
 *
 * Not the student's words, and not the tutor's reply. The teacher sees that a flag
 * exists, its class, when it was raised, and which student it concerns. That is
 * what they need to start a conversation, and it is all section 5.8 permits
 * without the privileged, audited transcript path this repository has not built.
 *
 * The reasoning is worth stating because the opposite is tempting: showing the
 * message would let a teacher judge severity themselves. It would also mean every
 * classifier false positive publishes a child's private sentence to their teacher,
 * and the classifier is one model call with no second opinion. A flag says "check
 * on this student"; it should not say "here is what they typed".
 *
 * ## Authorization
 *
 * This module performs none. It is called only from a route that has already
 * passed `requireClassroomOwner`, and it constrains every query to the roster it
 * was given. `safetyEvents` has no client read at all, so this Admin-credentials
 * path is the only way the data moves.
 */

export interface SafetyFlag {
  id: string;
  studentId: string;
  displayName: string | null;
  sessionId: string;
  responseClass: SafetyResponseClass;
  /**
   * Present so a teacher can weigh a marginal flag, per §56-style honesty about
   * confidence. Not a severity score.
   */
  classifierConfidence: number;
  raisedAt: string | null;
  /** Deliberately never the message content. See the module comment. */
  reviewStatus: string;
}

export interface SafetyReviewSummary {
  flags: SafetyFlag[];
  openCount: number;
  /**
   * True when the roster is empty, so the caller can distinguish "no flags" from
   * "nobody to have flags", which are different facts about a classroom.
   */
  rosterEmpty: boolean;
}

/** Firestore `in` queries accept at most 30 values; chunked well below that. */
const CHUNK = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** A roster entry, as `loadClassroomMembers` already returns it. */
export interface ReviewRosterMember {
  studentId: string;
  displayName: string | null;
}

/**
 * Reads open flags for the given roster.
 *
 * Fans out over the roster rather than querying `safetyEvents` by classroom,
 * because `safetyEvents` carries no `classroomId` — the same shape as
 * `learningSessions`, and for the same reason: a session belongs to a student, not
 * to a class. Filtering by classroom would require the writer to know which
 * classroom a session belonged to, which it does not.
 *
 * Display names come from the roster the caller already loaded rather than from a
 * second query. The roster loader resolves them from `users`, which is the
 * collection that actually holds them.
 */
export async function loadSafetyReview(
  roster: ReviewRosterMember[],
): Promise<SafetyReviewSummary> {
  const studentIds = roster.map((member) => member.studentId).filter(Boolean);
  if (studentIds.length === 0) {
    return { flags: [], openCount: 0, rosterEmpty: true };
  }

  const names = new Map(roster.map((member) => [member.studentId, member.displayName]));
  const flags: SafetyFlag[] = [];

  for (const group of chunk(studentIds, CHUNK)) {
    const snapshot = await adminDb
      .collection('safetyEvents')
      .where('studentId', 'in', group)
      .where('flaggedForTeacherReview', '==', true)
      .get();

    for (const document of snapshot.docs) {
      const data = document.data();
      const studentId = String(data.studentId ?? '');
      flags.push({
        id: document.id,
        studentId,
        // Null rather than omitted when a name is missing: the point of a flag is
        // the student, and dropping a child who needs checking on would be the
        // worst possible way to handle a missing profile.
        displayName: names.get(studentId) ?? null,
        sessionId: String(data.sessionId ?? ''),
        responseClass: (data.responseClass ?? 'teacher_review') as SafetyResponseClass,
        classifierConfidence: Number(data.classifierConfidence ?? 0),
        raisedAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        reviewStatus: String(data.reviewStatus ?? 'awaiting_review'),
      });
    }
  }

  // Newest first: a flag raised this morning matters more than one from last term.
  // Nulls sort last rather than crashing the comparator, which happens when a
  // server timestamp has not yet resolved on a just-written document.
  flags.sort((left, right) => {
    if (!left.raisedAt) return 1;
    if (!right.raisedAt) return -1;
    return right.raisedAt.localeCompare(left.raisedAt);
  });

  return {
    flags,
    openCount: flags.filter((flag) => flag.reviewStatus === 'awaiting_review').length,
    rosterEmpty: false,
  };
}

/**
 * Marks a flag reviewed.
 *
 * The write is narrow on purpose: `reviewStatus`, who closed it, and when.
 * Nothing about the flag itself is mutable, so a review cannot quietly rewrite
 * what was recorded. Section 28 lists safety case review among the audited
 * privileged actions, and the caller writes that entry.
 */
export async function markSafetyFlagReviewed(
  eventId: string,
  reviewerId: string,
): Promise<boolean> {
  const ref = adminDb.collection('safetyEvents').doc(eventId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;

  await ref.update({
    reviewStatus: 'reviewed',
    reviewedBy: reviewerId,
    reviewedAt: new Date(),
  });
  return true;
}
