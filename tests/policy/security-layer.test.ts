import { describe, it, expect, vi } from 'vitest';
import { activateAppCheck, readSiteKey } from '@/lib/firebase/app-check';
import {
  RATE_LIMITS,
  clientAddress,
  hashIdentifier,
  rateLimitHeaders,
} from '@/lib/security/rate-limit';

/**
 * Unit coverage for the pure parts of the Phase 8 security layer.
 *
 * The rate limiter's real behavior is tested against the Firestore emulator in
 * `tests/integration/safety-and-rate-limit.emulator.test.ts`, because a shared,
 * atomic counter cannot be observed in a unit test. What is covered here is the
 * logic that does not touch the store: key derivation, header parsing, and the
 * App Check activation branches.
 */

const app = {} as Parameters<typeof activateAppCheck>[0]['app'];

describe('App Check activation', () => {
  it('treats a blank site key as absent', () => {
    expect(readSiteKey({ recaptchaSiteKey: '' })).toBeNull();
    expect(readSiteKey({ recaptchaSiteKey: '   ' })).toBeNull();
    expect(readSiteKey({})).toBeNull();
    expect(readSiteKey({ recaptchaSiteKey: 'abc123' })).toBe('abc123');
  });

  it('reports the repository\'s actual state as not configured', async () => {
    // This is the Phase 8 criterion's second branch, asserted rather than asserted
    // about: there is no site key, so activation reports the gap and points at the
    // document that records it.
    const result = await activateAppCheck({
      app,
      siteKey: null,
      usingEmulators: false,
      isBrowser: true,
    });
    expect(result.status).toBe('not_configured');
    expect(result.detail).toContain('ASSUMPTIONS');
  });

  it('does not attempt activation during server rendering', async () => {
    const result = await activateAppCheck({
      app,
      siteKey: 'a-real-key',
      usingEmulators: false,
      isBrowser: false,
    });
    expect(result.status).toBe('skipped_server');
  });

  it('does not attempt activation against the emulator suite', async () => {
    // The emulators do not verify App Check tokens, so attesting against them
    // produces failures that mean nothing.
    const result = await activateAppCheck({
      app,
      siteKey: 'a-real-key',
      usingEmulators: true,
      isBrowser: true,
    });
    expect(result.status).toBe('skipped_emulator');
  });

  it('never throws when activation fails', async () => {
    // An abuse control that fails must not become an outage; the controls that
    // gate access are ID-token verification and security rules, which fail closed.
    const result = await activateAppCheck({
      app: null as never,
      siteKey: 'a-real-key',
      usingEmulators: false,
      isBrowser: true,
    });
    expect(['failed', 'active']).toContain(result.status);
  });
});

describe('rate limit key derivation', () => {
  it('hashes identifiers rather than storing them', () => {
    const hashed = hashIdentifier('203.0.113.9');
    expect(hashed).not.toContain('203.0.113.9');
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same input and distinct for different ones', () => {
    expect(hashIdentifier('user-a')).toBe(hashIdentifier('user-a'));
    expect(hashIdentifier('user-a')).not.toBe(hashIdentifier('user-b'));
  });

  it('produces a Firestore-safe document id from an address containing slashes', () => {
    // An IPv6 CIDR or a malformed header would otherwise create a nested path.
    expect(hashIdentifier('2001:db8::/32')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('separates the salt from the value', () => {
    // Guards against a concatenation bug where salt+value collides across a
    // boundary, e.g. salt "ab" + "c" matching salt "a" + "bc".
    const original = process.env.RATE_LIMIT_SALT;
    process.env.RATE_LIMIT_SALT = 'ab';
    const first = hashIdentifier('c');
    process.env.RATE_LIMIT_SALT = 'a';
    const second = hashIdentifier('bc');
    process.env.RATE_LIMIT_SALT = original;
    expect(first).not.toBe(second);
  });
});

describe('client address extraction', () => {
  function withHeaders(entries: Record<string, string>): Headers {
    return new Headers(entries);
  }

  it('returns null when no proxy header is present', () => {
    expect(clientAddress(new Headers())).toBeNull();
  });

  it('takes the left-most hop, which is the original client', () => {
    expect(
      clientAddress(withHeaders({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18' })),
    ).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip', () => {
    expect(clientAddress(withHeaders({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('ignores an empty header rather than keying on an empty string', () => {
    // Every caller sharing one empty-string key would rate-limit the whole world
    // together, which is a denial of service rather than a limit.
    expect(clientAddress(withHeaders({ 'x-forwarded-for': '   ' }))).toBeNull();
    expect(clientAddress(withHeaders({ 'x-forwarded-for': ',' }))).toBeNull();
  });
});

describe('rate limit configuration', () => {
  it('limits both AI-spending endpoints', () => {
    expect(Object.keys(RATE_LIMITS)).toContain('tutorChat');
    expect(Object.keys(RATE_LIMITS)).toContain('imageUpload');
  });

  it('allows more per IP than per user', () => {
    // A school NAT puts a whole class behind one address. An IP limit at or below
    // the user limit would lock out a classroom the moment two students worked at
    // once.
    for (const policy of Object.values(RATE_LIMITS)) {
      expect(policy.ip.limit).toBeGreaterThan(policy.user.limit);
    }
  });

  it('emits Retry-After so a refused client does not hammer the endpoint', () => {
    const headers = rateLimitHeaders({
      allowed: false,
      scope: 'user',
      remaining: 0,
      retryAfterSeconds: 42,
      limit: 12,
      unavailable: false,
    });
    expect(headers['Retry-After']).toBe('42');
    expect(headers['X-RateLimit-Limit']).toBe('12');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
  });
});
