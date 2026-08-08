import { adminDb } from '@/lib/firebase/admin';
import { SCORING_VERSION } from '@/lib/types/scoring';
import type { SessionMetrics } from '@/lib/types/scoring';
import {
  AnalyticsAttemptRow,
  AnalyticsMasteryRow,
  AnalyticsMember,
  AnalyticsProfileRow,
  AnalyticsReportRow,
  AnalyticsSessionRow,
  AnalyticsSnapshotRow,
  ClassroomAnalytics,
  aggregateClassroomAnalytics,
} from '@/lib/analytics/classroom';

/**
 * Loads the evidence a classroom aggregate is computed from, under Admin
 * credentials.
 *
 * Why this cannot be a client query. Section 41.1 requires the Admin SDK
 * "whenever a value is trusted, derived, aggregated, cross-user, or must be
 * consistent with a decision the client is not allowed to make". A classroom
 * aggregate is all five. The alternative -- widening `firestore.rules` so a
 * teacher may read every session, turn and attempt belonging to their students
 * -- would hand teachers the raw transcripts that section 5.8 says must not be
 * exposed by default, and would do it for the sake of a count.
 *
 * So the security boundary sits in `requireClassroomOwner`, not in a rule, and
 * the membership roster is the only thing that decides whose data is read. Every
 * query below is keyed by a student id that came from `classroomMemberships`
 * for this classroom; no query is keyed by anything the caller supplied.
 *
 * `learningSessions` has no `classroomId` (section 28 marks it optional and the
 * student workspace never writes it), so sessions are fanned out over member ids
 * in chunks rather than filtered by classroom. Backfilling `classroomId` would
 * be the faster query, but it would also be a migration over existing student
 * data to serve a teacher view, and it would still need the membership read to
 * know which classroom to trust.
 */

/** Firestore caps `in` filters at 30; 10 matches the batching in lib/scoring/server.ts. */
const IN_CHUNK_SIZE = 10;

/** Bounds the fan-out so one very large classroom cannot make a request unbounded. */
const MAX_MEMBERS = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === 'function') {
    try {
      return candidate.toDate();
    } catch {
      return null;
    }
  }
  return null;
}

export async function loadClassroomMembers(classroomId: string): Promise<AnalyticsMember[]> {
  const snapshot = await adminDb
    .collection('classroomMemberships')
    .where('classroomId', '==', classroomId)
    .where('status', '==', 'active')
    .limit(MAX_MEMBERS)
    .get();

  const studentIds = snapshot.docs
    .map((docSnap) => docSnap.data())
    .filter((data) => data.role === 'student' && typeof data.userId === 'string')
    .map((data) => data.userId as string);

  if (studentIds.length === 0) return [];

  // Display names come from `users`, which the teacher cannot read directly.
  const userBatches = await Promise.all(
    chunk(studentIds, IN_CHUNK_SIZE).map((batch) =>
      adminDb.collection('users').where('id', 'in', batch).get(),
    ),
  );

  const names = new Map<string, string | null>();
  for (const batch of userBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      names.set(docSnap.id, typeof data.displayName === 'string' ? data.displayName : null);
    }
  }

  return studentIds.map((studentId) => ({
    studentId,
    displayName: names.get(studentId) ?? null,
  }));
}

interface LoadedEvidence {
  sessions: AnalyticsSessionRow[];
  snapshots: AnalyticsSnapshotRow[];
  profiles: AnalyticsProfileRow[];
  mastery: AnalyticsMasteryRow[];
  attempts: AnalyticsAttemptRow[];
  reports: AnalyticsReportRow[];
}

