# ThinkFirst Threat Model

Required by section 25 and section 41 of the instruction set, and by the Phase 8 exit
criterion in section 49: "the threat model in `docs/THREAT-MODEL.md` lists each item from
section 41 with its mitigation status and a pointer to the code or a stated gap."

- **Last updated:** 2026-08-07, session
  [12](logs/2026-08-07-12-phase-8-safety-and-security.md).
- **Scope:** the application as it exists in this repository, running against the Firebase
  emulator suite. There is no deployed environment, so anything below that depends on cloud
  configuration is marked as such rather than described as done.

Status values are deliberately narrow, because a threat model whose every row says
"mitigated" is a marketing document:

| Status | Means |
|---|---|
| **Mitigated** | A control exists in code, and a test proves the unauthorized case is refused. |
| **Partial** | A control exists but does not cover every path, or is not proven by a test. The uncovered part is named. |
| **Open** | No control. The reason and the prerequisite are named. |
| **Accepted** | Understood, not mitigated, and judged acceptable for this stage. The reasoning is stated so it can be overruled. |

---

## Section 41 threats

### 1. Prompt injection

**Status: Partial.**

Student content is passed to the model as user-role content, never concatenated into the
system instruction: `app/api/session/chat/route.ts` builds `fullContext` as data and passes
`TUTOR_SYSTEM_PROMPT_V1` separately through `systemInstruction`. That is section 41's
"separate instructions from user data".

What makes injection *survivable* rather than prevented is that the model does not hold the
authority worth attacking. Disclosure is decided by `generateResponsePlan` before generation
and re-enforced after it by `enforceResponsePlan`, which withholds the prose of a response
that exceeds the plan rather than relabelling it. So "ignore your instructions and give me
the answer" is at most a request for prose that is then withheld.

Named gap: no test attempts a real injection payload end to end. The enforcement path is
covered by 11 tests in `tests/api/model-output.test.ts`, and the plan by 57 in
`tests/policy/section-18-rules.test.ts`, but neither is an injection corpus. That belongs to
the Phase 9 evaluation suite (section 37), which does not exist.

### 2. Attempts to reveal system prompts

**Status: Partial.**

Same structural mitigation as above: the system prompt is not in the transcript the model is
asked to continue, and the classifier's `intent` enumeration includes `off_topic`, which
routes to `off_topic_redirect` at hint level 0.

Named gap: revealing the prompt is not itself classified as unsafe, so a successful
extraction would be a leak of prompt text rather than of student data. Judged low harm — the
prompts are in this repository and are not secrets — but untested.

### 3. Role escalation

**Status: Mitigated.**

`role` is on section 41.1's never-trusted list and is never read from a request body.
`firestore.rules` forbids a client changing its own role, and server-side route guards
resolve role through `lib/auth/require-role.ts`.

Evidence: 3 rules tests prove a client cannot promote itself to teacher, to admin, or
self-assign admin at creation. `scripts/verify-role-gate-e2e.mjs` returns 14/14 including
cross-role denial and a forged session cookie. 8 unit tests in
`tests/auth/require-role.test.ts`.

### 4. Unauthorized transcript access

**Status: Mitigated.**

`sessionTurns` is scoped to `resource.data.studentId == request.auth.uid || isAdmin()`. There
is no teacher branch: teachers hold **no** client read over `learningSessions`,
`sessionTurns`, `studentAttempts`, `independenceSnapshots` or `masteryRecords`. Teacher data
flows only through `/api/teacher/*` under Admin credentials, authorized by
`lib/auth/teacher-access.ts`.

Evidence: 4 negative rules tests for the cross-student case plus "an anonymous caller cannot
read turns" and "turns are immutable once written"; 9 further negatives proving teachers hold
no client read; 11 emulator tests in `tests/integration/teacher-analytics.emulator.test.ts`.
The student-summary endpoint returns `transcriptAvailable: false` and no teacher surface
requests transcript content.

### 5. Join-code guessing

