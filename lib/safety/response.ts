import {
  getSafetyResources,
  type LocalSafetyResources,
  type SafetyLocale,
} from './resources';

/**
 * Deterministic safety responses (section 24).
 *
 * Until this session the safety path was a prompt instruction. The policy engine
 * correctly returned `safety_redirect`, and the tutoring route then called the
 * model anyway with `Action: safety_redirect` in its system context and shipped
 * whatever came back. Section 41.1 names that shape directly: "a prompt
 * instruction to obey the plan is not enforcement". A student disclosing self-harm
 * was receiving generated text, unattached to any support resource, with no
 * guarantee the model treated the turn as a safety turn at all.
 *
 * So the safety message is composed here, in code, from constants. No model call
 * happens on a safety turn — not as an optimisation, but because the one turn that
 * must not be improvised is the one where a child says something is wrong.
 *
 * Section 24's tone requirements are properties of these constants, checkable by
 * reading them: respond calmly, avoid graphic detail, encourage contacting a
 * trusted adult, never promise secrecy, do not act as a therapist, do not
 * interrogate the student.
 */

/** The nine categories the classifier may return, per section 15's schema. */
export type SafetyCategory =
  | 'none'
  | 'self_harm'
  | 'abuse'
  | 'sexual_content'
  | 'violence'
  | 'illegal_activity'
  | 'bullying'
  | 'personal_data'
  | 'other';

/**
 * Section 24 requires the application to "clearly distinguish" four things. They
 * are distinguished here as a closed union, so a new category cannot be handled
 * by an ad-hoc string at a call site.
 *
 * - `educational_redirect` — off-limits for schoolwork, but no welfare concern.
 * - `emergency_guidance` — possible immediate risk to the student. Guidance is
 *   surfaced with support resources.
 * - `teacher_review` — a human at the school should see this.
 * - `abuse_report` — platform misuse, routed to administrators, not to teachers.
 */
export type SafetyResponseClass =
  | 'educational_redirect'
  | 'emergency_guidance'
  | 'teacher_review'
  | 'abuse_report';

export interface SafetyDisposition {
  responseClass: SafetyResponseClass;
  /** Whether a human at the school is asked to look. Never shown to classmates. */
  flagForTeacherReview: boolean;
  /** Whether support resources accompany the message. */
  includeSupportResources: boolean;
}

/**
 * Category to disposition. Fixed table rather than nested conditionals so that
 * every category's handling is visible in one place and reviewable by someone who
 * is not reading the control flow.
 */
const DISPOSITIONS: Record<Exclude<SafetyCategory, 'none'>, SafetyDisposition> = {
  // Possible immediate risk. The only two that surface resources.
  self_harm: {
    responseClass: 'emergency_guidance',
    flagForTeacherReview: true,
    includeSupportResources: true,
  },
  abuse: {
    responseClass: 'emergency_guidance',
    flagForTeacherReview: true,
    includeSupportResources: true,
  },
  // A student describing being bullied is a welfare matter for a human, but the
  // student is not being told to seek emergency services for it.
  bullying: {
    responseClass: 'teacher_review',
    flagForTeacherReview: true,
    includeSupportResources: true,
  },
  violence: {
    responseClass: 'teacher_review',
    flagForTeacherReview: true,
    includeSupportResources: false,
  },
  // Not welfare concerns: these are simply not what this tool does. Flagging a
  // student for a curious question would make the tool something to be wary of,
  // which section 5's trust principle rules out.
  sexual_content: {
    responseClass: 'educational_redirect',
    flagForTeacherReview: false,
    includeSupportResources: false,
  },
  illegal_activity: {
    responseClass: 'educational_redirect',
    flagForTeacherReview: false,
    includeSupportResources: false,
  },
  // The student is about to hand over identifying information. Redirect, and do
  // not create a record that repeats what they typed.
  personal_data: {
    responseClass: 'educational_redirect',
    flagForTeacherReview: false,
    includeSupportResources: false,
  },
  other: {
    responseClass: 'educational_redirect',
    flagForTeacherReview: false,
    includeSupportResources: false,
  },
};

export function dispositionFor(category: SafetyCategory): SafetyDisposition | null {
  if (category === 'none') return null;
  return DISPOSITIONS[category];
}

interface MessageSet {
  emergency_guidance: string;
  teacher_review: string;
  educational_redirect: string;
  abuse_report: string;
  resourcesHeading: string;
  trustedAdultHeading: string;
}

