import type { SessionMetrics } from '@/lib/types/scoring';
import { computeIndependenceProfile } from '@/lib/scoring/independence';
import { deriveMasteryRows, type DerivedMasteryRow } from '@/lib/scoring/mastery';
import { parseStoredSessionMetrics } from '@/lib/scoring/stored-metrics';

/**
 * Classroom analytics aggregation, section 12.7 of module `02` and section 32 of
 * module `07`.
 *
 * This module is deliberately **pure**. It takes rows already loaded and returns
 * the numbers the dashboard renders, so every figure can be tested offline
 * against constructed evidence rather than only against whatever the emulator
 * happens to contain. `lib/analytics/classroom-server.ts` does the loading.
 *
 * Two rules from section 56 carry over, because the same honesty problem
 * applies to a classroom as to a student:
 *
 * 1. A metric reports its own denominator. `observedOf` is the number of
 *    sessions that actually carried the evidence, not the number that existed.
 *    A rate of 0% computed over zero observations is the defect §56.1 calls
 *    "confidently wrong", so an unobserved metric is `null` and the UI says so.
 * 2. Missing instrumentation is visible, never silently excluded. `coverage`
 *    travels with every aggregate.
 *
 * Section 12.7's wording constraint is enforced in code rather than left to the
 * author of a component: the only flags this module can emit are the four
 * approved phrasings. "Lazy", "weak", "dishonest" and "dependent" are not
 * reachable strings, and a test asserts it.
 */

/** The four approved phrasings from section 12.7. No other flag text exists. */
export const STUDENT_FLAGS = {
  needsIndependentPractice: 'Needs more independent practice.',
  frequentHighLevelHints: 'Frequently requests high-level hints.',
  transferBelowGuided: 'Transfer performance is lower than guided performance.',
  benefitsFromReview: 'May benefit from teacher review.',
} as const;

export type StudentFlag = (typeof STUDENT_FLAGS)[keyof typeof STUDENT_FLAGS];

/** A metric that knows how much evidence it rests on. */
export interface ObservedMetric {
  /** Null when nothing was observed. Never substitute 0 for "unknown". */
  value: number | null;
  observed: number;
  total: number;
}

export interface AnalyticsSessionRow {
  id: string;
  studentId: string;
  scope?: 'standalone' | 'classroom' | 'assignment';
  classroomId?: string | null;
  status?: string;
  startedAt: Date | null;
  completedAt: Date | null;
  subject?: string | null;
  topic?: string | null;
}

export interface AnalyticsSnapshotRow {
  studentId: string;
  sessionId: string | null;
  totalScore: number | null;
  coverage: number;
  suppressed: boolean;
  excludedForSystemError: boolean;
  generatedAt: Date | null;
  metrics: Partial<SessionMetrics> | null;
}

export interface AnalyticsAttemptRow {
  sessionId: string;
  studentId: string;
  errorCategory?: string | null;
  topic?: string | null;
}

export interface AnalyticsReportRow {
  sessionId: string;
  studentId: string;
  createdAt: Date | null;
  resolved: boolean;
}

export interface AnalyticsMember {
  studentId: string;
  displayName: string | null;
}

export interface ClassroomAnalyticsInput {
  now: Date;
  members: AnalyticsMember[];
  sessions: AnalyticsSessionRow[];
  snapshots: AnalyticsSnapshotRow[];
  attempts: AnalyticsAttemptRow[];
  reports: AnalyticsReportRow[];
}

/**
 * The server loader supplies complete, schema-validated metrics. Pure callers
 * may intentionally provide a partial metrics object for a single dashboard
 * counter, so aggregation only needs to reject an explicit contradictory
 * session id here; complete metrics are validated before mastery/profile use.
 */
