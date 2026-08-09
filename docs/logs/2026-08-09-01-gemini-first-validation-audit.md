---
date: 2026-08-09
agent: GPT-5.6 Sol
objective: Make semantic validation Gemini-first for load-bearing AI decisions, document the model/deployment changes, and audit/fix adjacent trust, scoring, retry, concurrency, and persistence defects.
outcome: partial
---

# Request

The user asked to prefer Gemini whenever a result needs semantic validation or important verification, accepting the additional cost for now; keep deterministic/local validation as a future optimization. They also asked to record the work in the repository's AI/session logs, read the instruction set first, update the README if needed, and scan for bugs similar to the transfer-validation defect. In the follow-up they explicitly authorized fixing any real bug found in the current repository, while continuing to follow the instruction/logging requirements.

# Starting state

- Work is on draft PR #3, branch `agent/gemini-3-6-flash-defaults` against `main`.
- Before this expanded audit request, the branch already changed all Gemini role defaults to `gemini-3.6-flash`, added `GEMINI_VALIDATOR_MODEL` to runtime/deployment configuration, and added an independent Gemini transfer-problem validator.
- The transfer generator previously treated deterministic verdict `unsupported` as validated because it used `verdict !== 'not_equivalent'`; that defect was already corrected on this branch before this log was opened.
- `docs/progress.md` claims prior session logs exist under `docs/logs/`, but several linked historical log files are absent from the current Git branch. Historical evidence links are therefore incomplete.
- GitHub Actions had not reported a workflow run for the PR head when this audit began, so no lint/typecheck/test/build claim was available.
- This log was created after earlier substantive edits in the same continuous conversation. That violates section 57.1's requirement to create the log before the first substantive edit. The omission was discovered only after re-reading the instruction router. It is recorded here rather than silently backdated.
- The conversation context was compacted during this same continuous session. Per section 57, work resumed in this existing log rather than opening a new log file.

# Trust-boundary review

Scope: `/api/session/chat`, trusted transcript history, generated transfer problems, model-based semantic validation, scoring evidence, referenced classroom/assignment policy, and concurrency coordination.

| Value or operation | Client controlled? | Trusted source | Validation | Authorization |
|---|---:|---|---|---|
| `sessionId` | yes | request identifier, then Firestore session | request schema + ownership lookup | authenticated owner only |
| current student message | yes | request | request schema/length; untrusted model input | route persists the student turn under Admin credentials |
| prior student transcript turns | historically yes | only turns carrying `serverAuthored: true` | provenance filter + sequence ordering | direct client writes now denied |
| assistant/system transcript turns | no | server route | structured output + policy/semantic checks | Admin write only |
| classroom/assignment references on session | yes | reference only; never authority by itself | active deterministic membership + assignment/classroom match | foreign or inactive references return forbidden |
| mode / strictness / grade / hint level / assignment policy | mixed | session choice where allowed, otherwise verified assignment/classroom/profile/server state | enums + resolver precedence | never accepted directly from request body |
| intent/classifier output | model-controlled | Gemini classifier | provider schema + Zod + independent semantic verifier | cannot grant auth/disclosure permission; safety handling is monotonic |
| response plan | no | deterministic policy engine | code invariants + post-generation enforcement | server-authoritative |
| tutor output | model-controlled | Gemini tutor | provider schema + Zod + response-plan enforcement + Gemini semantic verification | persisted/displayed only after checks |
| evaluator judgment | model-controlled | Gemini evaluator | provider schema + Zod + independent Gemini verification | server writes attempt evidence |
| transfer problem + hidden reference | model-controlled | Gemini transfer generator | Zod + deterministic signal + independent Gemini validator | hidden document is server-only |
| transfer-answer correctness | mixed | local checker signal + independent Gemini validator | disagreement fails to unavailable; deterministic confidence 1 only with Gemini agreement | scoring only, never auth |
| image extraction | model-controlled | Gemini multimodal extractor | schema + second multimodal Gemini check | low/rejected confidence forces confirmation |
| Independence Score | no | server-authored attempts/turns/session evidence | deterministic scoring-v2 | server-only writes |
| turn sequence allocation | no | `sessionTurnCounters` | Firestore transaction | server-only collection |
| per-session request serialization | no | `sessionProcessingLocks` | expiring token lease in transaction | server-only collection |

