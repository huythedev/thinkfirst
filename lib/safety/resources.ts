/**
 * Locale safety resources (section 24).
 *
 * Section 24 requires "configurable safety resource files by locale" and, in the
 * same breath, two prohibitions that decide this module's entire design:
 *
 *   - "Never invent emergency phone numbers."
 *   - "Do not ship unverified placeholder hotline information in production."
 *
 * Phase 8's exit criterion repeats it: locale resources must "contain no
 * unverified placeholder contact information".
 *
 * So this file ships the structure and, deliberately, **no contact numbers**.
 * Nothing in this environment can verify a hotline for any jurisdiction, and a
 * wrong crisis number is worse than no number at all: it consumes the one moment
 * a student reached out. An unverified entry is not a helpful default, it is a
 * dead end presented as help.
 *
 * What ships instead is the guidance section 24 asks for that needs no external
 * contact to be true and safe: tell a trusted adult, a teacher, a school
 * counsellor, a family member. That is real advice, not a placeholder.
 *
 * A deployment supplies real contacts by editing `SAFETY_RESOURCES` and setting
 * `verified: true` with a reviewer and a date. `getSafetyResources` never returns
 * an unverified entry, so forgetting to verify fails toward silence rather than
 * toward a fabricated number.
 */

export type SafetyLocale = 'en' | 'vi';

export interface SafetyContact {
  name: string;
  contact: string;
  description: string;
  /**
   * Set to true only when a human has confirmed this contact is correct and
   * current for the deployment's jurisdiction. Unverified entries are withheld
   * by `getSafetyResources` rather than displayed.
   */
  verified: boolean;
  /** Who confirmed it, and when. Both required for a verified entry. */
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface LocalSafetyResources {
  locale: SafetyLocale;
  /**
   * Optional and intentionally absent. Section 24 forbids inventing emergency
   * numbers, and even a well-known number is jurisdiction-specific: a student in
   * one country reading another's number loses time in the worst possible
   * moment.
   */
  emergencyNumber?: string;
  childSupportResources: SafetyContact[];
  /**
   * Guidance that is safe and true without any external contact. This is what
   * the student actually sees today.
   */
  trustedAdultGuidance: string[];
  /** ISO date of the last human review of this locale's entries. */
  lastReviewedAt: string;
  /**
   * Shown whenever `childSupportResources` yields nothing, so the absence is
   * explained rather than looking like a loading failure.
   */
  noContactsNotice: string;
}

/**
 * Strings that indicate a contact was typed as a stand-in rather than verified.
 *
 * `555` is included because it is the North American fictional exchange and the
 * single most likely number to be pasted into a demo. `1234`, `0000` and
 * `9999` catch the keyboard-mash placeholders.
 */
const PLACEHOLDER_MARKERS = [
  'xxx',
  'todo',
  'tbd',
  'tba',
  'placeholder',
  'example',
  'insert',
  'your ',
  'n/a',
  'lorem',
  'fixme',
  'changeme',
  'sample',
  '555-',
  '555.',
  '5551',
  '123-456',
  '1234567',
  '0000000',
  '9999999',
];

/**
 * True when a contact string looks like a stand-in.
 *
 * Deliberately over-inclusive. A false positive withholds a real contact and is
 * visible in the UI as "no contacts configured", which someone will notice and
 * fix. A false negative ships a fake crisis number, which nobody notices until
 * it matters.
 */
export function looksLikePlaceholder(contact: string): boolean {
  const normalized = contact.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * A contact is servable only if it is marked verified, carries its provenance,
 * and does not look like a placeholder. All three, because each catches a
 * different mistake: forgetting to review, reviewing without recording it, and
 * marking a stand-in as reviewed.
 */
export function isServableContact(contact: SafetyContact): boolean {
  if (!contact.verified) return false;
  if (!contact.verifiedBy || !contact.verifiedAt) return false;
  if (looksLikePlaceholder(contact.contact)) return false;
  return true;
}

const SAFETY_RESOURCES: Record<SafetyLocale, LocalSafetyResources> = {
  en: {
    locale: 'en',
    // No emergencyNumber. See the module comment: not inventable, not guessable.
    childSupportResources: [],
    trustedAdultGuidance: [
      'Talk to an adult you trust: a parent, guardian, or another family member.',
      'Your teacher or school counsellor can help, and you can ask to speak to them privately.',
      'If someone is in immediate danger, contact your local emergency services now.',
    ],
    lastReviewedAt: '2026-08-07',
    noContactsNotice:
      'This installation has not had local support services configured yet. Please speak to a trusted adult at your school.',
  },
  vi: {
    locale: 'vi',
    childSupportResources: [],
    trustedAdultGuidance: [
      'Hãy nói với một người lớn mà em tin tưởng: cha mẹ, người thân, hoặc người chăm sóc em.',
      'Giáo viên hoặc cán bộ tư vấn của trường có thể giúp em, và em có thể xin được nói chuyện riêng.',
      'Nếu có ai đang gặp nguy hiểm ngay lúc này, hãy liên hệ dịch vụ cấp cứu tại địa phương.',
    ],
    lastReviewedAt: '2026-08-07',
    noContactsNotice:
      'Cài đặt này chưa được cấu hình các dịch vụ hỗ trợ tại địa phương. Em hãy nói với một người lớn đáng tin cậy ở trường.',
  },
};

/**
 * Returns the resources for a locale, with unverified contacts stripped.
 *
 * Filtering happens here rather than at each call site so that no caller can
 * accidentally render an unverified entry, and so adding a caller cannot
 * reintroduce the problem.
 */
export function getSafetyResources(locale: string): LocalSafetyResources {
  const key: SafetyLocale = locale === 'vi' ? 'vi' : 'en';
  const configured = SAFETY_RESOURCES[key];

  return {
    ...configured,
    childSupportResources: configured.childSupportResources.filter(isServableContact),
    emergencyNumber:
      configured.emergencyNumber && !looksLikePlaceholder(configured.emergencyNumber)
        ? configured.emergencyNumber
        : undefined,
  };
}

/** The raw table, for tests that must inspect unfiltered entries. */
export function allConfiguredResources(): LocalSafetyResources[] {
  return Object.values(SAFETY_RESOURCES);
}
