export type LearningMode = 'learn' | 'practice' | 'assignment' | 'verify';
export type Subject = 'mathematics' | 'science' | 'other';

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

  tone: "simple_supportive" | "neutral_supportive" | "academic_supportive";
  
  maxResponseWords: number;
  learningObjective: string | null;
  rationaleCode: string;
  policyVersion: string;
}

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
