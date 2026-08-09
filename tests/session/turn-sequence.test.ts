import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionGet = vi.fn();
const transactionSet = vi.fn();
const runTransaction = vi.fn();

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
}));

const { reserveTurnSequences } = await import('@/lib/session/turn-sequence');

beforeEach(() => {
  vi.clearAllMocks();
  transactionGet.mockResolvedValue({ data: () => undefined });
  runTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({ get: transactionGet, set: transactionSet }),
  );
});

describe('reserveTurnSequences', () => {
  it('bootstraps from the persisted transcript maximum', async () => {
    await expect(reserveTurnSequences('session-1', 7, 2)).resolves.toEqual([7, 8]);

    expect(transactionSet).toHaveBeenCalledWith(
      { path: 'sessionTurnCounters/session-1' },
      {
        sessionId: 'session-1',
        nextSequence: 9,
        updatedAt: 'SERVER_TIMESTAMP',
      },
      { merge: true },
    );
  });

  it('continues from a higher existing server counter', async () => {
    transactionGet.mockResolvedValue({ data: () => ({ nextSequence: 12 }) });

    await expect(reserveTurnSequences('session-1', 7, 2)).resolves.toEqual([12, 13]);
    expect(transactionSet.mock.calls[0][1]).toMatchObject({ nextSequence: 14 });
  });

  it('never moves backward when an old counter is behind the transcript', async () => {
    transactionGet.mockResolvedValue({ data: () => ({ nextSequence: 3 }) });

    await expect(reserveTurnSequences('session-1', 7, 1)).resolves.toEqual([7]);
    expect(transactionSet.mock.calls[0][1]).toMatchObject({ nextSequence: 8 });
  });

  it('ignores malformed stored counters instead of trusting them', async () => {
    transactionGet.mockResolvedValue({ data: () => ({ nextSequence: -100 }) });

    await expect(reserveTurnSequences('session-1', 4, 1)).resolves.toEqual([4]);
  });

  it('rejects invalid reservation requests before touching Firestore', async () => {
    await expect(reserveTurnSequences('', 1, 1)).rejects.toThrow();
    await expect(reserveTurnSequences('session-1', 0, 1)).rejects.toThrow();
    await expect(reserveTurnSequences('session-1', 1, 0)).rejects.toThrow();
    await expect(reserveTurnSequences('session-1', 1, 11)).rejects.toThrow();
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
