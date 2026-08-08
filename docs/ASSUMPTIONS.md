# Assumptions

Durable decisions taken in the absence of explicit instruction, and the constraints that
forced them. Add to this file whenever a session makes a new assumption; reference the
entry from that session's log per section 57.5.

Each entry states the assumption, why it was necessary, what it affects, and how to revisit
it. An assumption with no stated consequence is not useful.

- Structure: the eleven sections required by the Phase 0 exit criteria in section 49.
- Last verified: **2026-08-07** by session
	[15-phase-11-acceptance](logs/2026-08-07-15-phase-11-acceptance.md).
- Everything below marked "verified" was checked by running a command or reading a file in
	the session named above. Anything not checked is marked `UNVERIFIED` per section 57.4.

---

## 1. Architecture and environment

| # | Assumption | Reason | Affects | Revisit when |
|---|---|---|---|---|
| A1 | The Next.js application lives at the repository root rather than in `apps/web`, and there is no package workspace | The project was created in an AI Studio container whose preview server runs the root `package.json`. A workspace root would need a custom start script | Section 27's monorepo layout. Uses the single-application variant in patch 4d of `INSTRUCTION-AUDIT.md` | The app moves to a host that can run a workspace, or a second deployable is added |
| A2 | The AI gateway is a Next.js route handler (`app/api/session/chat/route.ts`), not a separate Cloud Run service | Same container constraint; a second service is unreachable from the preview environment | Sections 26, 29. Every section 29 requirement still binds the route handler; adapting the shape does not discharge them | A separate gateway is deployed, at which point `AI_GATEWAY_BASE_URL` and `AI_GATEWAY_SHARED_SECRET` become live |
| A3 | Logical boundaries are preserved without packages: prompts in `services/ai-gateway/src/prompts/`, policy in `services/ai-gateway/src/policy/`, scoring in `lib/scoring/` | Those boundaries are the point of section 27; the directory nesting is not | Section 53's rule against prompts in route handlers | A package workspace is introduced and these become real packages |
| A4 | npm is the package manager, not pnpm | `package-lock.json` is the lockfile present, and the container provides npm | Section 47, which is written in `pnpm` commands. Read every `pnpm x` as `npm run x` | The repository moves to pnpm, which requires rewriting section 47 |
| A5 | Node's version is whatever the container provides; no `.nvmrc` and no `engines` field pins it | Never specified | Reproducibility of a clean install. `UNVERIFIED`: the exact Node version was not recorded | Section 48 CI is written, which must pin a version explicitly |
| A6 | Firestore is the only datastore, and `firebase-applet-config.json` is read directly for client config rather than `NEXT_PUBLIC_*` variables | The container injects that file. The env variables exist in `.env.example` for deployment elsewhere | Sections 28 and 46. Two config sources for the same values is a drift risk | The app is deployed outside AI Studio |
| A7 | Roles live in Firestore `users` documents rather than in custom auth claims | Custom claims need a privileged writer, and no Cloud Function or credentialed server path exists | Rules resolve `role` with a `get()` per evaluation, which costs a document read. Section 39's "admin access must require secure claims" is therefore **not** met as written | ADC becomes available and a claim-setting path can exist |

## 2. Security assumptions

Stated plainly, including the gaps. An unrecorded security gap is worse than a known one.

