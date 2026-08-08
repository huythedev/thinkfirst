import {
  ComponentId,
  ComponentScore,
  EvidenceState,
  IndependenceBand,
  IndependenceProfile,
  SCORING_VERSION,
  SessionMetrics,
  SessionScore,
  TransferOutcome,
} from '@/lib/types/scoring';

/**
 * Independence Score **v2**, implementing section 56 of
 * `instructions/12_SCORING_MODEL_AND_AGENT_LOGGING.md`.
 *
 * Four pure stages, each independently testable:
 *
 *   1. Evidence extraction   `lib/scoring/metrics.ts`
 *   2. Component scoring     `scoreComponents` below
 *   3. Session aggregation   `scoreSession`
 *   4. Profile aggregation   `computeIndependenceProfile`
 *
 * The most important difference from v1: a component returns a value in [0,1]
 * *and* a confidence, and the aggregate reports `coverage` alongside the score.
 * v1 renormalized over whichever components happened to be observed, so a
 * student maximized their score by disengaging early -- measured defect 1, and
 * the exact inversion of the product thesis.
 */

export const COMPONENT_WEIGHTS: Record<ComponentId, number> = {
  firstAttempt: 20,
  hintEfficiency: 20,
  reasoningExplanation: 20,
  transferPerformance: 30,
  verificationBehavior: 10,
};

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  firstAttempt: 'First attempt',
  hintEfficiency: 'Hint efficiency',
  reasoningExplanation: 'Reasoning explanation',
  transferPerformance: 'Transfer performance',
  verificationBehavior: 'Verification behavior',
};

export const INDEPENDENCE_BANDS: IndependenceBand[] = [
  {
    id: 'increasingly_independent',
    label: 'Increasingly independent',
    description: 'You usually start on your own and need few hints to keep going.',
    min: 80,
    max: 100,
  },
  {
    id: 'developing_independence',
    label: 'Developing independence',
    description: 'You often make a solid start and are building confidence with harder steps.',
    min: 60,
    max: 79,
  },
  {
    id: 'benefits_from_guided_support',
    label: 'Benefits from guided support',
    description: 'Working through problems with guidance is helping. Try one idea before asking.',
    min: 40,
    max: 59,
  },
  {
    id: 'needs_structured_practice',
    label: 'Needs more structured practice',
    description: 'More practice on the basics will make these problems feel easier.',
    min: 0,
    max: 39,
  },
];

/** §56.2 stage 4 constants. Named because every one of them is normative. */
export const RECENCY_DECAY = 0.85;
export const SHRINKAGE_PSEUDOCOUNT = 2.0;
export const NEUTRAL_PRIOR = 55;

/** §56.3: a session below this coverage is recorded but not shown as a score. */
export const MIN_SESSION_COVERAGE_TO_DISPLAY = 0.35;

/** §56.4 suppression: below this much evidence weight there is no score at all. */
export const MIN_EVIDENCE_WEIGHT_TO_DISPLAY = 1.0;

/** §56.4: no single session may move the displayed profile score by more than this. */
export const MAX_SINGLE_SESSION_MOVEMENT = 8;

const MIN_SESSIONS_FOR_TREND = 4;
const MIN_EVIDENCE_WEIGHT_FOR_TREND = 2.0;
const MIN_TREND_HALF_COVERAGE = 0.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds to 4 decimals so stored values compare exactly on recomputation (§56.4). */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function bandForScore(score: number): IndependenceBand {
  const clamped = clamp(score, 0, 100);
  return (
    INDEPENDENCE_BANDS.find((band) => clamped >= band.min && clamped <= band.max) ??
    INDEPENDENCE_BANDS[INDEPENDENCE_BANDS.length - 1]
  );
}

/**
 * The single decision point for whether a score, band or trend may be rendered.
 *
 * §56.4's suppression rule is a display rule, so it is easy to get right in one
 * component and wrong in another. Both surfaces that show a score call this, and
 * the tests exercise it directly, so "no score, band or trend when suppression
 * applies" is verified rather than asserted about markup.
 *
 * Accepts the shape the stored snapshot has, not `IndependenceProfile`, because
 * the client reads a serialized document rather than a computed profile.
 */