Gemini never decides role, ownership, classroom membership, Firestore authorization, hint ceilings, or whether a final answer is legally/pedagogically permitted. Gemini may reject semantic content or make safety handling more restrictive; deterministic policy remains the permission boundary.

# Investigation

## Gemini-first validation audit

- Section 14 requires a post-generation response-validation stage and section 15 requires server-side runtime validation of model JSON.
- Section 23 says not to rely solely on a generative model to verify its own output and requires deterministic utilities where practical; the current quality-first implementation therefore keeps Zod/math/policy checks and adds a separate Gemini verifier for semantic correctness.
- Section 41.1 defines model output as untrusted and forbids model output from determining authorization, ownership, or a trusted score directly.
- Section 53 forbids depending on AI for deterministic authorization.
- Section 36 requires model/prompt/version/validation provenance.

## Defects found in the repository

1. **Transfer deterministic `unsupported` was historically treated as success.** The old boolean condition accepted anything except explicit `not_equivalent`.
2. **A planned transfer could be scored as issued even when generation/validation failed.** `responsePlan.generateTransferProblem` described intent, not delivered behavior.
3. **A transfer problem could exist only in hidden storage while scoring assumed the student saw it.** The exact validated public problem now becomes an assistant turn tied to its hidden reference.
4. **The normal tutor could invent a transfer different from the hidden generated transfer.** Tutor-emitted `transfer_problem` is rejected outside the dedicated transfer generator.
5. **Hidden transfer + visible transfer turn were separate writes.** They are now one Firestore batch.
6. **A hint request could close a pending transfer as if it were an answer.** Transfer closes only when the evaluator extracts an actual answer.
7. **Transfer hint usage came from planned/current levels rather than delivered assistant turns.** It now derives from assistant plans actually delivered after issue.
8. **The browser wrote the current student turn before calling chat, while the route also appended the request message to model context.** The current message could appear twice to classifier/evaluator.
9. **More seriously, student turns were client-creatable at all.** Because prior transcript affects answer disclosure and scoring, Admin-reading a client-written turn laundered untrusted history into policy truth. All transcript writes are now server-authored and rules deny direct client writes.
10. **Legacy client-authored student turns remained dangerous after the rule cutover.** Policy and scoring loaders now ignore student turns that do not carry the server provenance marker.
11. **Explanation/verification attempt type was taken from the new response plan.** That plan describes the task being assigned after the student's current message, so evidence was one turn ahead. Attempt type now derives from the previous assistant task actually delivered.
12. **Evaluator learning objective had the same off-by-one bug.** It now uses the previous assistant response plan's objective.
13. **Evaluator context could include the tutor correction generated after the attempt being judged.** It now sees only prior history plus the current student message.
14. **Assistant-turn persistence and hint-level advancement were independent writes.** They now commit in one Firestore batch.
15. **Turn sequence used `max(transcript)+1` without cross-instance serialization.** Parallel Cloud Run requests could produce duplicate sequence numbers. A server-only transactional sequence allocator now reserves monotonically increasing sequence numbers.
16. **Even unique sequences did not prevent policy-state double spend.** Two concurrent requests could read the same hint state before either advanced it. A server-only expiring per-session lease now serializes chat work; a parallel request receives 409 before model work.
17. **Retry after a model/verifier failure duplicated the already-persisted student message.** When the last trusted turn is an orphan student turn with the exact retry message, the route reuses it and reserves only an assistant sequence.
18. **`endedWithSystemError` could stay permanently true after a later successful recovery.** A successfully persisted normal/safety assistant response clears the "ended with" marker; later evidence failures may set it again.
19. **Classifier verifier failure could downgrade a primary safety classification.** Safety merging is now monotonic: either classifier may make handling more restrictive; verifier failure cannot remove an existing non-`none` safety signal.
20. **Client-created sessions could point at arbitrary classroom/assignment ids, then the Admin resolver read those records without proving membership.** A known foreign classroom/assignment id could launder its strictness/grade/disclosure policy into the student's session. Resolver now requires deterministic active membership and exact assignment-to-classroom ownership; assignment-without-classroom is forbidden.
21. **Client session creation accepted arbitrary extra fields.** This includes server-looking/scoring fields such as `assignedDifficulty`, `endedWithSystemError`, or a forged completion timestamp. The rules hardening in this session constrains create keys/types/ranges and keeps server coordination collections client-inaccessible.
22. **`studentAttempts` historically copied the hidden transfer reference answer into an owner-readable document.** New persistence never copies the reference answer; it remains only in `transferProblems`.
23. **Transfer attempt persistence and transfer status update were separate writes.** A successful attempt write followed by status failure could leave the transfer pending and create duplicate evidence. Transfer evaluation now uses deterministic attempt id `<problemId>__evaluation` and batches the evidence write with `status: evaluated`.
24. **Transfer correctness provenance was mislabeled.** When local math is unsupported and the independent Gemini validator adjudicates, the source is now `validator`, not `evaluator`.
25. **Model-role fallback literals and obsolete Gemini sampling parameters had drifted.** Role defaults are centralized and audited 3.6 Flash calls omit ignored/deprecated sampling fields.
26. **Prompt/data concatenation mixed static instructions and untrusted data in several model calls.** Static system instructions and structured/untrusted user payloads are separated where audited.
27. **Mock provenance/schema drift existed.** Mock model names and extraction schema were aligned so test evidence cannot masquerade as live Gemini output.
28. **Production deploy omitted Firebase rules/indexes/storage while development/staging included them.** Production workflow was aligned.
29. **The session log index/history in Git is incomplete.** Missing historical logs were not fabricated.