| # | Assumption | Reason | Risk if wrong | Compensating control |
|---|---|---|---|---|
| S1 | ~~Policy inputs are not server-authoritative.~~ **CLOSED 2026-08-06, session 08.** Every policy input is read server-side; the request body carries only `sessionId` and `message` | The recorded prerequisite ("ADC for server-side Firestore reads") was wrong. `adminDb` already read `learningSessions` in the same route and worked against the emulator | -- | `lib/session/policy-inputs.ts` resolves `strictness`, `grade` and assignment policy through `assignments` -> `classrooms` -> `studentProfiles`, deliberately **not** through `learningSessions`, because the browser writes that document and a server-side read of a client-written field is laundered client input. `chatRequestSchema` is `.strict()` and rejects the fields outright. Proven by 22 unit tests, 10 emulator integration tests, and E2E check "a body carrying strictness and a high hint level is refused, not clamped" (400). **P0-1 closed** |
| S2 | Authorization rests on Firestore rules plus ID-token verification at the endpoint, not on server-side ownership reads inside route handlers | Rules enforce ownership without credentials; a route handler cannot read Firestore without them | A future endpoint that writes without a matching rule would have nothing else stopping it | 45 emulator rules tests pass (verified, `npm run test:rules`). Every section 28 collection has a scoped rule; matrix in `docs/SECURITY-RULES-MATRIX.md` |
| S3 | ~~Model output is not revalidated server-side.~~ **CLOSED 2026-08-06, session 08.** Both model outputs are revalidated with Zod after generation, and the plan is enforced in code | Section 41.1 requires it, and it needed no credentials | -- | `lib/types/ai/model-output.ts`. `enforceResponsePlan` withholds the model's prose rather than only rewriting the metadata, because a response that discloses the answer has already done so in `messageMarkdown`. 24 tests drive real malformed, truncated and overshooting payloads. **P0-3 closed** |
| S10 | The tutor-side revalidation and enforcement have not been exercised on **live** model output | The free-tier Gemini quota is 20 requests per model per day and a turn spends two; it was exhausted during this session's walk | An enforcement bug specific to real model output would not yet have been observed. The logic is exercised by 24 unit tests on hand-written malformed and overshooting payloads, which is stronger coverage than one live turn would give, but it is not the same evidence | The Firestore half of the path **is** confirmed live: the server log shows a real authorized request reaching the tutor call, which is after ownership resolution, the trusted read chain, the transcript read, classifier revalidation and the policy engine. Marked `UNVERIFIED` in session log 08 |
| S11 | The assignment tier of the policy chain is proven by seeded documents, not by a user journey | Nothing in the product creates an `assignments` document yet; Phase 6 owns assignment creation | A field-name mismatch between what a future teacher UI writes and what the resolver reads would resolve silently to the classroom default rather than failing loudly | 10 emulator integration tests seed real assignment documents through the Admin SDK and assert precedence, including that an assignment belonging to a different classroom is ignored |
| S12 | ~~The policy engine's low-extraction-confidence rule (section 18 R6) has no producer.~~ **CLOSED 2026-08-07, session 11.** `lib/session/policy-inputs.ts` reads `problemImages/{id}` and supplies `extractionConfidence`, and the chat route passes it to `generateResponsePlan` | Phase 7 built the producer. This entry was correct that the rule was dead code, and it was the most useful line in this file: it named the gap precisely enough that closing it was the first thing Phase 7 did | -- | 13 unit tests drive the real resolve-then-plan sequence rather than the pure branch, and 10 emulator integration tests prove the Firestore read exists. Both were necessary: the pure-function tests passed for three phases while the rule was unreachable |
| S13 | Extraction confidence and confirmation state are server-authoritative and live on `problemImages`, which no client may write | They decide whether tutoring may begin (R6), which places them on section 41.1's never-trusted list. A confidence on the client-written session document would be laundered client input, the same defect as S1 | A client that could write either would skip the confirmation step section 34 requires and have the tutor work on unchecked text | `allow write: if false` on `problemImages`, with 9 rules tests including forged-confidence, forged-confirmation and forged-document negatives. Live: a student's direct PATCH raising `extractionConfidence` returns **403**, and a confirm body carrying the field returns **400** rather than being clamped |
| S14 | Image MIME type is validated by sniffing leading bytes server-side, not from the extension, the declared `Content-Type`, or the Storage `contentType` | The Phase 7 exit criterion requires validation from file content. All three of those are strings the client chooses, and Storage rules cannot read bytes | A file that is not an image could reach the multimodal model, or be stored and later served as an image | `lib/images/validation.ts`, 23 unit tests. Live: a PDF named `.png` and declared `image/png` is refused with `UNSUPPORTED_FORMAT`, and a real PNG declared `image/jpeg` is refused with `DECLARED_TYPE_MISMATCH` |
| S15 | GIF and WebP metadata is **not** stripped. JPEG EXIF and PNG text chunks are | Both are rewritten by copying surviving segments, which keeps them decodable without re-encoding. GIF and WebP would need container rewriting this module does not do | A GIF or WebP carrying identifying metadata is stored with it intact | `stripImageMetadata` returns `stripped: false` for those formats and the stored document records it, so the gap is visible rather than assumed away. A test asserts the honest report |
| S4 | Teachers have no client-side read path to student transcripts, deliberately | A blanket teacher read over `sessionTurns` previously existed and was removed. Aggregate analytics belongs on a server path with an audit trail | Phase 6 analytics cannot be built client-side. That is intended | Rules test "a teacher cannot read a student transcript through client rules" (verified) |
| S5 | Join-code lookup and membership creation are server-only; lookup documents store a digest, not the shareable code | Client SDK rules cannot safely resolve a secret without exposing a read oracle. The server route can verify the ID token, rate-limit attempts, hash the submitted code, and create the deterministic membership under Admin credentials | A leaked classroom code remains usable until rotated, but repeated guesses no longer receive a client-readable lookup response and the digest is not the code | **CLOSED 2026-08-07, session 15.** `POST /api/classrooms/join` verifies the token, applies per-user and per-IP limits, hashes the normalized code, reads the digest under Admin credentials and writes membership. Classroom creation generates the code server-side and stores it in `classroomJoinCodeSecrets`, unreadable by clients. Rules deny all client reads/writes to both collections. `tests/rules/firestore-rules.test.ts` has 118 passing tests, including client denial; `tests/security/join-code.test.ts` covers canonicalization and non-reversibility |
| S6 | ~~No rate limiting exists on any endpoint.~~ **CLOSED 2026-08-07, session 12.** Both AI endpoints are limited per user and per IP by `lib/security/rate-limit.ts` | Phase 8 built it. Firestore-backed rather than in-process, because Cloud Run scales horizontally and a per-instance `Map` would grant the quota once per warm instance | Residual: the per-IP half derives its key from `x-forwarded-for` and is therefore a mitigation, not a control. See S16 | 9 emulator tests including atomicity (10 concurrent callers against a limit of 4 yield exactly 4 successes) and window rollover; 3 endpoint tests proving a refused request spends no model call; 2 rules negatives proving the counter is neither client-readable nor client-writable |
| S7 | App Check is **not** configured. Recorded here with the exact manual steps, which is the second branch the Phase 8 criterion permits | Needs a deployed Firebase project and a reCAPTCHA Enterprise registration; neither exists (section 9) | The endpoints accept requests from any client holding a valid ID token, including a scripted one. This is also the only available control for client-SDK reads such as the join-code lookup (S5) | Wiring ships inert in `lib/firebase/app-check.ts` and activates as soon as a key is present, so this becomes a deployment step rather than a development task. 5 unit tests cover the branches, including that the repository's real state reports `not_configured`. **Manual steps:** (1) create a Firebase project and register the web app; (2) in Google Cloud console enable reCAPTCHA Enterprise and create a **website** key for the deployed domain; (3) paste that key into `recaptchaSiteKey` in `firebase-applet-config.json`; (4) in Firebase console under App Check, register the web app with the reCAPTCHA Enterprise provider; (5) leave enforcement in monitoring mode until the metrics page shows verified traffic, then enable enforcement per service for Firestore, Storage and Authentication. **Blocks:** the Phase 8 App Check criterion, and the section 41 mitigation "use App Check" |
| S8 | Markdown from model output is non-executable because `react-markdown` is used without `rehype-raw` | `react-markdown` escapes raw HTML by default | Adding `rehype-raw` later would make XSS through model output reachable | Still `UNVERIFIED` by test at the component level. A second layer was added in session 12: a Content Security Policy in `next.config.ts` with `object-src 'none'`, `frame-ancestors 'none'` and an explicit `connect-src`, so the mitigation no longer rests on one dependency default. See threat 8 in `docs/THREAT-MODEL.md`, including why `style-src` must keep `'unsafe-inline'` for KaTeX |
| S9 | ~~`auditLogs` is `allow read, write: if false` and nothing writes it.~~ **CLOSED 2026-08-07, session 10**, and extended in session 12 | `lib/audit/audit-log.ts` is the writer. Session 12 added the safety-review callers, so all five section 28 privileged actions now have a caller except `role_change` and `policy_change` | Residual: `role_change` and `policy_change` remain modelled but uncalled, because neither action has a UI | An emulator test reads an entry back with actor, action, target, reason and `createdAt` intact; 3 rules negatives cover client read, forged write and delete |
| S16 | The per-IP rate limit is a mitigation, not a security boundary | `NextRequest` exposes no trustworthy client address, so the key comes from `x-forwarded-for`, which a client can set unless a trusted proxy overwrites it. Section 41.1: clamping is a mitigation, not a source of truth | A determined attacker rotates the header and defeats the IP half. The per-user half, keyed on the uid from a verified ID token, is unaffected | Stated as a limitation in `lib/security/rate-limit.ts` and as threat 11 in `docs/THREAT-MODEL.md` rather than described as secure. A deployment behind Cloud Run should confirm the platform overwrites the header |
| S17 | The rate limiter **fails open**: if Firestore is unreachable the request is allowed and the failure is logged | It is an abuse control, not an authorization control. Every authorization check on these endpoints has already run and does fail closed. Failing closed here would turn a Firestore blip into a total tutor outage for legitimate students | During a Firestore outage there is no rate limit, so model spend is unbounded for the duration | Deliberate and reviewable: `checkRateLimit` returns `unavailable: true` and logs at error level. Recorded under threat 11. This is the only control in the codebase that does not fail closed, and it is named as such |
| S18 | No safety hotline or emergency number ships, in any locale | Section 24 forbids inventing emergency numbers and forbids shipping unverified placeholder hotline information. Nothing in this environment can verify a number for any jurisdiction, and a wrong crisis number is worse than none: it consumes the one moment a student reached out | A student in crisis receives guidance to contact a trusted adult and local emergency services, but no specific number | `getSafetyResources` withholds any contact that is not marked verified with a recorded reviewer and date, and `looksLikePlaceholder` refuses stand-in strings even when marked verified. 11 tests, including one that walks the real configuration and one asserting no emergency number is configured. Adding real contacts is documented in `docs/MINOR-SAFETY.md` |

