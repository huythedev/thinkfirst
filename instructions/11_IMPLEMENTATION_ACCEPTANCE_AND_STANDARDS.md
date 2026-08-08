<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 49, 50, 51, 52, 53, 54, 55.
The instruction body below is copied verbatim from the uploaded master file.
Amendments, 2026-08-06 (audit patches 2a, 2b, 2c): the phase gate and per-phase
exit criteria in section 49, sections 52.1 and 52.2, and the completion report in
section 54. Each is marked where it begins. The original phase bodies are
unchanged.
-->

# 49. IMPLEMENTATION PHASES

Follow this order.

## How to use these phases

> Amendment, 2026-08-06. The original phases listed nouns to produce and never
> said when a phase was finished, which is why six feature phases were built
> before authorization existed.

A phase is a scope boundary, not a checklist. Work one phase, or one vertical
slice within one phase, per session.

Each phase below has exit criteria. You may not report a phase complete, and you
may not advance to the next phase, until every exit criterion is met and you can
show the evidence. If a criterion cannot be met in this environment, it is
**blocked**, not done: record it in `docs/ASSUMPTIONS.md` under environment
limitations, name the acceptance criterion it affects, and report the phase as
partial.

Every phase inherits these criteria, in addition to its own:

1. **Functional.** The behavior works when exercised through the product's real
	 entry point, not only in a unit test.
2. **Authorization.** Every new read and write path is authorized at the server
	 or in security rules, and a negative test proves an unauthorized caller is
	 refused.
3. **Persistence.** Data the feature claims to store is actually written and
	 read back. No value displayed to a user is a literal in the source.
4. **States.** Loading, empty and error states exist for every new view.
5. **Tests.** New behavior has tests. New authorization has a negative test.
6. **Commands.** `npm run lint`, `npx tsc --noEmit`, `npm test` and
	 `npm run build` all pass. Report the actual output, not a summary.
7. **No stubs.** Nothing added in this phase is a placeholder, an unused
	 dependency, an unreachable route, or a script that cannot run. See 52.2.
8. **Evidence.** The completion report in section 54 is filled in, with commands
	 actually executed and unverified items named.

### Phase 0 exit criteria

- `docs/IMPLEMENTATION-PLAN.md` exists and follows the required template:
	deliverables, dependencies, affected files, risks, trust boundaries, tests,
	exit criteria, deferred work, rollback, and vertical-slice order. A restatement
	of these phase titles does not satisfy this criterion.
- `docs/ASSUMPTIONS.md` exists and covers, at minimum: security assumptions,
	credential availability, deployment environment, the server-side credential
	model, trust boundaries, data retention, external infrastructure that cannot be
	provisioned, features deferred for environment reasons, mock versus production
	AI behavior, and every acceptance criterion those assumptions affect.
- The session log is open in `docs/logs/` per section 57.
- The trust-boundary review in section 41.1 is completed for every data path the
	plan will touch.

### Phase 1 exit criteria

- `npm install` from a clean checkout succeeds, and `npm run dev` serves the app.
- Every script in `package.json` either exits 0 or is removed. A script pointing
	at a file that does not exist is a defect, not a placeholder.
- Environment validation fails fast with a named variable when a required
	variable is missing, and `.env.example` lists exactly the variables the code
	reads.
- Every dependency added in this phase is imported by shipped code or by a test.
	Unused dependencies are removed before the phase closes.
- Emulators start with `npm run emulators` and the app can be pointed at them.

### Phase 2 exit criteria

Phase 2 is complete only when:

- Student and teacher sign-in work end to end against the emulator.
- Role-protected routes reject unauthorized users, server-side. A client-side
	redirect alone does not satisfy this.
- A client cannot modify its own role. An emulator test proves the write is
	refused.
- Classroom ownership is enforced: a teacher cannot read or write a classroom
	they do not own, proven by a negative emulator test.
- Classroom membership is enforced for every membership-scoped collection. A
	rule of the form `allow read: if isAuthenticated()` on any collection
	containing student work fails this criterion.
- Every collection in section 28 that exists in the rules has an explicit,
	scoped rule. The rules-completeness matrix in section 41.1 is filled in.
- Security rules exist in exactly one file, and `firebase.json` points at it.
- Emulator authorization tests pass, and are wired into `npm test`.
- Typecheck, lint, unit tests and build pass.

