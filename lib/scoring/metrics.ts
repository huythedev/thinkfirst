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
 * `not_applicable`, `declined` and `unavailable`. v1 had only "measured or not",
 * which is the root cause of the three severe measured defects:
 *
 *   - no `declined` state, so skipping a transfer task beat attempting it (1);
 *   - no distinction between thin and absent evidence, so one behavior produced
 *     a confident band (2);
 *   - missing instrumentation read as absent behavior, so a transcript where the
 *     tutor never wrote `hintLevel` scored 100 on a measured weight of 40 (3).
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

/**
 * A persisted `studentAttempts` evaluation. Rubric judgments are read from
 * storage rather than recomputed, because §56.4 requires recomputation from
 * stored metrics to be byte-identical.
 */
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

/**
 * Hint evidence. The distinction that matters: a session where tutor turns
 * exist but none carries a `hintLevel` is `unavailable`, while a session with no
 * tutor turns at all had no opportunity, so it is `not_applicable`.
 */
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
    // Measured defect 3. The tutor answered, so the behavior existed; the
    // telemetry did not record it. That reduces coverage and shows up in the
    // instrumentation-health metric rather than scoring full marks.
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

function firstAttemptEvidence(
  analyses: Partial<IntentAnalysis>[],
  studentTurnCount: number,
): { quality: AttemptQuality | null; state: EvidenceState } {
  if (studentTurnCount === 0) {
    return { quality: null, state: 'not_applicable' };
  }

  const first = analyses[0];
  if (!first || first.attemptQuality === undefined) {
    // The student spoke but nothing classified the message. Not "no attempt".
    return { quality: null, state: 'unavailable' };
  }

  return { quality: first.attemptQuality, state: 'observed' };
}

/**
 * Reasoning evidence comes from a persisted evaluator rubric, never from a turn
 * ratio. When the tutor asked for an explanation (`requiresExplanation`) and no
 * rubric exists but the student did keep talking, the rubric is `unavailable`;
 * when the student never replied at all, it is `declined`.
 */
function reasoningEvidence(
  turns: RawTurn[],
  attempts: RawAttempt[],
  studentTurnCount: number,
): { rubric: ReasoningRubric | null; state: EvidenceState } {
  const stored = attempts.find(
    (attempt) => attempt.attemptType === 'explanation' && attempt.evaluation?.reasoningRubric,
  );

  if (stored?.evaluation?.reasoningRubric) {
    const raw = stored.evaluation.reasoningRubric;
    return {
      rubric: {
        identifiedMethod: raw.identifiedMethod === true,
        explainedIntermediateStep: raw.explainedIntermediateStep === true,
        connectedToConcept: raw.connectedToConcept === true,
        interpretedResult: raw.interpretedResult === true,
        confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
        evidenceSpans: Array.isArray(raw.evidenceSpans) ? raw.evidenceSpans : [],
      },
      state: 'observed',
    };
  }

  const explanationRequested = turns.some(
    (turn) => turn.responsePlan?.['requiresExplanation'] === true,
  );

  if (!explanationRequested) {
    return { rubric: null, state: 'not_applicable' };
  }

  const requestIndex = turns.findIndex(
    (turn) => turn.responsePlan?.['requiresExplanation'] === true,
  );
  const repliedAfter = turns
    .slice(requestIndex + 1)
    .some((turn) => turn.actor === 'student');

  if (!repliedAfter && studentTurnCount > 0) {
    return { rubric: null, state: 'declined' };
  }

  return { rubric: null, state: 'unavailable' };
}

function verificationEvidence(
  session: RawSession,
  turns: RawTurn[],
  attempts: RawAttempt[],
): { rubric: VerificationRubric | null; state: EvidenceState } {
  const stored = attempts.find(
    (attempt) => attempt.attemptType === 'verification' && attempt.evaluation?.verificationRubric,
  );

  if (stored?.evaluation?.verificationRubric) {
    const raw = stored.evaluation.verificationRubric;
    return {
      rubric: {
        recomputedOrSubstituted: raw.recomputedOrSubstituted === true,
        checkedUnitsOrPlausibility: raw.checkedUnitsOrPlausibility === true,
        statedAssumptionOrLimitation: raw.statedAssumptionOrLimitation === true,
        correctlyJudgedContent: raw.correctlyJudgedContent === true,
        confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
      },
      state: 'observed',
    };
  }

  const requestIndex = turns.findIndex(
    (turn) => turn.responsePlan?.['requiresVerification'] === true,
  );
  const prompted = session.mode === 'verify' || requestIndex !== -1;

  if (!prompted) {
    return { rubric: null, state: 'not_applicable' };
  }

  const repliedAfter =
    requestIndex === -1
      ? turns.some((turn) => turn.actor === 'student')
      : turns.slice(requestIndex + 1).some((turn) => turn.actor === 'student');

  if (!repliedAfter) {
    return { rubric: null, state: 'declined' };
  }

  return { rubric: null, state: 'unavailable' };
}

/**
 * Transfer evidence. §56.2 forbids inferring correctness from fluency, so the
 * outcome is taken only from a stored evaluation whose correctness was
 * established either deterministically or by the evaluator. Without one, the
 * component is `unavailable`, which is the fix for measured defect 6.
 */