export function mayDisplayScore(
  profile: { score: number | null; suppressed: boolean } | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.suppressed) return false;
  return profile.score !== null;
}

/**
 * §56.3 difficulty adjustment. Applied **only** to hint efficiency and transfer,
 * the two components where task hardness genuinely changes what the behavior
 * means. Scaling first attempt, reasoning or verification would let a student
 * earn independence credit for explaining trivial work.
 */
export function applyDifficulty(value: number, difficulty: number): number {
  const ordinal = clamp(Math.round(difficulty), 1, 5);
  return clamp(value * (0.85 + 0.075 * ordinal), 0, 1);
}

interface Scored {
  value: number | null;
  confidence: number;
  state: EvidenceState;
  rationale: string;
}

function toComponent(id: ComponentId, scored: Scored): ComponentScore {
  return {
    id,
    label: COMPONENT_LABELS[id],
    weight: COMPONENT_WEIGHTS[id],
    value: scored.value === null ? null : round4(scored.value),
    confidence: round4(scored.confidence),
    state: scored.state,
    rationale: scored.rationale,
  };
}

/**
 * First attempt (20). §56.2 keeps v1's grading in spirit. A stated valid reason
 * for not attempting is `not_applicable`, per §13.1's "neutral".
 */
function scoreFirstAttempt(metrics: SessionMetrics): Scored {
  if (metrics.firstAttemptState === 'not_applicable') {
    return {
      value: null,
      confidence: 0,
      state: 'not_applicable',
      rationale: 'Starting the problem yourself did not apply in this session.',
    };
  }

  if (metrics.firstAttemptState === 'unavailable' || metrics.firstAttemptQuality === null) {
    return {
      value: null,
      confidence: 0,
      state: 'unavailable',
      rationale: 'No first attempt was recorded, so this could not be measured.',
    };
  }

  if (metrics.repeatedAnswerSeeking) {
    return {
      value: 0.1,
      confidence: 1,
      state: 'observed',
      rationale: 'Asked for the answer several times before trying a step.',
    };
  }

  const byQuality = {
    meaningful: { value: 1.0, rationale: 'Started with a meaningful attempt.' },
    partial: { value: 0.7, rationale: 'Started with a partial attempt.' },
    minimal: { value: 0.45, rationale: 'Started with a minimal attempt.' },
    none: { value: 0.2, rationale: 'Asked for help before trying a first step.' },
  } as const;

  const graded = byQuality[metrics.firstAttemptQuality];
  return { value: graded.value, confidence: 1, state: 'observed', rationale: graded.rationale };
}

/**
 * Hint efficiency (20). Fixes measured defects 4 and 8.
 *
 * §56.2: score against the level the student needed *relative to the level policy
 * permitted*, so zero hints with level 5 available is a stronger signal than zero
 * hints when the ceiling was 1. v1 returned `measured: false` for zero hints,
 * discarding the strongest independence signal available, and scored levels 0, 1
 * and 2 identically.
 */
function scoreHintEfficiency(metrics: SessionMetrics): Scored {
  if (metrics.hintState === 'not_applicable') {
    return {
      value: null,
      confidence: 0,
      state: 'not_applicable',
      rationale: 'Hints did not come up in this session.',
    };
  }

  // A tutor turn with no recorded hint level is `unavailable`, not "no hints
  // needed". That conflation is measured defect 3: missing telemetry scored 100.
  if (metrics.hintState === 'unavailable' || metrics.highestHintUsed === null) {
    return {
      value: null,
      confidence: 0,
      state: 'unavailable',
      rationale: 'Hint levels were not recorded for this session, so this is not counted.',
    };
  }

  // Accommodations are never dependence (§56.4), so an accommodation level is
  // excluded and the highest non-accommodation level stands in its place.
  const highest = metrics.highestHintUsed;
  const accommodations = new Set(metrics.accommodationHintLevels);
  const effectiveHint = accommodations.has(highest)
    ? Math.max(0, ...[0, ...metrics.accommodationHintLevels.filter((level) => level < highest)])
    : highest;

  const ceiling = Math.max(metrics.allowedHintLevel ?? effectiveHint, 1);
  const raw = clamp(1 - (effectiveHint / ceiling) * 0.85, 0.05, 1);
  const value = applyDifficulty(raw, metrics.difficulty);

  return {
    value,
    confidence: 1,
    state: 'observed',
    rationale:
      effectiveHint === 0
        ? `Worked without asking for a hint, with level ${ceiling} available.`
        : `Needed hints up to level ${effectiveHint} of ${ceiling} available.`,
  };
}

