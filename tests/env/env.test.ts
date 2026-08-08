import { describe, expect, it } from 'vitest';
import { formatFailures, validateEnv } from '@/lib/env';

/**
 * Tests for the environment validator.
 *
 * The behavior worth protecting is the failure, not the success: a missing
 * production Gemini key must be reported by name, and an unknown NODE_ENV must
 * not be silently accepted.
 */

const PRODUCTION = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('accepts an empty development environment', () => {
    const { env, failures } = validateEnv({} as NodeJS.ProcessEnv);
    expect(failures).toEqual([]);
    expect(env?.NODE_ENV).toBe('development');
    expect(env?.LOG_LEVEL).toBe('info');
  });

  it('does not require a Gemini key outside production', () => {
    const { failures } = validateEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(failures).toEqual([]);
  });

  it('requires GEMINI_API_KEY in production', () => {
    const { failures } = validateEnv(PRODUCTION);
    expect(failures).toHaveLength(1);
    expect(failures[0].variable).toBe('GEMINI_API_KEY');
  });

  it('accepts production when the Gemini key is present', () => {
    const { failures } = validateEnv({
      ...PRODUCTION,
      GEMINI_API_KEY: 'test-key',
    } as NodeJS.ProcessEnv);
    expect(failures).toEqual([]);
  });

  it('treats a blank Gemini key as missing', () => {
    const { failures } = validateEnv({
      ...PRODUCTION,
      GEMINI_API_KEY: '   ',
    } as NodeJS.ProcessEnv);
    expect(failures.map((failure) => failure.variable)).toContain('GEMINI_API_KEY');
  });

  it('rejects an unrecognized NODE_ENV', () => {
    const { env, failures } = validateEnv({ NODE_ENV: 'staging' } as unknown as NodeJS.ProcessEnv);
    expect(env).toBeNull();
    expect(failures[0].variable).toBe('NODE_ENV');
  });

  it('rejects an unrecognized LOG_LEVEL', () => {
    const { env, failures } = validateEnv({ LOG_LEVEL: 'verbose' } as unknown as NodeJS.ProcessEnv);
    expect(env).toBeNull();
    expect(failures[0].variable).toBe('LOG_LEVEL');
  });

  it('requires emulator hosts when the emulator flag is set', () => {
    const { failures } = validateEnv({
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
    } as unknown as NodeJS.ProcessEnv);
    const named = failures.map((failure) => failure.variable);
    expect(named).toContain('NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST');
    expect(named).toContain('NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST');
  });

  it('accepts the emulator flag when hosts are supplied', () => {
    const { env, failures } = validateEnv({
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
    } as unknown as NodeJS.ProcessEnv);
    expect(failures).toEqual([]);
    expect(env?.NEXT_PUBLIC_USE_FIREBASE_EMULATORS).toBe(true);
  });

  it('defaults the emulator flag to false', () => {
    const { env } = validateEnv({} as NodeJS.ProcessEnv);
    expect(env?.NEXT_PUBLIC_USE_FIREBASE_EMULATORS).toBe(false);
  });
});

describe('formatFailures', () => {
  it('names each failing variable and points at .env.example', () => {
    const message = formatFailures([{ variable: 'GEMINI_API_KEY', problem: 'required' }]);
    expect(message).toContain('GEMINI_API_KEY');
    expect(message).toContain('.env.example');
  });
});
