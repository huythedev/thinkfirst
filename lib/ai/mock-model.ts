import type { GenerateContentRequest, GenerateContentResult } from './model-client';

/**
 * The deterministic model used when `AI_MODEL_DRIVER=mock`.
 *
 * Section 47 asks for mock Gemini responses "for deterministic local tests",
 * with the production path still using the real service. This is that mock. It
 * is ordinary application code rather than a test fixture because the E2E suite
 * runs the real dev server, and a server cannot import from `tests/`.
 *
 * Its job is narrow and worth stating precisely, because it bounds what any test
 * built on it may claim. It returns **structurally valid** model output whose
 * shape follows from the student's message by simple keyword rules. It is not a
 * language model and it does not pretend to be one:
 *
 * - It **can** support assertions about routing, policy enforcement,
 *   persistence, authorization and rendering, since those are decided by the
 *   application after the model returns.
 * - It **cannot** support any claim about tutoring quality, classifier accuracy
 *   on real student language, or the phrasing of a hint. Nothing in this
 *   repository should assert those on the strength of this file.
 *
 * The tutor branch deliberately returns output that **respects** the plan it is
 * given, with one exception used by the enforcement tests. A mock that always
 * complied would make `enforceResponsePlan` untestable through this path, and a
 * mock that always cheated would make every scenario fail on withheld text.
 */

interface PromptParts {
  systemInstruction: string;
  userText: string;
}

function extractParts(request: GenerateContentRequest): PromptParts {
  const config = (request.config ?? {}) as { systemInstruction?: unknown };
  const systemInstruction =
    typeof config.systemInstruction === 'string' ? config.systemInstruction : '';

  let userText = '';
  const contents = request.contents as
    | Array<{ parts?: Array<{ text?: string }> }>
    | undefined;
  if (Array.isArray(contents)) {
    for (const entry of contents) {
      for (const part of entry.parts ?? []) {
        if (typeof part.text === 'string') userText += `${part.text}\n`;
      }
    }
  }
  return { systemInstruction, userText };
}

/** The last line beginning `Student:` is the message under consideration. */
function latestStudentMessage(userText: string): string {
  const matches = [...userText.matchAll(/^Student:\s*(.*)$/gm)];
  const last = matches.at(-1);
  return (last?.[1] ?? userText).trim();
}

// This deterministic fixture verifies downstream safety routing for these known
// phrases; it makes no claim about real-model safety recall.
const SELF_HARM = ['kill myself', 'end my life', 'want to die', 'hurt myself', 'not want to be here', 'i do not want to be alive any more', 'khong muon song'];
const ABUSE = ['hits me', 'hurts me at home', 'afraid to go home'];
const BULLYING = ['bullying', 'threatening me', 'they pick on me'];
const OFF_TOPIC = ['football', 'poem', 'joke', 'video game', 'movie'];
const ANSWER_REQUEST = ['give me the answer', 'just tell me', 'what is the answer', 'solve it for me', 'the final answer', 'answer now'];
const ATTEMPT_MARKERS = ['i factored', 'i got', 'i subtracted', 'my first step', 'i think i should', 'i tried', 'i divided', 'i multiplied', 'i set up'];
const CONCEPT = ['why do', 'what does', 'explain the concept', 'what is a'];
const VERIFY = ['verify', 'is this right', 'check this claim', 'i think the ai'];

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function classify(message: string): Record<string, unknown> {
  const text = message.toLowerCase();

  let safetyCategory = 'none';
  if (includesAny(text, SELF_HARM)) safetyCategory = 'self_harm';
  else if (includesAny(text, ABUSE)) safetyCategory = 'abuse';
  else if (includesAny(text, BULLYING)) safetyCategory = 'bullying';

  const providedAttempt = includesAny(text, ATTEMPT_MARKERS);

  let intent = 'problem_solving';
  if (safetyCategory !== 'none') intent = 'unsafe';
  else if (includesAny(text, OFF_TOPIC)) intent = 'off_topic';
  else if (includesAny(text, VERIFY)) intent = 'verification';
  else if (includesAny(text, ANSWER_REQUEST)) intent = 'answer_request';
  else if (providedAttempt) intent = 'step_check';
  else if (includesAny(text, CONCEPT)) intent = 'concept_explanation';

  return {
    intent,
    subject: 'mathematics',
    topic: 'algebra',
    estimatedGradeLevel: 9,
    problemStatement: null,
    studentProvidedAttempt: providedAttempt,
    attemptQuality: providedAttempt ? 'meaningful' : 'none',
    answerSeekingLikelihood: includesAny(text, ANSWER_REQUEST) ? 0.95 : 0.2,
    ambiguityLevel: 'low',
    missingInformation: [],
    detectedLanguage: /[\u00C0-\u1EF9]/.test(message) ? 'vi' : 'en',
    safetyCategory,
    confidence: 0.9,
  };
}

