import type { IntentAnalysis, TutorResponsePlan } from '@/lib/types/ai/schema';
import type { ComponentScore, SessionMetrics } from '@/lib/types/scoring';

/**
 * Model output is internal by default.  These projections are the only places
 * where model-derived data is allowed to cross into an owner-readable document
 * or API response.  Keep prose out of these types unless it has passed a
 * disclosure policy that is specific to that surface.
 */
export type InternalIntentAnalysis = IntentAnalysis;

export interface PersistedIntentSignals {
  intent: IntentAnalysis['intent'];
  subject: IntentAnalysis['subject'];
  estimatedGradeLevel: number | null;
  studentProvidedAttempt: boolean;
  attemptQuality: IntentAnalysis['attemptQuality'];
  answerSeekingLikelihood: number;
  ambiguityLevel: IntentAnalysis['ambiguityLevel'];
  detectedLanguage: IntentAnalysis['detectedLanguage'];
  safetyCategory: IntentAnalysis['safetyCategory'];
  confidence: number;
}

/** Deliberately excludes classifier prose: topic, problemStatement and missingInformation. */
export function safeIntentProjection(intent: InternalIntentAnalysis): PersistedIntentSignals {
  return {
    intent: intent.intent,
    subject: intent.subject,
    estimatedGradeLevel: intent.estimatedGradeLevel,
    studentProvidedAttempt: intent.studentProvidedAttempt,
    attemptQuality: intent.attemptQuality,
    answerSeekingLikelihood: intent.answerSeekingLikelihood,
    ambiguityLevel: intent.ambiguityLevel,
    detectedLanguage: intent.detectedLanguage,
    safetyCategory: intent.safetyCategory,
    confidence: intent.confidence,
  };
}

/** A plan returned to a student must never contain model classifier text. */
export function safeStudentResponsePlan(plan: TutorResponsePlan): TutorResponsePlan {
  return { ...plan, learningObjective: null };
}

/** Every generated transfer field that can be shown to a student. */
export function studentVisibleTransferText(problem: {
  problemMarkdown: string;
  topic?: string | null;
  expectedConcepts?: string[] | null;
}): string {
  return [problem.problemMarkdown, problem.topic, ...(problem.expectedConcepts ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n\n');
}

type SafeComponent = Pick<ComponentScore, 'id' | 'label' | 'weight' | 'value' | 'confidence' | 'state' | 'rationaleCode'>;

function safeComponents(components: ComponentScore[]): SafeComponent[] {
  return components.map(({ id, label, weight, value, confidence, state, rationaleCode }) =>
    rationaleCode === undefined
      ? { id, label, weight, value, confidence, state }
      : { id, label, weight, value, confidence, state, rationaleCode },
  );
}

/**
 * Student score snapshots intentionally hold only numeric/enumerated scoring
 * state. Raw metrics stay in independenceSnapshotsInternal under Admin access.
 */
export function safeStudentScoreProjection(input: {
  id: string;
  studentId: string;
  sessionId: string | null;
  kind: 'session' | 'profile';
  totalScore: number | null;
  coverage: number;
  suppressed: boolean;
  components: Record<string, number | null>;
  componentDetail: ComponentScore[];
  excludedForSystemError?: boolean;
  profileBaselineScore?: number | null;
  scoringVersion: string;
  generatedAt: unknown;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const extra = Object.fromEntries(
    Object.entries(input.extra ?? {}).filter(([, value]) => value !== undefined),
  );
  return {
    id: input.id,
    studentId: input.studentId,
    sessionId: input.sessionId,
    kind: input.kind,
    totalScore: input.totalScore,
    coverage: input.coverage,
    suppressed: input.suppressed,
    components: input.components,
    componentDetail: safeComponents(input.componentDetail),
    ...(input.excludedForSystemError === undefined
      ? {}
      : { excludedForSystemError: input.excludedForSystemError }),
    ...(input.profileBaselineScore === undefined
      ? {}
      : { profileBaselineScore: input.profileBaselineScore }),
    scoringVersion: input.scoringVersion,
    generatedAt: input.generatedAt,
    ...extra,
  };
}

/** Internal-only score audit record. Exported to make the boundary explicit. */
export function internalScoreEvidence(metrics: SessionMetrics | null): Record<string, unknown> | null {
  if (!metrics) return null;
  return {
    ...metrics,
    occurredAt: metrics.occurredAt ? metrics.occurredAt.toISOString() : null,
  };
}
