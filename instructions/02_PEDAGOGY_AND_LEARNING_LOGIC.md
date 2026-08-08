<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 7, 8, 9, 10, 11, 12, 13.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 7. LEARNING MODES

Implement four primary learning modes.

## 7.1 Learn Mode

Purpose:

- Introduce or explain a concept.
- Build understanding using examples and guided questions.

Behavior:

- Ask what the student already knows.
- Explain the concept in age-appropriate language.
- Use one small example.
- Ask a check-for-understanding question.
- Avoid unnecessarily long lectures.
- Offer a short practice task.

Full worked examples are allowed in this mode when the example is clearly not the student’s assessed assignment.

## 7.2 Practice Mode

Purpose:

- Help the student solve problems while maintaining productive struggle.

Behavior:

- Require a first attempt when appropriate.
- Use the progressive hint ladder.
- Evaluate each attempt.
- Give feedback on the process.
- End with an independent transfer problem.

## 7.3 Assignment Mode

Purpose:

- Help students understand assigned work without producing submission-ready work for them.

Behavior:

- Clarify the question.
- Explain relevant concepts.
- Help create a plan.
- Review the student’s own work.
- Identify mistakes.
- Ask questions that lead the student forward.
- Avoid providing a complete final submission unless the teacher’s assignment policy explicitly permits worked solutions.

For mathematics:

- Do not immediately reveal the final numerical answer.
- Ask for the next step.
- Reveal a complete solution only after sufficient engagement or when policy allows it.

For essays in future versions:

- Help brainstorm, outline and review.
- Do not generate a final essay that can be directly submitted without substantial student contribution.

## 7.4 Verify Mode

Purpose:

- Teach students to critically evaluate AI-generated content.

Behavior:

- Present a clearly labeled sample answer.
- Tell the student the sample may contain an error.
- Ask the student to identify claims, assumptions or calculations that require checking.
- Ask for evidence or recalculation.
- Reveal feedback only after the student attempts verification.
- Explain why the answer is correct or incorrect.
- Track verification ability.

Never secretly pretend that a deliberately flawed answer is trustworthy.

---

# 8. PROGRESSIVE HINT LADDER

Implement a configurable hint ladder with seven levels.

## Level 0 — Clarify

- Restate the problem.
- Ask whether the student understands the task.
- Identify missing information.

## Level 1 — Recall

- Remind the student of a relevant definition, formula or concept.
- Do not apply it directly to the whole problem.

## Level 2 — Strategy choice

- Ask the student to choose a method.
- Provide two or three reasonable strategies if necessary.

## Level 3 — Guiding question

- Ask a targeted question that points toward the next step.

## Level 4 — Partial setup

- Show the setup for the next step.
- Leave an important value or transformation for the student to complete.

## Level 5 — Worked next step

- Demonstrate exactly one step.
- Ask the student to continue.

## Level 6 — Partial solution

- Show most of the process but require the student to complete or explain a meaningful part.

## Level 7 — Full solution and reflection

A full solution may be shown only when policy allows it.

After showing a full solution:

- Ask the student to explain the key idea.
- Ask the student to identify where they became stuck.
- Provide a new transfer problem.
- Do not mark the topic as mastered merely because the solution was displayed.

The selected hint level must be stored for every AI response.

---

# 9. ASSISTANCE STRICTNESS

Teachers or administrators can configure assistance strictness.

## Supportive

- Fewer barriers.
- Earlier explanations.
- Suitable for learning new material.
- Full worked examples may appear sooner.

## Balanced

- Default setting.
- Requires an attempt before substantial help.
- Uses progressive hints.
- Full solutions require meaningful participation.

## Independence-focused

- Requires more student explanation.
- Limits direct answer disclosure.
- Uses transfer questions more frequently.
- Suitable for practice and revision.

## Assessment-safe

- No final answers.
- No complete worked solutions.
- Only clarification, conceptual reminders and process feedback.
- Must be visually indicated to students.

