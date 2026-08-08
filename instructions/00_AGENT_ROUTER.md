# ThinkFirst AI Agent Instruction Router

Use this file as the **only always-loaded instruction file**. Load additional modules only when they are relevant to the current task.

## Active scope

The current task defines the active implementation scope.

The master directive below describes the complete product. It is context, not a
work order. Do not treat it as the scope of the current session.

- Implement only what the current task requires.
- Do not implement unrelated modules merely because they appear in the full
	product specification.
- Preserve compatibility with the complete architecture. Modify only what the
	current task requires.
- If the current task is one feature, deliver that one feature end to end in
	preference to advancing several features partially.
- If you believe the task cannot be completed without work outside its scope,
	say so and name the dependency. Do not silently expand scope, and do not
	silently narrow it either.

One completed vertical slice is worth more than five started phases. A phase is
not progress until it satisfies its exit criteria in section 49.

## Instruction priority

When requirements conflict, resolve in this order. A lower-numbered level always
wins.

1. **Safety and privacy invariants.** Modules `05` and `24`/`25`. Minor safety,
	 data minimization, and the prohibition on exposing one student's data to
	 another.
2. **Authorization and data integrity.** Server-authoritative trust boundaries,
	 Firestore rules, and the rule that clients never write trusted values.
3. **Current task scope.** The section above.
4. **Product behavior invariants.** The learning loop, the hint ladder, policy
	 engine authority over disclosure, and the non-goals in section 4.
5. **Acceptance criteria and definition of done.** Sections 51 and 52.
6. **Architecture recommendations.** Sections 26, 27 and 29. These describe a
	 target shape and may be adapted to the environment. Adaptations must be
	 recorded in `docs/ASSUMPTIONS.md`, and the requirements attached to an
	 adapted component still bind its replacement.
7. **Optional enhancements.** Anything marked future, later, or prepare the
	 architecture for.

Requirement strength keywords:

- **must** - a hard requirement. Failing it means the work is not done. Never
	trade a `must` for scope, speed or convenience. If a `must` cannot be met,
	stop and report it as blocked.
- **should** - required unless there is a specific, recorded reason. Record the
	reason in `docs/ASSUMPTIONS.md` and the session log. Silence is not a reason.
- **recommended** - the default choice. Deviating is acceptable and needs one
	line of justification in the session log.
- **optional** - implement only when the current task asks for it.

Conflict resolution rules:

- A level 1 or level 2 requirement is never overridden by any lower level. If
	satisfying an acceptance criterion would require weakening authorization, the
	acceptance criterion goes unmet and you report it.
- Where two requirements at the same level conflict, prefer the one that is
	testable, and record the conflict in the session log so the instruction set
	can be corrected.
- Where a numbered amendment section supersedes an earlier section, the
	amendment governs. Section 56 supersedes the mechanics of section 13.
- Never resolve a conflict by implementing both paths. Two sources of truth for
	one decision is itself a defect.

## Master directive

# MASTER BUILD PROMPT — THINKFIRST

You are a senior product engineer, AI systems architect, educational technology specialist, UX designer, security engineer and quality-assurance lead.

Your task is to design and implement a production-quality MVP called **ThinkFirst**.

Do not produce only a concept, mockup, pseudocode or static frontend. Build a complete, locally runnable application with a working AI workflow, authentication, persistent data, tests, documentation and cloud deployment configuration.

Make reasonable assumptions when details are missing. Record important assumptions in `docs/ASSUMPTIONS.md` instead of repeatedly asking questions.

Use current stable packages and official Google SDKs at implementation time. Do not use deprecated Google AI or Firebase packages. Verify package names and APIs against official documentation before implementing them.

Write a session log for every working session. Create it in `docs/logs/` before your first substantive edit and complete it before you finish. The required format is section 57 in `12_SCORING_MODEL_AND_AGENT_LOGGING.md`. A session that changes behavior without a log is not done.

Update `docs/progress.md` before you finish any session that changes behavior. It is the standing per-phase progress ledger, scored out of 100% across twelve phases, and it is the answer to "how far along is this?" Re-verify the rows you touch, recount the affected phase, and add a change-log row linking your session log. Promoting a row without evidence in that row is a delivery failure, not an optimism. The update protocol is in the file itself.

---

## Context-loading rule

1. Always read `00_AGENT_ROUTER.md`.
2. Read only the modules required for the current task, using the task-type
	table below.
3. For any implementation work, also read
	`11_IMPLEMENTATION_ACCEPTANCE_AND_STANDARDS.md`.
4. For any feature that reads, writes, or exposes user data, also read
	`05_SAFETY_PRIVACY_AND_SECURITY.md`. This applies to every persistence path
	without exception, including ones that look purely visual.
5. For any AI behavior change, read `02`, `03` and `04` together.
6. For any work touching the Independence Score, read
	`12_SCORING_MODEL_AND_AGENT_LOGGING.md`. Section 56 supersedes section 13 of
	module `02` for computation.
7. Read section 57 of module `12` before your first edit in any session, so the
	log is started at the right time.
8. Do not load all modules unless performing a whole-repository audit or a final
	acceptance review. Loading the entire set for a small task is a defect: it
	costs context that should be spent on the code you are changing, and it
	invites scope expansion. If you loaded more than six modules for a
	single-feature task, you have mis-routed.

### Mandatory pairs

These modules must be loaded together whenever either applies, because each
contains a requirement the other's work will otherwise violate.