## Self-audit incident during this session

While adding scoring provenance, an `update_file` operation was made after reading only a partial view of `lib/scoring/metrics.ts`. Because the GitHub contents API replaces the whole file, that edit accidentally truncated the lower part of the module. The mistake was detected immediately by comparing against the previous blob and the file was restored byte-for-byte before further scoring edits. No attempt was made to hide or rewrite this incident. After that point, long-file edits were preceded by full-blob verification or avoided where possible.

# Changes

## Gemini/model layer

- Centralized all six Gemini roles on the 3.6 Flash default resolver.
- Added/expanded `lib/ai/semantic-validation.ts` and structured semantic-validator types/prompts.
- Added Gemini semantic verification for classifier intent, post-enforcement tutor response, evaluator evidence, transfer answers, and image extraction.
- Preserved deterministic policy/security/schema/math boundaries.
- Made classifier safety merge monotonic.
- Removed stale role fallbacks and obsolete sampling configuration from audited calls.

## Tutoring route / transcript trust

- `app/student/session/[sessionId]/page.tsx`: removed direct client writes to `sessionTurns`; send only the API request and let the realtime listener receive server-authored turns.
- `app/api/session/chat/route.ts`:
  - server-authors current student turns,
  - removes duplicate-current-message context,
  - derives attempt type/objective from the task already delivered,
  - excludes tutor correction from evaluator input,
  - batches assistant turn + hint/session state,
  - batches safety assistant + session state,
  - clears recovered system-error state on successful response persistence,
  - serializes each session with a server lease,
  - reuses orphan student turns on retry,
  - reserves sequence numbers transactionally,
  - makes delivered transfer problems visible as exact validated assistant turns.
- `lib/session/turn-sequence.ts`: added server-only transactional turn-sequence allocator.
- `lib/session/request-lock.ts`: added cross-instance expiring per-session request lease.
- `lib/session/policy-inputs.ts`: filters legacy unmarked student turns and verifies classroom membership / assignment references before policy use.

## Scoring/evidence