### Phase 3 exit criteria

- A student can create a session, enter a problem, exchange turns, leave, return,
	and see the same conversation. Verified by walking the flow, not inferred.
- Session and turn documents are written with the fields section 28 requires,
	including `policyVersion` and `scoringVersion`.
- A second student cannot read the first student's session, turns or attempts.
	Proven by a negative emulator test, not by the absence of a UI link.
- Mode and hint indicators reflect server state, not local component state.
- Loading, empty and error states exist for the workspace and the session list.
- The modes offered in the UI are exactly the modes the policy engine
	implements. A mode the UI can select but policy ignores, or a policy branch the
	UI cannot reach, fails this criterion.

### Phase 4 exit criteria

- The trust-boundary review in section 41.1 is completed for the tutoring
	endpoint and attached to the session log.
- Every policy input -- `mode`, `strictness`, `currentHintLevel`, assignment
	policy, grade -- is read server-side from Firestore or from verified auth
	claims. No policy input is taken from the request body. Clamping a
	client-supplied value is a mitigation, not a substitute, and does not satisfy
	this criterion.
- A request that supplies `strictness: "supportive"` and a high
	`currentHintLevel` produces the same policy decision as one that supplies
	nothing. There is a test for exactly this.
- Model output is revalidated server-side against the schema after generation,
	before it is trusted, persisted or returned. Provider-side schema enforcement
	is not revalidation.
- A response whose `hintLevel` exceeds the plan's `allowedHintLevel`, or that
	sets `finalAnswerIncluded` when the plan forbids it, is rejected or downgraded
	server-side. Asking the model to comply is not enforcement.
- The endpoint requires a verified ID token, fails closed when verification is
	unavailable, and returns no raw error text to the client.
- Policy decisions persist with a rationale code and a policy version.
- Deterministic policy tests cover every rule in section 18, including the
	negative cases.

### Phase 5 exit criteria

- Scores are computed server-side and persisted to `independenceSnapshots`.
	Recomputation in the browser on read fails this criterion.
- `independenceSnapshots` remains client-unwritable, and the server write path
	works with real credentials.
- The score follows section 56, including coverage, evidence states, shrinkage
	and suppression.
- All twelve tests in 56.6 exist and pass.
- No score, band or trend is displayed when section 56's suppression rule applies.

### Phase 6 exit criteria

- Every number on the teacher dashboard is derived from a query. A literal, a
	dash or a zero placeholder in the source fails this criterion outright.
- A teacher sees aggregate data for their own classrooms only, proven by a
	negative test.
- Transcript access, if implemented, requires a reason, is authorized, and writes
	an `auditLogs` entry. If it is not implemented, no UI affordance suggests it is.
- Composite indexes required by every dashboard query exist in
	`firestore.indexes.json`. An empty index file with sorted queries in the code
	fails this criterion.
- No page reachable from the teacher navigation says "under development", "coming
	soon", or equivalent. Remove the navigation entry instead.

### Phase 7 exit criteria

- Upload, extraction, low-confidence confirmation and correction all work end to
	end on a real image.
- Stored images are private and access is authorized. MIME type is validated from
	file content, not the extension. Size and dimensions are bounded.
- `storage.rules` governs a path the application actually writes.
- Tutoring cannot begin on low-confidence extraction without confirmation, and
	there is a test.

### Phase 8 exit criteria

Phase 8 is abuse prevention and audit depth. It is **not** where authorization
first appears; authorization is an exit criterion of every phase that adds a data
path.

- Safety classifications are consumed, not merely produced. A self-harm
	classification changes what the student sees, and there is a test.
- Locale safety resources exist and contain no unverified placeholder contact
	information.
- Rate limits apply per user and per IP on AI endpoints, with a test.
- App Check is configured, or its absence is recorded in `ASSUMPTIONS.md` with
	the exact manual steps and the acceptance criteria it blocks.
- Privileged actions write `auditLogs`, and clients cannot write that collection.
- The threat model in `docs/THREAT-MODEL.md` lists each item from section 41 with
	its mitigation status and a pointer to the code or a stated gap.

### Phase 9 exit criteria

- The evaluation suite runs from one command and writes a report, or its
	blockers are recorded with the gates they prevent measuring.
