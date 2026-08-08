import { describe, expect, it } from 'vitest';
import { resolveModelDriver, modelNameFor } from '@/lib/ai/model-client';
import { deterministicModelHandler } from '@/lib/ai/mock-model';
import { parseIntentAnalysis, parseTutorResponse } from '@/lib/types/ai/model-output';

/**
 * The model driver seam, and the two defects the evaluation suite found on its
 * first run.
 *
 * Both fixes are covered here rather than only in `npm run eval`, because the
 * eval suite is a report and this is a gate: `npm test` is what CI runs.
 */

/** `NodeJS.ProcessEnv` requires `NODE_ENV`, so fixtures build one explicitly. */
function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv;
}

describe('model driver selection', () => {
  it('defaults to the live client when nothing is set', () => {
    expect(resolveModelDriver(env({}))).toBe('live');
  });

  it('selects the mock only on an exact opt-in', () => {
    expect(resolveModelDriver(env({ AI_MODEL_DRIVER: 'mock' }))).toBe('mock');
    expect(resolveModelDriver(env({ AI_MODEL_DRIVER: 'Mock' }))).toBe('live');
    expect(resolveModelDriver(env({ AI_MODEL_DRIVER: 'true' }))).toBe('live');
  });

  it('refuses the mock in production even when the variable is set', () => {
    // A mock tutor on a real deployment is worse than an outage: an outage is
    // visible, whereas fabricated tutoring looks like the product working.
    expect(resolveModelDriver(env({ AI_MODEL_DRIVER: 'mock', NODE_ENV: 'production' }))).toBe(
      'live',
    );
  });

  it('marks a mock-produced turn so stored data does not overstate its provenance', () => {
    expect(modelNameFor('gemini-2.5-pro', env({ AI_MODEL_DRIVER: 'mock' }))).toBe(
      'mock:gemini-2.5-pro',
    );
    expect(modelNameFor('gemini-2.5-pro', env({}))).toBe('gemini-2.5-pro');
  });
});

describe('deterministic mock handler', () => {
  async function classify(message: string) {
    const result = await deterministicModelHandler({
      model: 'test',
      contents: [
        {
          parts: [
            {
              text: `Analyze the student interaction for educational routing.\n\nStudent: ${message}`,
            },
          ],
        },
      ],
    });
    const parsed = parseIntentAnalysis(result.text);
    if (!parsed.ok) throw new Error(`mock produced invalid intent: ${parsed.detail}`);
    return parsed.value;
  }

  it('produces output that passes the real schema validation', async () => {
    const analysis = await classify('Give me the answer.');
    expect(analysis.intent).toBe('answer_request');
    expect(analysis.safetyCategory).toBe('none');
  });

  it('routes a self-harm disclosure to a safety category', async () => {
    const analysis = await classify('I do not want to be here any more.');
    expect(analysis.safetyCategory).toBe('self_harm');
  });

  it('recognises an attempt so the ladder can advance', async () => {
    const analysis = await classify('I factored it as (x-2)(x-3). Is that right?');
    expect(analysis.studentProvidedAttempt).toBe(true);
    expect(analysis.attemptQuality).toBe('meaningful');
  });

  it('produces tutor output that respects the plan it is given', async () => {
    const result = await deterministicModelHandler({
      model: 'test',
      contents: [{ parts: [{ text: 'Student: What next?' }] }],
      config: {
        systemInstruction:
          'You are ThinkFirst, an adaptive educational assistant\nAllowed Hint Level: 2\nMay Reveal Final Answer: false\nAction: provide_hint',
      },
    });
    const parsed = parseTutorResponse(result.text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.hintLevel).toBeLessThanOrEqual(2);
      expect(parsed.value.finalAnswerIncluded).toBe(false);
    }
  });
});

describe('structured output: fenced JSON (found by the evaluation suite)', () => {
  // Providers frequently wrap structured output in a markdown fence even when a
  // response schema is supplied. Rejecting it produced a 502 for a payload that
  // was structurally correct, costing the student their turn.
  const payload =
    '{"messageMarkdown":"Try factoring.","responseType":"hint","hintLevel":2,"finalAnswerIncluded":false,"internalConceptTags":[]}';

  it('accepts JSON wrapped in a ```json fence', () => {
    const parsed = parseTutorResponse('```json\n' + payload + '\n```');
    expect(parsed.ok).toBe(true);
  });

  it('accepts JSON wrapped in a bare fence', () => {
    const parsed = parseTutorResponse('```\n' + payload + '\n```');
    expect(parsed.ok).toBe(true);
  });

  it('still rejects prose that merely mentions a fence', () => {
    // The unwrapping is deliberately narrow. Anything that scanned for the first
    // brace would start accepting explanations with an object buried in them.
    expect(parseTutorResponse('Here is some ```json``` for you').ok).toBe(false);
    expect(parseTutorResponse('I cannot help with that.').ok).toBe(false);
  });

  it('still rejects a fenced payload that violates the schema', () => {
    const bad = '```json\n{"messageMarkdown":"x","responseType":"telepathy","hintLevel":2,"finalAnswerIncluded":false,"internalConceptTags":[]}\n```';
    expect(parseTutorResponse(bad).ok).toBe(false);
  });
});
