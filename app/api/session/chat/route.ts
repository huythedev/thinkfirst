import { NextRequest, NextResponse } from 'next/server';
import { Type, Schema } from '@google/genai';
import { getModelClient, modelNameFor } from '@/lib/ai/model-client';
import { CLASSIFIER_PROMPT_V1 } from '@/services/ai-gateway/src/prompts/classifier.v1';
import { TUTOR_SYSTEM_PROMPT_V1 } from '@/services/ai-gateway/src/prompts/tutor-system.v1';
import { generateResponsePlan } from '@/services/ai-gateway/src/policy';
import { IntentAnalysis, TutorResponse, TutorResponsePlan } from '@/lib/types/ai/schema';
import { chatRequestSchema, MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import {
  SAFE_FALLBACK_INTENT,
  enforceResponsePlan,
  isFullSolutionAllowedThisTurn,
  parseIntentAnalysis,
  parseTutorResponse,
} from '@/lib/types/ai/model-output';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { effectiveHintLevelAfterDelivery } from '@/lib/session/delivered-hint';
import {
  loadTranscript,
  resolvePolicyInputs,
  type ResolvedPolicyInputs,
  type TranscriptTurn,
} from '@/lib/session/policy-inputs';
import {
  evaluateAttempt,
  generateTransferProblem,
  recordAttemptEvaluation,
  resolveTransferOutcome,
} from '@/lib/session/evaluation';
import { persistSessionEvidence } from '@/lib/scoring/server';
import { composeSafetyResponse, messageWithReviewStatus } from '@/lib/safety/response';
import { recordSafetyEvent } from '@/lib/safety/safety-event';
import {
  RATE_LIMITS,
  checkRateLimit,
  rateLimitHeaders,
} from '@/lib/security/rate-limit';

const CLASSIFIER_PROMPT_VERSION = 'classifier-v1';
const TUTOR_PROMPT_VERSION = 'tutor-system-v1';

const intentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, enum: ["concept_explanation", "problem_solving", "step_check", "answer_request", "homework_completion", "verification", "off_topic", "unsafe", "unclear"] },
    subject: { type: Type.STRING, enum: ["mathematics", "science", "other"] },
    topic: { type: Type.STRING, nullable: true },
    estimatedGradeLevel: { type: Type.INTEGER, nullable: true },
    problemStatement: { type: Type.STRING, nullable: true },
    studentProvidedAttempt: { type: Type.BOOLEAN },
    attemptQuality: { type: Type.STRING, enum: ["none", "minimal", "partial", "meaningful"] },
    answerSeekingLikelihood: { type: Type.NUMBER },
    ambiguityLevel: { type: Type.STRING, enum: ["low", "medium", "high"] },
    missingInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
    detectedLanguage: { type: Type.STRING, enum: ["vi", "en", "other"] },
    safetyCategory: { type: Type.STRING, enum: ["none", "self_harm", "abuse", "sexual_content", "violence", "illegal_activity", "bullying", "personal_data", "other"] },
    confidence: { type: Type.NUMBER }
  },
  required: ["intent", "subject", "studentProvidedAttempt", "attemptQuality", "answerSeekingLikelihood", "ambiguityLevel", "missingInformation", "detectedLanguage", "safetyCategory", "confidence"]
};

const tutorSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    messageMarkdown: { type: Type.STRING },
    responseType: { type: Type.STRING, enum: ["question", "hint", "feedback", "explanation", "worked_step", "solution", "transfer_problem", "safety_message"] },
    hintLevel: { type: Type.INTEGER },
    finalAnswerIncluded: { type: Type.BOOLEAN },
    studentActionRequired: { type: Type.STRING, nullable: true },
    checkForUnderstanding: { type: Type.STRING, nullable: true },
    confidenceStatement: { type: Type.STRING, nullable: true },
    learningObjective: { type: Type.STRING, nullable: true },
    internalConceptTags: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["messageMarkdown", "responseType", "hintLevel", "finalAnswerIncluded", "internalConceptTags"]
};