function transferEvidence(
  turns: RawTurn[],
  attempts: RawAttempt[],
): { transfer: TransferEvidence; state: EvidenceState } {
  const transferIndex = turns.findIndex(
    (turn) =>
      turn.tutorMetadata?.responseType === 'transfer_problem' ||
      turn.responsePlan?.['generateTransferProblem'] === true ||
      turn.responsePlan?.['action'] === 'start_transfer_task',
  );

  const empty: TransferEvidence = {
    issued: false,
    declined: false,
    outcome: null,
    correctnessSource: 'unavailable',
    confidence: 0,
    referenceAnswer: null,
    studentAnswer: null,
  };

  if (transferIndex === -1) {
    return { transfer: empty, state: 'not_applicable' };
  }

  const repliedAfter = turns
    .slice(transferIndex + 1)
    .some((turn) => turn.actor === 'student');

  if (!repliedAfter) {
    // §56.1: the opportunity arose and the student walked away. Scored low, not
    // excluded. Excluding it is measured defect 1, which made disengagement the
    // score-maximizing strategy.
    return {
      transfer: { ...empty, issued: true, declined: true, outcome: 'declined', confidence: 1 },
      state: 'declined',
    };
  }

  const stored = attempts.find(
    (attempt) => attempt.attemptType === 'transfer' && attempt.evaluation?.transferOutcome,
  );

  if (!stored?.evaluation?.transferOutcome) {
    return { transfer: { ...empty, issued: true }, state: 'unavailable' };
  }

  const evaluation = stored.evaluation;
  const source = evaluation.correctnessSource ?? 'unavailable';

  return {
    transfer: {
      issued: true,
      declined: false,
      outcome: evaluation.transferOutcome ?? null,
      correctnessSource: source,
      confidence:
        typeof evaluation.correctnessConfidence === 'number'
          ? evaluation.correctnessConfidence
          : source === 'deterministic'
            ? 1
            : 0.7,
      referenceAnswer: evaluation.referenceAnswer ?? null,
      studentAnswer: evaluation.studentAnswer ?? null,
    },
    state: source === 'unavailable' ? 'unavailable' : 'observed',
  };
}

/**
 * Turns one session, its transcript and its stored attempt evaluations into the
 * observations the Independence Score is computed from.
 *
 * `attempts` carries the persisted evaluator judgments. They are read rather
 * than re-requested because §56.4 requires recomputation from stored metrics to
 * be deterministic; asking a model again at read time would not be.
 */
export function deriveSessionMetrics(
  session: RawSession,
  turns: RawTurn[],
  attempts: RawAttempt[] = [],
): SessionMetrics {
  const ordered = [...turns].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const analyses = collectAnalyses(ordered);
  const studentTurns = ordered.filter((turn) => turn.actor === 'student');

  const attempt = firstAttemptEvidence(analyses, studentTurns.length);
  const hints = resolveHintEvidence(ordered);
  const reasoning = reasoningEvidence(ordered, attempts, studentTurns.length);
  const verification = verificationEvidence(session, ordered, attempts);
  const transfer = transferEvidence(ordered, attempts);
  const difficulty = resolveDifficulty(session, ordered);

  const answerSeekingSignals = analyses.filter(isAnswerSeeking).length;

  return {
    sessionId: session.id,
    occurredAt: toDate(session.completedAt) ?? toDate(session.startedAt),
    topic: session.topic ?? analyses[0]?.topic ?? null,
    subject: session.subject ?? null,
    mode: session.mode ?? null,

    endedWithSystemError:
      session.endedWithSystemError === true || ordered.some((turn) => turn.systemError === true),

    difficulty: difficulty.difficulty,
    difficultySource: difficulty.source,

    firstAttemptQuality: attempt.quality,
    firstAttemptState: attempt.state,
    answerSeekingSignals,
    repeatedAnswerSeeking:
      answerSeekingSignals >= 2 && (attempt.quality === null || attempt.quality === 'none'),

    highestHintUsed: hints.highestHintUsed,
    allowedHintLevel: hints.allowedHintLevel,
    hintState: hints.state,
    receivedFullSolution: ordered.some(
      (turn) =>
        turn.tutorMetadata?.finalAnswerIncluded === true ||
        (turn.tutorMetadata?.hintLevel ?? 0) >= 7,
    ),
    accommodationHintLevels: hints.accommodationHintLevels,

    studentTurnCount: studentTurns.length,
    reasoningRubric: reasoning.rubric,
    reasoningState: reasoning.state,

    transfer: transfer.transfer,
    transferState: transfer.state,

    verificationRubric: verification.rubric,
    verificationState: verification.state,
  };
}

export function groupTurnsBySession(turns: RawTurn[]): Map<string, RawTurn[]> {
  const grouped = new Map<string, RawTurn[]>();
  for (const turn of turns) {
    if (!turn.sessionId) continue;
    const bucket = grouped.get(turn.sessionId);
    if (bucket) {
      bucket.push(turn);
    } else {
      grouped.set(turn.sessionId, [turn]);
    }
  }
  return grouped;
}

export function groupAttemptsBySession(attempts: RawAttempt[]): Map<string, RawAttempt[]> {
  const grouped = new Map<string, RawAttempt[]>();
  for (const attempt of attempts) {
    if (!attempt.sessionId) continue;
    const bucket = grouped.get(attempt.sessionId);
    if (bucket) {
      bucket.push(attempt);
    } else {
      grouped.set(attempt.sessionId, [attempt]);
    }
  }
  return grouped;
}
