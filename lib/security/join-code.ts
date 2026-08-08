import { createHash } from 'node:crypto';

/** Returns the canonical digest used for classroom join-code lookups. */
export function hashJoinCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase(), 'utf8').digest('hex');
}
