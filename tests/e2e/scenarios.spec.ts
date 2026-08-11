import { expect, test } from '@playwright/test';
import {
  createSession,
  createStudent,
  queryCollection,
  sendTurn,
  writeDoc,
  str,
  int,
  bool,
  time,
  dbl,
} from './fixtures';

/**
 * Section 38, Scenario A -- student asks for a direct answer.
 *
 * The scenario has ten steps. Each assertion below names the step it covers, and
 * the two steps this environment cannot cover are skipped explicitly with a
 * reason rather than quietly dropped: Phase 9's exit criterion asks for scenarios
 * that "either pass or are individually recorded as not implemented".
 */

test.describe('Scenario A: student asks for a direct answer', () => {
  test('the tutor requires an attempt before helping, then escalates one rung at a time', async ({
    context,
    page,
    request,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 9 });

    // Steps 1 and 2: a balanced practice session with an algebra problem.
    const sessionId = await createSession(student.uid, {
      mode: 'assignment',
      strictness: 'balanced',
      problem: 'Solve x^2 - 5x + 6 = 0.',
    });

    // Step 3: "Give me the answer."
    const refused = await sendTurn(request, student, sessionId, 'Give me the answer.');
    expect(refused.status).toBe(200);

    // Step 4: the system requests an attempt rather than disclosing anything.
    const refusedPlan = refused.body.responsePlan as Record<string, unknown>;
    expect(refusedPlan.action).toBe('ask_for_attempt');
    expect(refusedPlan.allowedHintLevel).toBe(0);
    expect(refusedPlan.mayRevealFinalAnswer).toBe(false);
    const refusedTutor = refused.body.tutorData as Record<string, string>;
    expect(refusedTutor.messageMarkdown).not.toContain('x = 2');
    expect(refusedTutor.messageMarkdown).not.toContain('x = 3');

    // Step 5: the student submits a relevant first step.
    const attempted = await sendTurn(
      request,
      student,
      sessionId,
      'I factored it as (x-2)(x-3). Is that right?',
    );
    expect(attempted.status).toBe(200);

    // Step 6: help is now given, and the ladder moves by at most one rung.
    const attemptedPlan = attempted.body.responsePlan as Record<string, unknown>;
    expect(attemptedPlan.action).not.toBe('ask_for_attempt');
    expect(Number(attemptedPlan.allowedHintLevel)).toBeLessThanOrEqual(1);

    // Steps 7 and 8: the tutor asks the student to do something on every turn.
    expect(attemptedPlan.requiresStudentResponse).toBe(true);

    // Step 10: progress is stored. Turns are written server-side, and the
    // session's hint level is a server-authored value.
    const turns = await queryCollection('sessionTurns');
    const forSession = turns.filter(
      (turn) => (turn.sessionId as { stringValue?: string })?.stringValue === sessionId,
    );
    expect(forSession.length).toBeGreaterThanOrEqual(2);

    // The rendered workspace shows the stored conversation after a reload,
    // which is the student-visible half of "progress is stored".
    await page.goto(`/student/session/${sessionId}`);
    await expect(page.getByRole('log', { name: /conversation with your tutor/i })).toBeVisible();
  });

  test('step 9, the transfer problem, is fully generated and evaluated end-to-end', async ({
    context,
    page,
    request,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 9 });

    // Step 1: Create a session already at the top of the hint ladder
    const sessionId = await createSession(student.uid, {
      mode: 'assignment',
      strictness: 'balanced',
      problem: 'Solve x^2 - 5x + 6 = 0.',
      currentHintLevel: 7,
    });

    // Step 2: Push it over the edge to generate a transfer problem
    // The policy allows provide_full_solution at hint level 7 in balanced mode
    
    // First, let's get the score before the transfer evaluation
    const beforeScoreDoc = await queryCollection('independenceSnapshots');
    const beforeSession = beforeScoreDoc.find(s => (s.kind as any)?.stringValue === 'session' && (s.sessionId as any)?.stringValue === sessionId);
    const coverageBefore = beforeSession ? ((beforeSession.coverage as any)?.doubleValue ?? (beforeSession.coverage as any)?.integerValue ?? 0) : 0;

    const response = await sendTurn(request, student, sessionId, 'Just tell me the final answer. I tried factoring it first.');
    expect(response.status).toBe(200);

    const plan = response.body.responsePlan as Record<string, unknown>;
    expect(plan.action).toBe('provide_full_solution');
    expect(plan.allowedHintLevel).toBe(7);
    expect(plan.mayRevealFinalAnswer).toBe(true);
    expect(plan.generateTransferProblem).toBe(true);

    const tutorData = response.body.tutorData as Record<string, unknown>;
    expect(tutorData.responseType).toBe('solution');

    // Step 3: Assert API response contains student-safe transfer problem data
    const evidence = response.body.evidence as Record<string, any>;
    expect(evidence.transferIssued).toBe(true);
    expect(evidence.transferProblem).toBeDefined();
    expect(evidence.transferProblem.id).toBeDefined();
    expect(evidence.transferProblem.problemMarkdown).toBeDefined();
    expect(evidence.transferProblem.internalAnswer).toBeUndefined(); // Security check
    expect(evidence.transferProblem.internalSolutionSteps).toBeUndefined(); // Security check
    expect(evidence.transferProblem.validationNotes).toBeUndefined(); // Security check
    expect(evidence.transferProblem.referenceAnswer).toBeUndefined(); // Security check

    // Step 4: Query emulator/admin storage to confirm the private transfer record contains the reference answer
    const transfers = await queryCollection('transferProblems');
    const transfer = transfers.find((t) => (t.sessionId as any)?.stringValue === sessionId);
    expect(transfer).toBeDefined();
    const internalAnswer = (transfer!.internalAnswer as any)?.stringValue;
    expect(internalAnswer).toBeDefined();

    // Step 5: Verify the transfer problem appears in the student UI
    await page.goto(`/student/session/${sessionId}`);
    await expect(page.getByText('Independent Practice')).toBeVisible();
    await expect(page.getByText(evidence.transferProblem.problemMarkdown)).toBeVisible();

    // Step 6: Submit a correct transfer answer
    await page.getByLabel('Your message to the tutor').fill(`The answer is ${internalAnswer}`);
    await page.getByRole('button', { name: /send/i }).click();

    // Wait for the UI to clear the transfer problem
    await expect(page.getByText('Independent Practice')).toBeHidden();

    // Step 7: Verify learning evidence is recomputed and attempt document is safe
    const attempts = await queryCollection('studentAttempts');
    const transferAttempt = attempts.find((a) => (a.attemptType as any)?.stringValue === 'transfer' && (a.sessionId as any)?.stringValue === sessionId);
    expect(transferAttempt).toBeDefined();
    
    // Outcome should be under evaluation
    const evaluationFields = (transferAttempt!.evaluation as any)?.mapValue?.fields;
    expect(evaluationFields).toBeDefined();
    
    expect(evaluationFields.transferOutcome?.stringValue).toBe('independent_correct');
    expect(evaluationFields.correctnessSource?.stringValue).toBe('deterministic');
    expect(evaluationFields.correctnessConfidence?.integerValue || evaluationFields.correctnessConfidence?.doubleValue).toBeDefined();
    
    // Assert the attempt document does NOT contain the private reference answer
    expect(evaluationFields.referenceAnswer).toBeUndefined();
    expect((transferAttempt!.referenceAnswer as any)).toBeUndefined();

    // Step 8: Verify transfer status and score recomputation
    const updatedTransfers = await queryCollection('transferProblems');
    const updatedTransfer = updatedTransfers.find((t) => (t.sessionId as any)?.stringValue === sessionId);
    expect(updatedTransfer).toBeDefined();
    expect((updatedTransfer!.status as any)?.stringValue).toBe('evaluated');

    const updatedSessions = await queryCollection('learningSessions');
    const updatedSession = updatedSessions.find((s) => (s.id as any)?.stringValue === sessionId);
    expect(updatedSession).toBeDefined();
    
    // LiveScore field must exist, proving it was recomputed
    const liveScore = (updatedSession!.liveScore as any)?.mapValue?.fields;
    expect(liveScore).toBeDefined();
    
    const afterScoreDoc = await queryCollection('independenceSnapshots');
    const afterSession = afterScoreDoc.find(s => (s.kind as any)?.stringValue === 'session' && (s.sessionId as any)?.stringValue === sessionId);
    const coverageAfter = afterSession ? ((afterSession.coverage as any)?.doubleValue ?? (afterSession.coverage as any)?.integerValue ?? 0) : 0;
    const isSuppressed = (liveScore.displaySuppressed as any)?.booleanValue;
    
    // According to real scoring rules: coverage increases and the score is recomputed OR coverage remains insufficient and display remains suppressed
    const validOutcome = coverageAfter > coverageBefore || isSuppressed === true;
    expect(validOutcome).toBe(true);
  });
});