## 3. Credential availability

How availability was checked, not assumed.

| Credential | Available? | Verified how | Blocks |
|---|---|---|---|
| Application Default Credentials for the Admin SDK | **No** | `Test-Path $env:APPDATA\gcloud\application_default_credentials.json` returned `False` this session | Server-side Firestore reads (P0-1), server score writes to `independenceSnapshots` (Phase 5), any `auditLogs` writer (Phase 6/8) |
| Service account JSON | **No** | No key file in the repository. `lib/firebase/admin.ts` calls `initializeApp` with only `projectId` and `storageBucket`, so it relies on ADC | Same as above |
| `GEMINI_API_KEY` | **Yes, free tier** | Confirmed working 2026-08-06 (session 07): live `POST /api/session/chat` returned 200 twice against the emulators. The key is free tier, and the third call failed `429 RESOURCE_EXHAUSTED` with `limit: 20` on `generate_content_free_tier_requests` | Nothing outright. Caps live AI verification at roughly 20 requests per model per day, which is **10 tutoring turns** since each turn spends one classifier and one tutor call |
| Deployed Firebase project | **No** | No `.firebaserc`. `npm run test:rules` runs against the emulator with synthetic project id `thinkfirst-rules-test` | Phase 10, App Check, live verification of rules |
| Firebase CLI authentication | **No** | `npm run test:rules` printed "You are not currently authenticated so some features may not work correctly" and still passed, because the emulator needs no auth | Any `firebase deploy`. Does **not** block emulator tests |
| reCAPTCHA Enterprise site key | **No** | `firebase-applet-config.json` carries an empty `recaptchaSiteKey` | S7, the Phase 8 App Check criterion |
| Cloud Run / App Hosting credential | **No** | No deployment configuration in the repository | Phase 10 |