/**
 * The message bodies.
 *
 * Written to satisfy section 24 line by line: calm, no graphic detail, no
 * promise of secrecy ("I can't keep this private" is stated, not omitted), no
 * therapeutic role, and no questions back at the student — section 24 forbids
 * interrogating them, so none of these end in a question mark.
 */
const MESSAGES: Record<SafetyLocale, MessageSet> = {
  en: {
    emergency_guidance:
      "Thank you for telling me. I'm a study tool, so I'm not the right kind of help for this, " +
      "and I can't keep it private if you might be in danger. Please talk to an adult you trust " +
      'today. You deserve support from someone who can actually be there with you.',
    teacher_review:
      "I'm sorry this is happening. This isn't something I can help with as a study tool, and a " +
      'teacher or counsellor at your school is the right person to tell. I have let your teacher ' +
      "know that you may want to talk, and I haven't shared what you wrote with your classmates.",
    educational_redirect:
      "I can't help with that here. This space is for schoolwork, so let's stay with your problem. " +
      "If you have a question about the work you're studying, tell me where you got stuck.",
    abuse_report:
      "I can't help with that. This has been recorded for review by an administrator.",
    resourcesHeading: 'Where to get help',
    trustedAdultHeading: 'What you can do now',
  },
  vi: {
    emergency_guidance:
      'Cảm ơn em đã nói với thầy cô. Đây là công cụ học tập, nên thầy cô không phải là nơi giúp ' +
      'được việc này, và nếu em có thể đang gặp nguy hiểm thì thầy cô không thể giữ kín. Hôm nay ' +
      'em hãy nói với một người lớn mà em tin tưởng. Em xứng đáng được một người ở bên cạnh giúp em.',
    teacher_review:
      'Thầy cô rất tiếc vì chuyện này đang xảy ra. Đây không phải điều một công cụ học tập giúp ' +
      'được, và giáo viên hoặc cán bộ tư vấn ở trường là người em nên nói. Thầy cô đã báo cho giáo ' +
      'viên biết rằng em có thể muốn trò chuyện, và không chia sẻ điều em viết với các bạn cùng lớp.',
    educational_redirect:
      'Thầy cô không thể giúp việc đó ở đây. Không gian này dành cho bài học, nên mình quay lại bài ' +
      'của em nhé. Nếu em có câu hỏi về phần đang học, hãy nói cho thầy cô biết em đang mắc ở đâu.',
    abuse_report:
      'Thầy cô không thể giúp việc đó. Nội dung này đã được ghi lại để người quản trị xem xét.',
    resourcesHeading: 'Nơi em có thể tìm giúp đỡ',
    trustedAdultHeading: 'Em có thể làm ngay',
  },
};

export interface SafetyResponse {
  messageMarkdown: string;
  responseClass: SafetyResponseClass;
  flagForTeacherReview: boolean;
  resources: LocalSafetyResources;
}

/**
 * Composes the safety response for a category and language.
 *
 * Returns null for `none`, so a caller cannot accidentally produce a safety
 * message for a normal turn.
 */
export function composeSafetyResponse(
  category: SafetyCategory,
  language: SafetyLocale = 'en',
): SafetyResponse | null {
  const disposition = dispositionFor(category);
  if (!disposition) return null;

  const messages = MESSAGES[language] ?? MESSAGES.en;
  const resources = getSafetyResources(language);

  const parts: string[] = [messages[disposition.responseClass]];

  if (disposition.includeSupportResources) {
    parts.push('', `**${messages.trustedAdultHeading}**`, '');
    parts.push(...resources.trustedAdultGuidance.map((line) => `- ${line}`));

    // Only verified contacts reach this point; `getSafetyResources` filters the
    // rest. When there are none, the absence is explained rather than left as an
    // empty heading that looks like a rendering failure.
    if (resources.childSupportResources.length > 0) {
      parts.push('', `**${messages.resourcesHeading}**`, '');
      for (const contact of resources.childSupportResources) {
        parts.push(`- **${contact.name}** — ${contact.contact}. ${contact.description}`);
      }
    } else {
      parts.push('', `_${resources.noContactsNotice}_`);
    }
  }

  return {
    messageMarkdown: parts.join('\n'),
    responseClass: disposition.responseClass,
    flagForTeacherReview: disposition.flagForTeacherReview,
    resources,
  };
}
