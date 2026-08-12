import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { computeIndependenceProfile, scoreSession } from '@/lib/scoring/independence';
import {
  RawAttempt,
  RawSession,
  RawTurn,
  deriveSessionMetrics,
  toDate,
} from '@/lib/scoring/metrics';
import {
  ComponentId,
  ComponentScore,
  IndependenceProfile,
  SCORING_VERSION,
  SessionMetrics,
  SessionScore,
} from '@/lib/types/scoring';

/**
 * Server-side scoring and persistence.
 *
 * Phase 5's first exit criterion is explicit: "Scores are computed server-side
 * and persisted to `independenceSnapshots`. Recomputation in the browser on read
 * fails this criterion." So every read path below runs under Admin credentials,
 * and the browser reads a stored document rather than a transcript.
 *
 * That is a security property as much as an architectural one. §56.4 forbids the
 * client from writing a score, and `firestore.rules` denies client writes to
 * `independenceSnapshots` outright. A score computed in the browser is not
 * protected by that rule at all: the number on screen never passed through it.
 *
 * Reads here deliberately avoid `orderBy`, so no composite index is required;
 * ordering happens in memory. Phase 6 will need indexes for teacher aggregates,
 * which is a different query shape.
 */

/** Bounded so one student with a long history cannot make a request unbounded. */
const MAX_SESSIONS = 30;

/** Firestore caps `in` filters at 30 values; 10 keeps well clear. */
const IN_CHUNK_SIZE = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function occurredAtOf(session: RawSession): number {
  return (toDate(session.completedAt) ?? toDate(session.startedAt))?.getTime() ?? 0;
}

/**
 * Loads a student's sessions, transcripts and stored attempt evaluations, then
 * derives metrics for each session.
 *
 * Attempt evaluations are read from storage rather than regenerated, because
 * §56.4 requires recomputation from stored metrics to be byte-identical. Asking
 * the evaluator model again at read time would make the score non-reproducible,
 * and would also charge a model call to every page view.
 */
export async function loadSessionMetrics(studentId: string): Promise<SessionMetrics[]> {
  const sessionsSnapshot = await adminDb
    .collection('learningSessions')
    .where('studentId', '==', studentId)
    .get();

  const sessions: RawSession[] = sessionsSnapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<RawSession, 'id'>),
  }));

  if (sessions.length === 0) return [];

  const recent = sessions
    .sort((left, right) => occurredAtOf(right) - occurredAtOf(left))
    .slice(0, MAX_SESSIONS);

  const ids = recent.map((session) => session.id);

  const [turnBatches, attemptBatches] = await Promise.all([
    Promise.all(
      chunk(ids, IN_CHUNK_SIZE).map((batch) =>
        adminDb.collection('sessionTurns').where('sessionId', 'in', batch).get(),
      ),
    ),
    Promise.all(
      chunk(ids, IN_CHUNK_SIZE).map((batch) =>
        adminDb.collection('studentAttempts').where('sessionId', 'in', batch).get(),
      ),
    ),
  ]);

  const turnsBySession = new Map<string, RawTurn[]>();
  for (const batch of turnBatches) {
    for (const docSnap of batch.docs) {
      const turn = { id: docSnap.id, ...(docSnap.data() as RawTurn) };
      if (!turn.sessionId) continue;
      const bucket = turnsBySession.get(turn.sessionId);
      if (bucket) bucket.push(turn);
      else turnsBySession.set(turn.sessionId, [turn]);
    }
  }

  const attemptsBySession = new Map<string, RawAttempt[]>();
  for (const batch of attemptBatches) {
    for (const docSnap of batch.docs) {
      const attempt = { id: docSnap.id, ...(docSnap.data() as RawAttempt) };
      if (!attempt.sessionId) continue;
      const bucket = attemptsBySession.get(attempt.sessionId);
      if (bucket) bucket.push(attempt);
      else attemptsBySession.set(attempt.sessionId, [attempt]);
    }
  }

  return recent.map((session) =>
    deriveSessionMetrics(
      session,
      turnsBySession.get(session.id) ?? [],
      attemptsBySession.get(session.id) ?? [],
    ),
  );
}

/**
 * The most recent stored profile score, used to enforce §56.4's rule that no
 * single session may move the displayed score by more than 8 points.
 *
 * Only `scoring-v2` snapshots are considered. §56.5 forbids mutating v1
 * snapshots and requires recomputing forward, so a v1 score is history rather
 * than a baseline to clamp against.
 */