### 3.1 Daily model quota as a verification constraint

The free-tier ceiling is a measurement constraint rather than a defect, and it has already
changed how one criterion was proven. Recorded here so the next session budgets for it
instead of rediscovering it mid-walk.

- **Observed limit.** 20 `generateContent` requests per model per day. A single tutoring
	turn costs two, so a session gets about 10 live turns across all verification work.
- **What it blocked, 2026-08-06.** Walking the hint ladder above level 0 needs at least
	two successful turns: one refused for want of an attempt, one granting a hint. The
	second returned 500 on a `429`, so the climb could not be walked.
- **How that criterion was met anyway.** Deterministically, in
	`tests/api/session-hint-progression.test.ts`, which drives `resolveSessionHintLevel`,
	`generateResponsePlan` and `nextHintLevel` in the endpoint's own order and asserts the
	persisted sequence `[1,2,3,4,5,6,6,6]`. The server's ownership of the write is
	independently confirmed by `updatedAt` appearing on the session document, which only the
	Admin write sets.
- **Affects.** Section 37 release gates, which want a >=100-case evaluation run. At 20
	requests per day that is unreachable on this key regardless of budget for engineering
	time. Phase 9 and Phase 11 both depend on it, and both already carry `[!]` rows.

## 4. Server-side credential model