/**
 * Reasoning explanation (20). Fixes measured defect 5.
 *
 * §56.2 requires the four-criterion rubric of §13.3, each worth 0.25, judged by
 * the evaluator with evidence spans. v1 substituted a ratio of turns that
 * saturated at half participation, so explaining 2 of 4 turns scored the same as
 * explaining 8 of 8.
 */
function scoreReasoning(metrics: SessionMetrics): Scored {
  if (metrics.reasoningState === 'not_applicable') {
    return {
      value: null,
      confidence: 0,
      state: 'not_applicable',
      rationale: 'Explaining reasoning did not apply in this session.',
    };
  }

  if (metrics.reasoningState === 'declined') {
    return {
      value: 0.1,
      confidence: 1,
      state: 'declined',
      rationale: 'Was asked to explain the reasoning and did not.',
    };
  }

  if (metrics.reasoningState === 'unavailable' || metrics.reasoningRubric === null) {
    return {
      value: null,
      confidence: 0,
      state: 'unavailable',
      rationale: 'The explanation rubric was not evaluated for this session.',
    };
  }

  const rubric = metrics.reasoningRubric;
  const met = [
    rubric.identifiedMethod,
    rubric.explainedIntermediateStep,
    rubric.connectedToConcept,
    rubric.interpretedResult,
  ].filter(Boolean).length;

  return {
    value: met * 0.25,
    confidence: clamp(rubric.confidence, 0, 1),
    state: 'observed',
    rationale:
      met === 0
        ? 'Did not explain the thinking behind the steps.'
        : `Met ${met} of 4 explanation criteria.`,
  };
}

/**
 * Transfer performance (30). Fixes measured defect 6, the most consequential.
 *
 * §56.2: correctness must be **established**, never inferred from fluency. Under
 * v1 a confident, fluent, wrong answer earned the full 30, because the outcome
 * was derived from `attemptQuality`. So this grades only after correctness is
 * known, and when neither a deterministic check nor an evaluator judgment exists
 * the component is `unavailable` rather than worth 30 points.
 */
function scoreTransfer(metrics: SessionMetrics): Scored {
  const { transfer } = metrics;

  if (metrics.transferState === 'not_applicable' || !transfer.issued) {
    return {
      value: null,
      confidence: 0,
      state: 'not_applicable',
      rationale: 'No transfer problem was offered in this session.',
    };
  }

  if (transfer.declined || metrics.transferState === 'declined') {
    // Scored, not excluded. This is the whole point of the `declined` state:
    // walking away from an offered transfer task must not outscore attempting it.
    return {
      value: applyDifficulty(0.1, metrics.difficulty),
      confidence: 1,
      state: 'declined',
      rationale: 'A transfer problem was offered and not attempted.',
    };
  }

  if (
    metrics.transferState === 'unavailable' ||
    transfer.correctnessSource === 'unavailable' ||
    transfer.outcome === null
  ) {
    return {
      value: null,
      confidence: 0,
      state: 'unavailable',
      rationale: 'Whether the transfer answer was correct could not be established.',
    };
  }

  const byOutcome: Record<TransferOutcome, { value: number; rationale: string }> = {
    independent_correct: { value: 1.0, rationale: 'Solved a similar problem independently.' },
    minor_prompt: { value: 0.8, rationale: 'Solved a similar problem after a small nudge.' },
    one_conceptual_hint: {
      value: 0.6,
      rationale: 'Solved a similar problem after one concept hint.',
    },
    partial: { value: 0.4, rationale: 'Made partial progress on a similar problem.' },
    attempted_incorrect: {
      value: 0.2,
      rationale: 'Attempted a similar problem and did not reach a correct answer.',
    },
    declined: { value: 0.1, rationale: 'A transfer problem was offered and not attempted.' },
    unable_to_begin: { value: 0.2, rationale: 'Could not start the similar problem yet.' },
  };

  const graded = byOutcome[transfer.outcome];

  // §56.2 precedence: only a deterministic check earns confidence 1.0.
  const confidence =
    transfer.correctnessSource === 'deterministic'
      ? clamp(transfer.confidence, 0, 1)
      : Math.min(clamp(transfer.confidence, 0, 1), 0.7);

  return {
    value: applyDifficulty(graded.value, metrics.difficulty),
    confidence,
    state: 'observed',
    rationale: graded.rationale,
  };
}