- E2E scenarios A-F from section 38 either pass or are individually recorded as
	not implemented, with reasons. A Playwright dependency with no specs is a
	defect.
- Seed data produces a demonstrable classroom from one command.
- Accessibility review is performed against section 40 with findings recorded.
- The README satisfies section 45.

## Phase 0 — Planning

Before coding:

- Inspect the repository.
- Write `docs/IMPLEMENTATION-PLAN.md`.
- Write `docs/ASSUMPTIONS.md`.
- Open this session's log in `docs/logs/` per section 57. Do this before the first edit.
- Define architecture.
- Define data model.
- Define policy boundaries.
- Create a task checklist.

Do not stop after planning.

## Phase 1 — Foundation

Implement:

- Monorepo.
- Shared TypeScript config.
- Linting.
- Formatting.
- Environment validation.
- Basic Next.js app.
- AI gateway skeleton.
- Firebase emulator configuration.
- CI.

## Phase 2 — Authentication and roles

Implement:

- Sign-in.
- Student onboarding.
- Teacher onboarding.
- Role protection.
- Classroom creation.
- Classroom join flow.

## Phase 3 — Learning workspace

Implement:

- Session creation.
- Problem entry.
- Chat UI.
- Scratchpad.
- Mode selector.
- Hint indicator.
- Session persistence.

## Phase 4 — AI behavior engine

Implement:

- Intent classification.
- Policy engine.
- Hint planner.
- Tutor generation.
- Structured output validation.
- Error handling.
- Prompt versioning.

## Phase 5 — Learning evidence

Implement:

- Attempt evaluation.
- Explanation evaluation.
- Transfer generation.
- Transfer evaluation.
- Independence Score, per section 56 of `12_SCORING_MODEL_AND_AGENT_LOGGING.md`, not the literal formula in section 13.
- Topic mastery.

## Phase 6 — Teacher tools

Implement:

- Assignment creation.
- Classroom dashboard.
- Student summary.
- Aggregate analytics.
- Privacy boundaries.

## Phase 7 — Image input

Implement:

- Secure upload.
- Multimodal extraction.
- Confirmation flow.
- Extraction correction.

## Phase 8 — Safety and security

Implement:

- Safety routing.
- Rate limits.
- App Check.
- Audit logs.
- Security rules.
- Threat-model mitigations.

## Phase 9 — Evaluation and polish

Implement:

- Evaluation dataset.
- Automated reports.
- E2E tests.
- Accessibility review.
- Responsive design.
- Demo seed.
- Deployment documentation.

---

# 50. FAILURE HANDLING

The app must handle:

- Gemini timeout.
- Invalid structured output.
- Model refusal.
- Rate limiting.
- Network failure.
- Firestore failure.
- Upload failure.
- Image extraction failure.
- Invalid mathematics.
- Transfer generation failure.
- Authentication expiration.

Use friendly messages.

Example:

> I could not safely generate the next hint. Your work has been saved. Please try again.

Do not show raw stack traces to users.

Retry only when safe.

Use bounded retries.

Do not charge or count duplicate attempts caused by technical failure.

---

# 51. ACCEPTANCE CRITERIA

The MVP is complete only when all conditions below are satisfied.

## Functional

- A student can create or access an account.
- A student can join a classroom.
- A teacher can create a classroom.
- A teacher can create an assignment.
- A student can start a session.
- A student can enter a math problem.
- A student can upload a problem image.
- The system can request an attempt.
- The system can generate progressive hints.
- The system can evaluate a student step.
- The system can generate a transfer problem.
- The system can calculate an Independence Score.
- A student can see progress.
- A teacher can see aggregate classroom analytics.
- Data persists correctly.

## AI behavior

- The AI does not directly reveal answers when policy forbids it.
- The policy engine is deterministic and tested.
- The AI uses the correct language.
- The AI respects the maximum hint level.
- Full solutions trigger reflection and transfer.
- Ambiguous problems trigger clarification.
- Low-confidence image extraction requires confirmation.
- AI outputs are schema-validated.
- Mathematical answers are checked where supported.

## Privacy and security

- Student roles cannot be modified from the client.
- Students cannot access another student’s sessions.
- Teachers cannot access unrelated classrooms.
- Trusted scores cannot be written by clients.
- Join codes are protected.
- Images are private.
- Secrets are not exposed.
- Privileged access is audited.