export async function POST(req: NextRequest) {
  // Captured outside the try so the catch can flag the session: by then the
  // request body has been consumed and cannot be re-read.
  let failedSessionId: string | null = null;

  try {
    const auth = await verifyRequest(req);
    if (auth.verificationUnavailable) {
      // Failing closed: without credentials the server cannot tell who is calling.
      return NextResponse.json(
        { error: 'Server is not configured to verify authentication.' },
        { status: 503 },
      );
    }
    if (!auth.uid) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    // Rate limit *after* authentication, deliberately: the per-user key is the
    // verified uid, so an unauthenticated flood cannot consume a real student's
    // quota, and the counter is not spent on requests that were going to be
    // refused anyway. Before any model call, because the point is to bound spend.
    const limit = await checkRateLimit({
      policy: RATE_LIMITS.tutorChat,
      uid: auth.uid,
      headers: req.headers,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests. Please wait a moment before sending another message.',
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    let requestBody;
    try {
      requestBody = await req.json();
    } catch (e) {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const parsed = chatRequestSchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { message, sessionId } = parsed.data;
    failedSessionId = sessionId;

    // Every policy input is read server-side. The request body carries only the
    // session id and the student's message; section 41.1 forbids trusting the
    // rest, and `chatRequestSchema` no longer accepts it.
    const resolution = await resolvePolicyInputs(sessionId, auth.uid);
    if (resolution.status === 'not_found' || resolution.status === 'forbidden') {
      // Another student's session gets the same body as a miss, so the endpoint
      // does not confirm that the id exists.
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    }
    if (resolution.status === 'closed') {
      return NextResponse.json(
        { error: 'This session is closed and cannot accept new tutoring turns.' },
        { status: 409 },
      );
    }

    const policy = resolution.inputs;

    // The transcript is a policy input too: the classifier derives attempt
    // quality from it, and attempt quality gates disclosure. So it is read from
    // Firestore rather than accepted from the caller.
    const transcript = await loadTranscript(sessionId);
    const conversationHistory = transcript
      .map((turn) => `${turn.actor === 'student' ? 'Student' : 'Tutor'}: ${turn.content}`)
      .join('\n');

    const fullContext =
      `Problem: ${policy.originalProblem}\n` +
      `History:\n${conversationHistory}\n` +
      `Student: ${message}`;

    const startedAt = Date.now();

    // Resolved per request rather than at module scope, so a deterministic
    // driver can be selected by the evaluation harness without the shipping
    // code depending on a fixture. Production always resolves to the live
    // client; see `lib/ai/model-client.ts`.
    const ai = getModelClient();

    // 2. Classify intent.
    const classifierModel = process.env.GEMINI_CLASSIFIER_MODEL || 'gemini-3.6-flash';
    const intentResponse = await ai.models.generateContent({
      model: classifierModel,
      contents: [{ role: 'user', parts: [{ text: CLASSIFIER_PROMPT_V1 + '\n\n' + fullContext }] }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: intentSchema,
        temperature: 0.1,
      },
    });

    // Revalidated server-side: the provider's `responseSchema` is a hint, not a
    // guarantee. A classifier that returns nothing usable falls back to the most
    // restrictive analysis rather than to an empty object cast to the type.
    const intentParse = parseIntentAnalysis(intentResponse.text);
    if (!intentParse.ok) {
      console.warn('Classifier output rejected by server-side validation:', intentParse.detail);
    }
    const intentData = intentParse.ok ? intentParse.value : SAFE_FALLBACK_INTENT;

    const pendingTransfer = await loadPendingTransfer(sessionId);

    // 3. Apply the deterministic policy, on trusted inputs only.
    const responsePlan = generateResponsePlan(intentData, {
      mode: policy.mode,
      strictness: policy.strictness,
      currentHintLevel: policy.currentHintLevel,
      hasReceivedFullSolution: policy.currentHintLevel >= MAX_HINT_LEVEL,
      grade: policy.grade,
      allowFullSolutions: policy.allowFullSolutions,
      requireTransferProblem: policy.requireTransferProblem,
      hasPendingTransferProblem: !!pendingTransfer,
      // R6. Supplied only once the student has *not* confirmed the extraction:
      // a confirmed problem is the student's own words and carries no residual
      // extraction risk, so the rule stands down rather than blocking the
      // session permanently. Until this field was passed, R6 was implemented,
      // tested as a pure function, and unreachable from any real request.
      extractionConfidence: policy.extractionConfirmed ? undefined : policy.extractionConfidence,
    });

    // R8, enforced rather than requested. The policy engine has always returned
    // `safety_redirect` here, but until this session the route carried on and
    // asked the tutor model to honour it through a line in its system context --
    // exactly the shape section 41.1 rejects, since "a prompt instruction to obey
    // the plan is not enforcement". A student disclosing self-harm received
    // generated text with no support resources attached.
    //
    // So a safety turn returns here, from constants, with no model call. The one
    // turn that must not be improvised is the one where a child says something is
    // wrong.
    if (responsePlan.action === 'safety_redirect' && intentData.safetyCategory !== 'none') {
      return await handleSafetyTurn({
        sessionId,
        studentId: auth.uid,
        category: intentData.safetyCategory,
        language: policy.language,
        confidence: intentData.confidence,
        intentData,
        responsePlan,
        sequence: transcript.length + 1,
        classifierModel,
        latencyMs: Date.now() - startedAt,
        policy,
      });
    }

    // 4. Generate the tutor response inside those constraints.
    const tutorModel = process.env.GEMINI_TUTOR_MODEL || 'gemini-3.6-flash';

    const tutorSystemContext = `Grade: ${policy.grade}
Language: ${policy.language}
Subject: ${policy.subject}
Mode: ${policy.mode}
Strictness: ${policy.strictness}
Allowed Hint Level: ${responsePlan.allowedHintLevel}
May Reveal Final Answer: ${responsePlan.mayRevealFinalAnswer}
Maximum Response Words: ${responsePlan.maxResponseWords}
Tone: ${responsePlan.tone}
Action: ${responsePlan.action}`;

    const tutorResponse = await ai.models.generateContent({
      model: tutorModel,
      contents: [{ role: 'user', parts: [{ text: fullContext }] }],
      config: {
        systemInstruction: TUTOR_SYSTEM_PROMPT_V1 + '\n\n' + tutorSystemContext,
        responseMimeType: 'application/json',
        responseSchema: tutorSchema,
        temperature: 0.4,
      },
    });

    // 5. Revalidate, then enforce the plan in code. A model that ignores the
    // plan is corrected here; the prompt asking it to comply is not enforcement.
    const tutorParse = parseTutorResponse(tutorResponse.text);
    if (!tutorParse.ok) {
      console.error('Tutor output rejected by server-side validation:', tutorParse.detail);
      return NextResponse.json(
        { error: 'The tutor could not produce a usable response. Please try again.' },
        { status: 502 },
      );
    }

    const {
      validateSemanticDisclosure,
      judgeSemanticDisclosure,
      shouldWithholdForDisclosure,
    } = await import('@/lib/ai/disclosure-validation');
    const { deriveTrustedReferenceAnswer } = await import('@/lib/math/trusted-reference');
    // Assignment references are authoritative teacher input.  For ordinary
    // standalone linear equations, use the bounded deterministic solver so a
    // useful hint can be semantically cleared without trusting model prose.
    // Unsupported problems intentionally retain the fail-closed path.
    const trustedReferenceAnswer =
      policy.referenceAnswer ??
      deriveTrustedReferenceAnswer(policy.originalProblem, policy.subject);
    let semanticResult = validateSemanticDisclosure({
      messageMarkdown: tutorParse.value.messageMarkdown,
      referenceAnswer: trustedReferenceAnswer,
      subject: policy.subject,
      fullSolutionAllowedThisTurn: isFullSolutionAllowedThisTurn(responsePlan),
    });

    if (semanticResult.verdict !== 'leak' && !isFullSolutionAllowedThisTurn(responsePlan) && trustedReferenceAnswer) {
      const judgeResult = await judgeSemanticDisclosure({
        problem: policy.originalProblem,
        referenceAnswer: trustedReferenceAnswer,
        candidateResponse: tutorParse.value.messageMarkdown,
        responsePlan: {
          action: responsePlan.action,
          allowedHintLevel: responsePlan.allowedHintLevel,
          mayRevealFinalAnswer: responsePlan.mayRevealFinalAnswer,
        },
      });

      if (judgeResult.verdict === 'leak') {
         semanticResult = judgeResult;
      } else if (semanticResult.verdict === 'unavailable' && judgeResult.verdict === 'safe') {
         // Upgraded from unavailable to safe because Gemini judge cleared it
         semanticResult = judgeResult;
      }
    }

    // `unavailable` is not permission to disclose.  Without a trusted reference
    // there is no authoritative semantic clearance, so the plan-safe fallback is
    // the only response that may reach the student.
    const enforcement = enforceResponsePlan(
      tutorParse.value,
      responsePlan,
      policy.language,
      shouldWithholdForDisclosure(isFullSolutionAllowedThisTurn(responsePlan), semanticResult),
    );
    const tutorData: TutorResponse = enforcement.response;

    if (enforcement.violations.length > 0) {
      console.warn(
        `Response plan violations corrected for session ${sessionId}:`,
        enforcement.violations.join(', '),
      );
    }

    // The ladder tracks help the student actually received. A semantic or plan
    // failure replaces model prose with a non-mathematical fallback, so it must
    // not spend an otherwise permitted rung.
    const persistedHintLevel = effectiveHintLevelAfterDelivery({
      previousHintLevel: policy.currentHintLevel,
      responsePlan,
      deliveredResponse: tutorData,
      messageWithheld: enforcement.messageWithheld,
    });
    // Keep the policy decision for audit, but score against the assistance that
    // was actually delivered. A withheld response is a generic request for the
    // student's work, never an educational rung or a transfer-task issue.
    const deliveredResponsePlan = enforcement.messageWithheld
      ? { ...responsePlan, allowedHintLevel: 0 as const, generateTransferProblem: false }
      : responsePlan;
    const latencyMs = Date.now() - startedAt;

    // The assistant turn carries the policy decision, so the server writes it.
    // Section 41.1 lists `rationaleCode`, `mayRevealFinalAnswer` and
    // `allowedHintLevel` among the values never trusted from a client, and the
    // rules now refuse a client-authored assistant turn.
    const nextSequence = transcript.length + 1;
    const turnRef = adminDb.collection('sessionTurns').doc();

    await Promise.all([
      turnRef.set({
        id: turnRef.id,
        sessionId,
        studentId: auth.uid,
        sequence: nextSequence,
        actor: 'assistant',
        content: tutorData.messageMarkdown,
        createdAt: FieldValue.serverTimestamp(),
        intentAnalysis: intentData,
        responsePlan: deliveredResponsePlan,
        originalResponsePlan: responsePlan,
        tutorMetadata: {
          hintLevel: tutorData.hintLevel,
          finalAnswerIncluded: tutorData.finalAnswerIncluded,
          responseType: tutorData.responseType,
          // `mock:`-prefixed when no real model produced this turn, so the
          // stored record never overstates its own provenance (section 36).
          modelName: modelNameFor(tutorModel),
          promptVersion: TUTOR_PROMPT_VERSION,
          classifierPromptVersion: CLASSIFIER_PROMPT_VERSION,
          latencyMs,
          confidence: intentData.confidence,
          checkForUnderstanding: tutorData.checkForUnderstanding ?? null,
          learningObjective: tutorData.learningObjective ?? null,
          internalConceptTags: tutorData.internalConceptTags ?? [],
          planViolations: enforcement.violations,
          modelOutputRevalidated: true,
          semanticDisclosure: {
            verdict: semanticResult.verdict,
            confidence: semanticResult.confidence,
            reason: semanticResult.reason,
            validatorVersion: 'disclosure-validator-v1',
          },
        },
        safetyMetadata: {
          category: intentData.safetyCategory,
          action: responsePlan.action,
        },
      }),
      adminDb.collection('learningSessions').doc(sessionId).update({
        currentHintLevel: persistedHintLevel,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    ]);

    // Learning evidence. Everything below is server-authored: §56.4 forbids the
    // client writing a score, and a client that could author its own rubric
    // judgments could author its own score by proxy.
    //
    // A failure in this block must never cost the student their tutoring turn, so
    // each step is best-effort and its absence is recorded as missing evidence
    // rather than as a behavior the student failed to show.
    const evidence = await recordLearningEvidence({
      sessionId,
      studentId: auth.uid,
      message,
      conversationHistory,
      policy,
      responsePlan: deliveredResponsePlan,
      tutorData,
      transcriptTurns: transcript,
    });

    return NextResponse.json({
      tutorData,
      responsePlan,
      intentData,
      turnId: turnRef.id,
      evidence,
      sessionState: {
        currentHintLevel: persistedHintLevel,
        allowedHintLevel: deliveredResponsePlan.allowedHintLevel,
        mode: policy.mode,
        strictness: policy.strictness,
        grade: policy.grade,
        policySources: policy.sources,
      },
    });

  } catch (error: any) {
    console.error('Chat error:', error);

    // §56.4: a session that failed with a system error is excluded from scoring
    // entirely, not scored as abandonment. That only works if the failure is
    // recorded, so the flag is written here rather than inferred later.
    if (failedSessionId) {
      await markSessionSystemError(failedSessionId).catch(() => undefined);
    }

    // Internal messages can leak configuration detail, so they stay in the log.
    return NextResponse.json({ error: 'Failed to generate a response.' }, { status: 500 });
  }
}

async function markSessionSystemError(sessionId: string): Promise<void> {
  await adminDb.collection('learningSessions').doc(sessionId).update({
    endedWithSystemError: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

interface SafetyTurnInput {
  sessionId: string;
  studentId: string;
  category: Exclude<IntentAnalysis['safetyCategory'], 'none'>;
  language: 'en' | 'vi';
  confidence: number;
  intentData: IntentAnalysis;
  responsePlan: TutorResponsePlan;
  sequence: number;
  classifierModel: string;
  latencyMs: number;
  policy: ResolvedPolicyInputs;
}

/**
 * Handles a turn the classifier flagged as unsafe.
 *
 * Three things distinguish this from an ordinary turn, and each is a requirement
 * rather than a convenience.
 *
 * 1. **No model call.** The message comes from `composeSafetyResponse`, so it is
 *    deterministic and carries the support resources section 24 requires. Asking
 *    a model to produce it would put the most sensitive response in the
 *    application on the far side of a trust boundary.
 * 2. **No scoring.** `recordLearningEvidence` is not called. A crisis disclosure
 *    is not an attempt at a mathematics problem, and sending it to the evaluator
 *    would both fold it into the Independence Score and copy it into a third
 *    collection. §56.4 forbids scoring a student down for a system failure; doing
 *    it for a disclosure of harm would be worse.
 * 3. **No hint-ladder advance.** The session's `currentHintLevel` is left exactly
 *    where it was. R8 sets `allowedHintLevel: 0`, and writing that back would
 *    silently reset a student who had legitimately climbed to level 4 before the
 *    conversation turned.
 */
async function handleSafetyTurn(input: SafetyTurnInput): Promise<NextResponse> {
  const safety = composeSafetyResponse(input.category, input.language);

  // `composeSafetyResponse` returns null only for 'none', which the caller has
  // already excluded. Handled rather than asserted: a null here must not become
  // an unhandled throw on a safety path.
  if (!safety) {
    return NextResponse.json(
      { error: 'Failed to generate a response.' },
      { status: 500 },
    );
  }

  const turnRef = adminDb.collection('sessionTurns').doc();
  const reviewRecorded = !!(await recordSafetyEvent({
    sessionId: input.sessionId,
    studentId: input.studentId,
    turnId: turnRef.id,
    category: input.category,
    responseClass: safety.responseClass,
    flagForTeacherReview: safety.flagForTeacherReview,
    confidence: input.confidence,
    classroomId: input.policy.classroomId ?? null,
  }));

  const tutorData: TutorResponse = {
    messageMarkdown: messageWithReviewStatus(
      safety,
      input.language,
      reviewRecorded,
      input.policy.reviewerAvailable,
    ),
    responseType: 'safety_message',
    hintLevel: 0,
    finalAnswerIncluded: false,
    studentActionRequired: null,
    checkForUnderstanding: null,
    confidenceStatement: null,
    learningObjective: null,
    internalConceptTags: [],
  };

  try {
    await turnRef.set({
      id: turnRef.id,
      sessionId: input.sessionId,
      studentId: input.studentId,
      sequence: input.sequence,
      actor: 'assistant',
      content: tutorData.messageMarkdown,
      createdAt: FieldValue.serverTimestamp(),
      intentAnalysis: input.intentData,
      responsePlan: input.responsePlan,
      tutorMetadata: {
      hintLevel: 0,
      finalAnswerIncluded: false,
      responseType: 'safety_message',
      // Recorded honestly: no generative model produced this text.
      modelName: 'none:deterministic-safety-response',
      promptVersion: 'safety-response-v1',
      classifierPromptVersion: CLASSIFIER_PROMPT_VERSION,
      latencyMs: input.latencyMs,
      confidence: input.confidence,
      checkForUnderstanding: null,
      learningObjective: null,
      internalConceptTags: [],
      planViolations: [],
      modelOutputRevalidated: true,
      },
      safetyMetadata: {
        category: input.category,
        action: input.responsePlan.action,
        responseClass: safety.responseClass,
        flaggedForTeacherReview: safety.flagForTeacherReview,
        reviewRecorded,
        reviewerAvailable: input.policy.reviewerAvailable,
        classifierModel: input.classifierModel,
      },
      // §56.4: this turn is not learning evidence and must not be scored as any.
      excludedFromScoring: true,
    });

    await adminDb
      .collection('learningSessions')
      .doc(input.sessionId)
      .update({ updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    // Safety guidance must remain available if routine transcript persistence
    // is degraded. The event writer has its own failure isolation above.
    console.error('Safety turn persistence failed', error);
  }

  return NextResponse.json({
    tutorData,
    responsePlan: input.responsePlan,
    intentData: input.intentData,
    turnId: turnRef.id,
    safety: {
      responseClass: safety.responseClass,
      reviewRequested: safety.flagForTeacherReview,
      reviewRecorded,
      reviewerAvailable: input.policy.reviewerAvailable,
    },
    evidence: {
      attemptEvaluated: false,
      transferIssued: false,
      score: null,
      coverage: 0,
      suppressed: true,
    },
    sessionState: {
      // Unchanged, per point 3 above.
      currentHintLevel: input.policy.currentHintLevel,
      allowedHintLevel: 0,
      mode: input.policy.mode,
      strictness: input.policy.strictness,
      grade: input.policy.grade,
      policySources: input.policy.sources,
    },
  });
}

interface EvidenceInput {
  sessionId: string;
  studentId: string;
  message: string;
  conversationHistory: string;
  policy: ResolvedPolicyInputs;
  responsePlan: TutorResponsePlan;
  tutorData: TutorResponse;
  transcriptTurns: TranscriptTurn[];
}

interface EvidenceSummary {
  attemptEvaluated: boolean;
  transferIssued: boolean;
  transferEvaluated?: boolean;
  /** Session-level persisted score, never a mixed profile/session summary. */
  score: number | null;
  coverage: number;
  suppressed: boolean;
  transferProblem?: {
    id: string;
    problemMarkdown: string;
    topic: string | null;
    difficulty: string | null;
    expectedConcepts: string[];
  } | null;
}

/**
 * Records the learning evidence for this turn, then recomputes and persists the
 * trusted score.
 *
 * Order matters. The evaluation is written to `studentAttempts` *before*
 * `persistSessionEvidence` runs, because scoring reads stored rubric judgments
 * rather than recomputing them: §56.4 requires recomputation from stored metrics
 * to be byte-identical, which is impossible if a model is re-consulted at read
 * time. Writing after scoring would leave the snapshot one turn stale.
 */
async function recordLearningEvidence(input: EvidenceInput): Promise<EvidenceSummary> {
  const summary: EvidenceSummary = {
    attemptEvaluated: false,
    transferIssued: false,
    score: null,
    coverage: 0,
    suppressed: true,
  };

  try {
    const transcript =
      input.conversationHistory + `\nStudent: ${input.message}` +
      `\nTutor: ${input.tutorData.messageMarkdown}`;

    const pendingTransfer = await loadPendingTransfer(input.sessionId);

    if (pendingTransfer) {
      const { validateAnswer } = await import('@/lib/math/validation');
      const deterministic = validateAnswer(input.message, pendingTransfer.internalAnswer);
      
      let finalEvaluation = null;
      let available = false;
      let modelName = 'deterministic';
      
      if (deterministic.verdict === 'equivalent' || deterministic.verdict === 'not_equivalent') {
        available = true;
      } else {
        const evaluation = await evaluateAttempt({
          problem: pendingTransfer.problemMarkdown,
          learningObjective: pendingTransfer.topic ?? input.responsePlan.learningObjective,
          transcript,
          studentMessage: input.message,
          grade: input.policy.grade,
        });
        
        finalEvaluation = evaluation.evaluation;
        available = evaluation.available;
        modelName = evaluation.modelName;
      }

      const outcome = resolveTransferOutcome({
        studentAnswer: input.message,
        referenceAnswer: pendingTransfer.internalAnswer,
        evaluatorCorrectness: deterministic.verdict === 'unsupported' && available && finalEvaluation ? finalEvaluation.correctness : null,
        hintDelta: Math.max(0, input.responsePlan.allowedHintLevel - pendingTransfer.hintLevelAtIssue),
      });

      await recordAttemptEvaluation({
        sessionId: input.sessionId,
        studentId: input.studentId,
        attemptText: input.message,
        attemptType: 'transfer',
        evaluation: finalEvaluation ?? {
          extractedAnswer: input.message,
          relevance: 1,
          correctness: outcome.correctnessSource === 'deterministic' 
            ? (outcome.outcome === 'attempted_incorrect' ? 0 : 1) 
            : 0,
          reasoningQuality: 0,
          earliestMeaningfulError: null,
          errorCategory: 'none',
          understands: '',
          missingPrerequisite: null,
          smallestUsefulNextHint: null,
          feedbackSummary: '',
          confidence: outcome.confidence,
          reasoningRubric: {
            identifiedMethod: false,
            explainedIntermediateStep: false,
            connectedToConcept: false,
            interpretedResult: false,
            confidence: 0,
            evidenceSpans: []
          },
          verificationRubric: {
            recomputedOrSubstituted: false,
            checkedUnitsOrPlausibility: false,
            statedAssumptionOrLimitation: false,
            correctlyJudgedContent: false,
            confidence: 0,
          }
        },
        available,
        modelName,
        transfer: {
          outcome: outcome.outcome,
          correctnessSource: outcome.correctnessSource,
          confidence: outcome.confidence,
          studentAnswer: input.message,
        },
      });

      await adminDb.collection('transferProblems').doc(pendingTransfer.id).update({
        status: 'evaluated',
        evaluatedAt: FieldValue.serverTimestamp(),
      });
      summary.transferEvaluated = true;
      summary.attemptEvaluated = available;
    } else {
      const evaluation = await evaluateAttempt({
        problem: input.policy.originalProblem,
        learningObjective: input.responsePlan.learningObjective,
        transcript,
        studentMessage: input.message,
        grade: input.policy.grade,
      });

      const attemptType =
        input.responsePlan.action === 'start_verification_task' ||
        input.responsePlan.requiresVerification
          ? 'verification'
          : input.responsePlan.requiresExplanation
            ? 'explanation'
            : input.transcriptTurns.length <= 1
              ? 'initial'
              : 'intermediate';

      await recordAttemptEvaluation({
        sessionId: input.sessionId,
        studentId: input.studentId,
        attemptText: input.message,
        attemptType,
        evaluation: evaluation.evaluation,
        available: evaluation.available,
        modelName: evaluation.modelName,
      });
      summary.attemptEvaluated = evaluation.available;
    }

    // A new transfer problem, when the plan calls for one. The reference answer is
    // stored server-side and never returned to the browser: it is the answer.
    if (input.responsePlan.generateTransferProblem) {
      const generated = await generateTransferProblem({
        problem: input.policy.originalProblem,
        topic: input.responsePlan.learningObjective,
        grade: input.policy.grade,
        conceptTags: input.tutorData.internalConceptTags ?? [],
      });

      if (generated) {
        const ref = adminDb.collection('transferProblems').doc();
        await ref.set({
          id: ref.id,
          sessionId: input.sessionId,
          studentId: input.studentId,
          problemMarkdown: generated.problem.problemMarkdown,
          topic: generated.problem.topic,
          difficulty: generated.problem.difficulty,
          expectedConcepts: generated.problem.expectedConcepts,
          internalAnswer: generated.problem.internalAnswer,
          internalSolutionSteps: generated.problem.internalSolutionSteps,
          validationNotes: generated.problem.validationNotes,
          secondPassValidated: generated.validated,
          hintLevelAtIssue: input.responsePlan.allowedHintLevel,
          status: 'issued',
          modelName: generated.modelName,
          createdAt: FieldValue.serverTimestamp(),
        });
        summary.transferIssued = true;
        summary.transferProblem = {
          id: ref.id,
          problemMarkdown: generated.problem.problemMarkdown,
          topic: generated.problem.topic,
          difficulty: generated.problem.difficulty,
          expectedConcepts: generated.problem.expectedConcepts,
        };
      }
    }
  } catch (error) {
    // Evidence collection is best-effort by design. Its absence lowers coverage
    // and shows in the instrumentation-health metric, which is the honest record;
    // failing the turn would punish the student for a server-side fault.
    console.warn(
      'Learning evidence collection failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  try {
    const persisted = await persistSessionEvidence(input.studentId, input.sessionId);
    summary.score = persisted.sessionScore.rawScore;
    summary.coverage = persisted.sessionScore.coverage;
    summary.suppressed = persisted.sessionScore.displaySuppressed;
  } catch (error) {
    console.error(
      'Failed to persist independence snapshot:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  return summary;
}

/**
 * The most recent transfer problem still awaiting evaluation, with the reference
 * answer needed for the deterministic check.
 */
async function loadPendingTransfer(sessionId: string): Promise<
  | {
      id: string;
      internalAnswer: string;
      problemMarkdown: string;
      topic: string | null;
      hintLevelAtIssue: number;
    }
  | null
> {
  const snapshot = await adminDb
    .collection('transferProblems')
    .where('sessionId', '==', sessionId)
    .where('status', '==', 'issued')
    .get();

  if (snapshot.empty) return null;

  const documents = snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data() ?? {};
      return {
        id: docSnap.id,
        internalAnswer: typeof data.internalAnswer === 'string' ? data.internalAnswer : '',
        problemMarkdown: typeof data.problemMarkdown === 'string' ? data.problemMarkdown : '',
        topic: typeof data.topic === 'string' ? data.topic : null,
        hintLevelAtIssue:
          typeof data.hintLevelAtIssue === 'number' ? data.hintLevelAtIssue : 0,
        createdAt: data.createdAt?.toDate?.()?.getTime?.() ?? 0,
      };
    })
    .filter((entry) => entry.internalAnswer.length > 0)
    .sort((left, right) => right.createdAt - left.createdAt);

  return documents[0] ?? null;
}