/**
 * Verification behavior (10). §56.2 scores the substance, not the count: four
 * criteria at 0.25 each, the last of which rewards calibration. A student who
 * flags a correct answer as wrong has not verified well.
 */
function scoreVerification(metrics: SessionMetrics): Scored {
  if (metrics.verificationState === 'not_applicable') {
    return {
      value: null,
      confidence: 0,
      state: 'not_applicable',
      rationale: 'Checking the answer did not come up in this session.',
    };
  }

  if (metrics.verificationState === 'declined') {
    return {
      value: 0.1,
      confidence: 1,
      state: 'declined',
      rationale: 'Was asked to check the result and did not.',
    };
  }

  if (metrics.verificationState === 'unavailable' || metrics.verificationRubric === null) {
    return {
      value: null,
      confidence: 0,
      state: 'unavailable',
      rationale: 'Verification behavior was not evaluated for this session.',
    };
  }

  const rubric = metrics.verificationRubric;
  const met = [
    rubric.recomputedOrSubstituted,
    rubric.checkedUnitsOrPlausibility,
    rubric.statedAssumptionOrLimitation,
    rubric.correctlyJudgedContent,
  ].filter(Boolean).length;

  return {
    value: met * 0.25,
    confidence: clamp(rubric.confidence, 0, 1),
    state: 'observed',
    rationale: met === 0 ? 'Did not check the result.' : `Met ${met} of 4 checking criteria.`,
  };
}

/** Stage 2. Pure: observations in, component scores out. */
export function scoreComponents(metrics: SessionMetrics): ComponentScore[] {
  return [
    toComponent('firstAttempt', scoreFirstAttempt(metrics)),
    toComponent('hintEfficiency', scoreHintEfficiency(metrics)),
    toComponent('reasoningExplanation', scoreReasoning(metrics)),
    toComponent('transferPerformance', scoreTransfer(metrics)),
    toComponent('verificationBehavior', scoreVerification(metrics)),
  ];
}

/**
 * Stage 3, session aggregation, per §56.3:
 *
 *   applicable = components where state != not_applicable
 *   coverage   = sum(weight * confidence over applicable) / 100
 *   rawScore   = sum(weight * confidence * value) / sum(weight * confidence)
 *
 * `coverage` is the honest measure of how much the session is worth, and it is
 * exactly what v1 lacked. Never present `rawScore` without it.
 */
