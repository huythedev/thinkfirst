<!--
ThinkFirst amendment module.
Read 00_AGENT_ROUTER.md before using this file.
This file is NOT copied from the original master instruction file. It is an
amendment authored after auditing the shipped implementation.
It supersedes section 13 of 02_PEDAGOGY_AND_LEARNING_LOGIC.md where the two
conflict. Section 13 remains the statement of intent; this module is the
normative specification for computing the score.
-->

# 56. INDEPENDENCE SCORE v2 — NORMATIVE SCORING SPECIFICATION

Section 13 of `02_PEDAGOGY_AND_LEARNING_LOGIC.md` describes the *intent* of the
Independence Score and gives a starting formula. That formula was implemented as
`scoring-v1` and then audited against real behavior. The audit found that the
starting formula, taken literally, produces scores that are confidently wrong in
common cases.

This module defines `scoring-v2`. Where this module and section 13 conflict,
this module governs the computation. Section 13 continues to govern the
non-negotiable product constraints: the score is not a grade, not a measure of
intelligence, never publicly ranked, and always presented with a band, a trend,
a component breakdown and one improvement suggestion.

## 56.1 Why v1 must be replaced

Each defect below was reproduced by executing `scoring-v1` directly, not
inferred from reading it. The measured values are recorded in
`docs/logs/` for the session that produced this module.

| # | Defect | Measured evidence | Consequence |
|---|---|---|---|
| 1 | Renormalizing over observed components rewards absent evidence | A session with only a first attempt recorded scores **100**; a session where the student additionally attempted the transfer task and got partial credit scores **79** | The score is maximized by disengaging early. This inverts the product thesis. |
| 2 | Thin evidence yields a confident band | One session with a single measured component returns **100, "Increasingly independent"** | A student is told they are independent on the strength of one recorded behavior. |
| 3 | Absent instrumentation reads as absent behavior | A transcript where the tutor never wrote `hintLevel` scores **100** on a measured weight of 40 | Missing telemetry inflates scores. Failures in logging become high scores. |
| 4 | Solving with no hints is unmeasured, not excellent | `maxHintLevel === null` returns `measured: false` | The single strongest independence signal available is discarded. |
| 5 | Reasoning saturates at half participation | Explaining 2 of 4 turns earns **20/20**, identical to explaining 8 of 8 | The component stops discriminating exactly where it should start. |
| 6 | Transfer infers correctness from attempt quality | `attemptQuality: 'meaningful'` with no hint escalation maps to `independent_correct`, worth the full 30 | A confident, fluent, wrong answer earns the largest single weight in the model. |
| 7 | No difficulty or mastery adjustment | A trivial problem solved easily scores **100** | §13.2 explicitly requires adjustment for task difficulty and student mastery. Never implemented. |
| 8 | Hint tiers are coarse at the top | Hint level 0 and hint level 2 both score 20/20 | Distinct behaviors collapse to one value. |

Defects 1, 2 and 3 are the severe ones. They share a root cause: **v1 treats
"no evidence" as "excuse this component" rather than as "we do not know yet."**
The fix is not to score missing evidence as zero, which would punish short
sessions. The fix is to stop reporting a confident number from thin evidence.

## 56.2 The v2 model

Compute in four stages. Each stage is pure and independently testable.

```text
Stage 1  Evidence extraction   transcript  -> observations + provenance
Stage 2  Component scoring     observations -> component scores in [0,1] + confidence
Stage 3  Session aggregation   components  -> session score + coverage
Stage 4  Profile aggregation   sessions    -> shrunk, recency-weighted score + band + trend
```

### Stage 1 — Evidence extraction

Extraction must record, for every observation, **why** it holds that value.
Three states are required and must not be conflated:

- `observed` — the behavior was instrumented and seen.
- `not_applicable` — the opportunity never arose. The tutor did not issue a
  transfer task; verification never came up. The student cannot be credited or
  penalized.
- `declined` — the opportunity arose and the student did not take it. The
  transfer problem was issued and the student left; verification was requested
  and ignored.

Defect 1 exists because v1 has no `declined` state. `not_applicable` is excluded
from scoring. `declined` is scored, at a low value, and is the difference
between a student who was never offered a transfer task and one who walked away
from it.

A fourth state is required for defect 3:

- `unavailable` — the behavior should have been instrumented and was not. A
  tutor turn with no `hintLevel` is `unavailable`, not `not_applicable`.