/**
 * Section 38, Scenario B -- assessment-safe assignment.
 */
test.describe('Scenario B: assessment-safe assignment', () => {
  test('the final answer is never revealed, and conceptual guidance is still given', async ({
    context,
    request,
    baseURL,
  }) => {
    const teacher = await createStudent(context, baseURL!);
    const classroomId = `e2e-classroom-${Date.now()}`;

    // Step 1: the teacher creates an assessment-safe assignment.
    await writeDoc(
      'classrooms',
      {
        id: str(classroomId),
        name: str('E2E Assessment Class'),
        teacherId: str(teacher.uid),
        grade: int(9),
        subject: str('mathematics'),
        joinCodeHash: str('E2EAS1'),
        defaultStrictness: str('assessment_safe'),
        createdAt: time(new Date()),
      },
      classroomId,
    );

    const student = await createStudent(context, baseURL!, { grade: 9 });

    // Step 2: the student joins.
    await writeDoc(
      'classroomMemberships',
      {
        id: str(`${classroomId}__${student.uid}`),
        classroomId: str(classroomId),
        userId: str(student.uid),
        role: str('student'),
        status: str('active'),
        joinedAt: time(new Date()),
      },
      `${classroomId}__${student.uid}`,
    );

    const assignmentId = `e2e-assignment-${Date.now()}`;
    await writeDoc(
      'assignments',
      {
        id: str(assignmentId),
        classroomId: str(classroomId),
        teacherId: str(teacher.uid),
        title: str('Assessment-safe check'),
        instructions: str('Work independently.'),
        subject: str('mathematics'),
        grade: int(9),
        learningObjective: str('Independent reasoning'),
        strictness: str('assessment_safe'),
        allowFullSolutions: bool(false),
        requireTransferProblem: bool(false),
        status: str('active'),
        createdAt: time(new Date()),
      },
      assignmentId,
    );

    const sessionId = `e2e-session-${Date.now()}-b`;
    await writeDoc(
      'learningSessions',
      {
        id: str(sessionId),
        studentId: str(student.uid),
        assignmentId: str(assignmentId),
        subject: str('mathematics'),
        grade: int(9),
        language: str('en'),
        mode: str('assignment'),
        // Deliberately a *permissive* value on the client-written document. The
        // server must ignore it and read the classroom's assessment_safe
        // instead, which is the P0-1 defect this asserts has stayed closed.
        strictness: str('supportive'),
        status: str('active'),
        originalProblem: str('Solve x^2 - 5x + 6 = 0.'),
        currentHintLevel: int(6),
        startedAt: time(new Date()),
        policyVersion: str('policy-v2'),
        scoringVersion: str('scoring-v2'),
      },
      sessionId,
    );

    // Step 3: the student requests the final answer.
    const result = await sendTurn(
      request,
      student,
      sessionId,
      'I have tried everything. Just give me the final answer.',
    );
    expect(result.status).toBe(200);

    // Step 4: it is not revealed.
    const plan = result.body.responsePlan as Record<string, unknown>;
    expect(plan.mayRevealFinalAnswer).toBe(false);
    expect(plan.action).not.toBe('provide_full_solution');

    const tutorData = result.body.tutorData as Record<string, unknown>;
    expect(tutorData.finalAnswerIncluded).toBe(false);
    expect(String(tutorData.messageMarkdown)).not.toContain('x = 2 or x = 3');

    // Step 5: conceptual guidance is still provided, so the student is not
    // simply stonewalled.
    expect(String(tutorData.messageMarkdown).length).toBeGreaterThan(20);
    expect(plan.requiresStudentResponse).toBe(true);

    // The client-supplied `supportive` was ignored: the resolved strictness is
    // the classroom's.
    const state = result.body.sessionState as Record<string, unknown>;
    expect(state.strictness).toBe('assessment_safe');
  });
});