| If you touch | You must also load | Reason |
|---|---|---|
| Any endpoint that calls the policy engine | `03` **and** `06` | `03` section 16 gives the policy engine sole authority over disclosure. `06` section 29 forbids trusting client-supplied values. Loading one without the other has already produced a working answer-disclosure exploit. |
| Any code that persists or reads user data | `05` **and** `06` | Data model plus authorization. |
| Any change to hint level, strictness, mode, or answer disclosure | `02`, `03`, `05` | These three values are educational policy and a security boundary at the same time. |
| Any feature that records learning behavior | `08` **and** `12` | Analytics events and scoring provenance. A behavior that is not instrumented cannot be scored, and section 56 requires missing instrumentation to be visible. |

## Module map

| File | Load it for |
|---|---|
| `01_PRODUCT_FOUNDATION.md` | Mission, MVP scope, non-goals, product principles, and user roles. |
| `02_PEDAGOGY_AND_LEARNING_LOGIC.md` | Learning modes, hint ladder, strictness, grade behavior, subjects, flows, and Independence Score. |
| `03_AI_ORCHESTRATION_AND_POLICY.md` | AI pipeline, analysis/response schemas, and deterministic policy engine. |
| `04_MODEL_PROMPTS_AND_VALIDATION.md` | Tutor/classifier/evaluator prompts, transfer generation, and mathematical validation. |
| `05_SAFETY_PRIVACY_AND_SECURITY.md` | Minor safety, data protection, Firestore rules, application security, and the mandatory trust-boundary review in section 41.1. |
| `06_TECH_STACK_REPOSITORY_DATA_API.md` | Technology stack, monorepo layout, Firestore model, and API contracts. |
| `07_FRONTEND_UX_ACCESSIBILITY.md` | Routes, student/teacher interfaces, i18n, image input, and accessibility. |
| `08_OBSERVABILITY_ANALYTICS_VERSIONING.md` | Logs, metrics, model/prompt versions, and product analytics. |
| `09_EVALUATION_TESTING_AND_DEMO.md` | AI evaluation suite, automated testing, seed data, and required demo scenario. |
| `10_DOCUMENTATION_ENVIRONMENT_AND_CICD.md` | README requirements, environment variables, local setup, and delivery pipeline. |
| `11_IMPLEMENTATION_ACCEPTANCE_AND_STANDARDS.md` | Phases, failure handling, acceptance criteria, definition of done, coding standards, and agent output. |
| `12_SCORING_MODEL_AND_AGENT_LOGGING.md` | Normative Independence Score v2 algorithm, and the mandatory agent session log format. |

## Task-type routing

| Task type | Load | Notes |
|---|---|---|
| Product planning or scope review | `01`, `02`, `11` | |
| Student learning workspace | `01`, `02`, `05`, `06`, `07`, `11` | `05` and `06` are required: the workspace persists sessions and turns. |
| Teacher dashboard | `01`, `02`, `05`, `06`, `07`, `08`, `11` | `05` is required: the dashboard exposes data about other users. |
| AI tutor behavior | `02`, `03`, `04`, `05`, `09`, `11` | |
| Policy engine change | `02`, `03`, `05`, `06`, `09`, `11` | `06` is required. The policy engine's inputs are a trust boundary. |
| Prompt-only change | `03`, `04`, `09` | No `11` needed if no application code changes. Bump the prompt version per section 36. |
| Independence Score or learning evidence | `02`, `12`, `08`, `09`, `11` | |
| Firestore, API endpoints, or server code | `03`, `05`, `06`, `08`, `09`, `11` | `03` is required whenever the endpoint touches policy. |
| Authentication and authorization | `01`, `05`, `06`, `09`, `11` | |
| Security audit | `05`, `06`, `03`, `11` | Produce the trust-boundary review in section 41.1 for every endpoint and every collection. Do not change features during a security audit. |
| Bug fix | `11` plus the module owning the behavior | Reproduce first, then fix, then add the regression test. Do not refactor adjacent code. |
| Frontend-only change (no new data path) | `07`, `11` | If the change adds any read or write, it is not frontend-only. Reroute. |
| Data migration | `05`, `06`, `08`, `11` | Migrations must be idempotent, reversible, and must never widen access. |
| Image problem upload | `03`, `04`, `05`, `06`, `07`, `09`, `11` | |
| Repository or acceptance audit | all modules in numeric order | The only case where loading everything is correct. |
| Performance investigation | `06`, `08`, `11` | Measure before changing. Record the measurement in the log. |
| Dependency upgrade | `06`, `09`, `10`, `11` | Every upgraded package must still be imported and exercised by a test, or removed. |
| Test or evaluation work | the feature's module plus `09`, `11` | |
| Deployment and CI/CD | `05`, `08`, `10`, `11` | |

For implementation ordering, use the phases and exit criteria in section 49 of
module `11`. That is the single authoritative sequence.

## Source integrity

- Original numbered sections (1-55) are copied verbatim from the master file.
- Section 41.1, and sections 56 and later, are amendments authored after auditing the shipped implementation. They are not part of the original master file and are marked as amendments in their module header.
- The phase exit criteria in section 49, the implementation states in 52.1, the completeness sweep in 52.2, and the completion report in section 54 are also amendments. They add gates the original phases lacked.
- `docs/INSTRUCTION-AUDIT.md` records why each amendment exists. Read it before proposing a change to the instruction set.
- Sections are grouped by implementation responsibility, not merely by original position.
- HTML comments at the top of each module are generated navigation metadata, not product requirements.
- `MANIFEST.json` contains a machine-readable file-to-section map and checksums.
