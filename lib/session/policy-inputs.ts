import { adminDb } from '@/lib/firebase/admin';
import {
  MAX_HINT_LEVEL,
  MODE_VALUES,
  STRICTNESS_VALUES,
} from '@/lib/types/ai/request';
import type { PolicyMode, PolicyStrictness } from '@/services/ai-gateway/src/policy';

/**
 * Server-authoritative policy inputs.
 *
 * Section 41.1 lists `strictness`, `mode`, `currentHintLevel`, assignment policy
 * and `grade` as values that are never trusted from a request body, and section 49
 * adds that clamping a client-supplied value does not satisfy the requirement.
 *
 * A subtlety that matters more than it looks: reading `strictness` back off the
 * `learningSessions` document would *also* fail this requirement, because the
 * browser creates that document and the rules let it choose the value. A
 * server-side read of a client-written field is laundered client input. So the
 * chain below deliberately skips the session document for the fields a teacher
 * owns, and resolves them in the order section 41.1 gives:
 *
 *   assignments/{id} -> classrooms/{id} -> studentProfiles/{uid} -> default
 *
 * The session document remains authoritative for the two things it legitimately
 * owns and the client cannot write: `currentHintLevel`, which only this endpoint
 * advances, and `originalProblem`, which is the student's own question.
 *
 * Image extraction confidence joins that list from the other side. The session
 * may name the image it came from, because pointing at your own upload is
 * harmless; it may not state the confidence, because that value decides whether
 * the tutor is allowed to start at all (rule R6). So the confidence is read from
 * `problemImages/{id}`, which only the upload route writes, and only after
 * confirming the image belongs to the same student as the session.
 */

export const DEFAULT_STRICTNESS: PolicyStrictness = 'balanced';
export const DEFAULT_MODE: PolicyMode = 'practice';
export const DEFAULT_GRADE = 8;

export type PolicySource = 'assignment' | 'classroom' | 'studentProfile' | 'session' | 'default';

export interface ResolvedPolicyInputs {
  sessionId: string;
  studentId: string;
  originalProblem: string;
  subject: string;
  grade: number;
  language: 'en' | 'vi';
  mode: PolicyMode;
  strictness: PolicyStrictness;
  currentHintLevel: number;
  allowFullSolutions?: boolean;
  requireTransferProblem?: boolean;
  /**
   * Undefined when the problem was typed. Set only from a server-written image
   * document, per section 41.1.
   */
  extractionConfidence?: number;
  /** True when the student has confirmed the extracted text (section 34 step 10). */
  extractionConfirmed?: boolean;
  imageId?: string;
  /** Where each contested value came from, for the audit trail and for tests. */
  sources: {
    strictness: PolicySource;
    mode: PolicySource;
    grade: PolicySource;
    assignmentPolicy: PolicySource;
  };
}

export type PolicyResolution =
  | { status: 'ok'; inputs: ResolvedPolicyInputs }
  | { status: 'not_found' }
  | { status: 'forbidden' };

function isStrictness(value: unknown): value is PolicyStrictness {
  return typeof value === 'string' && (STRICTNESS_VALUES as readonly string[]).includes(value);
}

function isMode(value: unknown): value is PolicyMode {
  return typeof value === 'string' && (MODE_VALUES as readonly string[]).includes(value);
}

function clampHintLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), MAX_HINT_LEVEL);
}

function clampGrade(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const grade = Math.trunc(value);
  return grade >= 1 && grade <= 12 ? grade : null;
}

interface Documents {
  session: Record<string, unknown>;
  assignment: Record<string, unknown> | null;
  classroom: Record<string, unknown> | null;
  studentProfile: Record<string, unknown> | null;
  /** The `problemImages` document this session came from, when it came from one. */
  problemImage?: Record<string, unknown> | null;
}

/**
 * The pure resolution, separated from Firestore so it is testable without
 * credentials or an emulator. Every precedence decision lives here.
 */