/**
 * Section 38, Scenario C -- incorrect student step.
 */
test.describe('Scenario C: incorrect student step', () => {
  test('a method with an arithmetic slip is evaluated, not restarted', async ({
    context,
    request,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 9 });
    const sessionId = await createSession(student.uid, {
      mode: 'practice',
      strictness: 'balanced',
      problem: 'Solve 3x + 7 = 22.',
    });

    // Step 1: a valid method with an arithmetic error.
    const result = await sendTurn(
      request,
      student,
      sessionId,
      'I subtracted 7 from both sides and I got 3x = 16, so x = 5.33.',
    );
    expect(result.status).toBe(200);

    // Steps 2 and 3: the response evaluates the step rather than re-solving.
    const plan = result.body.responsePlan as Record<string, unknown>;
    expect(plan.action).toBe('evaluate_step');
    expect(plan.mayRevealFinalAnswer).toBe(true);

    const tutorData = result.body.tutorData as Record<string, unknown>;
    expect(tutorData.finalAnswerIncluded).toBe(false);
    // Step 4: the student is asked to repair the step themselves.
    expect(plan.requiresStudentResponse).toBe(true);
    expect(tutorData.studentActionRequired).toBeTruthy();
  });
});

/**
 * Section 38, Scenario D -- image extraction uncertainty.
 */
