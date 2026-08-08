<!--
ThinkFirst split instruction module.
Read 00_AGENT_ROUTER.md before using this file.
Original sections: 30, 31, 32, 33, 34, 40.
The instruction body below is copied verbatim from the uploaded master file.
-->

# 30. FRONTEND PAGES

Implement the following routes.

## Public

```text
/
 /about
 /privacy
 /safety
 /sign-in
```

## Student

```text
/student
/student/onboarding
/student/session/new
/student/session/[sessionId]
/student/progress
/student/progress/[topic]
/student/assignments
/student/settings
```

## Teacher

```text
/teacher
/teacher/classrooms
/teacher/classrooms/new
/teacher/classrooms/[classroomId]
/teacher/classrooms/[classroomId]/students/[studentId]
/teacher/classrooms/[classroomId]/assignments/new
/teacher/assignments/[assignmentId]
/teacher/settings
```

## Admin

```text
/admin
/admin/policies
/admin/reports
/admin/audit
```

Protect routes based on role.

---

# 31. STUDENT UI DESIGN

The interface should feel calm, supportive and focused.

Avoid:

- Excessive gamification.
- Flashing rewards.
- Competitive rankings.
- Manipulative streak pressure.
- Childish design for secondary students.
- Dense dashboards.
- Chatbot-only layouts.

Use:

- Clear hierarchy.
- Generous spacing.
- Accessible typography.
- Strong focus states.
- Keyboard navigation.
- Responsive mobile design.
- High contrast.
- Reduced motion support.
- Screen-reader labels.
- Clear loading states.
- Skeletons for AI processing.
- Error recovery.

## Learning workspace layout

Desktop:

```text
┌─────────────────────────────────────────────────────────┐
│ Header: Mode | Topic | Hint level | Session progress    │
├──────────────────────────┬──────────────────────────────┤
│ Problem                  │ Guided conversation          │
│                          │                              │
│ Original problem         │ AI message                   │
│ Image if present         │ Student response             │
│                          │ Suggested actions             │
├──────────────────────────┼──────────────────────────────┤
│ Scratchpad               │ Session controls             │
└──────────────────────────┴──────────────────────────────┘
```

Mobile:

- Problem collapsible section.
- Conversation as main view.
- Scratchpad accessible by tab.
- Persistent mode and hint indicator.

## Suggested student actions

Display context-dependent action chips:

- “Here is my first step.”
- “Check this calculation.”
- “Give me a smaller hint.”
- “Explain the concept.”
- “Explain it differently.”
- “I think the AI may be wrong.”
- “I’m ready to try alone.”

Do not let suggested actions replace free-text input.

---

# 32. TEACHER DASHBOARD DESIGN

Teacher dashboard cards:

- Students active this week.
- Sessions completed.
- Independent transfer success.
- Average hint level.
- Attempt-before-help rate.
- Topics needing review.
- Reported AI issues.

Charts:

- Independence trend over time.
- Guided versus independent accuracy.
- Hint-level distribution.
- Topic mastery matrix.
- Common error categories.

Do not use charts that imply causation without evidence.

Include explanatory tooltips.

Example:

> Transfer success measures performance on a similar problem after guided assistance. It is not an official grade.

---

# 33. INTERNATIONALIZATION

Support:

- Vietnamese: `vi`.
- English: `en`.

All UI strings must use translation files.

Do not hardcode visible interface text in components.

AI responses should follow the student’s selected language.

Mathematical notation should remain standard.

Use natural Vietnamese educational language.

Avoid awkward literal translations.

Create translation namespaces:

- common.
- auth.
- onboarding.
- student.
- teacher.
- session.
- progress.
- safety.
- errors.
- accessibility.

---

# 34. IMAGE INPUT

Students can upload photographs or screenshots of problems.

Requirements:

1. Validate file type.
2. Validate file size.
3. Strip unnecessary metadata when possible.
4. Store privately.
5. Use signed or authenticated access.
6. Send image to the configured multimodal Gemini model.
7. Extract only educational content.
8. Return extracted text and confidence.
9. Ask the student to confirm or edit the extraction.
10. Begin tutoring only after confirmation when confidence is low.

Show:

- Original image.
- Extracted question.
- “Edit extracted text” button.
- Extraction-confidence warning when needed.

Do not perform face recognition.

Do not identify people in uploaded images.

Warn students not to upload personal documents or images containing private information.

---

# 40. ACCESSIBILITY

Target WCAG 2.2 AA where practical.

Implement:

- Keyboard navigation.
- Visible focus indicators.
- Semantic landmarks.
- Proper labels.
- Accessible dialogs.
- Accessible form errors.
- Sufficient contrast.
- Reduced motion.
- Text resizing.
- Screen-reader announcements for AI response loading and completion.
- Alternative text for instructional images.
- No color-only meaning.
- Accessible mathematics rendering where supported.

Allow students to configure:

- Larger text.
- Reduced motion.
- Simplified interface.
- Increased spacing.
- Read-aloud readiness.
- Additional response time where relevant.

Accessibility settings must not reduce the Independence Score.

---