export function resolvePolicyFromDocuments(
  sessionId: string,
  uid: string,
  documents: Documents,
): ResolvedPolicyInputs {
  const { session, assignment, classroom, studentProfile, problemImage } = documents;

  const profileStrictness = (studentProfile?.assistanceProfile as Record<string, unknown> | undefined)
    ?.defaultStrictness;

  let strictness: PolicyStrictness = DEFAULT_STRICTNESS;
  let strictnessSource: PolicySource = 'default';

  if (isStrictness(assignment?.strictness)) {
    strictness = assignment.strictness;
    strictnessSource = 'assignment';
  } else if (isStrictness(classroom?.defaultStrictness)) {
    strictness = classroom.defaultStrictness;
    strictnessSource = 'classroom';
  } else if (isStrictness(profileStrictness)) {
    strictness = profileStrictness;
    strictnessSource = 'studentProfile';
  }

  // Mode is the student's own pedagogical choice, so the session document is a
  // legitimate source for it. An assignment may narrow the permitted set, and a
  // mode outside that set falls back to the assignment's first allowed mode.
  let mode: PolicyMode = isMode(session.mode) ? session.mode : DEFAULT_MODE;
  let modeSource: PolicySource = isMode(session.mode) ? 'session' : 'default';

  const allowedModes = Array.isArray(assignment?.allowedModes)
    ? assignment.allowedModes.filter(isMode)
    : null;

  if (allowedModes && allowedModes.length > 0 && !allowedModes.includes(mode)) {
    mode = allowedModes[0];
    modeSource = 'assignment';
  }

  let grade = DEFAULT_GRADE;
  let gradeSource: PolicySource = 'default';
  const assignmentGrade = clampGrade(assignment?.grade);
  const classroomGrade = clampGrade(classroom?.grade);
  const profileGrade = clampGrade(studentProfile?.grade);

  if (assignmentGrade !== null) {
    grade = assignmentGrade;
    gradeSource = 'assignment';
  } else if (classroomGrade !== null) {
    grade = classroomGrade;
    gradeSource = 'classroom';
  } else if (profileGrade !== null) {
    grade = profileGrade;
    gradeSource = 'studentProfile';
  }

  const hasAssignment = assignment !== null;

  // The image is only usable if it belongs to the same student as the session.
  // A session could otherwise name someone else's confirmed image and inherit
  // its confidence, which would turn R6 off with a borrowed id.
  const image =
    problemImage && problemImage.studentId === uid ? problemImage : null;

  const rawConfidence = image?.extractionConfidence;
  const extractionConfidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
      ? Math.min(Math.max(rawConfidence, 0), 1)
      : image
        ? // The image exists but carries no usable confidence. Treating that as
          // "no image" would skip R6 entirely, so it resolves to 0, which is
          // below the threshold and therefore requires confirmation.
          0
        : undefined;

  const extractionConfirmed = image ? image.confirmationStatus === 'confirmed' : undefined;

  // Problem statement precedence. The confirmed text wins, because it is what the
  // student verified against the image and it is the text the tutor must work on.
  // `originalProblem` on the session is written by the browser, so it is the
  // fallback rather than the source.
  const confirmedText = typeof image?.confirmedText === 'string' ? image.confirmedText : '';
  const sessionProblem =
    typeof session.originalProblem === 'string' ? session.originalProblem : '';
  const extractedText = typeof image?.extractedText === 'string' ? image.extractedText : '';

  const originalProblem =
    confirmedText.trim().length > 0
      ? confirmedText
      : sessionProblem.trim().length > 0
        ? sessionProblem
        : extractedText;

  return {
    sessionId,
    studentId: uid,
    originalProblem,
    subject: typeof session.subject === 'string' ? session.subject : 'mathematics',
    grade,
    language: session.language === 'vi' ? 'vi' : 'en',
    mode,
    strictness,
    // Only this endpoint writes it, and the rules exclude it from the
    // client-writable set. Clamping here defends against data corruption, not
    // against the client.
    currentHintLevel: clampHintLevel(session.currentHintLevel),
    allowFullSolutions:
      hasAssignment && typeof assignment.allowFullSolutions === 'boolean'
        ? assignment.allowFullSolutions
        : undefined,
    requireTransferProblem:
      hasAssignment && typeof assignment.requireTransferProblem === 'boolean'
        ? assignment.requireTransferProblem
        : undefined,
    extractionConfidence,
    extractionConfirmed,
    imageId: image ? (typeof image.id === 'string' ? image.id : undefined) : undefined,
    sources: {
      strictness: strictnessSource,
      mode: modeSource,
      grade: gradeSource,
      assignmentPolicy: hasAssignment ? 'assignment' : 'default',
    },
  };
}

