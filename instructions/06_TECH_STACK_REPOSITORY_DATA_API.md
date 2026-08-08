<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 26, 27, 28, 29.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 26. RECOMMENDED TECHNOLOGY STACK

Use a monorepo.

Recommended stack:

## Frontend

- Latest stable Next.js with App Router.
- TypeScript with strict mode.
- React.
- Tailwind CSS or a clean token-based styling system.
- Accessible component primitives.
- React Hook Form.
- Runtime schema validation.
- Internationalization for Vietnamese and English.
- KaTeX or equivalent for mathematics.
- A safe Markdown renderer.
- Firebase client SDK.

## Backend

- Node.js with TypeScript.
- Cloud Run service for the AI gateway.
- Official Google Gen AI SDK.
- Firebase Admin SDK.
- Firestore.
- Cloud Storage for problem images.
- Cloud Tasks or Pub/Sub only when genuinely needed.
- Secret Manager.
- Cloud Logging.
- Error reporting and tracing.

## Authentication

- Firebase Authentication.
- Email/password for development.
- Google sign-in for teachers.
- Configurable student access flow.
- Role claims or secure role records.

## Testing

- Vitest or Jest for unit tests.
- Testing Library for components.
- Playwright for end-to-end tests.
- Prompt evaluation scripts.
- Deterministic policy tests.
- Firestore emulator tests.

## Deployment

- Firebase Hosting or a Google-compatible frontend deployment.
- Cloud Run for the AI gateway.
- Firebase Emulator Suite for local development.
- Infrastructure configuration documented and reproducible.

Do not hardcode a specific Gemini model name throughout the code.

Use configuration:

```env
GEMINI_TUTOR_MODEL=
GEMINI_CLASSIFIER_MODEL=
GEMINI_VALIDATOR_MODEL=
```

Choose appropriate current production models at deployment time.

---

# 27. MONOREPO STRUCTURE

Create a structure similar to:

```text
thinkfirst/
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       ├── features/
│       ├── hooks/
│       ├── lib/
│       ├── messages/
│       ├── public/
│       └── tests/
├── services/
│   └── ai-gateway/
│       ├── src/
│       │   ├── api/
│       │   ├── auth/
│       │   ├── config/
│       │   ├── evaluation/
│       │   ├── prompts/
│       │   ├── providers/
│       │   ├── safety/
│       │   ├── services/
│       │   ├── validators/
│       │   └── index.ts
│       └── tests/
├── packages/
│   ├── ai-policy/
│   ├── shared/
│   ├── ui/
│   ├── scoring/
│   └── config/
├── firebase/
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   ├── storage.rules
│   └── seed/
├── evals/
│   ├── datasets/
│   ├── runners/
│   ├── reports/
│   └── README.md
├── docs/
├── scripts/
├── .github/
│   └── workflows/
├── docker-compose.yml
├── firebase.json
├── package.json
├── README.md
└── pnpm-workspace.yaml
```

Use a package manager suitable for a TypeScript monorepo.

---

# 28. FIRESTORE DATA MODEL

Design Firestore collections approximately as follows.

## users

```ts
interface User {
  id: string;
  role: "student" | "teacher" | "admin";
  displayName: string;
  preferredLanguage: "vi" | "en";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  disabledAt?: Timestamp;
}
```

## studentProfiles

