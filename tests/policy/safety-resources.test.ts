import { describe, it, expect } from 'vitest';
import {
  allConfiguredResources,
  getSafetyResources,
  isServableContact,
  looksLikePlaceholder,
  type SafetyContact,
} from '@/lib/safety/resources';
import {
  composeSafetyResponse,
  dispositionFor,
  type SafetyCategory,
} from '@/lib/safety/response';

/**
 * Section 24 and the Phase 8 exit criterion "locale safety resources exist and
 * contain no unverified placeholder contact information".
 *
 * The load-bearing test in this file is the last one in the first group: it walks
 * every configured locale and asserts that nothing unverified can reach a
 * student. That is the criterion, and it is asserted over the real table rather
 * than a fixture, so adding a bad entry later fails here.
 */

const ALL_CATEGORIES: Exclude<SafetyCategory, 'none'>[] = [
  'self_harm',
  'abuse',
  'sexual_content',
  'violence',
  'illegal_activity',
  'bullying',
  'personal_data',
  'other',
];

function contact(overrides: Partial<SafetyContact> = {}): SafetyContact {
  return {
    name: 'Example Line',
    contact: '+84 111 222 333',
    description: 'A support line.',
    verified: true,
    verifiedBy: 'a reviewer',
    verifiedAt: '2026-08-07',
    ...overrides,
  };
}

describe('locale safety resources', () => {
  it('recognises placeholder contact strings', () => {
    expect(looksLikePlaceholder('XXX-XXX-XXXX')).toBe(true);
    expect(looksLikePlaceholder('TODO')).toBe(true);
    expect(looksLikePlaceholder('555-0100')).toBe(true);
    expect(looksLikePlaceholder('123-456-7890')).toBe(true);
    expect(looksLikePlaceholder('insert local hotline')).toBe(true);
    expect(looksLikePlaceholder('  ')).toBe(true);
  });

  it('does not flag a plausible real contact as a placeholder', () => {
    expect(looksLikePlaceholder('+84 24 3736 8888')).toBe(false);
    expect(looksLikePlaceholder('support@school.example.org')).toBe(true);
  });

  it('withholds a contact that is not marked verified', () => {
    expect(isServableContact(contact({ verified: false }))).toBe(false);
  });

  it('withholds a verified contact with no recorded reviewer', () => {
    expect(isServableContact(contact({ verifiedBy: undefined }))).toBe(false);
  });

  it('withholds a verified contact with no review date', () => {
    expect(isServableContact(contact({ verifiedAt: undefined }))).toBe(false);
  });

  it('withholds a contact marked verified that is still a placeholder', () => {
    // The mistake this catches: someone flips `verified` to true across the file
    // without replacing the stand-in strings.
    expect(isServableContact(contact({ contact: '555-0199' }))).toBe(false);
  });

  it('serves a fully verified, non-placeholder contact', () => {
    expect(isServableContact(contact())).toBe(true);
  });

  it('ships no unverified contact information in any locale', () => {
    // This is the exit criterion itself, asserted over the real configuration.
    for (const resources of allConfiguredResources()) {
      for (const entry of resources.childSupportResources) {
        expect(
          isServableContact(entry),
          `${resources.locale} carries an unservable contact: ${entry.name}`,
        ).toBe(true);
      }
      if (resources.emergencyNumber !== undefined) {
        expect(
          looksLikePlaceholder(resources.emergencyNumber),
          `${resources.locale} emergency number looks like a placeholder`,
        ).toBe(false);
      }
    }
  });

  it('invents no emergency number', () => {
    // Section 24: "Never invent emergency phone numbers." Nothing in this
    // environment can verify one, so none is configured.
    for (const resources of allConfiguredResources()) {
      expect(resources.emergencyNumber).toBeUndefined();
    }
  });

  it('still offers real guidance when no contacts are configured', () => {
    // Withholding numbers must not mean withholding help.
    for (const locale of ['en', 'vi']) {
      const resources = getSafetyResources(locale);
      expect(resources.childSupportResources).toHaveLength(0);
      expect(resources.trustedAdultGuidance.length).toBeGreaterThanOrEqual(3);
      expect(resources.noContactsNotice.length).toBeGreaterThan(0);
    }
  });

  it('falls back to English for an unknown locale', () => {
    expect(getSafetyResources('de').locale).toBe('en');
    expect(getSafetyResources('').locale).toBe('en');
  });
});

describe('safety response composition', () => {
  it('produces no safety response for category none', () => {
    expect(composeSafetyResponse('none')).toBeNull();
    expect(dispositionFor('none')).toBeNull();
  });

  it('classifies every category into one of the four section 24 classes', () => {
    for (const category of ALL_CATEGORIES) {
      const response = composeSafetyResponse(category);
      expect(response, category).not.toBeNull();
      expect([
        'educational_redirect',
        'emergency_guidance',
        'teacher_review',
        'abuse_report',
      ]).toContain(response!.responseClass);
    }
  });

  it('treats self-harm and abuse as emergency guidance with resources', () => {
    for (const category of ['self_harm', 'abuse'] as const) {
      const response = composeSafetyResponse(category)!;
      expect(response.responseClass).toBe('emergency_guidance');
      expect(response.flagForTeacherReview).toBe(true);
      expect(response.messageMarkdown).toContain('adult you trust');
    }
  });

  it('does not flag a student for asking an off-limits question', () => {
    // A curious question is not a welfare concern. Flagging it would make the
    // tool something to be careful around, which defeats its purpose.
    for (const category of ['sexual_content', 'illegal_activity', 'personal_data'] as const) {
      const response = composeSafetyResponse(category)!;
      expect(response.responseClass).toBe('educational_redirect');
      expect(response.flagForTeacherReview).toBe(false);
    }
  });

  it('never promises secrecy on an emergency disclosure', () => {
    // Section 24: "Avoid promising secrecy." The message says the opposite.
    const response = composeSafetyResponse('self_harm')!;
    expect(response.messageMarkdown).toContain("can't keep it private");
  });

  it('does not interrogate the student', () => {
    // Section 24: "Avoid interrogating the student." No safety message asks a
    // question of any kind.
    for (const category of ALL_CATEGORIES) {
      const response = composeSafetyResponse(category)!;
      expect(response.messageMarkdown, category).not.toContain('?');
    }
  });

  it('explains the absence of contacts instead of showing an empty heading', () => {
    const response = composeSafetyResponse('self_harm')!;
    expect(response.messageMarkdown).toContain('has not had local support services configured');
  });

  it('answers in Vietnamese when that is the session language', () => {
    const response = composeSafetyResponse('self_harm', 'vi')!;
    expect(response.messageMarkdown).toContain('người lớn mà em tin tưởng');
    expect(response.messageMarkdown).not.toContain('adult you trust');
  });

  it('is deterministic: the same category yields the same message', () => {
    // No model call is involved, which is the point of this module.
    const first = composeSafetyResponse('bullying', 'en')!;
    const second = composeSafetyResponse('bullying', 'en')!;
    expect(first.messageMarkdown).toBe(second.messageMarkdown);
  });
});
