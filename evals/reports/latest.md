# ThinkFirst evaluation report

- Generated: 2026-08-11T06:05:12.530Z
- Cases: **121** (section 37 requires at least 100)
- Driver: **deterministic** -- no live model call was made

## Release gates

| Gate | Threshold | Measured | Status |
|---|---|---|---|
| Policy compliance | >= 95% | 100.0% (109/109) | PASS |
| Final-answer leakage in forbidden modes | <= 2% | 0.0% (0/16) | PASS |
| Structured output success | >= 99% | 100.0% (12/12) | PASS |
| Safety routing recall on the curated set | >= 95% | 100.0% (9/9) | PASS |
| Mathematical correctness on supported MVP topics | >= 95% | 100.0% (6/6) | PASS |
| Hint usefulness, relevance, age appropriateness and language quality of generated prose | qualitative review | n/a | not measured |

- **Policy compliance** -- Decided entirely by the deterministic policy engine, so this is a real measurement.
- **Final-answer leakage in forbidden modes** -- Measured by feeding hostile model output to the real enforcement layer and searching the delivered message.
- **Structured output success** -- Measures the Zod revalidation layer against malformed and adversarial payloads, including ones the provider schema does not catch.
- **Safety routing recall on the curated set** -- PARTIAL: measures routing and response composition given a classification. Classifier recall on real student language needs the live model and is not measured here.
- **Mathematical correctness on supported MVP topics** -- PARTIAL: measures the deterministic validator in lib/math/validation.ts. Correctness of generated tutor prose is not measured.
- **Hint usefulness, relevance, age appropriateness and language quality of generated prose** -- Requires the live model. The free tier allows 20 requests per day and a tutoring turn makes up to four calls, so a 100-case run is roughly 200 requests. Blocked on model budget, not on design.

## Metrics

| Metric | Result |
|---|---|
| Policy compliance | 100.0% (109/109) |
| Final-answer leakage (lower is better) | 0.0% (0/16) |
| Structured output success | 100.0% (12/12) |
| Safety routing recall | 100.0% (9/9) |
| Mathematical correctness | 100.0% (6/6) |
| Hint escalation discipline (at most +1) | 100.0% (23/23) |
| Student action required | 100.0% (100/100) |
| Uncertainty communication | 100.0% (2/2) |
| Age-appropriate register | 100.0% (6/6) |
| Transfer obligation after full solution | 100.0% (4/4) |

### Diagnostic Breakdowns

- **Metadata disclosure violations:** 0
- **Semantic disclosure violations:** 9
- **Semantic checks unavailable:** 7

## Case coverage

Section 37 lists the kinds of case the dataset must include. A kind with no case
fails the run, because 100 near-duplicate cases would otherwise satisfy the count.

| Kind | Cases |
|---|---:|
| direct_answer_request | 12 |
| meaningful_attempt | 7 |
| minimal_attempt | 6 |
| correct_intermediate_step | 8 |
| arithmetic_error | 6 |
| conceptual_error | 7 |
| ambiguous_image_extraction | 5 |
| assignment_safe_session | 5 |
| different_grades | 6 |
| vietnamese_prompt | 6 |
| english_prompt | 3 |
| off_topic | 5 |
| safety_sensitive | 9 |
| repeated_answer_attempts | 5 |
| polite_help_request | 4 |
| slang | 3 |
| incorrect_ai_candidate | 19 |
| transfer_quality | 5 |

## Failures

None.

## Limitations

Section 37 requires these to be documented. They are the reason two gates read
`PARTIAL` and one reads `not measured`.

- No live model call is made. The suite measures the deterministic layers: policy, enforcement, structured-output revalidation, safety routing and mathematical validation.
- Classifier accuracy is not measured. Each case supplies a fixed IntentAnalysis, so safety-routing recall is recall of the routing table rather than of the classifier.
- Tutor prose quality, hint usefulness and language quality are not measured, and are reported as not_measured rather than as passes.
- Mathematical correctness is measured against lib/math/validation.ts on the cases listed, not across the full MVP topic surface.
- The dataset is authored by the same project that implements the policy, so it can only find disagreements between the instruction text and the code, not errors shared by both.
