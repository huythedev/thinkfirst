import { GoogleGenAI } from '@google/genai';

/**
 * The single place the application obtains a generative model client.
 *
 * Section 47 requires that "mock Gemini responses should be available for
 * deterministic local tests" while "the production AI path must use the real
 * configured Gemini service". Until this module existed there was no seam at
 * all: `new GoogleGenAI(...)` was constructed at module scope in three separate
 * files, so nothing could substitute a deterministic client without monkey
 * patching the package.
 *
 * The switch is deliberately narrow and deliberately loud:
 *
 * - It is off unless `AI_MODEL_DRIVER=mock` is set explicitly. There is no
 *   "mock if the key looks missing" fallback, because a production deployment
 *   that lost its key would then quietly serve fabricated tutoring instead of
 *   failing.
 * - It refuses to engage when `NODE_ENV === 'production'`, so setting the
 *   variable on a real deployment cannot silently replace the tutor.
 * - Every mock response carries `modelName` beginning with `mock:` wherever it is
 *   recorded, so a turn produced without a real model is identifiable in the
 *   stored data rather than indistinguishable from a real one.
 */

export type ModelDriver = 'live' | 'mock';

/** Set by tests and the evaluation harness. Never set in production. */
const DRIVER_ENV = 'AI_MODEL_DRIVER';

/** Stable default used by every configured Gemini role unless explicitly overridden. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

export type GeminiModelRole =
  | 'tutor'
  | 'classifier'
  | 'validator'
  | 'evaluator'
  | 'transfer'
  | 'extraction';

const GEMINI_MODEL_ENV_BY_ROLE: Record<GeminiModelRole, string> = {
  tutor: 'GEMINI_TUTOR_MODEL',
  classifier: 'GEMINI_CLASSIFIER_MODEL',
  validator: 'GEMINI_VALIDATOR_MODEL',
  evaluator: 'GEMINI_EVALUATOR_MODEL',
  transfer: 'GEMINI_TRANSFER_MODEL',
  extraction: 'GEMINI_EXTRACTION_MODEL',
};

const GEMINI_MODEL_ENV_VARS = Object.values(GEMINI_MODEL_ENV_BY_ROLE);

/**
 * Populate missing/blank model overrides once at module load. Explicit Cloud Run
 * or local overrides win; omitted variables use the one documented stable
 * default instead of falling through to role-specific historical literals.
 */
export function applyDefaultGeminiModelEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const variable of GEMINI_MODEL_ENV_VARS) {
    if (!env[variable]?.trim()) env[variable] = DEFAULT_GEMINI_MODEL;
  }
}

/**
 * Resolve a role model from one source of truth. Call sites must use this helper
 * rather than embedding their own fallback model names; otherwise a stale literal
 * can silently reappear when module initialization or deployment configuration
 * changes.
 */
export function configuredGeminiModel(
  role: GeminiModelRole,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = GEMINI_MODEL_ENV_BY_ROLE[role];
  return env[variable]?.trim() || DEFAULT_GEMINI_MODEL;
}

applyDefaultGeminiModelEnv();

export function resolveModelDriver(env: NodeJS.ProcessEnv = process.env): ModelDriver {
  if (env[DRIVER_ENV] !== 'mock') return 'live';

  // A mock tutor in production would be worse than an outage: an outage is
  // visible, whereas fabricated tutoring looks like the product working.
  if (env.NODE_ENV === 'production') return 'live';

  return 'mock';
}

/**
 * The subset of the provider surface this application actually uses.
 *
 * Narrow on purpose. A mock that has to implement the whole SDK is a mock that
 * drifts from it; this is the shape every call site in the repository passes.
 */
export interface GenerateContentRequest {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}

export interface GenerateContentResult {
  text?: string;
}

export interface ModelClient {
  models: {
    generateContent(request: GenerateContentRequest): Promise<GenerateContentResult>;
  };
}

let cachedLive: ModelClient | null = null;
let mockHandler: ((request: GenerateContentRequest) => Promise<GenerateContentResult>) | null = null;

/**
 * Installs the deterministic handler used when the driver is `mock`.
 *
 * Called by the evaluation harness and by the mock server route. Kept as
 * registration rather than an import so that shipping code never depends on a
 * fixture module.
 */
export function setMockModelHandler(
  handler: ((request: GenerateContentRequest) => Promise<GenerateContentResult>) | null,
): void {
  mockHandler = handler;
}

export function getModelClient(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (resolveModelDriver(env) === 'mock') {
    return {
      models: {
        generateContent: async (request) => {
          // Loaded lazily rather than imported at module scope, so the mock and
          // its fixtures are never pulled into a production bundle. An explicit
          // handler registered by a test still wins.
          if (!mockHandler) {
            const { deterministicModelHandler } = await import('./mock-model');
            mockHandler = deterministicModelHandler;
          }
          return mockHandler(request);
        },
      },
    };
  }

  if (!cachedLive) {
    cachedLive = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) as unknown as ModelClient;
  }
  return cachedLive;
}

/**
 * Label recorded on any turn a mock produced.
 *
 * Section 36 requires that a stored response can be traced to what generated it.
 * A turn whose `modelName` starts with `mock:` is one no real model saw, and the
 * evaluation report separates the two rather than blending them.
 */
export function modelNameFor(configuredModel: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolveModelDriver(env) === 'mock' ? `mock:${configuredModel}` : configuredModel;
}
