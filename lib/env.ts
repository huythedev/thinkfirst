import { z } from 'zod';

/**
 * Environment validation.
 *
 * Every variable the application reads or exposes as a documented deployment
 * contract is declared here. Validation runs once at startup and fails fast,
 * naming the offending variable, so a misconfigured deployment stops at boot
 * instead of failing later inside a request handler.
 */

const optionalNonEmpty = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal('').transform(() => undefined));

const booleanFlag = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  GEMINI_API_KEY: optionalNonEmpty,
  GEMINI_TUTOR_MODEL: optionalNonEmpty,
  GEMINI_CLASSIFIER_MODEL: optionalNonEmpty,
  GEMINI_VALIDATOR_MODEL: optionalNonEmpty,
  GEMINI_EVALUATOR_MODEL: optionalNonEmpty,
  GEMINI_TRANSFER_MODEL: optionalNonEmpty,
  GEMINI_EXTRACTION_MODEL: optionalNonEmpty,
  NEXT_PUBLIC_USE_FIREBASE_EMULATORS: booleanFlag,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: optionalNonEmpty,
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: optionalNonEmpty,
  NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST: optionalNonEmpty,
});

export type Env = z.infer<typeof baseSchema>;

export interface EnvFailure {
  variable: string;
  problem: string;
}

export interface EnvValidationResult {
  env: Env | null;
  failures: EnvFailure[];
}

export type EnvSource = Record<string, string | undefined>;

export function validateEnv(source: EnvSource = process.env): EnvValidationResult {
  const parsed = baseSchema.safeParse(source);

  if (!parsed.success) {
    const failures = parsed.error.issues.map((issue) => ({
      variable: String(issue.path[0] ?? 'environment'),
      problem: issue.message,
    }));
    return { env: null, failures };
  }

  const env = parsed.data;
  const failures: EnvFailure[] = [];

  if (env.NODE_ENV === 'production' && !env.GEMINI_API_KEY) {
    failures.push({
      variable: 'GEMINI_API_KEY',
      problem: 'required in production; the tutoring endpoint cannot call the model without it',
    });
  }

  if (env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS) {
    if (!env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST) {
      failures.push({
        variable: 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST',
        problem: 'required when NEXT_PUBLIC_USE_FIREBASE_EMULATORS is true (for example 127.0.0.1:9099)',
      });
    }
    if (!env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST) {
      failures.push({
        variable: 'NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST',
        problem: 'required when NEXT_PUBLIC_USE_FIREBASE_EMULATORS is true (for example 127.0.0.1:8085)',
      });
    }
  }

  return { env, failures };
}

export function formatFailures(failures: EnvFailure[]): string {
  const lines = failures.map((failure) => `  - ${failure.variable}: ${failure.problem}`);
  return [
    'Environment validation failed:',
    ...lines,
    'See .env.example for the full list of supported variables.',
  ].join('\n');
}

/**
 * Validate and return the environment, throwing with a named variable on
 * failure. Call this from server entry points that must not start misconfigured.
 */
export function requireEnv(source: EnvSource = process.env): Env {
  const { env, failures } = validateEnv(source);
  if (!env || failures.length > 0) {
    throw new Error(formatFailures(failures));
  }
  return env;
}