/** Reads the plan values the route puts into the tutor system context. */
function planFromContext(systemInstruction: string): {
  allowedHintLevel: number;
  mayReveal: boolean;
  action: string;
} {
  const level = /Allowed Hint Level:\s*(\d+)/.exec(systemInstruction);
  const reveal = /May Reveal Final Answer:\s*(true|false)/.exec(systemInstruction);
  const action = /Action:\s*([a-z_]+)/.exec(systemInstruction);
  return {
    allowedHintLevel: level ? Number(level[1]) : 0,
    mayReveal: reveal ? reveal[1] === 'true' : false,
    action: action?.[1] ?? 'provide_hint',
  };
}

function tutorResponse(systemInstruction: string, message: string): Record<string, unknown> {
  const plan = planFromContext(systemInstruction);

  // An explicit escape hatch for enforcement tests: a student message
  // containing this marker makes the mock attempt to exceed its plan, so the
  // real `enforceResponsePlan` can be observed doing its job end to end.
  if (message.includes('__FORCE_PLAN_VIOLATION__')) {
    return {
      messageMarkdown: 'The final answer is x = 2 or x = 3.',
      responseType: 'solution',
      hintLevel: 7,
      finalAnswerIncluded: true,
      studentActionRequired: null,
      checkForUnderstanding: null,
      confidenceStatement: null,
      learningObjective: 'quadratic equations',
      internalConceptTags: ['factoring'],
    };
  }

  if (plan.action === 'ask_for_attempt') {
    return {
      messageMarkdown:
        'Before I help, show me one thing you have tried. What is your first step?',
      responseType: 'question',
      hintLevel: 0,
      finalAnswerIncluded: false,
      studentActionRequired: 'Describe your first step.',
      checkForUnderstanding: null,
      confidenceStatement: null,
      learningObjective: 'quadratic equations',
      internalConceptTags: ['factoring'],
    };
  }

  if (plan.action === 'clarify_problem') {
    return {
      messageMarkdown: 'I want to be sure I read the problem correctly. Can you confirm the text?',
      responseType: 'question',
      hintLevel: 0,
      finalAnswerIncluded: false,
      studentActionRequired: 'Confirm or correct the problem text.',
      checkForUnderstanding: null,
      confidenceStatement: 'I am not fully confident I read this correctly.',
      learningObjective: null,
      internalConceptTags: [],
    };
  }

  if (plan.action === 'off_topic_redirect') {
    return {
      messageMarkdown: 'That is outside what we are working on. Shall we return to the problem?',
      responseType: 'question',
      hintLevel: 0,
      finalAnswerIncluded: false,
      studentActionRequired: 'Return to the problem.',
      checkForUnderstanding: null,
      confidenceStatement: null,
      learningObjective: null,
      internalConceptTags: [],
    };
  }

  if (plan.action === 'evaluate_step') {
    return {
      messageMarkdown:
        'Your method is sound. Check the arithmetic in the step where you divided, then tell me what you get.',
      responseType: 'feedback',
      hintLevel: Math.min(plan.allowedHintLevel, 2),
      finalAnswerIncluded: false,
      studentActionRequired: 'Recheck that step and report the result.',
      checkForUnderstanding: 'Which step did you change?',
      confidenceStatement: null,
      learningObjective: 'quadratic equations',
      internalConceptTags: ['factoring'],
    };
  }

  if (plan.action === 'start_verification_task') {
    return {
      messageMarkdown:
        'Here is a candidate answer that may contain an error. Check it and tell me whether it holds: x = 2 and x = 4.',
      responseType: 'question',
      hintLevel: Math.min(plan.allowedHintLevel, 1),
      finalAnswerIncluded: false,
      studentActionRequired: 'Decide whether the candidate answer is correct.',
      checkForUnderstanding: null,
      confidenceStatement: null,
      learningObjective: 'verification',
      internalConceptTags: ['verification'],
    };
  }

  if (plan.action === 'provide_concept') {
    return {
      messageMarkdown:
        'A product equals zero only when one of its factors is zero. That is why each factor is set to zero in turn.',
      responseType: 'explanation',
      hintLevel: Math.min(plan.allowedHintLevel, 1),
      finalAnswerIncluded: false,
      studentActionRequired: 'Apply that idea to your factors.',
      checkForUnderstanding: 'Why can neither factor be ignored?',
      confidenceStatement: null,
      learningObjective: 'zero product property',
      internalConceptTags: ['zero-product'],
    };
  }

  if (plan.action === 'provide_full_solution' && plan.mayReveal) {
    return {
      messageMarkdown:
        'Factoring gives (x - 2)(x - 3) = 0, so x = 2 or x = 3. Explain in your own words why each factor may be set to zero.',
      responseType: 'solution',
      hintLevel: 7,
      finalAnswerIncluded: true,
      studentActionRequired: 'Explain the key idea in your own words.',
      checkForUnderstanding: 'Where did you get stuck?',
      confidenceStatement: null,
      learningObjective: 'quadratic equations',
      internalConceptTags: ['factoring'],
    };
  }

  return {
    messageMarkdown:
      'Think about which two numbers multiply to give the constant term and add to give the coefficient of x. What pair fits?',
    responseType: 'hint',
    hintLevel: plan.allowedHintLevel,
    finalAnswerIncluded: false,
    studentActionRequired: 'Name the pair of numbers.',
    checkForUnderstanding: null,
    confidenceStatement: null,
    learningObjective: 'quadratic equations',
    internalConceptTags: ['factoring'],
  };
}

