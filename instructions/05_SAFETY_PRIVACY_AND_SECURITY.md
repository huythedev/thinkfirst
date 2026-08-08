<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 24, 25, 39, 41.
The instruction body below is copied verbatim from the uploaded master file.
Section 41.1 is an amendment authored 2026-08-06 (audit patch 3). It is not part
of the source master file. Sections 24, 25, 39 and 41 remain verbatim, except for
the five-line addition to section 39 marked as an amendment.
-->

# 24. SAFETY FOR MINORS

Create a safety policy layer covering:

- Self-harm.
- Abuse.
- Sexual content.
- Bullying.
- Threats or violence.
- Dangerous activities.
- Drugs.
- Illegal behavior.
- Personal information.
- Requests to contact unknown adults.
- Attempts to expose hidden student data.

The assistant must:

- Respond calmly.
- Avoid graphic detail.
- Encourage contacting a trusted adult when appropriate.
- Use configured local support resources when necessary.
- Never invent emergency phone numbers.
- Avoid promising secrecy.
- Avoid acting as a therapist.
- Avoid interrogating the student.
- Escalate according to deployment policy.

Create configurable safety resource files by locale.

Example:

```ts
export interface LocalSafetyResources {
  locale: string;
  emergencyNumber?: string;
  childSupportResources: Array<{
    name: string;
    contact: string;
    description: string;
  }>;
  lastReviewedAt: string;
}
```

Do not ship unverified placeholder hotline information in production.

The application must clearly distinguish:

- Educational safety redirection.
- Immediate emergency guidance.
- Teacher review flags.
- Administrative abuse reports.

Do not expose safety classifications to classmates.

---

# 25. PRIVACY AND DATA PROTECTION

Design for data minimization.

Required practices:

- Collect only necessary profile fields.
- Use student aliases or display names.
- Do not require a public profile.
- Do not sell or use student data for advertising.
- Do not train external models on identifiable student content through application logic.
- Do not log secrets or authentication tokens.
- Redact sensitive fields from logs.
- Use encryption in transit.
- Use platform-managed encryption at rest.
- Use role-based access control.
- Use Firebase App Check or an equivalent abuse-prevention mechanism.
- Implement configurable data retention.
- Implement account deletion.
- Implement classroom removal.
- Implement export of a student’s own data where appropriate.
- Keep audit logs for privileged access.
- Do not claim legal compliance without review.
- Document areas requiring jurisdiction-specific legal review.

For underage users, implement a consent-ready architecture configurable by deployment jurisdiction.

Create:

- `docs/PRIVACY-DESIGN.md`.
- `docs/DATA-RETENTION.md`.
- `docs/THREAT-MODEL.md`.
- `docs/MINOR-SAFETY.md`.

---

# 39. FIRESTORE SECURITY RULES

Write and test security rules.

Principles:

- Students can read and update limited fields in their own profile.
- Students cannot change their role.
- Students cannot write trusted scores.
- Students can access only their sessions.
- Teachers can access classrooms they own.
- Teachers can access aggregate and authorized student summaries for their classrooms.
- Teachers cannot access students outside their classrooms.
- Admin access must require secure claims.
- Audit logs cannot be written directly by clients.
- Join codes must not be stored in plain text.
- Private storage images must require authorization.

Before writing or changing rules, complete the trust boundary and source-of-truth
review in section 41.1, including the rules completeness matrix. Each principle
above must map to at least one rule and at least one negative test. A principle
with no test is an intention, not a control.

Use emulator tests to prove the rules.

---

# 41. SECURITY REQUIREMENTS

Create a threat model covering:

- Prompt injection.
- Attempts to reveal system prompts.
- Role escalation.
- Unauthorized transcript access.
- Join-code guessing.
- Abuse of image uploads.
- Malicious file types.
- Cross-site scripting through Markdown.
- API key exposure.
- Model output injection.
- Rate-limit bypass.
- Enumeration of student accounts.
- Logging sensitive content.
- Data export abuse.
- Teacher-account compromise.

Mitigations:

- Treat user content as untrusted.
- Separate instructions from user data.
- Use strict structured output.
- Sanitize Markdown.
- Use content security policy.
- Use secure cookies.
- Validate Firebase ID tokens.
- Use App Check.
- Rate-limit by user and IP where appropriate.
- Hash classroom join codes.
- Rotate secrets.
- Use Secret Manager.
- Avoid exposing model keys to the browser.
- Use signed upload flows.
- Validate MIME types using file content, not only extension.
- Restrict image dimensions and size.
- Use audit logs for privileged actions.

---

# 41.1 TRUST BOUNDARY AND SOURCE-OF-TRUTH REVIEW

> Amendment, 2026-08-06. Not part of the source master file. Added after an audit
> found that no instruction required an agent to enumerate trusted values before
> coding, which permitted a working answer-disclosure exploit.

This review is mandatory before implementing or modifying any endpoint, server
action, security rule, or client write path. Complete it **before** writing code,
not after. Attach the completed table to the session log and to the completion
report in section 54.