```ts
interface StudentProfile {
  userId: string;
  grade: number;
  subjects: string[];
  classroomIds: string[];
  assistanceProfile: {
    defaultStrictness: "supportive" | "balanced" | "independence";
    accessibilitySettings: string[];
  };
  consentStatus: "unknown" | "pending" | "approved" | "not_required";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## teacherProfiles

```ts
interface TeacherProfile {
  userId: string;
  organizationName?: string;
  classroomIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## classrooms

```ts
interface Classroom {
  id: string;
  name: string;
  teacherId: string;
  grade: number;
  subject: string;
  joinCodeHash: string;
  defaultStrictness:
    | "supportive"
    | "balanced"
    | "independence"
    | "assessment_safe";
  createdAt: Timestamp;
  archivedAt?: Timestamp;
}
```

## classroomMemberships

```ts
interface ClassroomMembership {
  id: string;
  classroomId: string;
  userId: string;
  role: "student" | "teacher";
  status: "active" | "invited" | "removed";
  joinedAt?: Timestamp;
}
```

## assignments

```ts
interface Assignment {
  id: string;
  classroomId: string;
  teacherId: string;
  title: string;
  instructions: string;
  subject: string;
  topic?: string;
  grade: number;
  learningObjective: string;
  allowedModes: LearningMode[];
  strictness:
    | "supportive"
    | "balanced"
    | "independence"
    | "assessment_safe";
  allowFullSolutions: boolean;
  requireTransferProblem: boolean;
  dueAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## learningSessions

```ts
interface LearningSession {
  id: string;
  studentId: string;
  classroomId?: string;
  assignmentId?: string;
  subject: Subject;
  topic?: string;
  grade: number;
  language: "vi" | "en";
  mode: LearningMode;
  strictness: string;
  status: "active" | "completed" | "abandoned";
  originalProblem: string;
  extractedProblem?: string;
  imagePath?: string;
  currentHintLevel: number;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  policyVersion: string;
  scoringVersion: string;
}
```

## sessionTurns

```ts
interface SessionTurn {
  id: string;
  sessionId: string;
  sequence: number;
  actor: "student" | "assistant" | "system";
  content: string;
  createdAt: Timestamp;
  intentAnalysis?: IntentAnalysis;
  responsePlan?: TutorResponsePlan;
  tutorMetadata?: {
    hintLevel: number;
    finalAnswerIncluded: boolean;
    modelName: string;
    promptVersion: string;
    latencyMs: number;
    confidence?: number;
  };
  safetyMetadata?: {
    category: string;
    action: string;
  };
}
```

## studentAttempts

```ts
interface StudentAttempt {
  id: string;
  sessionId: string;
  studentId: string;
  attemptText: string;
  attemptType:
    | "initial"
    | "intermediate"
    | "explanation"
    | "transfer"
    | "verification";
  evaluation: {
    relevance: number;
    correctness: number;
    reasoningQuality: number;
    errorCategory?: string;
    feedbackSummary: string;
  };
  createdAt: Timestamp;
}
```

## independenceSnapshots

```ts
interface IndependenceSnapshot {
  id: string;
  studentId: string;
  sessionId: string;
  totalScore: number;
  components: {
    firstAttempt: number;
    hintEfficiency: number;
    explanation: number;
    transfer: number;
    verification: number;
  };
  scoringVersion: string;
  generatedAt: Timestamp;
}
```

## masteryRecords

```ts
interface MasteryRecord {
  id: string;
  studentId: string;
  subject: string;
  topic: string;
  guidedAccuracy: number;
  independentAccuracy: number;
  averageHintLevel: number;
  transferSuccessRate: number;
  sessionCount: number;
  updatedAt: Timestamp;
}
```

## reports

Store student reports of:

- Incorrect answer.
- Unclear explanation.
- Inappropriate content.
- Technical problem.
- Other issue.

## auditLogs

Store privileged actions:

- Transcript access.
- Role changes.
- Classroom exports.
- Safety case review.
- Policy changes.

Never allow clients to directly write trusted scoring or policy fields.

---

# 29. API DESIGN

Implement versioned backend endpoints.

## Session endpoints

```text
POST   /v1/sessions
GET    /v1/sessions/:sessionId
POST   /v1/sessions/:sessionId/turns
POST   /v1/sessions/:sessionId/complete
POST   /v1/sessions/:sessionId/report
```

## Image endpoints

```text
POST   /v1/problem-images/upload-url
POST   /v1/problem-images/:id/extract
POST   /v1/problem-images/:id/confirm
```

## Student dashboard

```text
GET    /v1/students/me/dashboard
GET    /v1/students/me/progress
GET    /v1/students/me/topics/:topic
```

## Classroom endpoints

```text
POST   /v1/classrooms
GET    /v1/classrooms/:classroomId
POST   /v1/classrooms/:classroomId/join
GET    /v1/classrooms/:classroomId/analytics
GET    /v1/classrooms/:classroomId/students/:studentId/summary
```

## Assignment endpoints

```text
POST   /v1/classrooms/:classroomId/assignments
GET    /v1/assignments/:assignmentId
PATCH  /v1/assignments/:assignmentId
POST   /v1/assignments/:assignmentId/archive
```

## Admin endpoints

```text
GET    /v1/admin/policies
PATCH  /v1/admin/policies/:policyId
GET    /v1/admin/evaluations
GET    /v1/admin/audit-logs
```

Requirements:

> The list below is an amendment, 2026-08-06 (audit patch 4a). The original said
> "never trust role values sent by the client" and named no other value, which
> permitted `strictness`, `mode` and `currentHintLevel` to arrive from a browser.

- Validate all input at the boundary with a runtime schema.
- Authenticate every protected endpoint with a verified Firebase ID token, and
  fail closed if verification is unavailable.
- Authorize access based on role and ownership, read server-side.
- Complete the trust boundary and source-of-truth review in section 41.1 before
  implementing any endpoint.
- Read every policy input server-side. `mode`, `strictness`,
  `currentHintLevel`, assignment policy and `grade` are read from
  `learningSessions`, `assignments`, `classrooms` and `studentProfiles`, never
  from the request body. The client identifies the session; the server decides
  everything about it.
- Ignore, do not merely sanitize, any policy field that arrives in a request
  body. Log the attempt at debug level and proceed with the server value.
- Revalidate model output against its schema server-side before persisting or
  returning it, and enforce the response plan in code.
- Rate-limit AI endpoints per user and per IP.
- Use idempotency where appropriate.
- Return consistent error structures. Never return raw error messages, stack
  traces or provider errors to a client.
- Never return private internal prompts.
- Never return model credentials.
- Never trust role values sent by the client.
- Never accept a trusted score, component value or mastery figure from a client
  under any circumstance.

These requirements attach to the **role**, not to the deployment shape. If the
AI gateway is implemented as a Next.js route handler, a server action, a Cloud
Run service or anything else, every requirement above still applies to it
unchanged. Adapting the architecture never discharges an API requirement, and
the adaptation must be recorded in `docs/ASSUMPTIONS.md`.

Document every endpoint that exists, including ones not listed in this section.
An endpoint with no contract in the instruction set is still bound by the
requirements above, and the section must be amended to describe it.

Standard error shape:

```ts
interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}
```

---