export function scoreSession(metrics: SessionMetrics): SessionScore {
  const components = scoreComponents(metrics);

  // §56.4: never score a student down for a system failure. A session that ended
  // in a timeout or a validation failure is excluded, not scored as abandonment.
  if (metrics.endedWithSystemError) {
    return {
      sessionId: metrics.sessionId,
      occurredAt: metrics.occurredAt,
      rawScore: null,
      coverage: 0,
      displaySuppressed: true,
      components,
      excludedForSystemError: true,
      scoringVersion: SCORING_VERSION,
    };
  }

  const applicable = components.filter((component) => component.state !== 'not_applicable');

  let weightedConfidence = 0;
  let weightedValue = 0;
  for (const component of applicable) {
    const share = component.weight * component.confidence;
    weightedConfidence += share;
    weightedValue += share * (component.value ?? 0);
  }

  const coverage = round4(weightedConfidence / 100);
  const rawScore =
    weightedConfidence > 0 ? round4((weightedValue / weightedConfidence) * 100) : null;

  return {
    sessionId: metrics.sessionId,
    occurredAt: metrics.occurredAt,
    rawScore,
    coverage,
    displaySuppressed: rawScore === null || coverage < MIN_SESSION_COVERAGE_TO_DISPLAY,
    components,
    excludedForSystemError: false,
    scoringVersion: SCORING_VERSION,
  };
}

/**
 * Averages each component across sessions for the breakdown display, weighting
 * by confidence so a low-confidence evaluator judgment does not count as much as
 * a deterministic one.
 */
function aggregateComponents(sessions: SessionScore[]): ComponentScore[] {
  return (Object.keys(COMPONENT_WEIGHTS) as ComponentId[]).map((id) => {
    const present = sessions
      .map((session) => session.components.find((component) => component.id === id))
      .filter((component): component is ComponentScore => Boolean(component));

    const samples = present.filter(
      (component) => component.value !== null && component.confidence > 0,
    );

    if (samples.length === 0) {
      const anyUnavailable = present.some((component) => component.state === 'unavailable');

      return {
        id,
        label: COMPONENT_LABELS[id],
        weight: COMPONENT_WEIGHTS[id],
        value: null,
        confidence: 0,
        state: anyUnavailable ? ('unavailable' as const) : ('not_applicable' as const),
        rationale: anyUnavailable
          ? 'This was not recorded yet, so it is not counted either way.'
          : 'Not enough evidence yet.',
      };
    }

    const confidenceSum = samples.reduce((sum, sample) => sum + sample.confidence, 0);
    const value =
      samples.reduce((sum, sample) => sum + sample.confidence * (sample.value ?? 0), 0) /
      confidenceSum;

    return {
      id,
      label: COMPONENT_LABELS[id],
      weight: COMPONENT_WEIGHTS[id],
      value: round4(value),
      confidence: round4(confidenceSum / samples.length),
      state: samples[samples.length - 1].state,
      rationale: samples[samples.length - 1].rationale,
    };
  });
}

function buildSuggestion(components: ComponentScore[]): string | null {
  const scored = components.filter(
    (component) => component.value !== null && component.confidence > 0,
  );
  if (scored.length === 0) return null;

  const weakest = scored.reduce((lowest, component) =>
    (component.value ?? 0) < (lowest.value ?? 0) ? component : lowest,
  );

  if ((weakest.value ?? 0) >= 0.8) {
    return 'Keep going the way you are. Try a harder problem to stretch yourself.';
  }

  const suggestions: Record<ComponentId, string> = {
    firstAttempt:
      'Before asking for help, write down one thing you notice about the problem. Even a wrong start counts.',
    hintEfficiency: 'After each hint, try one more step on your own before asking for the next one.',
    reasoningExplanation:
      'Say why you chose a step, not just what you did. Explaining it makes it stick.',
    transferPerformance:
      'When you finish a problem, try the similar one offered at the end. That is where learning shows.',
    verificationBehavior: 'Check your answer by substituting it back into the original problem.',
  };

  return suggestions[weakest.id];
}

/** The §35 instrumentation-health metric the amendment to section 36 requires. */
function instrumentationUnavailableRate(sessions: SessionScore[]): number {
  const observations = sessions.flatMap((session) => session.components);
  if (observations.length === 0) return 0;
  const unavailable = observations.filter((component) => component.state === 'unavailable').length;
  return round4(unavailable / observations.length);
}