`unavailable` observations must not be silently excluded. They reduce session
coverage (56.3) and must be counted in an instrumentation-health metric exposed
under section 35. A rising `unavailable` rate is a logging bug, and the score
must make that visible rather than absorb it.

### Stage 2 — Component scoring

Each component returns a normalized value in `[0,1]`, a confidence in `[0,1]`,
and a plain-language rationale. Normalizing to `[0,1]` separates *how well* from
*how much it counts*, which v1 conflated by scoring directly in weighted points.

Weights are unchanged from section 13 and still sum to 100:

```text
firstAttempt          20
hintEfficiency        20
reasoningExplanation  20
transferPerformance   30
verificationBehavior  10
```

**First attempt (20).** Unchanged in spirit. Grade `meaningful` 1.0, `partial`
0.7, `minimal` 0.45, `none` 0.2, repeated answer-seeking 0.1. A stated valid
reason for not attempting is `not_applicable`, per §13.1's "neutral."

**Hint efficiency (20).** Fixes defects 4 and 8. Score against the hint level
the student actually needed, relative to the level the policy engine permitted:

```text
value = 1 - (highestHintUsed / max(allowedHintLevel, 1)) * 0.85
```

Solving with zero hints when level 5 was available is a stronger signal than
solving with zero hints when the ceiling was 1, and the ratio captures that.
Clamp to `[0.05, 1]`. A student who never requested a hint and reached a correct
result scores 1.0 with confidence 1.0. This is `observed`, not missing.
Accessibility accommodations must be excluded from `highestHintUsed`, per §13.2.

**Reasoning explanation (20).** Fixes defect 5. §13.3 requires a structured
rubric and v1 substituted a ratio of turns. Implement the rubric as four
independent binary checks, each worth 0.25:

1. Identified the method or strategy.
2. Explained at least one substantive intermediate step.
3. Connected the step to a relevant concept, definition or formula.
4. Interpreted the final result, including units where applicable.

Each check is judged by the evaluator model against the transcript and must be
schema-validated per section 22. The evaluator returns per-criterion booleans
with evidence spans, never a bare number. Confidence is the evaluator's own
calibrated confidence, and falls below 1.0 when the transcript is short.

**Transfer performance (30).** Fixes defect 6, the most consequential. Correctness
must be established, not inferred from fluency. Order of precedence:

1. Deterministic check against the generated problem's stored reference answer,
   using the mathematical validation required by section 23. This is the only
   path that yields confidence 1.0.
2. Evaluator judgment when no deterministic check is possible, capped at
   confidence 0.7.
3. If neither is available, the component is `unavailable`, not a score of 30.

Grade only after correctness is known: independently correct 1.0, correct after
a minor prompt 0.8, correct after one conceptual hint 0.6, partially correct
0.4, attempted and incorrect 0.2, issued but declined 0.1, never issued
`not_applicable`.

A transfer task that a student got wrong must never outscore one they got right.
Under v1 it can, because outcome is derived from `attemptQuality`.

**Verification behavior (10).** Score the substance, not the count. Award 0.25
for each of: recomputed or substituted the result back into the problem;
checked units or dimensional plausibility; stated an assumption or limitation;
correctly identified an error in AI-presented content, or correctly affirmed
content that was in fact correct. The last criterion matters in Verify mode:
§7.4 requires tracking verification ability, and a student who flags a correct
answer as wrong has not verified well. Reward calibration, not suspicion.

### Stage 3 — Session aggregation

```text
applicable   = components where state != not_applicable
coverage     = sum(weight * confidence over applicable) / 100
rawScore     = sum(weight * confidence * value over applicable)
               / sum(weight * confidence over applicable)
```

`coverage` is the fraction of the full 100-point model that this session
actually observed with confidence. It is the honest measure of how much the
session is worth, and it is what v1 lacked.

Report `rawScore` and `coverage` together. **Never present `rawScore` alone.**
A session with `coverage < 0.35` must be recorded but must not be shown as a
session score in the UI. It still contributes to the profile, weighted by its
coverage.

### Stage 4 — Profile aggregation

This is where defects 1 and 2 are actually cured.

Weight each session by both recency and coverage:

```text
w_i    = decay^(sessionsSinceNewest_i) * coverage_i        decay = 0.85
observedMean = sum(w_i * rawScore_i) / sum(w_i)
```

