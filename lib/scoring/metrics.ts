import { IntentAnalysis } from '@/lib/types/ai/schema';
import {
  AttemptQuality,
  EvidenceState,
  ReasoningRubric,
  SessionMetrics,
  TransferEvidence,
  TransferOutcome,
  VerificationRubric,
} from '@/lib/types/scoring';

/**
 * Stage 1 of section 56: evidence extraction.
 *
 * §56.1 is emphatic that extraction must record **why** an observation holds its
 * value, using four states that must never be conflated: `observed`,
 * `not_applicable`, `declined` and `unavailable`.
 *
 * Nothing here scores anything. Judgment belongs to stage 2.
 */

export interface RawTurn {
  id?: string;
  sessionId?: string;
  sequence?: number;
  actor?: 'student' | 'assistant' | 'system' | string;
  content?: string;
  createdAt?: unknown;
  /** New student turns are written by the server route; legacy client turns lack this marker. */
  serverAuthored?: boolean;
  intentAnalysis?: Partial<IntentAnalysis>;
  responsePlan?: Record<string, unknown>;
  tutorMetadata?: {
    hintLevel?: number;
    finalAnswerIncluded?: boolean;
    responseType?: string;
    accessibilityAccommodation?: boolean;
    estimatedDifficulty?: number;
  };
  /** Set by the endpoint when generation failed, per §56.4. */
  systemError?: boolean;
}

export interface RawSession {
  id: string;
  studentId?: string;
  subject?: string;
  mode?: string;
  topic?: string | null;
  status?: string;
  currentHintLevel?: number;
  startedAt?: unknown;
  completedAt?: unknown;
  /** 1-5, teacher-assigned on the assignment. Highest-precedence difficulty. */
  assignedDifficulty?: number;
  /** Written by the endpoint when a turn failed with a system error (§56.4). */
  endedWithSystemError?: boolean;
}

/** Persisted `studentAttempts` evidence used for deterministic recomputation. */
export interface RawAttempt {
  id?: string;
  sessionId?: string;
  attemptType?: 'initial' | 'intermediate' | 'explanation' | 'transfer' | 'verification' | string;
  evaluation?: {
    reasoningRubric?: Partial<ReasoningRubric>;
    verificationRubric?: Partial<VerificationRubric>;
    transferOutcome?: TransferOutcome;
    correctnessSource?: 'deterministic' | 'evaluator' | 'unavailable';
    correctnessConfidence?: number;
    referenceAnswer?: string | null;
    studentAnswer?: string | null;
    accessibilityAccommodation?: boolean;
  };
}

const ANSWER_SEEKING_INTENTS = new Set(['answer_request', 'homework_completion']);
const ANSWER_SEEKING_THRESHOLD = 0.6;