/**
 * Reads every policy input for a session through the Admin SDK, and proves the
 * caller owns the session before returning anything.
 *
 * Admin credentials bypass security rules, so ownership is checked here
 * explicitly. A session belonging to another student returns `not_found` at the
 * call site so the endpoint does not confirm that the id exists.
 */
export async function resolvePolicyInputs(
  sessionId: string,
  uid: string,
): Promise<PolicyResolution> {
  const sessionSnapshot = await adminDb.collection('learningSessions').doc(sessionId).get();
  if (!sessionSnapshot.exists) return { status: 'not_found' };

  const session = (sessionSnapshot.data() ?? {}) as Record<string, unknown>;
  if (session.studentId !== uid) return { status: 'forbidden' };

  const assignmentId = typeof session.assignmentId === 'string' ? session.assignmentId : null;
  const classroomId = typeof session.classroomId === 'string' ? session.classroomId : null;
  const imageId = typeof session.imageId === 'string' ? session.imageId : null;

  const [assignmentSnapshot, classroomSnapshot, profileSnapshot, imageSnapshot] = await Promise.all([
    assignmentId ? adminDb.collection('assignments').doc(assignmentId).get() : null,
    classroomId ? adminDb.collection('classrooms').doc(classroomId).get() : null,
    adminDb.collection('studentProfiles').doc(uid).get(),
    imageId ? adminDb.collection('problemImages').doc(imageId).get() : null,
  ]);

  const assignment =
    assignmentSnapshot?.exists ? ((assignmentSnapshot.data() ?? {}) as Record<string, unknown>) : null;
  const classroom =
    classroomSnapshot?.exists ? ((classroomSnapshot.data() ?? {}) as Record<string, unknown>) : null;
  const studentProfile =
    profileSnapshot.exists ? ((profileSnapshot.data() ?? {}) as Record<string, unknown>) : null;
  const problemImage =
    imageSnapshot?.exists ? ((imageSnapshot.data() ?? {}) as Record<string, unknown>) : null;

  // An assignment must belong to the classroom the session claims, otherwise a
  // session could point at a lenient assignment from elsewhere.
  const assignmentBelongs =
    assignment !== null && (classroomId === null || assignment.classroomId === classroomId);

  return {
    status: 'ok',
    inputs: resolvePolicyFromDocuments(sessionId, uid, {
      session,
      assignment: assignmentBelongs ? assignment : null,
      classroom,
      studentProfile,
      problemImage,
    }),
  };
}

export interface TranscriptTurn {
  actor: 'student' | 'assistant' | 'system';
  content: string;
}

/**
 * Reads the conversation transcript server-side.
 *
 * The transcript is a policy input, which the original contract missed: the
 * classifier derives `studentProvidedAttempt` and `attemptQuality` from it, and
 * both gate answer disclosure. A client that could supply its own history could
 * describe an attempt the student never made and collect help it had not earned.
 */
export async function loadTranscript(
  sessionId: string,
  limit = 100,
): Promise<TranscriptTurn[]> {
  const snapshot = await adminDb
    .collection('sessionTurns')
    .where('sessionId', '==', sessionId)
    .get();

  return snapshot.docs
    .map((doc) => doc.data() as Record<string, unknown>)
    .map((data) => ({
      actor:
        data.actor === 'assistant' || data.actor === 'system'
          ? (data.actor as 'assistant' | 'system')
          : ('student' as const),
      content: typeof data.content === 'string' ? data.content : '',
      sequence: typeof data.sequence === 'number' ? data.sequence : 0,
    }))
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit)
    .map(({ actor, content }) => ({ actor, content }));
}