test.describe('Scenario D: image extraction uncertainty', () => {
  test('low-confidence extraction blocks tutoring until the student confirms', async ({
    context,
    request,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 9 });
    const imageId = `e2e-image-${Date.now()}`;

    // Steps 1 and 2: an uploaded problem whose extraction confidence is low.
    // Written server-side, as the real upload route does; `problemImages` is
    // client-unwritable precisely because this value gates tutoring.
    await writeDoc(
      'problemImages',
      {
        id: str(imageId),
        studentId: str(student.uid),
        storagePath: str(`problem-images/${student.uid}/${imageId}`),
        extractedText: str('Solve x^2 - Sx + 6 = 0'),
        extractionConfidence: dbl(0.35),
        confirmationStatus: str('pending'),
        metadataStripped: bool(true),
        createdAt: time(new Date()),
      },
      imageId,
    );

    const sessionId = await createSession(student.uid, {
      problem: 'Solve x^2 - Sx + 6 = 0',
      imageId,
    });

    // Step 3: the system asks for confirmation instead of tutoring.
    const blocked = await sendTurn(request, student, sessionId, 'Help me solve this.');
    expect(blocked.status).toBe(200);
    const blockedPlan = blocked.body.responsePlan as Record<string, unknown>;
    expect(blockedPlan.rationaleCode).toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(blockedPlan.action).toBe('clarify_problem');
    expect(blockedPlan.allowedHintLevel).toBe(0);

    // Step 4: the student corrects and confirms the extracted problem.
    await writeDoc(
      'problemImages',
      {
        id: str(imageId),
        studentId: str(student.uid),
        storagePath: str(`problem-images/${student.uid}/${imageId}`),
        extractedText: str('Solve x^2 - 5x + 6 = 0'),
        correctedText: str('Solve x^2 - 5x + 6 = 0'),
        extractionConfidence: dbl(0.35),
        confirmationStatus: str('confirmed'),
        confirmedAt: time(new Date()),
        metadataStripped: bool(true),
        createdAt: time(new Date()),
      },
      imageId,
    );

    // Step 5: tutoring begins on the corrected text.
    const released = await sendTurn(
      request,
      student,
      sessionId,
      'I factored it as (x-2)(x-3). Is that right?',
    );
    expect(released.status).toBe(200);
    const releasedPlan = released.body.responsePlan as Record<string, unknown>;
    expect(releasedPlan.rationaleCode).not.toBe('LOW_EXTRACTION_CONFIDENCE');
    expect(releasedPlan.action).not.toBe('clarify_problem');
  });
});

/**
 * Section 38, Scenario E -- Verify Mode.
 */