export async function loadPreviousProfileScore(studentId: string): Promise<number | null> {
  const snapshot = await adminDb
    .collection('independenceSnapshots')
    .where('studentId', '==', studentId)
    .where('kind', '==', 'profile')
    .where('scoringVersion', '==', SCORING_VERSION)
    .get();

  if (snapshot.empty) return null;

  const documents = snapshot.docs
    .map((docSnap) => docSnap.data() as Record<string, unknown>)
    .map((data) => ({
      score: typeof data.totalScore === 'number' ? data.totalScore : null,
      generatedAt: toDate(data.generatedAt)?.getTime() ?? 0,
    }))
    .sort((left, right) => right.generatedAt - left.generatedAt);

  return documents[0]?.score ?? null;
}

/** Weighted 0-100 points for the section 28 `components` field shape. */
function weightedPoints(component: ComponentScore | undefined): number | null {
  if (!component || component.value === null) return null;
  return Math.round(component.value * component.weight * 100) / 100;
}

function componentsField(components: ComponentScore[]) {
  const find = (id: ComponentId) => components.find((component) => component.id === id);
  return {
    firstAttempt: weightedPoints(find('firstAttempt')),
    hintEfficiency: weightedPoints(find('hintEfficiency')),
    explanation: weightedPoints(find('reasoningExplanation')),
    transfer: weightedPoints(find('transferPerformance')),
    verification: weightedPoints(find('verificationBehavior')),
  };
}

/**
 * Firestore rejects `undefined`, while `rationaleCode` is intentionally
 * optional in the domain model. Preserve every defined component field and
 * omit only that absent optional field at the persistence boundary.
 */
function serializeComponentDetail(components: ComponentScore[]): ComponentScore[] {
  return components.map(({ rationaleCode, ...component }) =>
    rationaleCode === undefined ? component : { ...component, rationaleCode },
  );
}

/**
 * §56.4 requires every snapshot to store the raw metrics it was computed from, so
 * a stored score can be recomputed and audited. `Date` values are serialized to
 * ISO strings because Firestore rejects `undefined` and nested `Date` handling
 * differs between the Admin and client SDKs.
 */
function serializeMetrics(metrics: SessionMetrics): Record<string, unknown> {
  return {
    ...metrics,
    occurredAt: metrics.occurredAt ? metrics.occurredAt.toISOString() : null,
  };
}

export interface PersistResult {
  sessionScore: SessionScore;
  profile: IndependenceProfile;
  sessionSnapshotId: string;
  profileSnapshotId: string;
}

/**
 * Computes and persists the trusted learning evidence for one session, then
 * refreshes the rolled-up profile snapshot and the topic mastery record.
 *
 * Deterministic snapshot ids. The session snapshot is keyed by session and
 * scoring version, and the profile snapshot by student and scoring version, so
 * re-running this after another turn overwrites rather than accumulating a new
 * document per turn. §56.5's "do not mutate existing v1 snapshots" still holds:
 * the version is part of the key, so a v1 document is never the target of a v2
 * write.
 */
