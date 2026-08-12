import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Moves legacy model-derived prose behind server-only collections and leaves
 * only the same fields new writes expose. Run with `--dry-run` first.
 */
const dryRun = process.argv.includes('--dry-run');

const SAFE_SNAPSHOT_KEYS = new Set([
  'id', 'studentId', 'sessionId', 'kind', 'totalScore', 'coverage', 'suppressed',
  'components', 'componentDetail', 'excludedForSystemError', 'profileBaselineScore',
  'scoringVersion', 'generatedAt', 'profileBaselineCapturedAt', 'suppressionReason',
  'band', 'trend', 'evidenceWeight', 'sessionsScored', 'sessionsConsidered',
  'sessionsExcluded', 'instrumentationUnavailableRate', 'suggestion',
]);

function legacyTurnNeedsSanitizing(data: Record<string, unknown>): boolean {
  const intent = data.intentAnalysis as Record<string, unknown> | undefined;
  const originalPlan = data.originalResponsePlan as Record<string, unknown> | undefined;
  const tutorMetadata = data.tutorMetadata as Record<string, unknown> | undefined;
  return Boolean(
    intent && ('topic' in intent || 'problemStatement' in intent || 'missingInformation' in intent) ||
    originalPlan && 'learningObjective' in originalPlan ||
    tutorMetadata && ('learningObjective' in tutorMetadata || 'internalConceptTags' in tutorMetadata),
  );
}

function sanitizeTurn(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data };
  const intent = data.intentAnalysis as Record<string, unknown> | undefined;
  if (intent) {
    const { topic: _topic, problemStatement: _problemStatement, missingInformation: _missingInformation, ...safeIntent } = intent;
    next.intentAnalysis = safeIntent;
  }
  const originalPlan = data.originalResponsePlan as Record<string, unknown> | undefined;
  if (originalPlan) {
    const { learningObjective: _learningObjective, ...safePlan } = originalPlan;
    next.originalResponsePlan = safePlan;
  }
  const tutorMetadata = data.tutorMetadata as Record<string, unknown> | undefined;
  if (tutorMetadata) {
    const { learningObjective: _learningObjective, internalConceptTags: _internalConceptTags, ...safeMetadata } = tutorMetadata;
    next.tutorMetadata = safeMetadata;
  }
  return next;
}

function snapshotNeedsSanitizing(data: Record<string, unknown>): boolean {
  return Object.keys(data).some((key) => !SAFE_SNAPSHOT_KEYS.has(key));
}

function sanitizeSnapshot(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => SAFE_SNAPSHOT_KEYS.has(key)));
}

async function run(): Promise<void> {
  const [turns, snapshots] = await Promise.all([
    adminDb.collection('sessionTurns').get(),
    adminDb.collection('independenceSnapshots').get(),
  ]);
  const unsafeTurns = turns.docs.filter((doc) => legacyTurnNeedsSanitizing(doc.data()));
  const unsafeSnapshots = snapshots.docs.filter((doc) => snapshotNeedsSanitizing(doc.data()));

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    unsafeSessionTurns: unsafeTurns.length,
    unsafePublicSnapshots: unsafeSnapshots.length,
    documentsToSanitize: unsafeTurns.length + unsafeSnapshots.length,
    internalAuditCopiesToRetain: unsafeTurns.length + unsafeSnapshots.length,
  }, null, 2));
  if (dryRun || (unsafeTurns.length === 0 && unsafeSnapshots.length === 0)) return;

  let batch = adminDb.batch();
  let operations = 0;
  const commit = async () => {
    if (operations === 0) return;
    await batch.commit();
    batch = adminDb.batch();
    operations = 0;
  };
  const queue = async (write: () => void) => {
    write();
    operations += 1;
    if (operations >= 400) await commit();
  };

  for (const doc of unsafeTurns) {
    const data = doc.data() as Record<string, unknown>;
    await queue(() => batch.set(
      adminDb.collection('sessionTurnInternalMetadata').doc(doc.id),
      { legacyTurnAudit: data, legacyMigratedAt: FieldValue.serverTimestamp() },
      { merge: true },
    ));
    await queue(() => batch.set(doc.ref, sanitizeTurn(data)));
  }
  for (const doc of unsafeSnapshots) {
    const data = doc.data() as Record<string, unknown>;
    await queue(() => batch.set(
      adminDb.collection('independenceSnapshotsInternal').doc(doc.id),
      { legacyPublicSnapshotAudit: data, legacyMigratedAt: FieldValue.serverTimestamp() },
      { merge: true },
    ));
    await queue(() => batch.set(doc.ref, sanitizeSnapshot(data)));
  }
  await commit();
}

run().catch((error) => {
  console.error('Model-output-boundaries migration failed:', error);
  process.exitCode = 1;
});
