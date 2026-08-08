# Privacy Design

Required by section 25 of the instruction set. Describes what ThinkFirst collects, why each
field exists, who can see it, and which questions need a lawyer rather than an engineer.

- **Last updated:** 2026-08-07, session
  [12](logs/2026-08-07-12-phase-8-safety-and-security.md).
- **Status:** design document for an application with no deployed environment. Nothing here
  is a compliance claim; section 25 forbids claiming compliance without review, and no review
  has happened.

---

## Data minimization

The rule applied throughout: a field exists because a feature cannot work without it, not
because it might be useful later.

### What is collected

| Data | Why it exists | Could the product work without it |
|---|---|---|
| Firebase uid | Identity and every authorization decision | No |
| Email address | Supplied by Google sign-in; used to identify an account | Not with Google as the only provider |
| Display name | Shown to the student's own teacher on a roster | A pseudonym would serve; see below |
| `grade` | Changes tutor tone and vocabulary (section 11) | No, it is a pedagogical input |
| `preferredLanguage` | Response language | No |
| Session problems and turns | The transcript is the learning record | No |
| Attempt evaluations | Rubric judgments the Independence Score is computed from | No |
| Independence snapshots | The score, its components, coverage | No |
| Mastery records | Per-topic progress | No |
| Problem images | The uploaded photo, retained for the session | Retained only while the session needs it |
| Safety events | Category and disposition, so a human can follow up | No |
| Audit logs | Privileged access trail, required by section 25 | No |
| Hashed rate-limit keys | Abuse prevention | No |

### What is deliberately not collected

- **No public profile.** Section 25 requires this explicitly. No user document is readable by
  another user; there is no directory, no search, no classmate list.
- **No IP addresses in storage.** The rate limiter stores a salted SHA-256 hash. An IP is
  personal data and a document id is the most durable place to leak one.
- **No student message content in `safetyEvents`.** The category, disposition and a turn
  pointer only. A self-harm disclosure copied into a second collection is the same disclosure
  stored twice, in a place the student cannot see and cannot delete.
- **No third-party analytics.** No advertising, tracking or attribution SDK is installed.
- **No behavioral data sold or used for advertising.** There is no path by which it could be:
  no export to a third party exists.
- **No secrets or tokens in logs.** Errors are logged by message and code; bodies are not.

### Aliases

Section 25 says to "use student aliases or display names". Display names come from Google
sign-in today, so a student's real name typically reaches their own teacher's roster. That is
the same information a teacher already holds, and it goes no further: no classmate can read
it. A deployment wanting stricter separation can set `displayName` to a pseudonym at
onboarding, and nothing in the application depends on it being a real name. Not enforced in
code, and recorded here as a deployment choice rather than a guarantee.

---

## Who can see what

Four principals, and the boundary between them is enforced by security rules and server-side
authorization rather than by UI.

**The student** sees their own sessions, turns, attempts, snapshots, mastery records and
images. Every rule is `resource.data.studentId == request.auth.uid || isAdmin()`.

**The teacher** sees classrooms they own, their rosters, assignments they authored, and
**aggregate** analytics for their own classrooms. They hold no client read over any
student-scoped collection; all of it flows through `/api/teacher/*` under Admin credentials
with ownership checked against stored data. No transcript surface exists. Section 5.8 makes
transcript access privileged and audited, and the current answer is that it is not
implemented at all, which the Phase 6 criterion permits explicitly.

**The classmate** sees nothing. No collection is readable by "any authenticated user";
`isAuthenticated` appears zero times as a read predicate in `firebase/firestore.rules`.
Safety classifications are unreadable by every client, per section 24.

**The administrator** reaches student-scoped collections through `isAdmin()`, which resolves
through the caller's own `users` document and fails closed on error. Admin access leaves an
audit entry when it goes through a server route.

Per-collection detail: `docs/SECURITY-RULES-MATRIX.md`.

---

## Encryption

- **In transit:** HTTPS to Firebase and to the Gemini API. `Strict-Transport-Security` is set
  in `next.config.ts`. Local development over HTTP against emulators is the documented
  exception.
- **At rest:** platform-managed, by Firestore and Cloud Storage. The application implements
  no field-level encryption, which is a deliberate limit — a key this application held would
  live in the same place as the data.

---

## Consent-ready architecture

Section 25 asks for an architecture "configurable by deployment jurisdiction" for underage
users. What exists today:

- Role and profile creation are a single explicit onboarding step, so a consent gate has one
  place to sit.
- No feature depends on a public profile, so a consent-restricted account can still learn.
- Retention is centrally described in `docs/DATA-RETENTION.md` rather than scattered.

What does not exist: no consent record, no guardian relationship, no jurisdiction
configuration. This is an unimplemented architecture rather than an implemented one, and
saying otherwise would be the kind of claim section 25 warns against.

---

## Student rights

| Right | State | Where |
|---|---|---|
| Access one's own data | **Partial.** Visible in the UI; no single export | `/student/progress`, session pages |
| Export one's own data | **Open.** Section 25 says "where appropriate"; no endpoint exists | — |
| Correct one's own data | **Partial.** Profile fields and scratchpad are editable; a transcript is immutable by design | rules restrict profile writes to limited fields |
| Delete one's account | **Open.** No deletion path | see `DATA-RETENTION.md` |
| Leave a classroom | **Partial.** A teacher can remove a member; a student cannot self-remove | `classroomMemberships` |

Three of five are open. They are listed rather than omitted because the gap is the honest
state, and each is named in `docs/DATA-RETENTION.md` with what it needs.

---

## Areas requiring jurisdiction-specific legal review

Section 25 requires these to be documented rather than guessed:

1. **Lawful basis for processing a minor's data**, and whether guardian consent is required
   before an account exists.
2. **The age at which a student may consent for themselves**, which differs by jurisdiction
   and determines whether the consent gate is per-account or per-class.
3. **Retention limits for educational records**, which are frequently set by statute and may
   be longer than this application's defaults or shorter than a school wants.
4. **Whether safety events constitute a mandatory-reporting record**, and who must be
   notified within what period. This one has operational consequences: the current design
   raises a flag for a human and takes no further action.
5. **Cross-border transfer**, since Firebase and Gemini regions may sit outside the school's
   jurisdiction.
6. **Whether an Independence Score is an assessment** under local rules, which would attach
   accuracy, appeal and disclosure obligations. Section 32 already requires the UI to say it
   is not an official grade, and that wording is a product decision, not a legal opinion.
7. **Whether transcripts are disclosable** to a guardian on request, and how that interacts
   with a student's expectation of privacy from their own household.
