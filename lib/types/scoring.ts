/**
 * Types for Independence Score **v2**, specified normatively in section 56 of
 * `instructions/12_SCORING_MODEL_AND_AGENT_LOGGING.md`.
 *
 * Section 56 supersedes section 13 of module `02` for computation. Section 13
 * still governs the product constraints: the score is not a grade, not a measure
 * of intelligence, never publicly ranked, and always presented with a band, a
 * trend, a component breakdown and one improvement suggestion.
 */

export const SCORING_VERSION = 'scoring-v2';

/** Retained so `scoring-v1` snapshots stay interpretable. §56.5 forbids mutating them. */
export const SCORING_VERSION_V1 = 'scoring-v1';

export type AttemptQuality = 'none' | 'minimal' | 'partial' | 'meaningful';

export type TransferOutcome =
  | 'independent_correct'
  | 'minor_prompt'
  | 'one_conceptual_hint'
  | 'partial'
  | 'attempted_incorrect'
  | 'declined'
  | 'unable_to_begin';

export type ComponentId =
  | 'firstAttempt'
  | 'hintEfficiency'
  | 'reasoningExplanation'
  | 'transferPerformance'
  | 'verificationBehavior';

/**
 * The four evidence states required by §56.1 stage 1. Conflating any two of them
 * is the root cause of measured defects 1, 2 and 3.
 *
 * - `observed`       the behavior was instrumented and seen.
 * - `not_applicable` the opportunity never arose. Excluded from scoring.
 * - `declined`       the opportunity arose and was not taken. Scored, low.
 * - `unavailable`    it should have been instrumented and was not. Reduces
 *                    coverage, and must never be silently excluded.
 */
export type EvidenceState = 'observed' | 'not_applicable' | 'declined' | 'unavailable';

export type IndependenceBandId =
  | 'increasingly_independent'
  | 'developing_independence'
  | 'benefits_from_guided_support'
  | 'needs_structured_practice';

export interface IndependenceBand {
  id: IndependenceBandId;
  label: string;
  description: string;
  min: number;
  max: number;
}

/**
 * The four rubric criteria of §56.2's reasoning component, each worth 0.25.
 * Judged by the evaluator and persisted, never recomputed at read time, because
 * §56.4 requires recomputation to be byte-identical.
 */
export interface ReasoningRubric {
  identifiedMethod: boolean;
  explainedIntermediateStep: boolean;
  connectedToConcept: boolean;
  interpretedResult: boolean;
  /** The evaluator's own calibrated confidence, in [0,1]. */
  confidence: number;
  evidenceSpans: string[];
}

/**
 * The four verification criteria of §56.2, each worth 0.25. The last rewards
 * calibration rather than suspicion: flagging a correct answer as wrong is not
 * good verification.
 */
export interface VerificationRubric {
  recomputedOrSubstituted: boolean;
  checkedUnitsOrPlausibility: boolean;
  statedAssumptionOrLimitation: boolean;
  correctlyJudgedContent: boolean;
  confidence: number;
}

/** How transfer correctness was established. §56.2 orders these by precedence. */
export type CorrectnessSource = 'deterministic' | 'validator' | 'evaluator' | 'unavailable';

export interface TransferEvidence {
  issued: boolean;
  /** True when the task was issued and the student never engaged with it. */
  declined: boolean;
  outcome: TransferOutcome | null;
  correctnessSource: CorrectnessSource;
  /** 1.0 only for deterministic + validator agreement; model-only judgment caps at 0.7. */
  confidence: number;
  /** Legacy field retained for snapshot compatibility; production persistence keeps it null. */
  referenceAnswer: string | null;
  studentAnswer: string | null;
}

/**
 * Observable behaviors extracted from one learning session, with provenance.
 *
 * This is the raw evidence layer and holds no scoring judgment. Every field that
 * can be missing carries its own `EvidenceState`, so stage 2 can tell "did not"
 * apart from "we do not know", which v1 could not.
 */