/**
 * Stage 4, profile aggregation. This is where measured defects 1 and 2 are
 * actually cured, by two mechanisms §56.2 spells out:
 *
 *   w_i   = decay^(sessionsSinceNewest) * coverage_i
 *   score = (sum(w_i * raw_i) + k * mu0) / (sum(w_i) + k)     k = 2, mu0 = 55
 *
 * Shrinkage toward a mid-band prior means thin evidence cannot produce an extreme
 * score: the single-component session v1 reported as 100 now lands near 59 with
 * low confidence, and the prior's influence fades as `sum(w_i)` grows past `k`.
 * The score earns its confidence instead of asserting it.
 *
 * `previousScore`, when supplied, enforces §56.4's clamp: no single session may
 * move the displayed score by more than 8 points.
 */
export function computeIndependenceProfile(
  sessions: SessionMetrics[],
  previousScore?: number | null,
): IndependenceProfile {
  const ordered = [...sessions].sort((a, b) => {
    const left = a.occurredAt?.getTime() ?? 0;
    const right = b.occurredAt?.getTime() ?? 0;
    return left - right;
  });

  const perSession = ordered.map(scoreSession);
  const eligible = perSession.filter(
    (session) => !session.excludedForSystemError && session.rawScore !== null,
  );
  const excluded = perSession.length - eligible.length;

  let weightSum = 0;
  let weightedRaw = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    const distanceFromNewest = eligible.length - 1 - index;
    const weight = Math.pow(RECENCY_DECAY, distanceFromNewest) * eligible[index].coverage;
    weightSum += weight;
    weightedRaw += weight * (eligible[index].rawScore ?? 0);
  }

  const evidenceWeight = round4(weightSum);
  const components = aggregateComponents(perSession);

  const shrunk =
    (weightedRaw + SHRINKAGE_PSEUDOCOUNT * NEUTRAL_PRIOR) / (weightSum + SHRINKAGE_PSEUDOCOUNT);

  // §56.4 suppression. An unknown score must look unknown, so no number and no
  // band are produced at all; the component breakdown is shown instead.
  const suppressed = weightSum < MIN_EVIDENCE_WEIGHT_TO_DISPLAY;

  let score: number | null = null;
  if (!suppressed) {
    const rounded = Math.round(clamp(shrunk, 0, 100));
    score =
      typeof previousScore === 'number'
        ? Math.round(
            clamp(
              rounded,
              previousScore - MAX_SINGLE_SESSION_MOVEMENT,
              previousScore + MAX_SINGLE_SESSION_MOVEMENT,
            ),
          )
        : rounded;
  }

  let trend: number | null = null;
  if (
    !suppressed &&
    eligible.length >= MIN_SESSIONS_FOR_TREND &&
    weightSum >= MIN_EVIDENCE_WEIGHT_FOR_TREND
  ) {
    const midpoint = Math.floor(eligible.length / 2);
    const earlier = eligible.slice(0, midpoint);
    const recent = eligible.slice(midpoint);
    const coverageOf = (half: SessionScore[]) =>
      half.reduce((sum, session) => sum + session.coverage, 0);

    // Report no trend rather than noise: a half with thin coverage cannot support
    // a claim that learning behavior is moving in a direction.
    if (
      coverageOf(earlier) >= MIN_TREND_HALF_COVERAGE &&
      coverageOf(recent) >= MIN_TREND_HALF_COVERAGE
    ) {
      const weightedMean = (half: SessionScore[]) => {
        const total = coverageOf(half);
        if (total === 0) return 0;
        return (
          half.reduce((sum, session) => sum + session.coverage * (session.rawScore ?? 0), 0) / total
        );
      };
      trend = Math.round(weightedMean(recent) - weightedMean(earlier));
    }
  }

  return {
    score,
    band: score === null ? null : bandForScore(score),
    trend,
    evidenceWeight,
    suppressed,
    suppressionReason: suppressed ? 'Not enough practice yet to estimate this.' : null,
    sessionsScored: eligible.length,
    sessionsConsidered: ordered.length,
    sessionsExcluded: excluded,
    instrumentationUnavailableRate: instrumentationUnavailableRate(perSession),
    components,
    perSession,
    suggestion: buildSuggestion(components),
    scoringVersion: SCORING_VERSION,
  };
}