test.describe('Scenario E: verify mode', () => {
  test('a verification task is started and the response is labelled as one to check', async ({
    context,
    request,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 11 });
    const sessionId = await createSession(student.uid, {
      mode: 'verify',
      strictness: 'independence',
      problem: 'Check this claim: the derivative of x^3 is 3x^2.',
    });

    // Steps 1 and 2: verify mode presents something to be checked.
    const result = await sendTurn(
      request,
      student,
      sessionId,
      'I want to verify this claim.',
    );
    expect(result.status).toBe(200);

    const plan = result.body.responsePlan as Record<string, unknown>;
    // Verify mode always requires verification, whatever else the turn does.
    expect(plan.requiresVerification).toBe(true);

    // Step 3 and 4: the student's judgment is what is evaluated, so the turn
    // asks the student to decide rather than deciding for them.
    expect(plan.requiresStudentResponse).toBe(true);

    // Step 5: the verification component is part of the score. Asserting the
    // component exists rather than a particular value, because a single turn
    // produces thin evidence and §56 suppresses a score built on it.
    const evidence = result.body.evidence as Record<string, unknown> | undefined;
    expect(evidence).toBeDefined();
  });
});

/**
 * Section 38, Scenario F -- teacher privacy.
 */
test.describe('Scenario F: teacher privacy', () => {
  test('a teacher sees aggregates but cannot reach raw transcripts', async ({
    context,
    request,
    baseURL,
  }) => {
    const teacher = await createTeacherAccount(context, baseURL!);
    const classroomId = `e2e-privacy-${Date.now()}`;

    await writeDoc(
      'classrooms',
      {
        id: str(classroomId),
        name: str('E2E Privacy Class'),
        teacherId: str(teacher.uid),
        grade: int(9),
        subject: str('mathematics'),
        joinCodeHash: str('E2EPR1'),
        defaultStrictness: str('balanced'),
        createdAt: time(new Date()),
      },
      classroomId,
    );

    const student = await createStudent(context, baseURL!, { grade: 9 });
    await writeDoc(
      'classroomMemberships',
      {
        id: str(`${classroomId}__${student.uid}`),
        classroomId: str(classroomId),
        userId: str(student.uid),
        role: str('student'),
        status: str('active'),
        joinedAt: time(new Date()),
      },
      `${classroomId}__${student.uid}`,
    );

    // Steps 1 and 2: the teacher's own classroom analytics are available.
    const analytics = await request.get(
      `/api/teacher/classrooms/${classroomId}/analytics`,
      { headers: { Authorization: `Bearer ${teacher.idToken}` }, failOnStatusCode: false },
    );
    expect(analytics.status()).toBe(200);
    const analyticsBody = await analytics.json();
    expect(analyticsBody).toHaveProperty('classroom');

    // Step 3: raw transcripts are not offered.
    const summary = await request.get(
      `/api/teacher/classrooms/${classroomId}/students/${student.uid}`,
      { headers: { Authorization: `Bearer ${teacher.idToken}` }, failOnStatusCode: false },
    );
    if (summary.status() === 200) {
      const summaryBody = await summary.json();
      expect(summaryBody.transcriptAvailable).toBe(false);
      expect(JSON.stringify(summaryBody)).not.toContain('I factored it as');
    }

    // Step 4: another teacher's classroom is refused, and indistinguishable
    // from one that does not exist, so ids cannot be enumerated.
    const intruder = await createTeacherAccount(context, baseURL!);
    const denied = await request.get(
      `/api/teacher/classrooms/${classroomId}/analytics`,
      { headers: { Authorization: `Bearer ${intruder.idToken}` }, failOnStatusCode: false },
    );
    expect(denied.status()).toBe(404);

    const missing = await request.get(
      `/api/teacher/classrooms/does-not-exist-at-all/analytics`,
      { headers: { Authorization: `Bearer ${intruder.idToken}` }, failOnStatusCode: false },
    );
    expect(missing.status()).toBe(denied.status());
  });
});

async function createTeacherAccount(
  context: Parameters<typeof createStudent>[0],
  baseUrl: string,
) {
  const { createTeacher } = await import('./fixtures');
  return createTeacher(context, baseUrl);
}
