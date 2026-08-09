import { z } from 'zod';

/**
 * Output contract for the independent Gemini transfer validator.
 * Model output remains untrusted until it passes this schema.
 */
export const transferValidationSchema = z.object({
  valid: z.boolean(),
  answerCorrect: z.boolean(),
  stepsConsistent: z.boolean(),
  problemUnambiguous: z.boolean(),
  unitsCorrect: z.boolean(),
  sameConcept: z.boolean(),
  correctedAnswer: z.string().min(1).max(500).nullable(),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string().min(1).max(1000)).max(20),
});

export type TransferValidation = z.infer<typeof transferValidationSchema>;

export type TransferValidationParseResult =
  | { ok: true; value: TransferValidation }
  | { ok: false; detail: string };

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return raw;
  const withoutOpening = trimmed.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '');
  return withoutOpening.replace(/\r?\n?```$/, '');
}

export function parseTransferValidation(
  raw: string | undefined | null,
): TransferValidationParseResult {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, detail: 'empty validator response' };
  }

  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(raw));
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'unparseable validator response',
    };
  }

  const parsed = transferValidationSchema.safeParse(json);
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

/**
 * Fail closed. A validator saying only `valid: true` is insufficient if one of
 * its own component judgements disagrees, if it proposes a corrected answer, if
 * it still reports issues, or if its confidence is too low to make the hidden
 * reference answer load-bearing for scoring.
 */
export function isTransferValidationApproved(result: TransferValidation): boolean {
  return (
    result.valid &&
    result.answerCorrect &&
    result.stepsConsistent &&
    result.problemUnambiguous &&
    result.unitsCorrect &&
    result.sameConcept &&
    result.correctedAnswer === null &&
    result.issues.length === 0 &&
    result.confidence >= 0.7
  );
}
