/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => {
  const listeners: Array<(snapshot: any) => void> = [];
  const onSnapshot = vi.fn((_source: unknown, success: (snapshot: any) => void) => {
    listeners.push(success);
    return vi.fn();
  });
  return { listeners, onSnapshot };
});

vi.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 'session-1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'student-1' }, loading: false }) }));
vi.mock('@/lib/firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})), doc: vi.fn(() => ({ path: 'learningSessions/session-1' })), query: vi.fn(() => ({})),
  where: vi.fn(), orderBy: vi.fn(), updateDoc: vi.fn(), onSnapshot: firestoreMocks.onSnapshot,
}));
vi.mock('@/components/TutorMarkdown', () => ({ TutorMarkdown: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/LiveScorePanel', () => ({ LiveScorePanel: () => null }));
vi.mock('@/hooks/use-live-session-score', () => ({ useLiveSessionScore: () => ({ score: null }) }));
vi.mock('@/components/HintLadderIndicator', () => ({ HintLadderIndicator: () => null }));
vi.mock('@/components/Scratchpad', () => ({ Scratchpad: () => null }));
vi.mock('@/components/SessionProblemImage', () => ({ SessionProblemImage: () => null }));
vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import LearningWorkspace from '@/app/student/session/[sessionId]/page';

function sessionSnapshot() {
  return { exists: () => true, id: 'session-1', data: () => ({
    status: 'active', subject: 'mathematics', mode: 'practice', strictness: 'balanced',
    currentHintLevel: 0, language: 'vi', originalProblem: 'x^2 - 6x + 7 = 0', studentId: 'student-1',
  }) };
}
function turnsSnapshot(turns: any[] = []) {
  return { docs: turns.map((turn, index) => ({ id: `turn-${index}`, data: () => turn })) };
}

describe('LearningWorkspace optimistic chat', () => {
  let chatRequests: Array<{ body: string; resolve: (value: Response) => void; reject: (reason?: unknown) => void }>;

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    firestoreMocks.listeners.length = 0;
    firestoreMocks.onSnapshot.mockClear();
    chatRequests = [];
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('/transfer')) return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      return new Promise<Response>((resolve, reject) => chatRequests.push({ body: String(init?.body), resolve, reject }));
    }));
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' });
  });

  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function renderWorkspace() {
    render(<LearningWorkspace />);
    await act(async () => {
      firestoreMocks.listeners[0](sessionSnapshot());
      firestoreMocks.listeners[1](turnsSnapshot());
    });
  }

  async function sendHello() {
    fireEvent.change(screen.getByLabelText('Your message to the tutor'), { target: { value: 'Em đang bị bí.' } });
    fireEvent.click(screen.getByRole('button', { name: 'activeSession.send' }));
    await act(async () => {});
    expect(chatRequests).toHaveLength(1);
  }

  it('shows the student message immediately and announces typing before the request resolves', async () => {
    vi.useFakeTimers();
    await renderWorkspace();
    await sendHello();
    expect(screen.getByTestId('optimistic-student-message').textContent).toContain('Em đang bị bí.');
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByTestId('typing-indicator').getAttribute('aria-live')).toBe('polite');
    vi.useRealTimers();
  });

  it('reconciles the server-owned turn by clientRequestId without duplicating it', async () => {
    await renderWorkspace();
    await sendHello();
    await act(async () => firestoreMocks.listeners[1](turnsSnapshot([{ actor: 'student', content: 'Em đang bị bí.', clientRequestId: '11111111-1111-4111-8111-111111111111' }])));
    expect(screen.getAllByText('Em đang bị bí.')).toHaveLength(1);
    expect(screen.queryByTestId('optimistic-student-message')).toBeNull();
  });

  it('keeps a failed message and retries with the same request id', async () => {
    await renderWorkspace();
    await sendHello();
    await act(async () => chatRequests[0].reject(new Error('offline')));
    expect(await screen.findByText('Không gửi được · Thử lại')).toBeTruthy();
    fireEvent.click(screen.getByText('Không gửi được · Thử lại'));
    await act(async () => {});
    expect(chatRequests).toHaveLength(2);
    expect(JSON.parse(chatRequests[0].body).clientRequestId).toBe(JSON.parse(chatRequests[1].body).clientRequestId);
  });
});
