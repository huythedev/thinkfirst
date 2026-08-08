# Data Retention

Required by section 25, which asks for "configurable data retention", account deletion,
classroom removal, and export of a student's own data.

- **Last updated:** 2026-08-07, session
  [12](logs/2026-08-07-12-phase-8-safety-and-security.md).
- **Honest summary:** retention is **designed and not implemented**. There is no scheduled
  deletion job, because there is no deployed environment to schedule one in. What follows is
  the intended policy, the per-collection reasoning, and exactly what is missing. Presenting
  it as working would be the failure mode this repository's ledger exists to catch.

---

## Intended retention policy

Periods are proposals, not statute. Section 25 requires retention to be *configurable*, so
these are defaults a deployment overrides, and item 3 of the legal-review list in
`docs/PRIVACY-DESIGN.md` covers the case where local law sets a different figure.

| Collection | Proposed retention | Reasoning |
|---|---|---|
| `users` | Until account deletion | Identity; deleting it orphans everything else |
| `studentProfiles` | Until account deletion | Grade and language are current-state, not history |
| `teacherProfiles` | Until account deletion | As above |
| `classrooms` | Until the teacher deletes it | Institutional record |
| `classroomMemberships` | Until removal, then 90 days | A brief tail so an accidental removal is recoverable |
| `classroomJoinCodes` | Until the classroom is deleted or the code rotated | A live shared secret |
| `assignments` | Academic year, then archive | Teachers reuse them across terms |
| `assignmentReferences` | Same as the assignment | Reference answers are useless without the assignment |
| `learningSessions` | 2 academic years | Long enough to show progress; short enough not to be a permanent record of a child's struggles |
| `sessionTurns` | Same as the session | The transcript **is** the session |
| `studentAttempts` | Same as the session | Rubric judgments; the score is recomputed from them, so they cannot outlive it |
| `transferProblems` | Same as the session | Contains reference answers |
| `independenceSnapshots` | 2 academic years | Trend needs history; older snapshots inform nothing |
| `masteryRecords` | 2 academic years | As above |
| `problemImages` | **30 days**, or on session end | The shortest period of anything here: an image may show handwriting, a name, a bedroom. The extracted text is what teaching needs, and it is stored separately |
| `safetyEvents` | 1 year, or per mandatory-reporting law | Long enough for a pattern to be visible to a human; short enough not to follow a child indefinitely. Item 4 of the legal-review list may override this |
| `reports` | 1 year | Product feedback |
| `auditLogs` | **2 years minimum** | Deliberately the longest. An audit trail shorter than the data it audits is not a trail |
| `rateLimits` | Minutes | Disposable once the window passes; each document carries `expiresAt` |

Two asymmetries above are intentional and worth stating: images are kept for the shortest
time of any content, and audit logs for the longest. The first is because an image carries
more incidental personal data than anything else the application stores. The second is
because the record of who looked at a child's data must outlive the opportunity to look.

---

## What is implemented

- **`rateLimits` carries `expiresAt`** on every document, so a TTL policy needs configuration
  rather than code. This is the only collection with a retention marker in place.
- **Session-scoped image cleanup is possible** because `problemImages` records `storagePath`,
  `studentId` and `createdAt`, so a deletion job has everything it needs to find and remove
  both the document and the object.

## What is not implemented

Each row names the missing piece, not just the gap.

| Requirement | State | What it needs |
|---|---|---|
| Scheduled deletion | **Open** | A Cloud Scheduler job or Firestore TTL policies. Both need a deployed project |
| Account deletion | **Open** | A privileged route that deletes the auth user and fans out over 13 collections, writing an audit entry. Must be idempotent and resumable, since a partial deletion leaves orphans that no rule scopes |
| Classroom removal | **Partial** | A teacher can remove a member. Deleting a classroom, its memberships, assignments and join code as one unit does not exist |
| Student data export | **Open** | A route that reads a student's own documents and returns JSON. The authorization is trivial; the care is in not including `transferProblems` or `assignmentReferences`, which would leak reference answers to the student through their own export |
| TTL on `problemImages` | **Open** | Needs both a Firestore TTL and a Storage lifecycle rule. Deleting only the document would leave the object in the bucket, which is worse than either alone, because the image survives with nothing pointing at it |

The export gap has a subtlety worth recording, because it is the kind of thing an
implementation gets wrong on the first pass: a naive "export everything with your
`studentId`" would hand the student the reference answer to every transfer problem they were
ever set, defeating the assessment that section 22 exists to create. The export must be a
named allowlist of collections, not a filter over all of them.

---

## Deletion ordering

For whoever implements account deletion. This order is not arbitrary:

1. Revoke sessions and disable the auth user, so nothing new is written mid-deletion.
2. Write the audit entry **first**, naming the actor and target. Writing it last means a
   deletion that fails halfway leaves no record it was attempted.
3. Delete content: `sessionTurns`, `studentAttempts`, `transferProblems`, `problemImages`
   documents and their Storage objects, `safetyEvents`.
4. Delete derived data: `independenceSnapshots`, `masteryRecords`.
5. Delete `learningSessions`.
6. Delete `classroomMemberships`.
7. Delete `studentProfiles`, then `users`.
8. **Retain `auditLogs`.** They reference the uid but contain no educational content, and
   deleting the trail along with the account would make the deletion itself unauditable.

Content before derived data, and both before the parent session, so a crash mid-way leaves
orphaned children rather than parents pointing at nothing — the recoverable direction.
