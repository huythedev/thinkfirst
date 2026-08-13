import { z } from 'zod';
import { toDate } from '@/lib/scoring/metrics';
import type { SessionMetrics } from '@/lib/types/scoring';

const evidenceState = z.enum(['observed', 'not_applicable', 'declined', 'unavailable']);
const transferOutcome = z.enum([
  'independent_correct',
  'minor_prompt',
  'one_conceptual_hint',
  'partial',
  'attempted_incorrect',
  'declined',
  'unable_to_begin',
]);

const reasoningRubric = z.object({
  identifiedMethod: z.boolean(),
  explainedIntermediateStep: z.boolean(),
  connectedToConcept: z.boolean(),
  interpretedResult: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidenceSpans: z.array(z.string()),
});

const verificationRubric = z.object({
  recomputedOrSubstituted: z.boolean(),
  checkedUnitsOrPlausibility: z.boolean(),
  statedAssumptionOrLimitation: z.boolean(),
  correctlyJudgedContent: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const storedSessionMetricsSchema = z.object({
  sessionId: z.string().min(1),
  occurredAt: z.unknown().transform((value) => toDate(value)),
  topic: z.string().nullable(),
  subject: z.string().nullable(),
  mode: z.string().nullable(),
  endedWithSystemError: z.boolean(),
  difficulty: z.number().min(1).max(5),
  difficultySource: z.enum(['assignment', 'model', 'grade_default']),
  firstAttemptQuality: z.enum(['none', 'minimal', 'partial', 'meaningful']).nullable(),
  firstAttemptState: evidenceState,
  answerSeekingSignals: z.number().int().min(0),
  repeatedAnswerSeeking: z.boolean(),
  highestHintUsed: z.number().nullable(),
  allowedHintLevel: z.number().nullable(),
  hintState: evidenceState,
  receivedFullSolution: z.boolean(),
  accommodationHintLevels: z.array(z.number()),
  studentTurnCount: z.number().int().min(0),
  reasoningRubric: reasoningRubric.nullable(),
  reasoningState: evidenceState,
  transfer: z.object({
    issued: z.boolean(),
    declined: z.boolean(),
    outcome: transferOutcome.nullable(),
    correctnessSource: z.enum(['deterministic', 'evaluator', 'unavailable']),
    confidence: z.number().min(0).max(1),
    referenceAnswer: z.string().nullable(),
    studentAnswer: z.string().nullable(),
  }),
  transferState: evidenceState,
  verificationRubric: verificationRubric.nullable(),
  verificationState: evidenceState,
});

/** Parses the complete server-authored metrics needed for profile/mastery scoring. */
export function parseStoredSessionMetrics(
  value: unknown,
  expectedSessionId?: string,
): SessionMetrics | null {
  const parsed = storedSessionMetricsSchema.safeParse(value);
  if (!parsed.success) return null;
  if (expectedSessionId && parsed.data.sessionId !== expectedSessionId) return null;
  return parsed.data;
}
