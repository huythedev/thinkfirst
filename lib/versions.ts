/**
 * Central AI version registry, per section 36 of
 * `instructions/08_OBSERVABILITY_ANALYTICS_VERSIONING.md`.
 *
 * Every AI interaction stores the versions it ran under, so a stored decision can
 * be traced to the prompt, policy and scoring algorithm that produced it. Do not
 * change behavior without changing the corresponding version here.
 *
 * `scoring` remains `scoring-v2`: this branch fixes evidence validation and
 * instrumentation defects against the existing §56 scoring contract; it does not
 * change component weights, formulas, bands, suppression or movement rules.
 */
export const AI_VERSIONS = {
  tutorPrompt: 'tutor-system-v1',
  classifierPrompt: 'classifier-v1',
  evaluatorPrompt: 'evaluator-v1',
  transferPrompt: 'transfer-v1',
  validatorPrompt: 'validator-v1',
  semanticValidatorPrompt: 'semantic-validator-v2',
  extractionPrompt: 'extraction-v1',
  policy: 'policy-v2',
  scoring: 'scoring-v2',
} as const;

export type AiVersionKey = keyof typeof AI_VERSIONS;
