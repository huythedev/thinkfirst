import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionGet = vi.fn();
const transactionSet = vi.fn();
const transactionDelete = vi.fn();
const runTransaction = vi.fn();

vi.mock('node:crypto', () => ({
  randomUUID: () => 'lock-token',
}));

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }),
    runTransaction: (...args: unknown[]) => runTransaction(...args),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  Timestamp: {
    fromMillis: (ms: number) => ({ toMillis: () => ms, __millis: ms }),
  },
}));

const { acquireSessionRequestLock, releaseSessionRequestLock } = await import(
  '@/lib/session/request-lock'
);

beforeEach(() => {
  vi.clearAllMocks();
  transactionGet.mockResolvedValue({ exists: false, data: () => undefined });
  runTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      get: transactionGet,
      set: transactionSet,
      delete: transactionDelete,
    }),
  );
});

describe('session request lock', () => {
  it('acquires an empty lease transactionally', async () => {
    const lock = await acquireSessionRequestLock('session-1');

    expect(lock).toEqual({ sessionId: 'session-1', token: 'lock-token' });
    expect(transactionSet).toHaveBeenCalledTimes(1);
    expect(transactionSet.mock.calls[0][0]).toEqual({
      path: 'sessionProcessingLocks/session-1',
    });
    expect(transactionSet.mock.calls[0][1]).toMatchObject({
      sessionId: 'session-1',
      token: 'lock-token',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('refuses acquisition while a non-expired lease exists', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        token: 'someone-else',
        expiresAt: { toMillis: () => Date.now() + 60_000 },
      }),
    });

    await expect(acquireSessionRequestLock('session-1')).resolves.toBeNull();
    expect(transactionSet).not.toHaveBeenCalled();
  });

  it('reclaims an expired lease', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({
        token: 'stale',
        expiresAt: { toMillis: () => Date.now() - 1 },
      }),
    });

    await expect(acquireSessionRequestLock('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      token: 'lock-token',
    });
    expect(transactionSet).toHaveBeenCalledTimes(1);
  });

  it('releases only its own lease token', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ token: 'lock-token' }),
    });

    await releaseSessionRequestLock({ sessionId: 'session-1', token: 'lock-token' });
    expect(transactionDelete).toHaveBeenCalledWith({
      path: 'sessionProcessingLocks/session-1',
    });
  });

  it('does not delete a newer lease after the old request finishes late', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ token: 'newer-token' }),
    });

    await releaseSessionRequestLock({ sessionId: 'session-1', token: 'lock-token' });
    expect(transactionDelete).not.toHaveBeenCalled();
  });
});
