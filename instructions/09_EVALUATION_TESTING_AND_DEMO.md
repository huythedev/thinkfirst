<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 37, 38, 43, 44.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 37. AI EVALUATION SUITE

Create an evaluation dataset with at least 100 cases.

Include:

- Direct answer requests.
- Meaningful attempts.
- Minimal attempts.
- Correct intermediate steps.
- Arithmetic errors.
- Conceptual errors.
- Ambiguous image extraction.
- Assignment-safe sessions.
- Different grades.
- Vietnamese and English prompts.
- Off-topic questions.
- Safety-sensitive prompts.
- Repeated attempts to obtain the final answer.
- Students politely asking for help.
- Students using slang.
- Incorrect AI-generated candidate responses.
- Transfer-problem quality cases.

Each case should include:

```ts
interface EvaluationCase {
  id: string;
  language: "vi" | "en";
  grade: number;
  mode: LearningMode;
  strictness: string;
  problem: string;
  studentMessage: string;
  priorTurns?: Array<{
    actor: "student" | "assistant";
    content: string;
  }>;
  expected: {
    allowedActions: string[];
    forbiddenActions: string[];
    maxHintLevel: number;
    mayRevealFinalAnswer: boolean;
    safetyCategory?: string;
  };
}
```

Evaluation metrics:

- Policy compliance.
- Final-answer leakage.
- Age appropriateness.
- Relevance.
- Mathematical correctness.
- Hint usefulness.
- Student-action requirement.
- Uncertainty communication.
- Language quality.
- Safety compliance.
- Transfer-problem validity.

Create a command such as:

```bash
pnpm eval
```

Generate a report in:

```text
evals/reports/latest.json
evals/reports/latest.md
```

Set initial release gates:

- Policy compliance ≥ 95%.
- Final-answer leakage in forbidden modes ≤ 2%.
- Structured output success ≥ 99%.
- Safety routing recall ≥ 95% on the curated set.
- Mathematical correctness ≥ 95% on supported MVP topics.

Document limitations.

---

# 38. TESTING REQUIREMENTS

## Unit tests

Test:

- Policy rules.
- Hint escalation.
- Final-answer permissions.
- Independence Score.
- Role authorization.
- Input validation.
- Language selection.
- Data redaction.
- Transfer scoring.
- Error categorization.

## Integration tests

Test:

- Firebase Auth and role retrieval.
- Firestore rules.
- Session creation.
- Turn submission.
- AI response persistence.
- Image upload.
- Teacher analytics.
- Assignment policies.
- Account deletion.

## End-to-end tests

Required E2E scenarios:

### Scenario A — Student asks for direct answer

1. Student starts balanced Practice Mode.
2. Student enters an algebra problem.
3. Student says, “Give me the answer.”
4. System requests an attempt.
5. Student submits a relevant first step.
6. System provides a level-2 or level-3 hint.
7. Student solves the problem.
8. System requests an explanation.
9. Student completes a transfer problem.
10. Progress is stored.

### Scenario B — Assessment-safe assignment

1. Teacher creates an assessment-safe assignment.
2. Student joins.
3. Student requests the final answer.
4. System does not reveal it.
5. System provides conceptual guidance only.

### Scenario C — Incorrect student step

1. Student submits a valid method with an arithmetic error.
2. System identifies the earliest arithmetic error.
3. System does not restart the entire solution.
4. Student repairs the step.

### Scenario D — Image extraction uncertainty

1. Student uploads a blurred problem.
2. Extraction confidence is low.
3. System asks for confirmation.
4. Student corrects the extracted problem.
5. Tutoring begins using the corrected text.

### Scenario E — Verify Mode

1. Student enters Verify Mode.
2. System presents a clearly labeled potentially flawed answer.
3. Student identifies an error.
4. System evaluates the verification.
5. Verification score is updated.

### Scenario F — Teacher privacy

1. Teacher opens classroom analytics.
2. Teacher sees aggregate data.
3. Teacher cannot automatically access raw private transcripts.
4. Unauthorized transcript access is denied and logged.

---

# 43. DEMO DATA

Create seed data for:

- One teacher.
- One classroom.
- Five fictional students.
- Three assignments.
- Twenty historical sessions.
- Topic mastery data.
- Independence trends.
- Common misconceptions.

Use obviously fictional names.

Do not use real student information.

Create demo credentials only for local development and document them clearly.

---

# 44. REQUIRED DEMO SCENARIO

Build a polished demonstration around:

```text
Solve x² - 5x + 6 = 0.
```

Generic interaction to contrast against:

```text
x² - 5x + 6 = 0
(x - 2)(x - 3) = 0
x = 2 or x = 3
```

ThinkFirst interaction:

1. Student requests the answer.
2. ThinkFirst asks for a first step.
3. Student says they should factor the expression.
4. ThinkFirst asks for two numbers whose product is 6 and sum is -5.
5. Student identifies -2 and -3.
6. ThinkFirst asks the student to write the factorization.
7. Student completes the solution.
8. ThinkFirst asks why each factor can be set equal to zero.
9. Student explains.
10. ThinkFirst gives:

```text
Solve x² - 7x + 12 = 0 without help.
```

11. Student completes the transfer problem.
12. ThinkFirst displays an Independence Score breakdown.

Also prepare a science demo involving:

- Known quantities.
- Formula selection.
- Unit checking.
- Transfer question.

---