function metricsSessionMatches(
  metrics: Partial<SessionMetrics> | null,
  sessionId: string | null,
): boolean {
  if (!metrics || typeof metrics !== 'object') return true;
  const embeddedSessionId = (metrics as { sessionId?: unknown }).sessionId;
  return typeof embeddedSessionId !== 'string' || embeddedSessionId === sessionId;
}

export interface TopicMasteryCell {
  topic: string;
  subject: string;
  guidedAccuracy: number;
  independentAccuracy: number;
  averageHintLevel: number;
  transferSuccessRate: number;
  studentCount: number;
  sessionCount: number;
  /** Guided minus independent, the section 42 "performance gap". */
  gap: number;
  needsReview: boolean;
}

export interface StudentRosterRow {
  studentId: string;
  displayName: string | null;
  sessionsCompleted: number;
  lastActiveAt: Date | null;
  score: number | null;
  band: string | null;
  trend: number | null;
  suppressed: boolean;
  coverage: number;
  averageHintLevel: ObservedMetric;
  transferSuccessRate: ObservedMetric;
  flags: StudentFlag[];
}

export interface ClassroomAnalytics {
  classroomId: string;
  memberCount: number;
  activeStudentsThisWeek: number;
  sessionsCompletedThisWeek: number;
  sessionsCompletedTotal: number;
  attemptBeforeHelpRate: ObservedMetric;
  averageHintLevel: ObservedMetric;
  transferSuccessRate: ObservedMetric;
  guidedIndependentGap: ObservedMetric;
  independenceAverage: ObservedMetric;
  /** Mean per-session coverage, the §35 instrumentation-health figure. */
  evidenceCoverage: number;
  openReportCount: number;
  totalReportCount: number;
  independenceTrend: { weekStart: Date; average: number; observed: number }[];
  hintLevelDistribution: { level: number; sessions: number }[];
  topicMastery: TopicMasteryCell[];
  topicsNeedingReview: TopicMasteryCell[];
  commonErrorCategories: { category: string; count: number }[];
  roster: StudentRosterRow[];
  generatedAt: Date;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A rate over an explicit denominator, or null when the denominator is zero. */
function rate(numerator: number, denominator: number, total: number): ObservedMetric {
  if (denominator <= 0) return { value: null, observed: 0, total };
  return { value: numerator / denominator, observed: denominator, total };
}

function mean(values: number[], total: number): ObservedMetric {
  if (values.length === 0) return { value: null, observed: 0, total };
  const sum = values.reduce((acc, value) => acc + value, 0);
  return { value: sum / values.length, observed: values.length, total };
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  const weekday = (copy.getDay() + 6) % 7; // Monday-based
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

/** §56.2 treats these two as a genuine attempt; the weaker two are not. */
function isGenuineAttempt(quality: unknown): boolean {
  return quality === 'partial' || quality === 'meaningful';
}

function isSuccessfulTransfer(outcome: unknown): boolean {
  return (
    outcome === 'independent_correct' ||
    outcome === 'minor_prompt' ||
    outcome === 'one_conceptual_hint'
  );
}

export function aggregateClassroomAnalytics(
  classroomId: string,
  input: ClassroomAnalyticsInput,
): ClassroomAnalytics {
  const { now, members, sessions, snapshots, attempts, reports } = input;
  const memberIds = new Set(members.map((member) => member.studentId));

  // Cross-student data is filtered here as well as in the loader. A classroom
  // aggregate that silently included a non-member would be a privacy failure
  // that no rule catches, because these reads run under Admin credentials.
  const ownSessions = sessions.filter(
    (session) =>
      memberIds.has(session.studentId) &&
      (session.scope === 'classroom' || session.scope === 'assignment') &&
      session.classroomId === classroomId,
  );
  const sessionOwners = new Map(ownSessions.map((session) => [session.id, session.studentId]));
  const allowedSessionIds = new Set(sessionOwners.keys());
  const ownSnapshots = snapshots.filter(
    (snapshot) =>
      allowedSessionIds.has(snapshot.sessionId ?? '') &&
      memberIds.has(snapshot.studentId) &&
      sessionOwners.get(snapshot.sessionId ?? '') === snapshot.studentId &&
      metricsSessionMatches(snapshot.metrics, snapshot.sessionId) &&
      !snapshot.excludedForSystemError,
  );
  const ownAttempts = attempts.filter(
    (attempt) =>
      allowedSessionIds.has(attempt.sessionId) &&
      memberIds.has(attempt.studentId) &&
      sessionOwners.get(attempt.sessionId) === attempt.studentId,
  );
  const ownReports = reports.filter(
    (report) =>
      allowedSessionIds.has(report.sessionId) &&
      memberIds.has(report.studentId) &&
      sessionOwners.get(report.sessionId) === report.studentId,
  );

  const weekAgo = new Date(now.getTime() - WEEK_MS);

  const activeStudents = new Set(
    ownSessions
      .filter((session) => {
        const at = session.completedAt ?? session.startedAt;
        return at !== null && at >= weekAgo;
      })
      .map((session) => session.studentId),
  );

  const completed = ownSessions.filter((session) => session.status === 'completed');
  const completedThisWeek = completed.filter(
    (session) => (session.completedAt ?? session.startedAt) !== null &&
      (session.completedAt ?? session.startedAt)! >= weekAgo,
  );

  // Attempt-before-help, average hint level, transfer success: all derived from
  // the stored per-session metrics rather than recomputed, so a classroom
  // aggregate and a student's own score cannot disagree about the same session.
  const totalSnapshots = ownSnapshots.length;

  let attemptObserved = 0;
  let attemptGenuine = 0;
  const hintLevels: number[] = [];
  const hintDistribution = new Map<number, number>();
  let transferObserved = 0;
  let transferSuccess = 0;
  let coverageSum = 0;

  for (const snapshot of ownSnapshots) {
    coverageSum += snapshot.coverage;
    const metrics = snapshot.metrics ?? {};

    if (metrics.firstAttemptState === 'observed' || metrics.firstAttemptState === 'declined') {
      attemptObserved += 1;
      if (isGenuineAttempt(metrics.firstAttemptQuality)) attemptGenuine += 1;
    }

    if (metrics.hintState === 'observed' && typeof metrics.highestHintUsed === 'number') {
      hintLevels.push(metrics.highestHintUsed);
      const level = Math.max(0, Math.min(7, Math.round(metrics.highestHintUsed)));
      hintDistribution.set(level, (hintDistribution.get(level) ?? 0) + 1);
    }

    const transfer = metrics.transfer;
    if (transfer?.issued) {
      // A declined transfer counts against the rate rather than vanishing from
      // it. Excluding it is measured defect 1: skipping the task beat attempting it.
      transferObserved += 1;
      if (isSuccessfulTransfer(transfer.outcome)) transferSuccess += 1;
    }
  }

  const scopedMetrics = ownSnapshots
    .map((snapshot) => parseStoredSessionMetrics(snapshot.metrics, snapshot.sessionId ?? undefined))
    .filter((metrics): metrics is SessionMetrics => metrics !== null);
  const metricsByStudent = new Map<string, SessionMetrics[]>();
  for (const metrics of scopedMetrics) {
    const studentId = sessionOwners.get(metrics.sessionId);
    if (!studentId) continue;
    const bucket = metricsByStudent.get(studentId);
    if (bucket) bucket.push(metrics);
    else metricsByStudent.set(studentId, [metrics]);
  }
  const scopedMastery = [...metricsByStudent.entries()].flatMap(([studentId, metrics]) =>
    deriveMasteryRows(studentId, metrics),
  );

  const guidedGaps = scopedMastery
    .filter((record) => record.sessionCount > 0)
    .map((record) => record.guidedAccuracy - record.independentAccuracy);

  const profileByStudent = new Map(
    [...metricsByStudent.entries()].map(([studentId, metrics]) => [
      studentId,
      computeIndependenceProfile(metrics),
    ]),
  );
  const profileScores = [...profileByStudent.values()]
    .filter((profile) => !profile.suppressed && typeof profile.score === 'number')
    .map((profile) => profile.score as number);

  // Independence trend: mean session score per week, over observed sessions only.
  const weekBuckets = new Map<number, number[]>();
  for (const snapshot of ownSnapshots) {
    if (snapshot.suppressed || snapshot.totalScore === null || !snapshot.generatedAt) continue;
    const bucket = startOfWeek(snapshot.generatedAt).getTime();
    const existing = weekBuckets.get(bucket);
    if (existing) existing.push(snapshot.totalScore);
    else weekBuckets.set(bucket, [snapshot.totalScore]);
  }
  const independenceTrend = [...weekBuckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([weekStart, values]) => ({
      weekStart: new Date(weekStart),
      average: values.reduce((acc, value) => acc + value, 0) / values.length,
      observed: values.length,
    }));

  // Topic mastery matrix, averaged across the students who studied each topic.
  const topicGroups = new Map<string, DerivedMasteryRow[]>();
  for (const record of scopedMastery) {
    const key = `${record.subject}\u0000${record.topic}`;
    const existing = topicGroups.get(key);
    if (existing) existing.push(record);
    else topicGroups.set(key, [record]);
  }

  const topicMastery: TopicMasteryCell[] = [...topicGroups.values()].map((records) => {
    const count = records.length;
    const avg = (pick: (row: DerivedMasteryRow) => number) =>
      records.reduce((acc, row) => acc + pick(row), 0) / count;
    const guided = avg((row) => row.guidedAccuracy);
    const independent = avg((row) => row.independentAccuracy);
    const averageHint = avg((row) => row.averageHintLevel);
    const transfer = avg((row) => row.transferSuccessRate);
    return {
      topic: records[0].topic,
      subject: records[0].subject,
      guidedAccuracy: guided,
      independentAccuracy: independent,
      averageHintLevel: averageHint,
      transferSuccessRate: transfer,
      studentCount: count,
      sessionCount: records.reduce((acc, row) => acc + row.sessionCount, 0),
      gap: guided - independent,
      // "Needs review" is a property of the topic, never a judgment about the
      // students: either independent work trails guided work by a wide margin,
      // or transfer is not carrying.
      needsReview: guided - independent >= 0.25 || transfer < 0.5,
    };
  });
  topicMastery.sort((left, right) => right.gap - left.gap);

  const errorCounts = new Map<string, number>();
  for (const attempt of ownAttempts) {
    const category = (attempt.errorCategory ?? '').trim();
    if (!category || category === 'none') continue;
    errorCounts.set(category, (errorCounts.get(category) ?? 0) + 1);
  }
  const commonErrorCategories = [...errorCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);

  // Per-student roster.
  const sessionsByStudent = new Map<string, AnalyticsSessionRow[]>();
  for (const session of ownSessions) {
    const existing = sessionsByStudent.get(session.studentId);
    if (existing) existing.push(session);
    else sessionsByStudent.set(session.studentId, [session]);
  }
  const snapshotsByStudent = new Map<string, AnalyticsSnapshotRow[]>();
  for (const snapshot of ownSnapshots) {
    const existing = snapshotsByStudent.get(snapshot.studentId);
    if (existing) existing.push(snapshot);
    else snapshotsByStudent.set(snapshot.studentId, [snapshot]);
  }
  const masteryByStudent = new Map<string, DerivedMasteryRow[]>();
  for (const record of scopedMastery) {
    const existing = masteryByStudent.get(record.studentId);
    if (existing) existing.push(record);
    else masteryByStudent.set(record.studentId, [record]);
  }

  const roster: StudentRosterRow[] = members.map((member) => {
    const studentSessions = sessionsByStudent.get(member.studentId) ?? [];
    const studentSnapshots = snapshotsByStudent.get(member.studentId) ?? [];
    const profile = profileByStudent.get(member.studentId) ?? null;
    const studentMastery = masteryByStudent.get(member.studentId) ?? [];

    const lastActiveAt = studentSessions
      .map((session) => session.completedAt ?? session.startedAt)
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    const studentHints: number[] = [];
    let studentTransferObserved = 0;
    let studentTransferSuccess = 0;
    for (const snapshot of studentSnapshots) {
      const metrics = snapshot.metrics ?? {};
      if (metrics.hintState === 'observed' && typeof metrics.highestHintUsed === 'number') {
        studentHints.push(metrics.highestHintUsed);
      }
      if (metrics.transfer?.issued) {
        studentTransferObserved += 1;
        if (isSuccessfulTransfer(metrics.transfer.outcome)) studentTransferSuccess += 1;
      }
    }

    const averageHint = mean(studentHints, studentSnapshots.length);
    const transferRate = rate(
      studentTransferSuccess,
      studentTransferObserved,
      studentSnapshots.length,
    );

    const flags: StudentFlag[] = [];
    if (averageHint.value !== null && averageHint.value >= 5) {
      flags.push(STUDENT_FLAGS.frequentHighLevelHints);
    }
    if (transferRate.value !== null && transferRate.value < 0.5 && transferRate.observed >= 2) {
      flags.push(STUDENT_FLAGS.transferBelowGuided);
    }
    const guidedGap = studentMastery.length
      ? studentMastery.reduce((acc, row) => acc + (row.guidedAccuracy - row.independentAccuracy), 0) /
        studentMastery.length
      : null;
    if (guidedGap !== null && guidedGap >= 0.25) {
      flags.push(STUDENT_FLAGS.needsIndependentPractice);
    }
    if (profile && typeof profile.trend === 'number' && profile.trend <= -8) {
      flags.push(STUDENT_FLAGS.benefitsFromReview);
    }

    return {
      studentId: member.studentId,
      displayName: member.displayName,
      sessionsCompleted: studentSessions.filter((session) => session.status === 'completed').length,
      lastActiveAt,
      score: profile && !profile.suppressed ? profile.score : null,
      band: profile && !profile.suppressed ? profile.band?.id ?? null : null,
      trend: profile && !profile.suppressed ? profile.trend : null,
      suppressed: profile ? profile.suppressed : true,
      coverage: profile ? profile.evidenceWeight : 0,
      averageHintLevel: averageHint,
      transferSuccessRate: transferRate,
      flags,
    };
  });

  roster.sort((left, right) =>
    (left.displayName ?? left.studentId).localeCompare(right.displayName ?? right.studentId),
  );

  return {
    classroomId,
    memberCount: members.length,
    activeStudentsThisWeek: activeStudents.size,
    sessionsCompletedThisWeek: completedThisWeek.length,
    sessionsCompletedTotal: completed.length,
    attemptBeforeHelpRate: rate(attemptGenuine, attemptObserved, totalSnapshots),
    averageHintLevel: mean(hintLevels, totalSnapshots),
    transferSuccessRate: rate(transferSuccess, transferObserved, totalSnapshots),
    guidedIndependentGap: mean(guidedGaps, scopedMastery.length),
    independenceAverage: mean(profileScores, members.length),
    evidenceCoverage: totalSnapshots > 0 ? coverageSum / totalSnapshots : 0,
    openReportCount: ownReports.filter((report) => !report.resolved).length,
    totalReportCount: ownReports.length,
    independenceTrend,
    hintLevelDistribution: Array.from({ length: 8 }, (_, level) => ({
      level,
      sessions: hintDistribution.get(level) ?? 0,
    })),
    topicMastery,
    topicsNeedingReview: topicMastery.filter((cell) => cell.needsReview).slice(0, 6),
    commonErrorCategories,
    roster,
    generatedAt: now,
  };
}
