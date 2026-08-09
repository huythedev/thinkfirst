import { z } from 'zod';

export const semanticValidationVerdictSchema = z.enum([
  'approved',
  'rejected',
  'correct',
  'partial',
  'incorrect',
  'unable',
  'unsupported',
]);

export const semanticValidationSchema = z.object({
  approved: z.boolean(),
  verdict: semanticValidationVerdictSchema,
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string().min(1).max(1000)).max(20),
  correctedValue: z.string().min(1).max(2000).nullable(),
});

export type SemanticValidation = z.infer<typeof semanticValidationSchema>;
export type SemanticValidationVerdict = z.infer<typeof semanticValidationVerdictSchema>;

export type SemanticValidationParseResult =
  | { ok: true; value: SemanticValidation }
  | { ok: false; detail: string };

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return raw;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '');
  return withoutOpening.replace(/\r?\n?```$/, '');
}

export function parseSemanticValidation(
  raw: string | undefined | null,
): SemanticValidationParseResult {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, detail: 'empty semantic-validator response' };
  }

  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'unparseable semantic-validator response',
    };
  }

  const parsed = semanticValidationSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      detail: parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }

  return { ok: true, value: parsed.data };
}

export function isSemanticApproval(result: SemanticValidation, minimumConfidence = 0.7): boolean {
  return (
    result.approved &&
    result.verdict === 'approved' &&
    result.confidence >= minimumConfidence &&
    result.issues.length === 0 &&
    result.correctedValue === null
  );
}