Then shrink toward a neutral prior so that thin evidence cannot produce an
extreme score. Use a James-Stein style shrinkage with a pseudo-count:

$$\text{score} = \frac{\sum_i w_i \cdot \text{raw}_i + k \cdot \mu_0}{\sum_i w_i + k}$$

with $k = 2.0$ and $\mu_0 = 55$, the midpoint of "benefits from guided support."
The prior is deliberately mid-band, not zero: a new student is unknown, not
struggling.

Consequence, and the point of the change: the single-component session that v1
scored 100 now yields roughly `(0.2 * 100 + 2 * 55) / (0.2 + 2) ≈ 59`, reported
with low confidence. As real evidence accumulates, `sum(w_i)` grows past `k` and
the prior's influence fades. The score earns its confidence instead of asserting
it.

**Suppression rule.** When `sum(w_i) < 1.0`, do not display a numeric score or a
band at all. Display the component breakdown and "Not enough practice yet to
estimate this." An unknown score must look unknown. This directly prevents the
measured defect-2 case.

**Trend.** Require at least 4 scored sessions *and* `sum(w_i) >= 2.0`. Compare
the coverage-weighted mean of the recent half against the earlier half. Suppress
the trend when either half has combined coverage below 0.5. Report no trend
rather than noise.

### 56.3 Difficulty and mastery adjustment

Fixes defect 7 and satisfies §13.2's unimplemented requirement.

Store a difficulty estimate on each problem, on a 1-5 ordinal scale, sourced in
this order: teacher-assigned difficulty on the assignment; else the tutor
model's estimate at classification time, persisted with the session; else the
grade-band default of 3.

Apply difficulty **only** to `hintEfficiency` and `transferPerformance`, the two
components where task hardness genuinely changes the meaning of the behavior:

```text
adjusted = clamp(value * (0.85 + 0.075 * difficulty), 0, 1)
```

At difficulty 3 the multiplier is 1.075 and nearly neutral; needing hints on a
hard problem is penalized less, and breezing through an easy one is not treated
as strong evidence of independence.

Do not apply difficulty to first attempt, reasoning or verification. Those
behaviors are expected at every difficulty, and scaling them would let a student
earn independence credit for explaining trivial work.

## 56.4 Fairness and safety constraints

These are requirements, not guidance.

- Never let a single session move the displayed profile score by more than 8
  points. Section 13 requires rolling averages and no dramatic swings; make this
  an explicit clamp with a test, not an emergent property of the decay constant.
- Never score a student down for behavior caused by a system failure. Sessions
  that ended in a Gemini timeout, a validation failure or a network error, per
  section 50, are excluded from scoring entirely, not scored as abandonment.
- Never score accessibility accommodations as dependence.
- Never allow the client to write a score. Scores are computed server-side and
  persisted to `independenceSnapshots`, which remains client-unwritable.
- The score must be reproducible. Given the same stored metrics and the same
  `scoringVersion`, recomputation must be byte-identical. Evaluator-model
  judgments must therefore be persisted as part of the metrics record, not
  re-requested at read time.
- Every snapshot stores: raw metrics, per-component values with state and
  confidence, coverage, the computed score, and `scoringVersion`, per §13.

## 56.5 Versioning and migration

- Set `scoring: "scoring-v2"` in the `AI_VERSIONS` registry defined in section 36.
- Do not mutate existing `scoring-v1` snapshots. Recompute forward and retain
  both. A student's history must never silently change meaning.
- When the displayed score changes because the algorithm changed, say so in the
  UI. A student who sees 100 become 59 is owed an explanation that this is a
  measurement change, not a regression in their learning.
- Run both versions in parallel over the evaluation dataset (section 37) before
  switching the displayed value, and record the score delta distribution in the
  session log.

## 56.6 Required tests

Add to the scoring suite. Each maps to a measured defect above.

1. Skipping a transfer task never scores higher than attempting it and partially
   succeeding. *(defect 1)*
2. A single thin session returns a suppressed score and no band. *(defect 2)*
3. A transcript with no recorded hint levels is marked `unavailable` and reduces
   coverage rather than scoring full marks. *(defect 3)*
4. Solving with zero hints scores 1.0 on hint efficiency with full confidence,
   and is not marked unmeasured. *(defect 4)*
5. Explaining 8 of 8 turns scores strictly higher than explaining 2 of 4.
   *(defect 5)*