Store strictness as a policy field rather than hardcoding it into UI components.

---

# 10. AGE AND GRADE BEHAVIOR

Create configurable behavior profiles.

## 10.1 Grade band A: Grades 3–5

Prepare the architecture, but this grade band does not need full curriculum support in the MVP.

Behavior rules:

- Maximum one main instruction per message.
- Prefer sentences under approximately 15 words.
- Avoid advanced terminology unless defined.
- Use concrete objects and visual descriptions.
- Ask simple prediction questions.
- Give praise for strategies and effort.
- Never use shame or comparison.
- Strongly limit long generated responses.
- Encourage asking a trusted adult when appropriate.

## 10.2 Grade band B: Grades 6–9

This is the primary MVP profile.

Behavior rules:

- Use clear but not childish language.
- Ask students to show intermediate reasoning.
- Encourage formula selection and unit checking.
- Ask students to compare alternative approaches.
- Ask confidence questions occasionally.
- Explain errors precisely.
- Use short paragraphs and structured steps.
- Require transfer practice after meaningful assistance.

## 10.3 Grade band C: Grades 10–12

Prepare the architecture.

Behavior rules:

- Encourage evidence evaluation.
- Introduce counterarguments.
- Ask for assumptions.
- Discuss limitations of methods.
- Use more technical language.
- Encourage independent verification and source comparison.

---

# 11. SUBJECT-SPECIFIC BEHAVIOR

## 11.1 Mathematics

The tutor must:

- Parse the problem.
- Identify the likely topic.
- Identify required prerequisites.
- Check whether the problem has sufficient information.
- Evaluate the student’s intermediate steps.
- Distinguish conceptual errors from arithmetic errors.
- Preserve the student’s chosen method when valid.
- Check the final result.
- Ask for units where relevant.
- Generate a similar transfer problem.
- Avoid pretending certainty when notation is ambiguous.

For image uploads:

- Extract the visible question.
- Show the extracted text to the student.
- Allow correction before analysis.
- Never silently rely on uncertain extraction.

## 11.2 Science

The tutor must:

- Identify the concept.
- Ask the student to describe known quantities.
- Require units.
- Distinguish observation, hypothesis, model and conclusion.
- Explain assumptions.
- Avoid presenting uncertain scientific claims as facts.
- Encourage the student to connect formulas to physical meaning.

## 11.3 Writing support

Do not fully implement this subject in the MVP, but create policy interfaces that can later support:

- Brainstorming.
- Outlining.
- Feedback.
- Argument evaluation.
- Source checking.
- Revision.

---

# 12. CORE USER FLOWS

## 12.1 Student onboarding

Required steps:

1. Choose interface language.
2. Sign in or create an account.
3. Select student role.
4. Enter display name or approved nickname.
5. Select grade.
6. Select preferred subjects.
7. Join a classroom using an optional code.
8. Show a brief explanation of how ThinkFirst works.
9. Complete one short interactive tutorial.

The tutorial should demonstrate:

- Why the AI asks for an attempt.
- How hints work.
- That AI can be incorrect.
- How the Independence Score is used.
- How to report a problem.

Do not ask students for unnecessary personal information.

## 12.2 Start a learning session

The student chooses:

- Subject.
- Topic, when known.
- Learning mode.
- Text input or image upload.
- Optional assignment.
- Preferred language.

The application creates a session and opens the learning workspace.

## 12.3 Learning workspace

The workspace should contain:

- Problem panel.
- Chat or guided interaction panel.
- Student scratchpad.
- Hint indicator.
- Session progress.
- Current mode label.
- “Check my step” action.
- “I’m stuck” action.
- “Show a smaller hint” action.
- “Explain differently” action.
- “Report an issue” action.

Do not include a prominent “Give me the answer” button.

## 12.4 Session completion

A session should normally end with:

1. Student explanation.
2. Transfer problem.
3. Independent attempt.
4. Feedback.
5. Independence Score update.
6. A short session summary.
7. Recommended next practice.

## 12.5 Teacher classroom creation

The teacher:

1. Creates a classroom.
2. Selects grade and subject.
3. Receives an invitation code.
4. Configures default assistance strictness.
5. Optionally configures assignment-safe policies.
6. Invites students.

## 12.6 Teacher assignment creation

Fields:

- Title.
- Instructions.
- Grade.
- Subject.
- Topic.
- Learning objective.
- Due date, optional.
- Allowed modes.
- Assistance strictness.
- Whether full solutions are allowed.
- Whether transfer tasks are required.
- Teacher reference answer, optional.
- Rubric or key concepts, optional.

## 12.7 Teacher analytics

Display:

- Active students.
- Completed sessions.
- Average attempt-before-help rate.
- Average hint level.
- Transfer success rate.
- Common misconceptions.
- Topics requiring review.
- Dependence trend.
- Students whose hint dependence has significantly increased.
- AI answers reported as incorrect.

Do not label a student as lazy, weak, dishonest or dependent.

Use neutral educational wording such as:

- “Needs more independent practice.”
- “Frequently requests high-level hints.”
- “Transfer performance is lower than guided performance.”
- “May benefit from teacher review.”

---

# 13. INDEPENDENCE SCORE

> **Amended.** The formula in this section is the original starting point and is
> retained verbatim as the statement of intent. For computing the score, section 56
> of `12_SCORING_MODEL_AND_AGENT_LOGGING.md` governs and supersedes the mechanics
> below. Implementing this section literally reproduces measured defects, including
> a student scoring higher by skipping the transfer task. The product constraints in
> this section (not a grade, not intelligence, never ranked publicly, rolling
> averages, stored version) remain fully in force.

Create an Independence Score between 0 and 100.

It must not be used as an official grade.

It must not be treated as a measure of intelligence.

It should summarize observable learning behaviors.

Use the following starting formula:

```text
Independence Score =
  First Attempt Component       20 points
  Hint Efficiency Component     20 points
  Reasoning Explanation         20 points
  Transfer Performance          30 points
  Verification Behavior         10 points
```

## 13.1 First Attempt Component

- Meaningful attempt before direct help: 20.
- Partial attempt: 10–15.
- No attempt, but valid reason: neutral.
- Repeated answer-seeking with no attempt: 0–5.

## 13.2 Hint Efficiency Component

Suggested scoring:

- Solved with levels 0–2: 20.
- Solved with level 3: 16.
- Solved with level 4: 12.
- Solved with level 5: 8.
- Required level 6: 4.
- Required full solution: 0–2.

Adjust for task difficulty and student mastery.

Do not penalize students for using accessibility accommodations.

## 13.3 Reasoning Explanation Component

Evaluate whether the student can:

- Identify the method.
- Explain important steps.
- Use relevant concepts.
- Explain the final result.

Use a structured rubric.

## 13.4 Transfer Performance Component

- Correct independently: 30.
- Correct with minor prompt: 24.
- Correct after one conceptual hint: 18.
- Partially correct: 8–15.
- Unable to begin: 0–5.

## 13.5 Verification Behavior Component

Evaluate:

- Whether the student checked the answer.
- Whether units were checked.
- Whether assumptions were considered.
- Whether the student identified a possible AI error.
- Whether the student expressed calibrated confidence.

## 13.6 Score presentation

Show:

- Current band.
- Trend.
- Component breakdown.
- One improvement suggestion.

Suggested bands:

- 80–100: Increasingly independent.
- 60–79: Developing independence.
- 40–59: Benefits from guided support.
- 0–39: Needs more structured practice.

Never compare student scores publicly.

Use rolling averages instead of dramatic score changes from one session.

Store both:

- Raw session metrics.
- Computed score snapshot.
- Scoring algorithm version.

---