const EVALUATION = {
  relevance: 0.9,
  correctness: 0.8,
  reasoningQuality: 0.75,
  earliestMeaningfulError: null,
  errorCategory: 'none',
  understands: 'The student can select and apply a factoring method.',
  missingPrerequisite: null,
  smallestUsefulNextHint: 'Check the sign on the constant term.',
  feedbackSummary: 'Method chosen correctly and applied consistently.',
  confidence: 0.8,
  reasoningRubric: {
    identifiedMethod: true,
    explainedIntermediateStep: true,
    connectedToConcept: false,
    interpretedResult: false,
    confidence: 0.8,
    evidenceSpans: ['I factored it as (x-2)(x-3)'],
  },
  verificationRubric: {
    recomputedOrSubstituted: false,
    checkedUnitsOrPlausibility: false,
    statedAssumptionOrLimitation: false,
    correctlyJudgedContent: false,
    confidence: 0.6,
  },
  extractedAnswer: 'x = 2 or x = 3',
};

const TRANSFER = {
  problemMarkdown: 'Solve x^2 - 7x + 12 = 0 without help.',
  topic: 'quadratic equations',
  difficulty: 'similar',
  expectedConcepts: ['factoring', 'zero-product'],
  internalAnswer: 'x = 3 or x = 4',
  internalSolutionSteps: ['Factor x^2 - 7x + 12 as (x - 3)(x - 4).', 'Set each factor equal to zero.', 'x = 3 or x = 4'],
  validationNotes: ['A standard quadratic solvable by factoring.'],
};

const EXTRACTION = {
  extractedText: 'Solve $3x + 7 = 22$',
  confidence: 0.95,
  detectedLanguage: 'en',
  containsDiagram: false,
  containsHandwriting: false,
  qualityWarning: null,
  requiresConfirmation: false,
};

/**
 * Routes a request to the right canned payload by identifying the prompt.
 *
 * Matching is on distinctive prompt text rather than on the model name, because
 * every call in this application can be configured to the same model.
 */
export async function deterministicModelHandler(
  request: GenerateContentRequest,
): Promise<GenerateContentResult> {
  const { systemInstruction, userText } = extractParts(request);
  const combined = `${systemInstruction}\n${userText}`;

  if (combined.includes('Analyze the student interaction for educational routing')) {
    return { text: JSON.stringify(classify(latestStudentMessage(userText))) };
  }
  if (combined.includes('You are ThinkFirst, an adaptive educational assistant')) {
    return { text: JSON.stringify(tutorResponse(systemInstruction, latestStudentMessage(userText))) };
  }
  if (combined.includes('transfer') && !combined.includes('You are a semantic disclosure judge.')) {
    return { text: JSON.stringify(TRANSFER) };
  }
  if (combined.includes('extraction') || combined.includes('image')) {
    return { text: JSON.stringify(EXTRACTION) };
  }
  if (combined.includes('You are a semantic disclosure judge.')) {
    // If the mock sees a specific marker in the response plan or candidate response, it can return specific judge values.
    if (combined.includes('__MOCK_JUDGE_LEAK__')) {
       return { text: JSON.stringify({ verdict: 'leak', confidence: 0.95, reasonCode: 'exact_answer' }) };
    }
    if (combined.includes('__MOCK_JUDGE_UNCERTAIN__')) {
       return { text: JSON.stringify({ verdict: 'uncertain', confidence: 0.95, reasonCode: 'uncertain' }) };
    }
    if (combined.includes('__MOCK_JUDGE_LOW_CONFIDENCE__')) {
       return { text: JSON.stringify({ verdict: 'safe', confidence: 0.4, reasonCode: 'no_disclosure' }) };
    }
    if (combined.includes('__MOCK_JUDGE_MALFORMED__')) {
       return { text: '{ "verdict": "safe", "confidence"' };
    }
    if (combined.includes('__MOCK_JUDGE_INVALID_SCHEMA__')) {
       return { text: JSON.stringify({ verdict: 'fine', confidence: 1 }) };
    }
    if (combined.includes('__MOCK_JUDGE_INCONSISTENT_SAFE__')) {
       return { text: JSON.stringify({ verdict: 'safe', confidence: 0.99, reasonCode: 'exact_answer' }) };
    }
    if (combined.includes('__MOCK_JUDGE_INCONSISTENT_LEAK__')) {
       return { text: JSON.stringify({ verdict: 'leak', confidence: 0.99, reasonCode: 'no_disclosure' }) };
    }
    if (combined.includes('__MOCK_JUDGE_TIMEOUT__')) {
       return new Promise(resolve => setTimeout(() => resolve({ text: JSON.stringify({ verdict: 'safe', confidence: 0.95, reasonCode: 'no_disclosure' }) }), 5500));
    }
    return { text: JSON.stringify({ verdict: 'safe', confidence: 0.95, reasonCode: 'no_disclosure' }) };
  }
  return { text: JSON.stringify(EVALUATION) };
}
