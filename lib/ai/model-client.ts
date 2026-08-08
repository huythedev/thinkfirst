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
 * That absence had a concrete cost. Section 37 asks for an evaluation dataset of
 * at least 100 cases, and section 38 for six end-to-end scenarios. A tutoring
 * turn makes up to four model calls, and the free tier allows twenty requests a
 * day, so neither requirement could ever have been executed against the live
 * service on this budget.
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
