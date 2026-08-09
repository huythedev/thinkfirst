import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  configuredGeminiModel,
} from '@/lib/ai/model-client';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe('Gemini role model resolution', () => {
  it('uses one stable default for every role when no override exists', () => {
    const empty = env({});
    for (const role of ['tutor', 'classifier', 'validator', 'evaluator', 'transfer', 'extraction'] as const) {
      expect(configuredGeminiModel(role, empty)).toBe(DEFAULT_GEMINI_MODEL);
    }
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.6-flash');
  });

  it('uses an explicit role override without affecting another role', () => {
    const custom = env({
      GEMINI_TUTOR_MODEL: 'custom-tutor-model',
      GEMINI_VALIDATOR_MODEL: 'custom-validator-model',
    });

    expect(configuredGeminiModel('tutor', custom)).toBe('custom-tutor-model');
    expect(configuredGeminiModel('validator', custom)).toBe('custom-validator-model');
    expect(configuredGeminiModel('evaluator', custom)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('treats a blank override as missing', () => {
    expect(configuredGeminiModel('transfer', env({ GEMINI_TRANSFER_MODEL: '   ' }))).toBe(
      DEFAULT_GEMINI_MODEL,
    );
  });
});
