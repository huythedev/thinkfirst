import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'thinkfirst-session-boundaries-test';
const STUDENT = 'session-boundary-student';
const REPO_ROOT = resolve(__dirname, '../..');

const EMULATOR_PORT: number = (() => {
  const config = JSON.parse(readFileSync(resolve(REPO_ROOT, 'firebase.json'), 'utf8'));
  const port = config?.emulators?.firestore?.port;
  if (typeof port !== 'number') throw new Error('Firestore emulator port missing.');
  return port;
})();

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: EMULATOR_PORT,
      rules: readFileSync(resolve(REPO_ROOT, 'firebase/firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

function db() {
  return env.authenticatedContext(STUDENT).firestore();
}

function validSession(extra: Record<string, unknown> = {}) {
  return {
    studentId: STUDENT,
    subject: 'mathematics',
    grade: 8,
    language: 'en',
    mode: 'practice',
    strictness: 'balanced',
    status: 'active',
    originalProblem: 'Solve 2x + 3 = 11',
    currentHintLevel: 0,
    startedAt: new Date('2026-08-09T12:00:00Z'),
    policyVersion: 'policy-v2',
    scoringVersion: 'scoring-v2',
    ...extra,
  };
}

describe('learning-session creation trust boundary', () => {
  it('still permits the documented client-created workspace shell', async () => {
    await assertSucceeds(
      setDoc(doc(db(), 'learningSessions', 'valid-session'), validSession()),
    );
  });

  it('refuses client-seeded assigned difficulty', async () => {
    await assertFails(
      setDoc(
        doc(db(), 'learningSessions', 'forged-difficulty'),
        validSession({ assignedDifficulty: 5 }),
      ),
    );
  });

  it('refuses client-seeded system-error state', async () => {
    await assertFails(
      setDoc(
        doc(db(), 'learningSessions', 'forged-system-error'),
        validSession({ endedWithSystemError: false }),
      ),
    );
  });

  it('refuses a completed timestamp on an active session create', async () => {
    await assertFails(
      setDoc(
        doc(db(), 'learningSessions', 'forged-completion'),
        validSession({ completedAt: new Date('2099-01-01T00:00:00Z') }),
      ),
    );
  });
});

describe('server-only transcript and coordination documents', () => {
  it('refuses a direct student transcript write', async () => {
    await assertFails(
      setDoc(doc(db(), 'sessionTurns', 'forged-turn'), {
        sessionId: 'valid-session',
        studentId: STUDENT,
        sequence: 1,
        actor: 'student',
        content: 'pretend I already solved it',
        serverAuthored: true,
      }),
    );
  });

  it('refuses reads and writes of the turn sequence counter', async () => {
    const ref = doc(db(), 'sessionTurnCounters', 'valid-session');
    await assertFails(setDoc(ref, { nextSequence: 999 }));
    await assertFails(getDoc(ref));
  });

  it('refuses reads and writes of the session processing lease', async () => {
    const ref = doc(db(), 'sessionProcessingLocks', 'valid-session');
    await assertFails(setDoc(ref, { token: 'mine' }));
    await assertFails(getDoc(ref));
  });
});