6. A fluent but incorrect transfer answer scores strictly below a correct one.
   *(defect 6)*
7. Identical behavior on difficulty 1 and difficulty 5 produces different hint
   efficiency and transfer scores. *(defect 7)*
8. Hint level 0 scores strictly higher than hint level 2 at the same ceiling.
   *(defect 8)*
9. Component weights still sum to 100.
10. No single session moves the profile score by more than 8 points.
11. A session that failed with a system error is excluded from scoring.
12. Recomputation from stored metrics is deterministic.

---

# 57. AGENT SESSION LOGGING

Every agent working in this repository must write a session log. This is a
delivery requirement with the same standing as passing tests, not a courtesy.

The original instruction set required `docs/ASSUMPTIONS.md` and
`docs/IMPLEMENTATION-PLAN.md` but never required a record of what an agent
actually did. The result is that `docs/SPEC-AUDIT.md` refers to work done "this
session" with no way to identify which session, when, or by whom. Sections 36
and 51 demand versioning and reproducibility; neither is achievable when
changes leave no trace.

## 57.1 When to write

Create **one new log file per session**. A session is one continuous working
engagement, from the first action to the final summary.

- Create the file **before the first substantive edit**, not at the end. Fill in
  the plan and the starting state first, then append as you work.
- Never append to another session's log. Never overwrite one.
- If a session is interrupted, resumed, or its context is compacted, continue
  the same file and note the interruption.

## 57.2 Location and naming

```text
docs/logs/YYYY-MM-DD-NN-short-slug.md
```

`NN` is a two-digit ordinal for that date, starting at `01`, so multiple
sessions on one day sort correctly. The slug is two to five lowercase words
describing the work.

Maintain `docs/logs/README.md` as an index: one row per session, newest first,
with date, slug, one-line summary and outcome. Add the row in the same session
that creates the log.

## 57.3 Required contents

Every log must contain these sections, in this order.

1. **Front matter** — date, agent or model identifier, one-sentence objective,
   and outcome (`completed`, `partial`, `blocked`).
2. **Request** — what was asked, quoted or closely paraphrased.
3. **Starting state** — what was already true. Relevant existing files, whether
   the build and tests passed beforehand, and any known-broken state inherited.
4. **Investigation** — what was read and what was learned, including hypotheses
   that turned out wrong. Dead ends are the highest-value content in a log,
   because they stop the next agent from repeating them.
5. **Changes** — every file created, modified or deleted, each with a one-line
   reason. Group by purpose, not alphabetically.
6. **Verification** — the exact commands run and their real results. Record
   measured numbers, not adjectives.
7. **Not done** — what was in scope and left undone, and why. Anything
   knowingly left broken. Anything claimed but unverified.
8. **Follow-ups** — concrete next actions, ordered by priority.

## 57.4 Honesty requirements

These override any instinct to present work favorably.

- Record commands that failed and tests that did not pass. A log showing only
  successes is not a log.
- Distinguish verified from assumed. If a claim was not executed, mark it
  `UNVERIFIED`, matching the convention already used in `docs/SPEC-AUDIT.md`.
- Do not claim a feature works because the code compiles.
- If a requirement was misunderstood mid-session, record the misunderstanding
  and the correction.
- Never delete or rewrite history in a previous log to make the current session
  look cleaner. Correct it by adding a dated note.

## 57.5 Relationship to other documents

- `docs/ASSUMPTIONS.md` — durable assumptions. When a session makes a new one,
  add it there **and** reference it from the log.
- `docs/IMPLEMENTATION-PLAN.md` — forward-looking plan. Update phase status when
  a session completes phase work.
- `docs/SPEC-AUDIT.md` — point-in-time compliance snapshot. When a session
  changes a status, update the row and cite the log file.
- `docs/progress.md` — the standing progress ledger, scored out of 100% across
  twelve phases against the exit criteria in section 49. Update it in every
  session that changes behavior, following the update protocol in the file.
  `SPEC-AUDIT.md` asks "does an implementation exist?"; `progress.md` asks "are
  the exit criteria met, with evidence?" A feature that exists but is
  unauthorized, unreachable or untested counts in the audit and must not count
  in the ledger. Blocked criteria score zero and stay in the denominator: a
  phase never approaches 100% by becoming impossible.
- `docs/logs/` — the append-only history. Never edited retroactively.

A session that changes behavior without updating the log is incomplete, and must
be treated as failing the definition of done in section 52.

---