- The client SDK is initialized from `firebase-applet-config.json` (`lib/firebase/config.ts`) and can be pointed at emulators with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true`.
- The Admin SDK (`lib/firebase/admin.ts`) is initialized with `projectId` and `storageBucket` only, so it depends on **Application Default Credentials**, which are absent here.
- Operations that consequently fail in this environment, named specifically:
	- `adminAuth.verifyIdToken`, so `verifyRequest` returns `verificationUnavailable` and the tutoring endpoint answers **503**. The endpoint refuses to serve rather than guessing, which is the correct failure direction.
	- Any `adminDb` read, which is why policy inputs are clamped instead of read from `learningSessions` (S1).
	- Any `adminDb` write, which is why `independenceSnapshots` and `auditLogs` have no writer (S9).
- Operations that work without a credential: the whole client SDK path against emulators, all pure logic in `lib/scoring/` and `services/ai-gateway/src/policy/`, and the emulator rules tests.
- Consequence worth stating plainly: with no ADC, **the tutoring endpoint cannot serve any authenticated request on this machine.** No session may claim the chat flow was verified end to end here.

## 5. Trust boundaries

Summary of the section 41.1 review as it stands. Per-path reviews live in
`docs/IMPLEMENTATION-PLAN.md`; the per-collection matrix lives in
`docs/SECURITY-RULES-MATRIX.md`.

| Value | Read server-side today? | Arrives from client? | Policy-relevant? |
|---|---|---|---|
| Caller identity (`uid`) | Yes, from the verified ID token | Bearer token only | Yes, it is the basis of every ownership check |
| `role` | No route handler reads it; rules read `get(users/{uid}).data.role` | No | Yes |
| Session ownership | In rules, via `learningSessions.studentId` | `sessionId` does, and the route handler does not verify it | Yes |
| `mode` | **No** | Yes | **Yes** — S1 |
| `strictness` | **No** | Yes, clamped upward | **Yes** — S1 |
| `currentHintLevel` | **No** | Yes, clamped down | **Yes** — S1 |
| `grade`, `subject`, `language` | **No** | Yes | Yes, they shape the tutor prompt |
| `originalProblem`, `priorTurns` | **No** | Yes | Indirectly: the conversation the model sees is client-asserted |
| Assignment policy | Not implemented | No | Yes, once Phase 6 lands |
| Independence Score | Computed in the browser | No | A trusted value derived in an untrusted place — Phase 5 |
| `policyVersion`, `scoringVersion` | Stamped by the server on the policy decision, and also written by the client onto session documents | Yes, on session create | Provenance |

Two conclusions to carry into Phase 4: everything deciding disclosure is still
client-supplied, and the only reason the blast radius is small is clamping.

## 6. Deployment environment

### Section 33's image upload contract, adapted (session 11)

Section 33 specifies `POST /v1/problem-images/upload-url`, a signed-URL flow.
Implemented instead as a direct upload to `POST /api/problem-images`, under
router priority level 6, which permits adapting an architecture recommendation
with a recorded reason.

Two reasons, and the second is the stronger one:

1. Signing a URL with the Admin SDK needs a service-account signer. This machine
	has none (section 3).
2. A signed URL puts the object in the bucket **before** any server code sees its
	bytes. The Phase 7 exit criterion requires the MIME type to be validated from
	file content, and Storage rules cannot read bytes, so the bytes must reach the
	server regardless. Validating first and writing second means a rejected file is
	never stored, rather than stored and then cleaned up by a process that might
	not run.

The requirements attached to the original component still bind this one: the
object is private, access is authorized, the type is content-validated, and size
and dimensions are bounded.

- Target per section 26: Firebase App Hosting or Cloud Run. **Nothing is deployed**, and no `.firebaserc`, Dockerfile, or cloud project exists. CI/CD configuration now exists in `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`; deployment documentation is in `docs/DEPLOYMENT.md`. The workflows have not run because no remote repository or cloud credentials exist.
- Development runs locally with `npm run dev` on port 3000. Emulators come from `firebase.json`: auth 9099, Firestore **8085** rather than the default 8080, storage 9199.
- Region assumed `us-central1` from `.env.example`. Not exercised.
- Works locally but unproven when deployed: Admin SDK credentials, App Check, Storage rules, and the tutoring endpoint under real credentials.
- The build script was `"NODE_ENV=production next build"`, POSIX shell syntax that **failed outright** on Windows with "'NODE_ENV' is not recognized as an internal or external command" and exit 1. Corrected to `"next build"` this session, because `next build` already sets production mode; `npm run build` now exits 0 (verified). Recorded because it means no prior session on Windows could have run the build it claimed to run.

## 7. Data retention and privacy

Nothing here is a compliance claim. Section 25 requires `PRIVACY-DESIGN.md`,
`DATA-RETENTION.md`, `THREAT-MODEL.md` and `MINOR-SAFETY.md`; those documents now
exist, but their statements remain design documentation rather than a certification.

- Retention: indefinite. No TTL, no scheduled deletion, no retention configuration.
- Deletion: no account deletion or classroom removal path. `learningSessions` has `allow delete: if false` and turns are immutable, so a student currently cannot delete their own work at all.
- Export: no student data export path.
- Consent: no consent capture and no jurisdiction configuration. Section 24's consent-ready architecture is not started.
- Minors: the product targets school students, so most users are presumed minors. That presumption is what makes S6 and S7 more serious than they would otherwise be.
- Chain-of-thought is not stored, per section 53. `UNVERIFIED` by test; asserted from reading the endpoint, which persists only the structured response.
- Anything beyond this needs jurisdiction-specific legal review, which has not occurred.

## 8. AI behavior: mock versus production

- Real model calls exist on exactly one path: `app/api/session/chat/route.ts`, which calls the classifier and then the tutor through `@google/genai`.
- **No test calls a live model.** As of session 08 the suite is 195 unit, 81 rules and 10 emulator integration tests (`tests/api`, `tests/auth`, `tests/env`, `tests/integration`, `tests/markdown`, `tests/policy`, `tests/rules`, `tests/scoring`).
- There is still no mock provider, so the two `generateContent` calls themselves are not covered. Everything on either side of them now is: the trusted input resolution, the policy decision, the revalidation of model output, and the plan enforcement are all tested directly against hand-written payloads, including malformed and plan-violating ones. Section 26's dependency-injection requirement for AI providers remains unmet.
- Behavior differs between environments in one way that matters: without ADC the endpoint returns 503 before reaching the model, so local runs without credentials exercise only the failure path.

### Section 18 ambiguities resolved in session 08

Section 18 prefixes its rules with "Example rules" and contains no mode x strictness x hint-level matrix. Two points required a decision, and deriving them is a design act rather than an extraction, so both are recorded here.

| # | Ambiguity | Resolution | Reason |
|---|---|---|---|
| P1 | R1 reads `IF mode = assessment-safe`, but `assessment_safe` is a **strictness** value in module 02 section 9, and modes are `learn`, `practice`, `assignment`, `verify` | Implemented as strictness | R2, in the same block, uses `mode` and `strictness` correctly as separate fields, so R1's wording is a slip rather than a second dimension. Reading it literally would make the rule dead, since no mode has that name |
| P2 | Section 18 never states whether hint level 7 is reachable by progression. It previously was not: escalation stopped below 6 and the only branch that set 7 could never fire | Levels 0-6 by progression, level 7 only when `mayRevealFinalAnswer` is true, and only on a turn *after* the ceiling was already reached | This is the resolution recommended by `INSTRUCTION-AUDIT.md` row P3. Testing the post-progression level instead would let one turn move 5 -> 7, violating R4's "increase by at most 1"; that bug was written, caught by the new test, and fixed |

`policyVersion` moved from `policy-v1` to `policy-v2` because these changes alter decisions for existing sessions.

### Section 56.5 requirements not met in session 09

Two of section 56.5's process requirements could not be satisfied when `scoring-v2` was
implemented. Both are recorded here rather than quietly skipped, per the router's rule that a
`should` needs a written reason.

| # | Requirement | Status | Reason and consequence |
|---|---|---|---|
| S12 | "Run both versions in parallel over the evaluation dataset (section 37) before switching the displayed value, and record the score delta distribution" | **Not met** | There is no evaluation dataset; section 37 is Phase 9 work. The displayed value was switched anyway, deliberately. `scoring-v1` is the algorithm §56.1 documents as awarding **100 to a session that disengaged early** and **100 to a transcript with no recorded hint levels**; leaving that in front of students to satisfy a process requirement would be the worse failure. The delta distribution is unmeasured, so the size of the change is unquantified. Reasoning from the model rather than from data, a previously perfect thin record now lands near 59 |
| S13 | "When the displayed score changes because the algorithm changed, say so in the UI" | **Not met, and not yet owed** | No `scoring-v1` snapshot exists in any environment, because nothing ever wrote one: the collection had no server writer before this session. So no student has a score that could visibly change. The copy is required before any deployment carries real history across a version change |

Snapshot ids embed the scoring version (`<sessionId>__scoring-v2`), so §56.5's "do not mutate
existing v1 snapshots" holds structurally rather than by convention. The forward-recompute
path is consequently untested, since there is no v1 data to recompute from.
- Model ids come from `GEMINI_TUTOR_MODEL` and `GEMINI_CLASSIFIER_MODEL` with **hardcoded literal fallbacks** (`gemini-2.5-pro`, `gemini-3.5-flash`) in the route handler. Audit patch 4c forbids exactly this, because a stale fallback survives a model upgrade silently. Open defect.
- **Correction, session 09.** The line previously here said `GEMINI_VALIDATOR_MODEL` still sat in `.env.example` as the Phase 5 marker. It does not: session 05 deleted it, and session 05's own log records that. Phase 5's validation requirement is met by `lib/math/validation.ts`, which is deterministic code rather than a model call, so no such variable is needed.
- Session 09 added `GEMINI_EVALUATOR_MODEL` and `GEMINI_TRANSFER_MODEL`, both documented in `.env.example` and both optional. They extend the hardcoded-fallback defect above rather than fixing it: the evaluator falls back to `gemini-3.5-flash` and the transfer generator to `gemini-2.5-pro`, both literals in `lib/session/evaluation.ts`. Four model ids now carry stale-fallback risk instead of two.
- A tutoring turn now makes up to **four** model calls: classifier, tutor, evaluator, and transfer generation when the plan requires it. On the free tier's 20 requests per day that is roughly five turns, which is why live end-to-end verification keeps failing on quota rather than on code.

## 9. External infrastructure that cannot be provisioned

| Item | Why it cannot be provisioned here | Manual steps to complete it | Acceptance criteria blocked |
|---|---|---|---|
| Application Default Credentials | Requires an interactive `gcloud auth application-default login` against a real project, and no project exists | Create the Firebase project, then `gcloud auth application-default login`, or place a service-account key and set `GOOGLE_APPLICATION_CREDENTIALS` | Phase 4 server-authoritative inputs (P0-1); Phase 5 server score writes; Phase 6 audited analytics; section 51 privacy criteria |
| Deployed Firebase project | No console access from this environment | Create the project; enable Auth (Google provider), Firestore, Storage; add `.firebaserc`; `firebase deploy --only firestore:rules,storage` | Phase 10 entirely; live verification of rules |
| App Check with reCAPTCHA Enterprise | Needs a project and a site-key registration | Register the site key, set `recaptchaSiteKey`, enable enforcement per service | Phase 8 App Check criterion; section 41 abuse mitigations |
| Cloud Run or App Hosting target | No deployment credential | Provision the service, put `GEMINI_API_KEY` in Secret Manager, wire the pipeline | Phase 10; section 48 |
| Model budget for the section 37 gates | 100 or more evaluation cases against a live model needs a funded key | Fund a key, then run the suite once it exists | Section 37 release gates; Phase 11 |
| Version control | This working copy has **no git history at all**: `git status` reports "not a git repository" | `git init`, commit, add a remote | Phase 10 CI cannot run without a repository. Also removes `git revert` as a recovery path, so rollback plans are written as forward-fixes |

## 10. Features deferred due to environment limitations

Deferred-for-environment is a constraint. Not-yet-built is remaining work and belongs in
`docs/IMPLEMENTATION-PLAN.md`. Only the first kind is listed here.

| Feature | Section | Reason deferred | Acceptance criteria affected | Prerequisite |
|---|---|---|---|---|
| Server-authoritative policy inputs | 29, 41.1 | No ADC, so a route handler cannot read `learningSessions` | Phase 4 criterion 2; P0-1 | ADC or a service account |
| ~~Server-computed score persisted to `independenceSnapshots`~~ | 39, 56 | **Row withdrawn, session 09.** This was never blocked. The stated prerequisite was ADC, but the Admin SDK reaches the Firestore emulator without it, as session 08 had already demonstrated on the same code path. Implemented and verified by 10 emulator integration tests | Phase 5 criteria 1 and 2, both now met | None. The prerequisite was recorded in error |
| `auditLogs` writer | 41 | Same | Phase 8 audit criterion; S9 | ADC |
| App Check | 25, 41 | No project, no reCAPTCHA registration | Phase 8 | Firebase project |
| Live evaluation suite run | 37 | No funded key, and no suite yet | Section 37 gates; Phase 11 | Budget plus Phase 9 work |
| CI pipeline execution | 48 | No git repository in this environment | Phase 10 | A git remote |

## 11. Assumptions affecting acceptance criteria

| Assumption | Criterion affected | Effect |
|---|---|---|
| S1 | Section 51 AI behavior; Phase 4 criterion 2 | Cannot be met without ADC |
| S3 | Phase 4 criteria 4 and 5 | Unmet, and **fixable now with no credential**. Must not be deferred behind S1 |
| S2 | Section 51 privacy and security | Substantially met for client access paths, with 45 negative tests. Not met for server paths, which barely exist |
| S5 | Section 39, join codes not in plain text | **Closed 2026-08-07, session 15.** Server-only join and classroom-creation routes store only a digest in the lookup collection; client rules deny lookup and secret access, with 118 rules tests and two helper tests |
| S6 | Section 51 security; section 41 abuse | Unmet. Fixable now |
| S7 | Phase 8 App Check | Unmet. Needs a project |
| S9 | Section 41 audit logging | Unmet, blocked on ADC |
| A7 | Section 39, admin access via secure claims | Unmet as written; roles are Firestore documents, not claims |
| Section 7 documents absent | Section 25 | Four required documents missing. Fixable now; they are prose, not infrastructure |
| Credential rows 1-2 | Phases 4, 5, 6; section 51 privacy | The largest environmental blocker in the project |
| Section 9 row 5 | Section 37 release gates | Cannot be measured here. Phase 11 must report them blocked, not passing |
| No mock provider (section 8) | Section 51 quality, integration tests | The AI orchestration path has no automated coverage. Fixable now by injecting the provider |
| Model-name literal fallbacks | Patch 4c; Phase 1 configuration reality | Fixable now |

The honest summary: of the items above, **eight are fixable in this environment today** and
five genuinely need credentials or a project. A session that treats all of them as
environmentally blocked is overstating the constraint.