/** §56.3: grade-band default when no better difficulty estimate exists. */
export const DEFAULT_DIFFICULTY = 3;

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const candidate = (value as { toDate: () => Date }).toDate;
    if (typeof candidate === 'function') {
      try {
        return (value as { toDate: () => Date }).toDate();
      } catch {
        return null;
      }
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isAnswerSeeking(analysis: Partial<IntentAnalysis>): boolean {
  if (analysis.intent && ANSWER_SEEKING_INTENTS.has(analysis.intent)) return true;
  return (analysis.answerSeekingLikelihood ?? 0) >= ANSWER_SEEKING_THRESHOLD;
}

/**
 * The classifier result for student message N is stored on the tutor turn that
 * answers it, so analyses are collected in sequence order rather than read off
 * student turns directly.
 */
function collectAnalyses(turns: RawTurn[]): Partial<IntentAnalysis>[] {
  return turns
    .map((turn) => turn.intentAnalysis)
    .filter((analysis): analysis is Partial<IntentAnalysis> =>
      Boolean(analysis && Object.keys(analysis).length > 0),
    );
}

/** §56.3 difficulty precedence: assignment, then model estimate, then default. */
function resolveDifficulty(
  session: RawSession,
  turns: RawTurn[],
): { difficulty: number; source: SessionMetrics['difficultySource'] } {
  const assigned = session.assignedDifficulty;
  if (typeof assigned === 'number' && assigned >= 1 && assigned <= 5) {
    return { difficulty: Math.round(assigned), source: 'assignment' };
  }

  const estimated = turns
    .map((turn) => turn.tutorMetadata?.estimatedDifficulty)
    .find((value): value is number => typeof value === 'number' && value >= 1 && value <= 5);

  if (estimated !== undefined) {
    return { difficulty: Math.round(estimated), source: 'model' };
  }

  return { difficulty: DEFAULT_DIFFICULTY, source: 'grade_default' };
}

function resolveHintEvidence(turns: RawTurn[]): {
  highestHintUsed: number | null;
  allowedHintLevel: number | null;
  state: EvidenceState;
  accommodationHintLevels: number[];
} {
  const tutorTurns = turns.filter((turn) => turn.actor === 'assistant');

  const levels = tutorTurns
    .map((turn) => turn.tutorMetadata?.hintLevel)
    .filter((level): level is number => typeof level === 'number');

  const allowed = turns
    .map((turn) => turn.responsePlan?.['allowedHintLevel'])
    .filter((level): level is number => typeof level === 'number');

  const accommodationHintLevels = tutorTurns
    .filter((turn) => turn.tutorMetadata?.accessibilityAccommodation === true)
    .map((turn) => turn.tutorMetadata?.hintLevel)
    .filter((level): level is number => typeof level === 'number');

  if (tutorTurns.length === 0) {
    return {
      highestHintUsed: null,
      allowedHintLevel: null,
      state: 'not_applicable',
      accommodationHintLevels,
    };
  }

  if (levels.length === 0) {
    return {
      highestHintUsed: null,
      allowedHintLevel: allowed.length > 0 ? Math.max(...allowed) : null,
      state: 'unavailable',
      accommodationHintLevels,
    };
  }

  return {
    highestHintUsed: Math.max(...levels),
    allowedHintLevel: allowed.length > 0 ? Math.max(...allowed) : null,
    state: 'observed',
    accommodationHintLevels,
  };
}

function rubricState<T>(
  attempts: RawAttempt[],
  type: RawAttempt['attemptType'],
  selector: (attempt: RawAttempt) => T | undefined,
): { value: T | null; state: EvidenceState } {
  const relevant = attempts.filter((attempt) => attempt.attemptType === type);
  if (relevant.length === 0) return { value: null, state: 'not_applicable' };

  for (let index = relevant.length - 1; index >= 0; index -= 1) {
    const value = selector(relevant[index]);
    if (value !== undefined) return { value, state: 'observed' };
  }

  return { value: null, state: 'unavailable' };
}

function resolveTransferEvidence(attempts: RawAttempt[]): TransferEvidence {
  const transferAttempts = attempts.filter((attempt) => attempt.attemptType === 'transfer');
  if (transferAttempts.length === 0) {
    return { outcome: null, state: 'not_applicable', correctnessSource: null, confidence: null };
  }

  const latest = transferAttempts[transferAttempts.length - 1];
  const outcome = latest.evaluation?.transferOutcome;
  if (!outcome) {
    return { outcome: null, state: 'unavailable', correctnessSource: null, confidence: null };
  }

  return {
    outcome,
    state: outcome === 'declined' ? 'declined' : 'observed',
    correctnessSource: latest.evaluation?.correctnessSource ?? null,
    confidence:
      typeof latest.evaluation?.correctnessConfidence === 'number'
        ? latest.evaluation.correctnessConfidence
        : null,
  };
}

export function deriveSessionMetrics(
  session: RawSession,
  rawTurns: RawTurn[],
  rawAttempts: RawAttempt[],
): SessionMetrics {
  const turns = [...rawTurns].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const attempts = [...rawAttempts];
  const analyses = collectAnalyses(turns);
  const hintEvidence = resolveHintEvidence(turns);

  const studentTurns = turns.filter((turn) => turn.actor === 'student');
  const answerSeekingCount = analyses.filter(isAnswerSeeking).length;
  const meaningfulAttemptCount = analyses.filter(
    (analysis) => analysis.attemptQuality === 'meaningful',
  ).length;
  const firstMeaningfulAttemptIndex = analyses.findIndex(
    (analysis) => analysis.attemptQuality === 'meaningful',
  );

  const reasoning = rubricState(attempts, 'explanation', (attempt) =>
    attempt.evaluation?.reasoningRubric,
  );
  const verification = rubricState(attempts, 'verification', (attempt) =>
    attempt.evaluation?.verificationRubric,
  );
  const transfer = resolveTransferEvidence(attempts);

  const accommodationAttempts = attempts.filter(
    (attempt) => attempt.evaluation?.accessibilityAccommodation === true,
  ).length;

  const systemErrorTurns = turns.filter((turn) => turn.systemError === true).length;

  const finalAnswerShown = turns.some(
    (turn) => turn.tutorMetadata?.finalAnswerIncluded === true,
  );

  return {
    sessionId: session.id,
    occurredAt: toDate(session.completedAt) ?? toDate(session.startedAt),
    subject: session.subject ?? null,
    topic: session.topic ?? analyses.find((analysis) => analysis.topic)?.topic ?? null,
    mode: session.mode ?? null,
    status: session.status ?? null,
    studentTurnCount: studentTurns.length,
    answerSeekingCount,
    meaningfulAttemptCount,
    firstMeaningfulAttemptIndex:
      firstMeaningfulAttemptIndex >= 0 ? firstMeaningfulAttemptIndex : null,
    highestHintUsed: hintEvidence.highestHintUsed,
    allowedHintLevel: hintEvidence.allowedHintLevel,
    hintEvidenceState: hintEvidence.state,
    reasoningRubric: reasoning.value as ReasoningRubric | null,
    reasoningEvidenceState: reasoning.state,
    verificationRubric: verification.value as VerificationRubric | null,
    verificationEvidenceState: verification.state,
    transfer,
    finalAnswerShown,
    difficulty: resolveDifficulty(session, turns).difficulty,
    difficultySource: resolveDifficulty(session, turns).source,
    endedWithSystemError: Boolean(session.endedWithSystemError || systemErrorTurns > 0),
    accessibilityAccommodation: {
      hintLevels: hintEvidence.accommodationHintLevels,
      attemptCount: accommodationAttempts,
    },
  };
}
