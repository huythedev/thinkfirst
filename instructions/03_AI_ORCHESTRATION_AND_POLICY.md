<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 14, 15, 16, 17, 18.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 14. AI SYSTEM ARCHITECTURE

Do not send user messages directly to a generative model and display the raw response.

Create a multi-stage behavior engine.

Required pipeline:

```text
Student input
    ↓
Input normalization
    ↓
Safety and privacy preprocessing
    ↓
Intent and task analysis
    ↓
Student-state retrieval
    ↓
Policy decision
    ↓
Response plan
    ↓
Gemini generation
    ↓
Response validation
    ↓
Safety and disclosure check
    ↓
Persist interaction metrics
    ↓
Display structured response
```

Create the following components:

1. Input Normalizer.
2. Intent Classifier.
3. Educational Task Analyzer.
4. Student State Service.
5. Policy Engine.
6. Hint Planner.
7. Tutor Response Generator.
8. Mathematical Response Validator.
9. Safety Validator.
10. Learning Evidence Evaluator.
11. Transfer Problem Generator.
12. Independence Score Calculator.
13. Session Summary Generator.
14. Audit Logger.

Each component should have a clear TypeScript interface.

---

# 15. REQUIRED AI ANALYSIS SCHEMA

Use structured model output.

Create a schema similar to:

```ts
export type LearningMode =
  | "learn"
  | "practice"
  | "assignment"
  | "verify";

export type Subject =
  | "mathematics"
  | "science"
  | "other";

export type RequestIntent =
  | "concept_explanation"
  | "problem_solving"
  | "step_check"
  | "answer_request"
  | "homework_completion"
  | "verification"
  | "off_topic"
  | "unsafe"
  | "unclear";

export interface IntentAnalysis {
  intent: RequestIntent;
  subject: Subject;
  topic: string | null;
  estimatedGradeLevel: number | null;
  problemStatement: string | null;
  studentProvidedAttempt: boolean;
  attemptQuality: "none" | "minimal" | "partial" | "meaningful";
  answerSeekingLikelihood: number;
  ambiguityLevel: "low" | "medium" | "high";
  missingInformation: string[];
  detectedLanguage: "vi" | "en" | "other";
  safetyCategory:
    | "none"
    | "self_harm"
    | "abuse"
    | "sexual_content"
    | "violence"
    | "illegal_activity"
    | "bullying"
    | "personal_data"
    | "other";
  confidence: number;
}
```

Use numeric confidence values between 0 and 1.

Validate all model output with a runtime schema validator.

Do not trust model-generated JSON without validation.

---

# 16. RESPONSE PLAN SCHEMA

The policy engine must produce a response plan before generation.

```ts
export interface TutorResponsePlan {
  action:
    | "ask_for_attempt"
    | "clarify_problem"
    | "provide_concept"
    | "provide_hint"
    | "evaluate_step"
    | "provide_worked_step"
    | "provide_partial_solution"
    | "provide_full_solution"
    | "start_transfer_task"
    | "start_verification_task"
    | "safety_redirect"
    | "off_topic_redirect";

  allowedHintLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

  mayRevealFinalAnswer: boolean;
  requiresStudentResponse: boolean;
  requiresExplanation: boolean;
  requiresVerification: boolean;
  generateTransferProblem: boolean;

  tone:
    | "simple_supportive"
    | "neutral_supportive"
    | "academic_supportive";

  maxResponseWords: number;
  learningObjective: string | null;
  rationaleCode: string;
  policyVersion: string;
}
```

The model must not decide its own permissions.

The deterministic policy engine decides:

- Maximum hint level.
- Whether final answers are allowed.
- Whether a transfer task is required.
- Response length.
- Required student action.

The generative model operates inside those constraints.

---

# 17. TUTOR RESPONSE SCHEMA

```ts
export interface TutorResponse {
  messageMarkdown: string;
  responseType:
    | "question"
    | "hint"
    | "feedback"
    | "explanation"
    | "worked_step"
    | "solution"
    | "transfer_problem"
    | "safety_message";

  hintLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  finalAnswerIncluded: boolean;
  studentActionRequired: string | null;
  checkForUnderstanding: string | null;
  confidenceStatement: string | null;
  learningObjective: string | null;
  internalConceptTags: string[];
}
```

Do not expose internal chain-of-thought.

The application may show concise reasoning explanations, calculations and educational steps, but must not request or store hidden model reasoning.

---

# 18. DETERMINISTIC POLICY RULES

Implement core policy logic in code.

Do not rely only on a system prompt.

Example rules:

```text
IF mode = assessment-safe
THEN mayRevealFinalAnswer = false

IF mode = assignment
AND studentProvidedAttempt = false
AND strictness is balanced or independence-focused
THEN action = ask_for_attempt

IF attemptQuality = meaningful
AND student asks to check a step
THEN action = evaluate_step

IF currentHintLevel < allowed maximum
AND student remains stuck
THEN increase hint level by at most 1

IF student has received a full solution
THEN require reflection and transfer problem

IF image extraction confidence is low
THEN ask student to confirm extracted text

IF the problem is ambiguous
THEN clarify before solving

IF safetyCategory is not none
THEN invoke the appropriate safety policy

IF model confidence is low
THEN communicate uncertainty and suggest verification
```

Store policy decisions with machine-readable rationale codes.

Example rationale codes:

- `ATTEMPT_REQUIRED`.
- `ASSESSMENT_FINAL_ANSWER_BLOCKED`.
- `NEXT_HINT_ALLOWED`.
- `FULL_SOLUTION_AFTER_ENGAGEMENT`.
- `TRANSFER_REQUIRED`.
- `LOW_EXTRACTION_CONFIDENCE`.
- `AMBIGUOUS_PROBLEM`.
- `SAFETY_REDIRECT`.

---
