import { adminDb } from '@/lib/firebase/admin';
import { SCORING_VERSION } from '@/lib/types/scoring';
import { parseStoredSessionMetrics } from '@/lib/scoring/stored-metrics';
import {
  AnalyticsAttemptRow,
  AnalyticsMember,
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
 * Membership establishes who may have classroom evidence. The trusted session
 * binding establishes which evidence belongs to this classroom. Both are
 * required: a current roster entry never authorizes the student's activity from
 * another classroom or from private practice.
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
    .filter((docSnap) => {
      const data = docSnap.data();
      return (
        data.role === 'student' &&
        typeof data.userId === 'string' &&
        docSnap.id === `${classroomId}__${data.userId}`
      );
    })
    .map((docSnap) => docSnap.data())
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
  attempts: AnalyticsAttemptRow[];
  reports: AnalyticsReportRow[];
}

interface CandidateSession {
  id: string;
  studentId: string;
  data: FirebaseFirestore.DocumentData;
}

function toAnalyticsSession(
  candidate: CandidateSession,
  scope: 'classroom' | 'assignment',
  classroomId: string,
): AnalyticsSessionRow {
  return {
    id: candidate.id,
    studentId: candidate.studentId,
    scope,
    classroomId,
    status: typeof candidate.data.status === 'string' ? candidate.data.status : undefined,
    startedAt: toDate(candidate.data.startedAt),
    completedAt: toDate(candidate.data.completedAt),
    subject: typeof candidate.data.subject === 'string' ? candidate.data.subject : null,
    topic: typeof candidate.data.topic === 'string' ? candidate.data.topic : null,
  };
}

export async function loadEvidenceForClassroom(
  classroomId: string,
  studentIds: string[],
): Promise<LoadedEvidence> {
  if (studentIds.length === 0) {
    return { sessions: [], snapshots: [], attempts: [], reports: [] };
  }

  const batches = chunk(studentIds, IN_CHUNK_SIZE);
  const sessionBatches = await Promise.all(
    batches.map((batch) =>
      adminDb
        .collection('learningSessions')
        .where('classroomId', '==', classroomId)
        .where('studentId', 'in', batch)
        .get(),
    ),
  );

  const sessions: AnalyticsSessionRow[] = [];
  const sessionOwners = new Map<string, string>();
  const allowedStudentIds = new Set(studentIds);
  const candidateAssignments = new Map<string, CandidateSession[]>();
  for (const batch of sessionBatches) {
    for (const docSnap of batch.docs) {
      const data = docSnap.data() ?? {};
      const studentId = typeof data.studentId === 'string' ? data.studentId : '';
      const scope = data.scope;
      if (
        data.classroomId !== classroomId ||
        !allowedStudentIds.has(studentId) ||
        (scope !== 'classroom' && scope !== 'assignment') ||
        (scope === 'classroom' && 'assignmentId' in data) ||
        (scope === 'assignment' && typeof data.assignmentId !== 'string')
      ) {
        continue;
      }
      if (scope === 'assignment') {
        const assignmentId = data.assignmentId as string;
        const candidates = candidateAssignments.get(assignmentId);
        const candidate = { id: docSnap.id, studentId, data };
        if (candidates) candidates.push(candidate);
        else candidateAssignments.set(assignmentId, [candidate]);
        continue;
      }
      const candidate = { id: docSnap.id, studentId, data };
      sessionOwners.set(candidate.id, candidate.studentId);
      sessions.push(toAnalyticsSession(candidate, 'classroom', classroomId));
    }
  }

  if (candidateAssignments.size > 0) {
    const assignmentIds = [...candidateAssignments.keys()];
    const assignmentBatches = await Promise.all(
      chunk(assignmentIds, IN_CHUNK_SIZE).map((batch) =>
        adminDb.getAll(
          ...batch.map((assignmentId) => adminDb.collection('assignments').doc(assignmentId)),
        ),
      ),
    );
    const validAssignmentIds = new Set<string>();
    for (const batch of assignmentBatches) {
      for (const assignmentSnap of batch) {
        if (!assignmentSnap.exists) continue;
        const assignment = assignmentSnap.data() ?? {};
        if (assignment.classroomId === classroomId) validAssignmentIds.add(assignmentSnap.id);
      }
    }
    for (const assignmentId of validAssignmentIds) {
      for (const candidate of candidateAssignments.get(assignmentId) ?? []) {
        sessionOwners.set(candidate.id, candidate.studentId);
        sessions.push(toAnalyticsSession(candidate, 'assignment', classroomId));
      }
    }
  }

  if (sessions.length === 0) {
    return { sessions: [], snapshots: [], attempts: [], reports: [] };
  }

  const sessionIds = sessions.map((session) => session.id);
  const [snapshotBatches, attemptBatches, reportBatches] = await Promise.all([
    Promise.all(
      chunk(sessionIds, IN_CHUNK_SIZE).map((batch) =>
        adminDb.getAll(
          ...batch.map((sessionId) =>
            adminDb
              .collection('independenceSnapshotsInternal')
              .doc(`${sessionId}__${SCORING_VERSION}`),
          ),
        ),
      ),
    ),
    Promise.all(
      chunk(sessionIds, IN_CHUNK_SIZE).map((batch) =>
        adminDb.collection('studentAttempts').where('sessionId', 'in', batch).get(),
      ),
    ),
    Promise.all(
      chunk(sessionIds, IN_CHUNK_SIZE).map((batch) =>
        adminDb.collection('reports').where('sessionId', 'in', batch).get(),
      ),
    ),
  ]);

  const snapshots: AnalyticsSnapshotRow[] = [];
  for (const batch of snapshotBatches) {
    for (const docSnap of batch) {
      if (!docSnap.exists) continue;
      const data = docSnap.data() ?? {};
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : null;
      const studentId = sessionId ? sessionOwners.get(sessionId) : null;
      if (
        !sessionId ||
        !studentId ||
        data.kind !== 'session' ||
        data.scoringVersion !== SCORING_VERSION ||
        data.studentId !== studentId
      ) {
        continue;
      }
      const metrics = parseStoredSessionMetrics(data.rawMetrics, sessionId);
      if (!metrics) continue;
      snapshots.push({
        studentId,
        sessionId,
        totalScore: typeof data.totalScore === 'number' ? data.totalScore : null,
        coverage: typeof data.coverage === 'number' ? data.coverage : 0,
        suppressed: data.suppressed !== false,
        excludedForSystemError: data.excludedForSystemError === true,
        generatedAt: toDate(data.generatedAt),
        metrics,
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
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
      const studentId = sessionOwners.get(sessionId);
      if (!studentId || data.studentId !== studentId) continue;
      const evaluation = (data.evaluation ?? {}) as Record<string, unknown>;
      attempts.push({
        sessionId,
        studentId,
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
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : '';
      const studentId = sessionOwners.get(sessionId);
      if (!studentId || data.reporterId !== studentId) continue;
      reports.push({
        sessionId,
        studentId,
        createdAt: toDate(data.createdAt),
        resolved: data.status === 'resolved',
      });
    }
  }

  return { sessions, snapshots, attempts, reports };
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
  const evidence = await loadEvidenceForClassroom(
    classroomId,
    members.map((member) => member.studentId),
  );
  return aggregateClassroomAnalytics(classroomId, { now, members, ...evidence });
}
