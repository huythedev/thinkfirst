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
  let failedSessionId: string | null = null;

  try {
    const auth = await verifyRequest(req);
    if (auth.verificationUnavailable) {
      return NextResponse.json(
        { error: 'Server is not configured to verify authentication.' },
        { status: 503 },
      );
    }
    if (!auth.uid) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

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

    const resolution = await resolvePolicyInputs(sessionId, auth.uid);
    if (resolution.status === 'not_found' || resolution.status === 'forbidden') {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    }

    const policy = resolution.inputs;
    const transcript = await loadTranscript(sessionId);
    const conversationHistory = transcript
      .map((turn) => `${turn.actor === 'student' ? 'Student' : 'Tutor'}: ${turn.content}`)
      .join('\n');

    const fullContext =
      `Problem: ${policy.originalProblem}\n` +
      `History:\n${conversationHistory}\n` +
      `Student: ${message}`;

    const startedAt = Date.now();
    const ai = getModelClient();

    // Classifier output is untrusted data. The static instruction stays in the
    // system channel while the transcript remains in the user turn.
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

    const intentParse = parseIntentAnalysis(intentResponse.text);
    if (!intentParse.ok) {
      console.warn('Classifier output rejected by server-side validation:', intentParse.detail);
    }
    const intentData = intentParse.ok ? intentParse.value : SAFE_FALLBACK_INTENT;

    // Gemini may classify content, but this deterministic policy layer alone
    // decides disclosure permission and hint ceilings.
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

    // Safety text remains deterministic after classification. The semantic
    // verifier preference never moves crisis response composition or permission
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

    // The dedicated transfer generator owns transfer problem/reference-answer
    // pairs. A tutor-invented transfer would let the student see problem A while
    // scoring against hidden problem B, so fail closed instead of relabelling it.
    if (tutorData.responseType === 'transfer_problem') {
      console.error('Tutor attempted to emit a transfer problem outside the dedicated generator.');
      await markSessionSystemError(sessionId).catch(() => undefined);
      return NextResponse.json(
        { error: 'The tutor could not safely prepare the next task. Please try again.' },
        { status: 502 },
      );
    }

    // Semantic correctness is independently checked after deterministic response
    // enforcement and before the text is persisted or shown. The verifier can
    // reject content but can never widen the response plan.
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
 * Safety turns use deterministic text, are excluded from academic scoring, and
 * do not move the hint ladder. Classification may be model-produced; response
 * content and policy consequence are not.
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
 * score. The evaluator sees the student evidence that existed before the current
 * tutor reply, so the tutor cannot leak a correction into the judgement of the
 * student's preceding attempt.
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
    const transcript = input.conversationHistory + `\nStudent: ${input.message}`;

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

    // A transfer is considered issued only after the exact Gemini-validated
    // problem is persisted as a visible assistant turn.
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
        await markSessionSystemError(input.sessionId).catch(() => undefined);
      }
    }
  } catch (error) {
    // A partial evidence-persistence failure is a system fault. Mark the session
    // so scoring excludes it rather than turning missing/half-written evidence
    // into student behavior.
    await markSessionSystemError(input.sessionId).catch(() => undefined);
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
    await markSessionSystemError(input.sessionId).catch(() => undefined);
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
