<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 35, 36, 42.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 35. OBSERVABILITY

Add structured logging.

Every request should have:

- Request ID.
- User role.
- Endpoint.
- Session ID when applicable.
- Policy version.
- Prompt version.
- Model configuration identifier.
- Latency.
- Token or usage estimate when available.
- Validation outcome.
- Safety action.
- Error code.

Never log:

- Passwords.
- Authentication tokens.
- Full private student profiles.
- Unredacted sensitive safety disclosures.
- Raw image bytes.
- Secret configuration.

Add metrics:

- AI request latency.
- AI error rate.
- Schema validation failure rate.
- Policy decision distribution.
- Average hint level.
- Final-answer disclosure rate.
- Transfer problem generation failure.
- Student report rate.
- Incorrect-response report rate.
- Image extraction confirmation rate.

---

# 36. PROMPT AND MODEL VERSIONING

Every AI interaction must store:

- Prompt version.
- Policy version.
- Scoring version.
- Model identifier.
- Generation settings.
- Validation result.

Create a central registry:

```ts
export const AI_VERSIONS = {
  tutorPrompt: "tutor-v1",
  classifierPrompt: "classifier-v1",
  evaluatorPrompt: "evaluator-v1",
  transferPrompt: "transfer-v1",
  policy: "policy-v1",
  scoring: "scoring-v1",
};
```

Do not silently modify behavior without changing the version.

> **Amendment.** `scoring` advances to `scoring-v2` when the model in section 56 of
> `12_SCORING_MODEL_AND_AGENT_LOGGING.md` is implemented. Also add an
> instrumentation-health metric to section 35: the rate of observations marked
> `unavailable`. A rising rate means telemetry is missing and scores are being
> computed on incomplete evidence.

---

# 42. ANALYTICS AND PRODUCT METRICS

Track privacy-respecting product events.

Examples:

- Onboarding completed.
- Session started.
- Initial attempt submitted.
- Hint requested.
- Hint level changed.
- Student explanation submitted.
- Transfer problem started.
- Transfer problem completed.
- AI response reported.
- Session completed.

Do not send raw educational content to third-party analytics by default.

Core product metrics:

- Attempt-before-help rate.
- Median highest hint level.
- Transfer success rate.
- Guided-to-independent performance gap.
- Percentage of sessions ending with transfer practice.
- Student-reported helpfulness.
- AI incorrect-answer report rate.
- Change in hint dependence over time.
- Teacher weekly active use.

Do not optimize only for message count or time spent.

---