export async function loadEvidenceForStudents(studentIds: string[]): Promise<LoadedEvidence> {
  if (studentIds.length === 0) {
    return { sessions: [], snapshots: [], profiles: [], mastery: [], attempts: [], reports: [] };
  }

  const batches = chunk(studentIds, IN_CHUNK_SIZE);

  const [sessionBatches, snapshotBatches, masteryBatches, attemptBatches, reportBatches] =
    await Promise.all([
      Promise.all(
        batches.map((batch) =>
          adminDb.collection('learningSessions').where('studentId', 'in', batch).get(),
        ),
      ),
      Promise.all(
        batches.map((batch) =>
          adminDb
            .collection('independenceSnapshots')
            .where('studentId', 'in', batch)
            .where('scoringVersion', '==', SCORING_VERSION)
            .get(),
        ),
      ),
      Promise.all(
        batches.map((batch) =>
          adminDb.collection('masteryRecords').where('studentId', 'in', batch).get(),
        ),
      ),
      Promise.all(
        batches.map((batch) =>
          adminDb.collection('studentAttempts').where('studentId', 'in', batch).get(),
        ),
      ),
      Promise.all(
        batches.map((batch) =>
          adminDb.collection('reports').where('reporterId', 'in', batch).get(),
        ),
      ),
    ]);

  const sessions: AnalyticsSessionRow[] = [];
  for (const batch of sessionBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      sessions.push({
        id: docSnap.id,
        studentId: String(data.studentId ?? ''),
        status: typeof data.status === 'string' ? data.status : undefined,
        startedAt: toDate(data.startedAt),
        completedAt: toDate(data.completedAt),
        subject: typeof data.subject === 'string' ? data.subject : null,
        topic: typeof data.topic === 'string' ? data.topic : null,
      });
    }
  }

  const snapshots: AnalyticsSnapshotRow[] = [];
  const profiles: AnalyticsProfileRow[] = [];
  for (const batch of snapshotBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      const studentId = String(data.studentId ?? '');
      if (data.kind === 'profile') {
        profiles.push({
          studentId,
          score: typeof data.totalScore === 'number' ? data.totalScore : null,
          band: typeof data.band === 'string' ? data.band : null,
          trend: typeof data.trend === 'number' ? data.trend : null,
          suppressed: data.suppressed !== false,
          coverage: typeof data.coverage === 'number' ? data.coverage : 0,
        });
        continue;
      }
      snapshots.push({
        studentId,
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : null,
        totalScore: typeof data.totalScore === 'number' ? data.totalScore : null,
        coverage: typeof data.coverage === 'number' ? data.coverage : 0,
        suppressed: data.suppressed !== false,
        excludedForSystemError: data.excludedForSystemError === true,
        generatedAt: toDate(data.generatedAt),
        metrics: (data.rawMetrics as Partial<SessionMetrics> | null) ?? null,
      });
    }
  }

  const mastery: AnalyticsMasteryRow[] = [];
  for (const batch of masteryBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      mastery.push({
        studentId: String(data.studentId ?? ''),
        subject: typeof data.subject === 'string' ? data.subject : 'unknown',
        topic: typeof data.topic === 'string' ? data.topic : 'unknown',
        guidedAccuracy: typeof data.guidedAccuracy === 'number' ? data.guidedAccuracy : 0,
        independentAccuracy:
          typeof data.independentAccuracy === 'number' ? data.independentAccuracy : 0,
        averageHintLevel: typeof data.averageHintLevel === 'number' ? data.averageHintLevel : 0,
        transferSuccessRate:
          typeof data.transferSuccessRate === 'number' ? data.transferSuccessRate : 0,
        sessionCount: typeof data.sessionCount === 'number' ? data.sessionCount : 0,
      });
    }
  }

  // Only the error category and topic are read from attempts. The attempt text
  // is the student's own writing and is never aggregated into a teacher view:
  // section 5.8 says a teacher should not automatically see private student work.
  const attempts: AnalyticsAttemptRow[] = [];
  for (const batch of attemptBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      const evaluation = (data.evaluation ?? {}) as Record<string, unknown>;
      attempts.push({
        studentId: String(data.studentId ?? ''),
        errorCategory:
          typeof evaluation.errorCategory === 'string' ? evaluation.errorCategory : null,
        topic: null,
      });
    }
  }

  const reports: AnalyticsReportRow[] = [];
  for (const batch of reportBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      reports.push({
        studentId: String(data.reporterId ?? ''),
        createdAt: toDate(data.createdAt),
        resolved: data.status === 'resolved',
      });
    }
  }

  return { sessions, snapshots, profiles, mastery, attempts, reports };
}

/**
 * The one entry point every teacher analytics surface calls.
 *
 * Authorization is the caller's responsibility and happens before this runs:
 * `requireClassroomOwner` proves the classroom belongs to the caller, and the
 * roster read here decides whose data is in scope. Nothing downstream accepts a
 * student id from the request.
 */
export async function computeClassroomAnalytics(
  classroomId: string,
  now: Date = new Date(),
): Promise<ClassroomAnalytics> {
  const members = await loadClassroomMembers(classroomId);
  const evidence = await loadEvidenceForStudents(members.map((member) => member.studentId));
  return aggregateClassroomAnalytics(classroomId, { now, members, ...evidence });
}
