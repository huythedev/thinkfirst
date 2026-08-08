<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 1, 2, 3, 4, 5, 6.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 1. PRODUCT MISSION

ThinkFirst is an adaptive AI learning assistant for primary and secondary school students.

General-purpose AI tools often optimize for giving users a complete answer as quickly as possible. That behavior can cause students to copy answers, avoid productive struggle, lose confidence in independent thinking and become unable to evaluate whether an AI response is correct.

ThinkFirst must optimize for a different outcome:

> Help students become progressively less dependent on AI while improving their ability to reason, explain, verify and independently solve new problems.

The application must not simply block AI usage. It must teach students how to use AI appropriately.

The system should:

1. Require meaningful student participation before providing substantial help.
2. Adapt assistance to the student’s grade, demonstrated ability and current learning mode.
3. Provide progressive hints rather than immediately revealing final answers.
4. Ask students to explain their reasoning.
5. Teach students to question and verify AI outputs.
6. Measure whether learning transfers to a new problem without AI assistance.
7. Track changes in independence over time.
8. Protect minors’ privacy and avoid surveillance-oriented product design.
9. Provide teachers with actionable learning insights.
10. Avoid presenting AI-generated content as unquestionably correct.

---

# 2. PRIMARY PRODUCT STATEMENT

Use the following statement throughout product documentation:

> ThinkFirst is an adaptive AI learning layer that changes how AI responds based on a student’s age, ability, task and level of dependence. Instead of completing schoolwork for students, it requires them to attempt, explain, verify and transfer their knowledge.

Primary success question:

> Can the student solve a similar problem after AI assistance is removed?

---

# 3. MVP SCOPE

Build an MVP for:

- Vietnamese students in grades 6–9.
- Mathematics as the primary supported subject.
- Basic science as a secondary supported subject.
- Vietnamese and English user interfaces.
- Text-based and image-based problem input.
- Individual student accounts.
- Teacher accounts and classrooms.
- Adaptive tutoring sessions.
- Progressive hints.
- Transfer problems.
- Independence scoring.
- Student progress dashboards.
- Teacher analytics dashboards.
- Teacher-created assignments.
- Configurable AI behavior policies.

Design the architecture so it can later support:

- Primary students.
- Grades 10–12.
- Essay writing.
- History and social science.
- Voice input.
- Parent accounts.
- School administration.
- Curriculum integrations.
- Learning management system integrations.

Do not implement all future features in the MVP.

---

# 4. NON-GOALS

Do not build:

- A general-purpose chatbot.
- A tool that automatically completes homework.
- An unrestricted essay generator.
- A system that assigns official grades.
- A plagiarism detector.
- A psychological diagnosis system.
- A student surveillance system.
- A public social network.
- A leaderboard that ranks students by intelligence.
- A system that secretly gives students false information.
- A replacement for teachers.
- A high-stakes examination platform.
- A system that claims legal, medical or psychological certainty.
- A product that stores unnecessary sensitive information about minors.

---

# 5. CORE PRODUCT PRINCIPLES

Every implementation decision must follow these principles.

## 5.1 Attempt before assistance

When appropriate, the student must provide an attempt, prediction, explanation or first step before receiving substantial help.

The system should not enforce this rigidly when:

- The student is learning a completely new concept.
- The teacher has enabled worked-example mode.
- The student has an accessibility accommodation.
- The student genuinely does not understand the question.
- The problem is malformed or missing information.

## 5.2 Minimum sufficient help

Give only enough assistance to let the student make the next meaningful step.

Do not provide the entire solution when a smaller hint would be sufficient.

## 5.3 Productive friction

The product should make copying less convenient than thinking, but it must not make learning frustrating.

Productive friction includes:

- Asking for a first attempt.
- Asking the student to choose between possible strategies.
- Asking for an explanation.
- Requiring the student to fill in an intermediate step.
- Asking the student to verify the result.

Productive friction must not include:

- Repetitive refusal messages.
- Punitive language.
- Shame.
- Artificial delays.
- Excessive questioning.
- Treating all help requests as cheating.

## 5.4 Age-appropriate communication

Younger students require:

- Shorter sentences.
- Concrete examples.
- One instruction at a time.
- Less text.
- Clearer vocabulary.
- More visual support.
- Stronger safety controls.

Older students can receive:

- More abstract explanations.
- Counterarguments.
- Evidence evaluation.
- Multiple solution methods.
- Deeper reflection questions.

## 5.5 Appropriate reliance

Students should learn:

- When AI is useful.
- When AI should be questioned.
- How to check an answer.
- How to identify uncertainty.
- How to compare methods.
- How to solve without AI.

## 5.6 Learning over completion

The application should optimize for demonstrated understanding, not the number of tasks completed.

## 5.7 No hidden manipulation

Do not secretly insert incorrect information to test a student.

A teacher-approved **Verify Mode** may show a clearly framed sample AI answer that may contain a mistake. The student must be explicitly told that the answer is being presented as a verification exercise.

## 5.8 Privacy by default

Collect the minimum data necessary.

Do not expose full student conversations to teachers by default.

Teacher dashboards should emphasize:

- Topic mastery.
- Hint usage.
- Transfer success.
- Common misconceptions.
- Participation.
- Changes over time.

Transcript access should require a clear reason, appropriate authorization and an auditable action.

---

# 6. USER ROLES

Implement role-based access control for the following roles.

## 6.1 Student

A student can:

- Create or join an account flow appropriate for the deployment.
- Join a classroom using an invitation code.
- Select grade and preferred language.
- Start a learning session.
- Enter a problem manually.
- Upload an image of a problem.
- Choose a learning mode.
- Use a scratchpad.
- Submit attempts.
- Receive adaptive hints.
- Explain their reasoning.
- Complete transfer problems.
- View personal progress.
- Review concepts that require more practice.
- Report an incorrect or unhelpful AI answer.

A student cannot:

- Modify AI policy settings.
- Access another student’s information.
- View hidden teacher notes.
- Use teacher-only worked-solution controls.
- Export another user’s data.

## 6.2 Teacher

A teacher can:

- Create classrooms.
- Invite students.
- Create assignments.
- Set subject, grade and learning objective.
- Configure allowed learning modes.
- Configure assistance strictness.
- View classroom-level analytics.
- View individual progress summaries.
- View misconceptions and hint dependence.
- Create or approve transfer problems.
- Mark generated content as incorrect.
- Review safety flags when authorized.
- Export aggregate classroom data.

A teacher should not automatically see every private student message.

## 6.3 Administrator

An administrator can:

- Manage global policy configurations.
- Manage supported subjects and grade bands.
- Review system health.
- Review anonymized evaluation data.
- Manage safety configurations.
- Manage retention settings.
- Review audit logs.
- Disable users or classrooms when required.
- Configure locale-specific help resources.

Admin features may use a minimal internal interface in the MVP.

---
