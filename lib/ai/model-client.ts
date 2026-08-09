import { GoogleGenAI } from '@google/genai';

/**
 * The single place the application obtains a generative model client.
 *
 * The mock switch is deliberately narrow and deliberately loud:
 * - it is off unless `AI_MODEL_DRIVER=mock` is explicit;
 * - production always resolves to the live driver;
 * - live mode refuses to construct a client without `GEMINI_API_KEY`;
 * - mock provenance is recorded with a `mock:` model-name prefix.
 */

export type ModelDriver = 'live' | 'mock';
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

export function applyDefaultGeminiModelEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const variable of GEMINI_MODEL_ENV_VARS) {
    if (!env[variable]?.trim()) env[variable] = DEFAULT_GEMINI_MODEL;
  }
}

/** One source of truth for every model-role fallback. */
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
  if (env.NODE_ENV === 'production') return 'live';
  return 'mock';
}

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
let cachedLiveKey: string | null = null;
let mockHandler: ((request: GenerateContentRequest) => Promise<GenerateContentResult>) | null = null;

export function setMockModelHandler(
  handler: ((request: GenerateContentRequest) => Promise<GenerateContentResult>) | null,
): void {
  mockHandler = handler;
}

/**
 * Resolve the model client at call time.
 *
 * This is the server-side fail-fast boundary for Gemini credentials. We do not
 * validate the key at module import/build time because Docker builds deliberately
 * do not receive production secrets. The first live AI operation instead fails
 * immediately with a named configuration error rather than constructing an SDK
 * client with an undefined key and surfacing an opaque provider error later.
 *
 * The cached live client is also replaced when the process environment key
 * changes. Cloud Run normally starts a new process for a new secret value, but
 * this makes local/runtime key rotation behavior deterministic too.
 */
export function getModelClient(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (resolveModelDriver(env) === 'mock') {
    return {
      models: {
        generateContent: async (request) => {
          if (!mockHandler) {
            const { deterministicModelHandler } = await import('./mock-model');
            mockHandler = deterministicModelHandler;
          }
          return mockHandler(request);
        },
      },
    };
  }

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is required for the live Gemini model driver. ' +
        'Inject it at runtime (Cloud Run uses Secret Manager) or set AI_MODEL_DRIVER=mock outside production.',
    );
  }

  if (!cachedLive || cachedLiveKey !== apiKey) {
    cachedLive = new GoogleGenAI({ apiKey }) as unknown as ModelClient;
    cachedLiveKey = apiKey;
  }
  return cachedLive;
}

/** Label persisted for provenance; mock output must never look like live Gemini. */
export function modelNameFor(configuredModel: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolveModelDriver(env) === 'mock' ? `mock:${configuredModel}` : configuredModel;
}