An implementation that skips this review is not accepted, even if it works.

## Questions you must answer first

Answer all eight in writing, for the specific path you are about to build:

1. Which inputs come from the client?
2. Which inputs must be read from Firestore or another server-side source?
3. Which values affect authorization?
4. Which values affect educational policy or permission to reveal final answers?
5. May the client write trusted scores? (The answer is always no. Confirm that
   nothing in your path allows it.)
6. Which operations must use a server-side write path?
7. Where are Firebase Security Rules sufficient?
8. Where is the Firebase Admin SDK required?

Answers to 7 and 8, stated as a rule: security rules are sufficient when the
client is the legitimate author of the data and every constraint is expressible
as a rule predicate over the request and the existing document. The Admin SDK is
required whenever a value is trusted, derived, aggregated, cross-user, or must be
consistent with a decision the client is not allowed to make. If you cannot
express the constraint as a rule, do not weaken the rule. Move the write.

## Required table

| Value or operation | Client controlled? | Trusted source | Validation | Authorization |
|---|---:|---|---|---|
| example: `sessionId` | yes | client, then verified | shape check | server confirms `session.studentId == token.uid` |
| example: `strictness` | no | `assignments/{id}` else `classrooms/{id}` else `studentProfiles/{uid}` | enum | read server-side; request value ignored entirely |

One row per value the path reads and per operation it performs. "Client
controlled?" means whether the value arrives in the request, not whether you
intend to trust it. A value may arrive from the client and still be untrusted;
say so, and say what you replace it with.

## Values that are never trusted from a request body

This list is closed and non-negotiable. Each of these must be read from
Firestore, from verified custom claims, or derived server-side. A value appearing
in a request body is not evidence of anything.

- `role` and any capability derived from it.
- Classroom membership, and any list of classroom IDs.
- Session ownership, and `studentId` on any document.
- `strictness`.
- `mode` / learning mode.
- `currentHintLevel` and any hint ceiling.
- Assignment policy: `allowFullSolutions`, `allowedModes`,
  `requireTransferProblem`, `strictness`.
- `grade`, when it changes model behavior.
- Any Independence Score, component value, coverage figure or mastery record.
- Any policy decision, `rationaleCode`, `mayRevealFinalAnswer`, or
  `allowedHintLevel`.
- Any timestamp used for ordering, rate limiting or audit.
- Any `policyVersion` or `scoringVersion` stamp.

Two rules follow, and they are the ones most often missed:

**Clamping is a mitigation, not a source of truth.** Narrowing a
client-supplied value toward the safe end reduces blast radius and is worth doing
as a stopgap. It does not satisfy this section. The value must be read from the
authoritative document. If credentials for server-side reads are unavailable in
your environment, clamp, then record it in `docs/ASSUMPTIONS.md` as an open
security gap naming the acceptance criteria it affects, and say so in the
completion report. Do not describe a clamped path as secure.

**Schema validation is not authorization.** A validator proves a value is a
well-formed member of an enum. It cannot prove the value is the one the teacher
configured. Both are required; neither substitutes for the other.

## Model output is untrusted input

The generative model is on the far side of a trust boundary, in both directions.

- Revalidate model output against the schema server-side after generation,
  before it is trusted, persisted or returned. Provider-side response-schema
  enforcement is a hint, not a guarantee, and does not discharge this
  requirement.
- Enforce the response plan in code after generation. If the returned
  `hintLevel` exceeds `allowedHintLevel`, or `finalAnswerIncluded` is true when
  the plan forbids it, reject or downgrade the response. A prompt instruction to
  obey the plan is not enforcement, and section 16's "the model must not decide
  its own permissions" is not satisfied by asking politely.
- Never let model output determine authorization, ownership, or a score that is
  persisted as trusted.

## Rules completeness matrix

For every collection in section 28, record and keep current:

| Collection | Client read | Client write | Server write | Rule scope | Negative test |
|---|---|---|---|---|---|

- Every collection must have an explicit rule. A collection reachable only by a
  default-deny is acceptable only if that is intentional and stated.
- `allow read: if isAuthenticated()` is never an acceptable rule for a
  collection containing student work, session content, attempts, or
  membership-scoped data. Scope reads to the owner plus the teacher of record.
- Every collection that stores trusted values is client-unwritable, and has a
  working server write path. A client-unwritable collection with no server
  writer is a dead collection: either implement the writer or remove the
  collection and its rule.
- Every rule needs a negative test in the emulator proving the unauthorized
  caller is refused. Use `@firebase/rules-unit-testing` against the emulator
  configured in `firebase.json`, and wire it into the default test command so it
  runs unattended.
- Security rules live in exactly one file, the one `firebase.json` deploys. A
  second copy anywhere in the repository is a defect: delete it.

The current state of this matrix for this repository lives in
`docs/SECURITY-RULES-MATRIX.md`. Update it in the same session that changes a
rule.

---