## Quality

- TypeScript strict mode passes.
- Linting passes.
- Unit tests pass.
- Integration tests pass.
- E2E critical paths pass.
- Build passes.
- README is complete.
- App works on mobile and desktop.
- Core flows are keyboard accessible.
- Vietnamese and English interfaces work.

---

# 52. DEFINITION OF DONE FOR EACH FEATURE

A feature is not done unless it includes:

- Production implementation.
- Loading state.
- Empty state.
- Error state.
- Authorization.
- Input validation.
- Accessibility.
- Tests.
- Analytics event where appropriate.
- Documentation.
- A session log entry in `docs/logs/` recording the change and its verification.
- Responsive behavior.
- No unresolved TypeScript errors.
- No hardcoded secrets.
- No placeholder button that appears functional but does nothing.

## 52.1 What "implemented" means

> Amendment, 2026-08-06. The list above forbade exactly one placeholder shape.
> Hardcoded metrics, unused dependencies, empty config files and non-runnable
> scripts all passed it.

A feature is not implemented merely because its files, types, routes,
dependencies, schemas, or UI placeholders exist.

A feature is implemented only when it is reachable through the intended product
flow, connected to real application state, authorized, persisted where required,
tested, and verified through its intended user journey.

Use these terms precisely in every report. They are not synonyms.

| State | Means | Not sufficient because |
|---|---|---|
| File created | The file exists. | Nothing imports it. |
| Component rendered | It appears on a page. | Its data may be hardcoded. |
| Feature wired | Real application state flows through it. | No user can navigate to it. |
| Feature reachable | A user can get there through normal navigation. | Its writes may be unauthorized or lost. |
| Feature persisted | Data survives a reload, read back from its store. | Another user may be able to read it. |
| Feature authorized | Access is enforced server-side or in rules, with a negative test. | Regressions are undetected. |
| Feature tested | Automated tests cover the behavior and its refusals. | The real flow may still be broken. |
| Feature production-ready | The whole journey was exercised, states exist, no placeholders remain, and required infrastructure is configured or explicitly deferred. | -- |

Report the highest state you can prove. Never report a higher one. "Implemented"
in a report means at least `feature tested`. If it is at `file created`, say
`file created`.

## 52.2 Required completeness sweep

Run this before reporting any implementation task complete. Each item is a check
you perform, not a principle you agree with. Report each as pass, fail, or not
applicable, and fix every failure or name it as a known gap.

1. **Dead code.** Every file added or modified is imported by shipped code or by
	a test. Search for the module name. If nothing imports it, either wire it or
	delete it.
2. **Unreachable features.** Every new route is linked from navigation or from
	another reachable page. Every new UI control triggers a real handler. Every
	policy branch, mode and enum value the backend implements is reachable from
	the interface, and every option the interface offers is implemented by the
	backend.
3. **Unused dependencies.** Every package added is imported. A package installed
	for a feature that was not built is removed in the same session.
4. **Placeholder content.** No shipped view contains "under development",
	"coming soon", "TODO", lorem text, or a literal metric standing in for a
	computed one. Remove the entry point rather than shipping the placeholder.
5. **Hardcoded values.** No number, label, band or percentage displayed to a user
	is a literal in the source when the product claims it is measured. Grep the
	values you display.
6. **Runnable scripts.** Every `package.json` script exits 0, or is removed. A
	script referencing a path that does not exist is a failure of this check.
7. **Missing integration paths.** Every collection declared in security rules has
	a real read path and, unless server-only by design, a real write path. Every
	collection the code writes has a rule. Every query that combines a filter with
	an ordering has an index.
8. **Disabled code.** No `.bak`, `.old`, `.disabled` or commented-out file
	substitutes for a required behavior.
9. **Duplicate sources of truth.** One rules file, one policy implementation, one
	definition of each enum. If you find two, reconcile them in this session or
	record the drift risk.
10. **Configuration reality.** Every environment variable the code reads is in
	 `.env.example`. Every variable in `.env.example` is read by the code. No
	 hardcoded fallback silently substitutes for missing required configuration.

---

# 53. CODING STANDARDS

Use:

- TypeScript strict mode.
- Small focused functions.
- Explicit return types for public APIs.
- Runtime validation at trust boundaries.
- Dependency injection for AI providers.
- Central error handling.
- Structured logging.
- Clear domain types.
- Server-only modules for secrets.
- Reusable design tokens.
- Accessible components.
- Tests near domain logic.

Avoid:

- `any` unless strictly justified.
- Giant components.
- Business logic inside UI components.
- Direct Firestore access scattered across the app.
- Prompt strings embedded in route handlers.
- Unvalidated model responses.
- Duplicated policy logic.
- Silent catch blocks.
- Hardcoded model names.
- Hardcoded roles.
- Raw HTML injection.
- Storing chain-of-thought.
- Depending on AI for deterministic authorization.

---

# 54. OUTPUT EXPECTATIONS FOR THE CODING AGENT

At the beginning, provide:

1. A concise architecture summary.
2. Key assumptions.
3. Proposed repository structure.
4. Implementation phases.
5. Major risks.

Then open this session's log file per section 57, and immediately begin implementation.

During implementation:

- Work phase by phase.
- Keep the application runnable.
- Run tests after meaningful changes.
- Fix failures before moving on.
- Document important decisions.
- Append to the session log as you go, including failed attempts and dead ends.
- Do not leave the repository in a broken intermediate state.
- Do not replace working code with unexplained placeholders.
- Do not claim completion without running the relevant checks.

At the end of an implementation task, provide the completion report below. This
is the deliverable, not a courtesy. A task without it is not done.

> Amendment, 2026-08-06. Replaces the original numbered end-of-task list, which
> asked for a whole-product handover after every change and never asked which
> commands were actually run.

Two shapes exist. Use the task report for normal work. Use the release report
only for a final acceptance review, which additionally includes the full
handover: repository structure, setup commands, environment variables,
deployment, demo instructions, known limitations, next steps, and a link to this
session's completed log in `docs/logs/`.

```md
## Scope completed

What the task asked for, and what of that is now done. State the implementation
state from 52.1 for each item.

## Files changed

Every file created, modified or deleted, each with a one-line reason.

## Requirements addressed

Specific numbered sections satisfied. Cite section numbers, not module names.

## Trust boundaries reviewed

The table from section 41.1 for every data path touched, or an explicit
"no data path touched".

## Commands actually executed

The exact commands, with their real exit status and output summary. If you did
not run it, it does not appear here.

## Test results

Counts of passed, failed and skipped, from a run performed in this session. Name
the new tests added.

## Manual verification performed

The user journeys you actually walked, step by step, and what you observed. If
you walked none, write "none".

## Unverified items

Everything asserted but not executed, and why. Use the UNVERIFIED convention
from section 57.4.

## Remaining gaps

In-scope work left undone, blocked items with their blockers, and the acceptance
criteria still unmet.
```

Forbidden claims. Each of these is a false statement unless the stated condition
holds:

- "Tests pass" -- only if you ran them in this session and report the counts.
- "Implemented" -- only at state `feature tested` or higher in 52.1. A skeleton
	is `file created`.
- "Secure" -- only after completing the section 41.1 review and running a
	negative authorization test. Adding authentication does not make an endpoint
	secure.
- "Production-ready" -- never while a placeholder, an unused dependency, an
	unrunnable script or unconfigured required infrastructure remains.
- "End-to-end complete" -- only if you exercised the intended user journey and
	can describe what you observed.
- "Phase N complete" -- only if every exit criterion in section 49 for that phase
	is met, with evidence.

Under-claiming is always acceptable. Over-claiming is a delivery failure, and is
more damaging than the incomplete work it conceals, because it removes the next
agent's ability to trust the record.

If some external infrastructure cannot be created automatically, implement everything possible locally and provide exact manual steps.

---

# 55. FINAL PRODUCT STANDARD

The completed MVP should communicate the following idea through its actual behavior:

> ThinkFirst does not measure success by how quickly AI finishes a student’s work. It measures success by whether the student can understand, explain, verify and perform the next task independently.

Prioritize the core student learning loop over decorative features:

```text
Attempt
→ Targeted feedback
→ Progressive hint
→ Student reasoning
→ Verification
→ Transfer problem
→ Independence measurement
```

Build this loop completely before adding optional features.

Begin now.