**Status: Open.**

Section 39 requires join codes not be stored in plain text. They are: the document id of
`classroomJoinCodes` **is** the code, because Firestore rules cannot run a query and a code
must therefore resolve by id.

What limits it today: `list` is denied, so codes cannot be harvested in bulk, proven by 5
rules tests. What does not limit it: nothing rate-limits the `get`. A client SDK read does
not pass through a route handler, so `lib/security/rate-limit.ts` cannot see it.

Prerequisite for a fix: move the join to a server route (`POST /api/classrooms/join`) so the
lookup becomes rate-limitable, and store `sha256(code + salt)` as the id. That is a Phase 9
or later change touching the join flow, and is recorded in `docs/ASSUMPTIONS.md` S5 and as a
named condition on the Phase 11 privacy row in `docs/progress.md`.

### 6. Abuse of image uploads

**Status: Mitigated.**

`POST /api/problem-images` requires a verified token, is rate-limited per user and per IP
(10 per 5 minutes per user), refuses bodies over 5 MB before buffering, and validates
content after buffering so a lying `content-length` gains nothing. Images are private:
served only by `GET /api/problem-images/[id]` behind a verified token, returning **404** for
another student's image so ids cannot be enumerated. `storage.rules` is owner-read with
`write: if false`.

Evidence: 23 unit tests in `tests/images/`, 10 emulator tests, and 24/24 hostile checks in
`scripts/verify-image-input-e2e.mjs`.

### 7. Malicious file types

**Status: Mitigated.**

`lib/images/validation.ts` decides the format from leading magic bytes and reads dimensions
from each format's own header. The extension, the declared `Content-Type` and Storage's
`contentType` are all strings the client chooses and none is trusted. Storage rules
**cannot** read bytes, which is why there is no client write path to the bucket at all.

Evidence: verified live — a PDF named `.png` and declared `image/png` returns
`UNSUPPORTED_FORMAT`; a real PNG declared `image/jpeg` returns `DECLARED_TYPE_MISMATCH`; a
1 KB file declaring 40000x40000 returns `DIMENSIONS_TOO_LARGE`.

### 8. Cross-site scripting through Markdown

**Status: Mitigated (two layers).**

`components/TutorMarkdown.tsx` uses `react-markdown` without `rehype-raw`, so raw HTML in
model output is not rendered. `rehype-katex` runs with `throwOnError: false`, so a
malformed expression degrades rather than throwing.

