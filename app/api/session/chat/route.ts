import { NextRequest, NextResponse } from 'next/server';
import { Type, Schema } from '@google/genai';
import {
  configuredGeminiModel,
  getModelClient,
  modelNameFor,
} from '@/lib/ai/model-client';
import { runSemanticValidation } from '@/lib/ai/semantic-validation';
import { CLASSIFIER_PROMPT_V1 } from '@/services/ai-gateway/src/prompts/classifier.v1';
import { TUTOR_SYSTEM_PROMPT_V1 } from '@/services/ai-gateway/src/prompts/tutor-system.v1';
import { TRANSFER_PROMPT_VERSION } from '@/services/ai-gateway/src/prompts/transfer.v1';
import { generateResponsePlan } from '@/services/ai-gateway/src/policy';
import { IntentAnalysis, TutorResponse, TutorResponsePlan } from '@/lib/types/ai/schema';
import { chatRequestSchema, MAX_HINT_LEVEL } from '@/lib/types/ai/request';
import {
  SAFE_FALLBACK_INTENT,
  enforceResponsePlan,
  parseIntentAnalysis,
  parseTutorResponse,
} from '@/lib/types/ai/model-output';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { nextHintLevel } from '@/lib/session/hint-ladder';
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
  validateTransferOutcome,
} from '@/lib/session/evaluation';
import { persistSessionEvidence } from '@/lib/scoring/server';
import { composeSafetyResponse } from '@/lib/safety/response';
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

    const parsed = chatRequestSchema.safeParse(await req.json());
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

    // 2. Classify intent. Static instructions are a system instruction; the
    // untrusted transcript stays in the user turn rather than being concatenated
    // into the same instruction string.
    const classifierModel = configuredGeminiModel('classifier');
    const intentResponse = await ai.models.generateContent({
      model: classifierModel,
      contents: [{ role: 'user', parts: [{ text: fullContext }] }],
      config: {
        systemInstruction: CLASSIFIER_PROMPT_V1,
        responseMimeType: 'application/json',
        responseSchema: intentSchema,
      },
    });

    // Revalidated server-side: the provider's `responseSchema` is a hint, not a
    // guarantee. A classifier that returns nothing usable falls back to the most
    // restrictive ordinary analysis rather than to an empty object cast to type.
    const intentParse = parseIntentAnalysis(intentResponse.text);
    if (!intentParse.ok) {
      console.warn('Classifier output rejected by server-side validation:', intentParse.detail);
    }
    const intentData = intentParse.ok ? intentParse.value : SAFE_FALLBACK_INTENT;

    // 3. Apply the deterministic policy, on trusted inputs only. Gemini may
    // classify or semantically verify content, but it never grants permissions.
    const responsePlan = generateResponsePlan(intentData, {
      mode: policy.mode,
      strictness: policy.strictness,
      currentHintLevel: policy.currentHintLevel,
      hasReceivedFullSolution: policy.currentHintLevel >= MAX_HINT_LEVEL,
      grade: policy.grade,
      allowFullSolutions: policy.allowFullSolutions,
      requireTransferProblem: policy.requireTransferProblem,
      extractionConfidence: policy.extractionConfirmed ? undefined : policy.extractionConfidence,
    });

    // R8, enforced rather than requested. Safety output remains deterministic:
    // semantic-verifier preference never moves authorization/safety composition
    // onto a model-controlled path.
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
        classifierModel: modelNameFor(classifierModel),
        latencyMs: Date.now() - startedAt,
        policy,
      });
    }

    // 4. Generate the tutor response inside deterministic disclosure constraints.
    const tutorModel = configuredGeminiModel('tutor');

    const tutorSystemContext = `Grade: ${policy.grade}
Language: ${policy.language}
Subject: ${policy.subject}
Mode: ${policy.mode}
Strictness: ${policy.strictness}
Allowed Hint Level: ${responsePlan.allowedHintLevel}
May Reveal Final Answer: ${responsePlan.mayRevealFinalAnswer}
Maximum Response Words: ${responsePlan.maxResponseWords}
Tone: ${responsePlan.tone}
Action: ${responsePlan.action}
Dedicated transfer generator: ${responsePlan.generateTransferProblem ? 'enabled; do not invent a separate transfer problem in this tutor response' : 'not requested'}`;

    const tutorResponse = await ai.models.generateContent({
      model: tutorModel,
      contents: [{ role: 'user', parts: [{ text: fullContext }] }],
      config: {
        systemInstruction: TUTOR_SYSTEM_PROMPT_V1 + '\n\n' + tutorSystemContext,
        responseMimeType: 'application/json',
        responseSchema: tutorSchema,
      },
    });

    // 5. Revalidate, then enforce the plan in code. A model that ignores the
    // plan is corrected here; the prompt asking it to comply is not enforcement.
    const tutorParse = parseTutorResponse(tutorResponse.text);
    if (!tutorParse.ok) {
      console.error('Tutor output rejected by server-side validation:', tutorParse.detail);
      await markSessionSystemError(sessionId).catch(() => undefined);
      return NextResponse.json(
        { error: 'The tutor could not produce a usable response. Please try again.' },
        { status: 502 },
      );
    }

    const enforcement = enforceResponsePlan(tutorParse.value, responsePlan, policy.language);
    const tutorData: TutorResponse = enforcement.response;

    if (enforcement.violations.length > 0) {
      console.warn(
        `Response plan violations corrected for session ${sessionId}:`,
        enforcement.violations.join(', '),
      );
    }

    // Transfer problems have their own generator and hidden validated reference
    // answer. Accepting a transfer invented by the tutor would show one problem
    // while scoring against another, so that output is refused rather than
    // relabelled.
    if (tutorData.responseType === 'transfer_problem') {
      console.error('Tutor attempted to emit a transfer problem outside the dedicated generator.');
      await markSessionSystemError(sessionId).catch(() => undefined);
      return NextResponse.json(
        { error: 'The tutor could not safely prepare the next task. Please try again.' },
        { status: 502 },
      );
    }

    // Gemini-first semantic verification of the actual post-enforcement text.
    // The validator cannot widen the plan; it can only approve the content or
    // cause this turn to fail closed before anything is persisted or shown.
    const tutorValidation = await runSemanticValidation({
      validationKind: 'tutor_response',
      data: {
        problem: policy.originalProblem,
        grade: policy.grade,
        subject: policy.subject,
        language: policy.language,
        conversationHistory,
        studentMessage: message,
        responsePlan,
        candidateResponse: tutorData,
      },
    });

    if (!tutorValidation.approved) {
      console.error(
        'Tutor response rejected by independent semantic validation:',
        tutorValidation.validation?.issues.join('; ') || 'validator unavailable or did not approve',
      );
      await markSessionSystemError(sessionId).catch(() => undefined);
      return NextResponse.json(
        { error: 'The tutor could not safely verify its response. Please try again.' },
        { status: 502 },
      );
    }

    // The hint ladder advances here, on the server, never from the browser. The
    // plan's ceiling is persisted rather than the model's self-report, so a model
    // that overshoots cannot ratchet the session forward.
    const persistedHintLevel = nextHintLevel(policy.currentHintLevel, responsePlan.allowedHintLevel);
    const latencyMs = Date.now() - startedAt;

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
        responsePlan,
        tutorMetadata: {
          hintLevel: tutorData.hintLevel,
          finalAnswerIncluded: tutorData.finalAnswerIncluded,
          responseType: tutorData.responseType,
          modelName: modelNameFor(tutorModel),
          classifierModel: modelNameFor(classifierModel),
          promptVersion: TUTOR_PROMPT_VERSION,
          classifierPromptVersion: CLASSIFIER_PROMPT_VERSION,
          latencyMs,
          confidence: intentData.confidence,
          checkForUnderstanding: tutorData.checkForUnderstanding ?? null,
          learningObjective: tutorData.learningObjective ?? null,
          internalConceptTags: tutorData.internalConceptTags ?? [],
          planViolations: enforcement.violations,
          modelOutputRevalidated: true,
          semanticValidation: {
            available: tutorValidation.available,
            approved: tutorValidation.approved,
            modelName: tutorValidation.modelName,
            promptVersion: tutorValidation.promptVersion,
            confidence: tutorValidation.validation?.confidence ?? 0,
          },
          generationConfig: {
            responseMimeType: 'application/json',
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

    // Learning evidence is best-effort and never blocks a verified tutoring turn.
    const evidence = await recordLearningEvidence({
      sessionId,
      studentId: auth.uid,
      message,
      conversationHistory,
      policy,
      responsePlan,
      tutorData,
      transcriptTurns: transcript,
      assistantSequence: nextSequence,
    });

    return NextResponse.json({
      tutorData,
      responsePlan,
      intentData,
      turnId: turnRef.id,
      evidence,
      sessionState: {
        currentHintLevel: persistedHintLevel,
        allowedHintLevel: responsePlan.allowedHintLevel,
        mode: policy.mode,
        strictness: policy.strictness,
        grade: policy.grade,
        policySources: policy.sources,
      },
    });

  } catch (error: any) {
    console.error('Chat error:', error);

    // §56.4: a session that failed with a system error is excluded from scoring
    // entirely, not scored as abandonment.
    if (failedSessionId) {
      await markSessionSystemError(failedSessionId).catch(() => undefined);
    }

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
 * 1. No generative response model: safety text comes from verified constants.
 * 2. No scoring: a disclosure is not an academic attempt.
 * 3. No hint-ladder advance: a disclosure cannot reset or penalize progress.
 */
async function handleSafetyTurn(input: SafetyTurnInput): Promise<NextResponse> {
  const safety = composeSafetyResponse(input.category, input.language);

  if (!safety) {
    return NextResponse.json(
      { error: 'Failed to generate a response.' },
      { status: 500 },
    );
  }

  const tutorData: TutorResponse = {
    messageMarkdown: safety.messageMarkdown,
    responseType: 'safety_message',
    hintLevel: 0,
    finalAnswerIncluded: false,
    studentActionRequired: null,
    checkForUnderstanding: null,
    confidenceStatement: null,
    learningObjective: null,
    internalConceptTags: [],
  };

  const turnRef = adminDb.collection('sessionTurns').doc();

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
      modelName: 'none:deterministic-safety-response',
      promptVersion: 'safety-response-v1',
      classifierPromptVersion: CLASSIFIER_PROMPT_VERSION,
      classifierModel: input.classifierModel,
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
      classifierModel: input.classifierModel,
    },
    excludedFromScoring: true,
  });

  await recordSafetyEvent({
    sessionId: input.sessionId,
    studentId: input.studentId,
    turnId: turnRef.id,
    category: input.category,
    responseClass: safety.responseClass,
    flagForTeacherReview: safety.flagForTeacherReview,
    confidence: input.confidence,
  });

  await adminDb
    .collection('learningSessions')
    .doc(input.sessionId)
    .update({ updatedAt: FieldValue.serverTimestamp() });

  return NextResponse.json({
    tutorData,
    responsePlan: input.responsePlan,
    intentData: input.intentData,
    turnId: turnRef.id,
    safety: {
      responseClass: safety.responseClass,
      teacherNotified: safety.flagForTeacherReview,
    },
    evidence: {
      attemptEvaluated: false,
      transferIssued: false,
      score: null,
      coverage: 0,
      suppressed: true,
    },
    sessionState: {
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
  assistantSequence: number;
}

interface EvidenceSummary {
  attemptEvaluated: boolean;
  transferIssued: boolean;
  score: number | null;
  coverage: number;
  suppressed: boolean;
}

/**
 * Record learning evidence for this turn, then recompute and persist the trusted
 * score. Model-produced scoring evidence is independently Gemini-validated before
 * persistence; recomputation later remains deterministic because the validated
 * result and its provenance are stored once here.
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
      semanticValidation: evaluation.semanticValidation,
    });
    summary.attemptEvaluated = evaluation.available;

    // Evaluate the most recent actual issued transfer. The generated public
    // problem is loaded with the hidden answer so Gemini verifies the student's
    // answer against the same problem they actually saw.
    const pendingTransfer = await loadPendingTransfer(input.sessionId);
    if (pendingTransfer) {
      const studentAnswer = evaluation.evaluation.extractedAnswer ?? input.message;
      const outcome = await validateTransferOutcome({
        problemMarkdown: pendingTransfer.problemMarkdown,
        studentAnswer,
        referenceAnswer: pendingTransfer.internalAnswer,
        evaluatorCorrectness: evaluation.available ? evaluation.evaluation.correctness : null,
        hintDelta: Math.max(0, input.responsePlan.allowedHintLevel - pendingTransfer.hintLevelAtIssue),
      });

      await recordAttemptEvaluation({
        sessionId: input.sessionId,
        studentId: input.studentId,
        attemptText: input.message,
        attemptType: 'transfer',
        evaluation: evaluation.evaluation,
        available: evaluation.available,
        modelName: evaluation.modelName,
        semanticValidation: evaluation.semanticValidation,
        transfer: {
          outcome: outcome.outcome,
          correctnessSource: outcome.correctnessSource,
          confidence: outcome.confidence,
          referenceAnswer: pendingTransfer.internalAnswer,
          studentAnswer,
          semanticValidation: outcome.semanticValidation,
        },
      });

      await adminDb.collection('transferProblems').doc(pendingTransfer.id).update({
        status: 'evaluated',
        evaluatedAt: FieldValue.serverTimestamp(),
        answerSemanticValidation: outcome.semanticValidation,
      });
    }

    // A new transfer becomes "issued" only after two things are both true:
    // (1) Gemini independently validated its hidden reference solution, and
    // (2) the exact validated problemMarkdown was written as an assistant turn
    // that the student's transcript listener can actually display.
    if (input.responsePlan.generateTransferProblem) {
      const generated = await generateTransferProblem({
        problem: input.policy.originalProblem,
        topic: input.responsePlan.learningObjective,
        grade: input.policy.grade,
        conceptTags: input.tutorData.internalConceptTags ?? [],
      });

      if (generated) {
        const ref = adminDb.collection('transferProblems').doc();
        const transferTurnRef = adminDb.collection('sessionTurns').doc();
        const transferSequence = input.assistantSequence + 1;

        await Promise.all([
          ref.set({
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
            secondPassValidated: true,
            semanticValidation: generated.validation,
            hintLevelAtIssue: input.responsePlan.allowedHintLevel,
            status: 'issued',
            modelName: generated.modelName,
            promptVersion: TRANSFER_PROMPT_VERSION,
            createdAt: FieldValue.serverTimestamp(),
          }),
          transferTurnRef.set({
            id: transferTurnRef.id,
            sessionId: input.sessionId,
            studentId: input.studentId,
            sequence: transferSequence,
            actor: 'assistant',
            content: generated.problem.problemMarkdown,
            createdAt: FieldValue.serverTimestamp(),
            tutorMetadata: {
              hintLevel: input.responsePlan.allowedHintLevel,
              finalAnswerIncluded: false,
              responseType: 'transfer_problem',
              modelName: generated.modelName,
              promptVersion: TRANSFER_PROMPT_VERSION,
              transferProblemId: ref.id,
              modelOutputRevalidated: true,
              semanticValidation: generated.validation,
            },
          }),
        ]);
        summary.transferIssued = true;
      } else {
        // A required transfer generation/validation failure is a technical system
        // failure, not a student refusal. Exclude the session rather than letting
        // responsePlan.generateTransferProblem be misread as a declined task.
        await markSessionSystemError(input.sessionId).catch(() => undefined);
      }
    }
  } catch (error) {
    console.warn(
      'Learning evidence collection failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  try {
    const persisted = await persistSessionEvidence(input.studentId, input.sessionId);
    summary.score = persisted.profile.score;
    summary.coverage = persisted.sessionScore.coverage;
    summary.suppressed = persisted.profile.suppressed;
  } catch (error) {
    console.error(
      'Failed to persist independence snapshot:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }

  return summary;
}

/**
 * Most recent transfer problem still awaiting evaluation. Both the public
 * problem and hidden answer are loaded so answer verification is grounded in the
 * exact problem the student saw.
 */
async function loadPendingTransfer(sessionId: string): Promise<
  | {
      id: string;
      problemMarkdown: string;
      internalAnswer: string;
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
        problemMarkdown: typeof data.problemMarkdown === 'string' ? data.problemMarkdown : '',
        internalAnswer: typeof data.internalAnswer === 'string' ? data.internalAnswer : '',
        hintLevelAtIssue:
          typeof data.hintLevelAtIssue === 'number' ? data.hintLevelAtIssue : 0,
        createdAt: data.createdAt?.toDate?.()?.getTime?.() ?? 0,
      };
    })
    .filter((entry) => entry.internalAnswer.length > 0 && entry.problemMarkdown.length > 0)
    .sort((left, right) => right.createdAt - left.createdAt);

  return documents[0] ?? null;
}