export interface SessionMetrics {
  sessionId: string;
  occurredAt: Date | null;
  topic: string | null;
  subject: string | null;
  mode: string | null;

  /** §56.4: a session that failed with a system error is excluded from scoring. */
  endedWithSystemError: boolean;

  /** 1-5 ordinal, per §56.3. Teacher-assigned, else model estimate, else 3. */
  difficulty: number;
  difficultySource: 'assignment' | 'model' | 'grade_default';

  firstAttemptQuality: AttemptQuality | null;
  firstAttemptState: EvidenceState;
  answerSeekingSignals: number;
  repeatedAnswerSeeking: boolean;

  highestHintUsed: number | null;
  /** The ceiling the policy engine permitted, for §56.2's ratio. */
  allowedHintLevel: number | null;
  hintState: EvidenceState;
  receivedFullSolution: boolean;
  /** §56.4: accommodations are never scored as dependence. */
  accommodationHintLevels: number[];

  studentTurnCount: number;
  reasoningRubric: ReasoningRubric | null;
  reasoningState: EvidenceState;

  transfer: TransferEvidence;
  transferState: EvidenceState;

  verificationRubric: VerificationRubric | null;
  verificationState: EvidenceState;
}

/**
 * A scored component. `value` is normalized to [0,1] and answers "how well";
 * `confidence` answers "how much it counts". v1 conflated the two by scoring
 * directly in weighted points, which is why absent evidence read as excellence.
 */
export interface ComponentScore {
  id: ComponentId;
  label: string;
  weight: number;
  value: number | null;
  confidence: number;
  state: EvidenceState;
  rationale: string;
  rationaleCode?: string;
}

export interface SessionScore {
  sessionId: string;
  occurredAt: Date | null;
  /** Confidence-weighted mean over applicable components, 0-100, or null. */
  rawScore: number | null;
  /** Fraction of the 100-point model this session actually observed. §56.3. */
  coverage: number;
  /** True when coverage < 0.35: recorded, but never shown as a session score. */
  displaySuppressed: boolean;
  components: ComponentScore[];
  excludedForSystemError: boolean;
  scoringVersion: string;
}

export interface IndependenceProfile {
  /** Null whenever the §56.4 suppression rule applies. */
  score: number | null;
  band: IndependenceBand | null;
  trend: number | null;
  /** `sum(w_i)`. Below 1.0 the score and band are suppressed entirely. */
  evidenceWeight: number;
  suppressed: boolean;
  suppressionReason: string | null;
  sessionsScored: number;
  sessionsConsidered: number;
  sessionsExcluded: number;
  /** Share of observations marked `unavailable`, for the §35 health metric. */
  instrumentationUnavailableRate: number;
  components: ComponentScore[];
  perSession: SessionScore[];
  suggestion: string | null;
  suggestionCode?: string | null;
  scoringVersion: string;
}

/**
 * The persisted `independenceSnapshots` document: section 28 of module `06`, as
 * extended by §56.4's requirement that every snapshot store raw metrics,
 * per-component values with state and confidence, coverage, the score and the
 * scoring version.
 *
 * `kind` separates the per-session snapshot from the rolled-up profile so both
 * live under one collection and one security rule.
 */
export interface IndependenceSnapshotDoc {
  id: string;
  studentId: string;
  sessionId: string | null;
  kind: 'session' | 'profile';
  totalScore: number | null;
  coverage: number;
  suppressed: boolean;
  /** Weighted 0-100 points, keeping the section 28 field shape. */
  components: {
    firstAttempt: number | null;
    hintEfficiency: number | null;
    explanation: number | null;
    transfer: number | null;
    verification: number | null;
  };
  componentDetail: ComponentScore[];
  rawMetrics: unknown;
  scoringVersion: string;
  generatedAt: unknown;
}

export interface MasteryRecordDoc {
  id: string;
  studentId: string;
  subject: string;
  topic: string;
  guidedAccuracy: number;
  independentAccuracy: number;
  averageHintLevel: number;
  transferSuccessRate: number;
  sessionCount: number;
  updatedAt: unknown;
}