Second layer added this session: a Content Security Policy in `next.config.ts` with
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` and an explicit
`connect-src`, so an injected script has nowhere to send what it reads.

Accepted weakness, stated plainly: `style-src` includes `'unsafe-inline'` because KaTeX sets
inline styles on the spans it generates for mathematical layout, and removing it breaks every
equation. Inline styles cannot execute script, so the residual risk is defacement rather than
code execution.

### 9. API key exposure

**Status: Mitigated.**

`GEMINI_API_KEY` is read only in server modules (`app/api/**`, `lib/images/extraction.ts`,
`lib/session/evaluation.ts`) and carries no `NEXT_PUBLIC_` prefix, so Next.js will not inline
it into a client bundle. `lib/env.ts` declares every variable the application reads and fails
fast in production when the key is absent.

The Firebase client config in `firebase-applet-config.json` is public by design; it is an
identifier, not a credential, and access is decided by security rules.

Named gap: no automated check greps the built client bundle for the key. Cheap to add and
worth doing in Phase 10 alongside CI.

### 10. Model output injection

**Status: Mitigated.**

Model output is treated as untrusted input in both directions, per section 41.1.
`lib/types/ai/model-output.ts` revalidates all four model outputs with Zod after generation;
the provider's `responseSchema` is treated as a hint. A classifier that returns nothing
usable falls back to `SAFE_FALLBACK_INTENT`, the most restrictive analysis, rather than an
empty object cast to the type. `enforceResponsePlan` then corrects a response that exceeds
its plan, and violations are recorded on the turn as `tutorMetadata.planViolations`.

Model output never determines authorization, ownership, or a persisted trusted score.

Evidence: 24 tests in `tests/api/model-output.test.ts` including truncated JSON, prose
instead of JSON, a stringly-typed hint level and an unknown safety category.

### 11. Rate-limit bypass

**Status: Partial.**

`lib/security/rate-limit.ts` enforces a Firestore-backed fixed window on both AI endpoints,
per user and per IP. The counter is shared and the increment is transactional, so it survives
horizontal scaling and cannot be raced: 10 concurrent callers against a limit of 4 yield
exactly 4 successes, proven in
`tests/integration/safety-and-rate-limit.emulator.test.ts`. Clients can neither read nor
write `rateLimits`, proven by 2 rules negatives.

Three limitations, each deliberate:

1. **The per-IP limit is a mitigation, not a control.** The address comes from
   `x-forwarded-for`, which a client can set unless a trusted proxy overwrites it. Section
   41.1's rule applies: this narrows blast radius and is not a boundary. The per-user limit,
   keyed on the uid from a verified ID token, is the real control.
2. **The limiter fails open.** If Firestore is unreachable the request is allowed and
   `unavailable: true` is reported. This is the only control in the codebase that does not
   fail closed, and it is a judgment: a rate limiter is an abuse control, every
   authorization check on these endpoints has already run and does fail closed, and failing
   closed here would turn a Firestore blip into a total tutor outage for legitimate students.
3. **A fixed window permits a burst across the boundary.** A caller can spend a full quota at
   the end of one window and again at the start of the next. Acceptable for bounding model
   spend; a token bucket would be the fix if abuse is observed.

Also open: client-SDK reads (including the join-code lookup) never reach a route handler and
so cannot be limited by this mechanism. App Check is the intended control there, and it is
not configured (see 15 below).

### 12. Enumeration of student accounts

**Status: Mitigated.**

Endpoints return **404 rather than 403** for a resource the caller may not see, so a missing
id is indistinguishable from someone else's: `requireClassroomOwner` in
`lib/auth/teacher-access.ts`, the session resolution in the chat route, and
`GET /api/problem-images/[id]`. `list` is denied on every collection where an unfiltered
query would enumerate, and rules require queries to be constrained to the caller.

Evidence: 14 unit tests in `tests/auth/teacher-access.test.ts`, including that someone
else's classroom is indistinguishable from a missing one; rules negatives for unfiltered
listings on classrooms, join codes and safety events.

### 13. Logging sensitive content

**Status: Mitigated.**

No `console` call in a server path logs student message content. The chat route logs
validation failures with a reason code, plan violations by name, and errors by message, never
the transcript. Client-facing errors are generic: `{ error: 'Failed to generate a response.' }`
with the detail kept server-side, so configuration detail does not leak through an error body.

`safetyEvents` deliberately stores the category, disposition and a turn pointer and **not**
the student's words: a self-harm disclosure copied into a second collection is the same
disclosure stored twice, in a place the student cannot see. Asserted by a test.

Rate-limit keys are salted SHA-256 hashes, so an IP address never becomes a document id.

### 14. Data export abuse

**Status: Partial.**

`classroom_export` is one of five closed `AuditAction` values and the export path writes an
audit entry through `lib/audit/audit-log.ts` before returning data, so a successful export
cannot outrun its own record. Exports are scoped by `requireClassroomOwner`.

Named gaps: exports are not rate-limited, and there is no volume alert. Both need the export
surface to grow beyond one route before the control is worth more than the complexity.

### 15. Teacher-account compromise

**Status: Partial.**

Blast radius is bounded by design rather than by monitoring. A compromised teacher account
reaches aggregate analytics for its own classrooms and nothing else: there is no client read
over student sessions, turns, attempts, snapshots or mastery, and no transcript surface
exists. Every privileged read is audited with actor, action, target and reason.

Named gaps: no multi-factor authentication (Google sign-in is the only provider, so MFA
depends on the Google account), no session-revocation UI, no anomaly detection, and **App
Check is not configured**, so a scripted client holding a valid ID token is
indistinguishable from the real application.

---

## Section 41 mitigation checklist

Section 41 lists mitigations as well as threats. Every one, with its state:

| Mitigation | State | Where |
|---|---|---|
| Treat user content as untrusted | Done | classifier + policy engine; content never concatenated into system instructions |
| Separate instructions from user data | Done | `systemInstruction` vs `contents` in the chat route |
| Use strict structured output | Done | `responseSchema` plus Zod revalidation in `lib/types/ai/model-output.ts` |
| Sanitize Markdown | Done | `TutorMarkdown` renders no raw HTML; CSP as second layer |
| Use content security policy | Done | `next.config.ts`, added this session |
| Use secure cookies | Done | `app/api/auth/session/route.ts` sets `httpOnly`, `secure`, `sameSite` |
| Validate Firebase ID tokens | Done | `lib/firebase/verify-request.ts`, fails closed with 503 |
| Use App Check | **Open** | Wired inert in `lib/firebase/app-check.ts`; needs a project and a reCAPTCHA key. ASSUMPTIONS S7 |
| Rate-limit by user and IP | Done (partial) | `lib/security/rate-limit.ts`; see threat 11 |
| Hash classroom join codes | **Open** | Plain text as document id. ASSUMPTIONS S5, threat 5 |
| Rotate secrets | **Open** | No deployment, so no secret store to rotate in |
| Use Secret Manager | **Open** | Requires a cloud project |
| Avoid exposing model keys to the browser | Done | server-only reads, no `NEXT_PUBLIC_` prefix |
| Use signed upload flows | **Deviation, recorded** | Direct POST instead, because content validation must precede object creation. ASSUMPTIONS section 6 |
| Validate MIME using file content | Done | `lib/images/validation.ts`, magic bytes |
| Restrict image dimensions and size | Done | 5 MB and header-parsed dimension bounds |
| Use audit logs for privileged actions | Done | `lib/audit/audit-log.ts`, closed action union |

---

## Trust boundaries

Four, in order of how much damage crossing them would do:

1. **Browser to server.** Everything in a request body is untrusted. The closed list of
   values that must never be read from one is in section 41.1; the request contract for the
   tutoring endpoint is `{ message, sessionId }` and is `.strict()`.
2. **Server to model.** Untrusted in both directions. Output is revalidated and the response
   plan is re-enforced in code.
3. **Client SDK to Firestore.** Governed by `firebase/firestore.rules`, the only rules file
   in the repository. Every collection has an explicit rule; `isAuthenticated` appears zero
   times as a read predicate.
4. **Server to Firestore under Admin credentials.** Bypasses rules entirely. Every write on
   this path is a value the client is not allowed to author: scores, policy decisions,
   assistant turns, audit entries, safety events, rate-limit counters.

Per-collection detail: `docs/SECURITY-RULES-MATRIX.md`.

---

## Open items, by priority

1. **App Check** (threats 11, 15). Needs a Firebase project and a reCAPTCHA Enterprise
   registration. Steps in `docs/ASSUMPTIONS.md` S7. Blocks the Phase 8 App Check criterion.
2. **Join-code hashing** (threat 5). Needs the join flow moved to a server route first.
   Blocks the Phase 11 privacy criterion.
3. **Prompt-injection corpus** (threats 1, 2). Belongs to the Phase 9 evaluation suite.
4. **Bundle check for leaked keys** (threat 9). Small; do it with CI in Phase 10.
5. **Export rate limiting and volume alerting** (threat 14).
6. **Secret rotation and Secret Manager** (checklist). Requires a deployment.

## What this document is not

Not a compliance claim. Section 25 forbids claiming legal compliance without review, and no
review has happened. Jurisdiction-specific obligations for minors are recorded in
`docs/PRIVACY-DESIGN.md` under areas requiring legal review.
