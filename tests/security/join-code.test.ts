import { describe, expect, it } from 'vitest';
import { hashJoinCode } from '@/lib/security/join-code';

describe('classroom join-code privacy', () => {
  it('canonicalizes case and surrounding whitespace', () => {
    expect(hashJoinCode(' abC123 ')).toBe(hashJoinCode('ABC123'));
  });

  it('does not equal the shareable code', () => {
    expect(hashJoinCode('ABC123')).not.toBe('ABC123');
    expect(hashJoinCode('ABC123')).toMatch(/^[a-f0-9]{64}$/);
  });
});