export async function persistSessionEvidence(
  studentId: string,
  sessionId: string,
): Promise<PersistResult> {
  const [allMetrics, previousScore] = await Promise.all([
    loadSessionMetrics(studentId),
    loadPreviousProfileScore(studentId),
  ]);

  const metrics =
    allMetrics.find((entry) => entry.sessionId === sessionId) ?? allMetrics[0] ?? null;

  const sessionScore = metrics
    ? scoreSession(metrics)
    : {
        sessionId,
        occurredAt: null,
        rawScore: null,
        coverage: 0,
        displaySuppressed: true,
        components: [],
        excludedForSystemError: false,
        scoringVersion: SCORING_VERSION,
      };

  const profile = computeIndependenceProfile(allMetrics, previousScore);

  const sessionSnapshotId = `${sessionId}__${SCORING_VERSION}`;
  const profileSnapshotId = `${studentId}__profile__${SCORING_VERSION}`;

  const writes: Promise<unknown>[] = [
    adminDb
      .collection('independenceSnapshots')
      .doc(sessionSnapshotId)
      .set({
        id: sessionSnapshotId,
        studentId,
        sessionId,
        kind: 'session',
        totalScore: sessionScore.rawScore,
        coverage: sessionScore.coverage,
        suppressed: sessionScore.displaySuppressed,
        components: componentsField(sessionScore.components),
        componentDetail: serializeComponentDetail(sessionScore.components),
        rawMetrics: metrics ? serializeMetrics(metrics) : null,
        excludedForSystemError: sessionScore.excludedForSystemError,
        scoringVersion: SCORING_VERSION,
        generatedAt: FieldValue.serverTimestamp(),
      }),

    adminDb
      .collection('independenceSnapshots')
      .doc(profileSnapshotId)
      .set({
        id: profileSnapshotId,
        studentId,
        sessionId: null,
        kind: 'profile',
        totalScore: profile.score,
        coverage: profile.evidenceWeight,
        suppressed: profile.suppressed,
        suppressionReason: profile.suppressionReason,
        band: profile.band?.id ?? null,
        trend: profile.trend,
        evidenceWeight: profile.evidenceWeight,
        sessionsScored: profile.sessionsScored,
        sessionsConsidered: profile.sessionsConsidered,
        sessionsExcluded: profile.sessionsExcluded,
        instrumentationUnavailableRate: profile.instrumentationUnavailableRate,
        suggestion: profile.suggestion,
        components: componentsField(profile.components),
        componentDetail: serializeComponentDetail(profile.components),
        rawMetrics: null,
        scoringVersion: SCORING_VERSION,
        generatedAt: FieldValue.serverTimestamp(),
      }),
  ];

  const masteryWrite = buildMasteryWrite(studentId, allMetrics);
  if (masteryWrite) writes.push(masteryWrite);

  await Promise.all(writes);

  return { sessionScore, profile, sessionSnapshotId, profileSnapshotId };
}

/**
 * Topic mastery, per section 28's `MasteryRecord`.
 *
 * Guided accuracy is measured over sessions where the student was helped up the
 * hint ladder; independent accuracy over sessions they completed without needing
 * to climb. Keeping them separate is the point of the record: a student who is
 * accurate only while being guided has not yet mastered the topic, and a single
 * blended accuracy figure would hide exactly that.
 */
function buildMasteryWrite(
  studentId: string,
  allMetrics: SessionMetrics[],
): Promise<unknown> | null {
  const scorable = allMetrics.filter(
    (metrics) => !metrics.endedWithSystemError && metrics.topic && metrics.subject,
  );
  if (scorable.length === 0) return null;

  // One record per subject and topic, so the id is deterministic and the rule can
  // stay a simple ownership check.
  const groups = new Map<string, SessionMetrics[]>();
  for (const metrics of scorable) {
    const key = `${metrics.subject}__${metrics.topic}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(metrics);
    else groups.set(key, [metrics]);
  }

  const batch = adminDb.batch();

  for (const [, group] of groups) {
    const subject = group[0].subject!;
    const topic = group[0].topic!;
    const recordId = `${studentId}__${subject}__${topic}`.replace(/[/\s]+/g, '_').slice(0, 400);

    const guided = group.filter((metrics) => (metrics.highestHintUsed ?? 0) > 0);
    const independent = group.filter((metrics) => (metrics.highestHintUsed ?? 0) === 0);

    const accuracyOf = (sessions: SessionMetrics[]): number => {
      const scored = sessions
        .map((metrics) => scoreSession(metrics))
        .filter((score) => score.rawScore !== null);
      if (scored.length === 0) return 0;
      return (
        Math.round(
          (scored.reduce((sum, score) => sum + (score.rawScore ?? 0), 0) / scored.length) * 100,
        ) / 10000
      );
    };

    const hintLevels = group
      .map((metrics) => metrics.highestHintUsed)
      .filter((level): level is number => typeof level === 'number');

    const transferAttempts = group.filter((metrics) => metrics.transfer.issued);
    const transferSuccesses = transferAttempts.filter((metrics) =>
      ['independent_correct', 'minor_prompt', 'one_conceptual_hint'].includes(
        metrics.transfer.outcome ?? '',
      ),
    );

    batch.set(
      adminDb.collection('masteryRecords').doc(recordId),
      {
        id: recordId,
        studentId,
        subject,
        topic,
        guidedAccuracy: accuracyOf(guided),
        independentAccuracy: accuracyOf(independent),
        averageHintLevel:
          hintLevels.length === 0
            ? 0
            : Math.round(
                (hintLevels.reduce((sum, level) => sum + level, 0) / hintLevels.length) * 100,
              ) / 100,
        transferSuccessRate:
          transferAttempts.length === 0
            ? 0
            : Math.round((transferSuccesses.length / transferAttempts.length) * 10000) / 10000,
        sessionCount: group.length,
        scoringVersion: SCORING_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return batch.commit();
}