- `lib/scoring/server.ts`: production scoring ignores legacy client-authored student turns.
- `lib/session/evaluation.ts`:
  - evaluator evidence requires independent semantic approval,
  - transfer validator provenance is explicit,
  - hidden transfer reference is no longer persisted into `studentAttempts`,
  - transfer attempt id is deterministic,
  - attempt + transfer evaluated status persist atomically.
- `lib/types/scoring.ts`: added `validator` correctness provenance.
- Transfer "planned" no longer equals transfer "issued" for scoring.

## Firestore / deployment

- `firebase/firestore.rules` hardening performed in this session includes server-only transcript writes, server-only turn counters/processing locks, and a constrained learning-session create schema so the browser cannot seed scoring/system fields.
- Production deployment workflow now deploys Firebase rules/indexes/storage as well as Cloud Run.

## Tests added/updated

- semantic validation safety monotonicity tests,
- classifier/tutor route trust-boundary tests,
- duplicate-current-message regression,
- previous-delivered-objective regression,
- server-authored transcript regression,
- orphan retry regression,
- busy session lease 409/no-model-work regression,
- transactional sequence allocator unit tests,
- session request lease unit tests,
- policy emulator tests for trusted transcript provenance,
- policy emulator negatives for foreign classroom, inactive membership, mismatched assignment, assignment-without-classroom,
- scoring emulator regression proving legacy forged student turns do not count,
- transfer persistence tests for deterministic id/atomic status and hidden-reference non-persistence,
- focused Firestore-rule tests for server-only session coordination and rejecting client-seeded scoring/system fields.

## Documentation

- Updated README, `.env.example`, deployment docs, PR description, and log index earlier in this continuous session for Gemini-first architecture and Cloud Run/Secret Manager behavior.
- This file is the canonical session record for the entire continuous audit, including work resumed after context compaction.

# Verification

## Executed / observed

- Repository code paths and trust boundaries were inspected through the connected GitHub repository.
- Regression tests were added alongside each major boundary change rather than relying on comments alone.
- The accidental `lib/scoring/metrics.ts` truncation was detected by blob comparison and restored immediately.
- PR remains draft; merge was intentionally not attempted.

## Not yet verified by execution

This execution environment did not provide a usable local authenticated checkout/`gh` workflow, and earlier outbound GitHub network access from the container failed. Therefore this log does **not** claim any of the following are green until GitHub Actions or a local-equivalent run reports it:

- lint,
- TypeScript typecheck,
- unit tests,
- Firestore rules tests,
- emulator integration tests,
- build,
- Playwright E2E,
- deterministic eval suite,
- live Gemini quality evaluation.

The final PR-head workflow/status must be checked again after the last code/doc commit. Any failure found there is part of this same session's follow-up, not evidence that should be silently ignored.

# Not done

- Full network-level request idempotency is not solved. The route safely reuses an orphan student turn after a failed model call, but if the server completed and persisted the assistant response and the client lost the HTTP response, resending the same text is indistinguishable from a deliberate repeated message without a client request/idempotency id.
- Historical client-authored session/attempt documents may already contain fields that new rules/code no longer create. New trusted loaders quarantine legacy student turns and new transfer attempts no longer leak references, but deployed historical data was not migrated from this repository-only session.
- `docs/progress.md` contains historical claims/links that are stale or missing evidence. This session must add a conservative current-session correction without rewriting historical evidence or changing percentages absent executed gates.
- Historical missing log files were not reconstructed.
- Live paid-model evaluation has not been rerun after the Gemini-first call expansion.

# Follow-ups

1. Run/inspect CI on the final PR head and fix any lint/type/test/rules/build regressions before marking ready.
2. Add a request id/idempotency key to the chat contract if full network retry deduplication is required.
3. Decide on a migration/quarantine policy for historical `studentAttempts` that may contain legacy hidden reference fields and historical session documents with client-seeded fields.
4. Wire any future teacher-assigned difficulty from teacher-owned `assignments`; never trust `learningSessions.assignedDifficulty` as an authority.
5. Run representative live Gemini evaluation with funded quota and measure the latency/cost increase from second-pass verification before production release.
