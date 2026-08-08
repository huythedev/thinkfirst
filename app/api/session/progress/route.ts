import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { SCORING_VERSION } from '@/lib/types/scoring';

/**
 * Serves the student's own persisted Independence Score snapshot.
 *
 * Phase 5's exit criterion says recomputation in the browser on read fails, so
 * this returns a **stored** snapshot: the numbers were computed server-side when
 * the session turn was processed, by `persistSessionEvidence`, and written under
 * Admin credentials to a collection the client cannot write.
 *
 * The endpoint reads only `request.auth.uid`'s own documents. A student id is
 * never accepted from the query string, because that would make every student's
 * evidence readable by any signed-in caller who could guess a uid -- the same
 * defect class as the `sessionTurns` exposure closed in Phase 2.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await verifyRequest(req);
    if (auth.verificationUnavailable) {
      return NextResponse.json(
        { error: 'Server is not configured to verify authentication.' },
        { status: 503 },
      );
    }
    if (!auth.uid) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const profileId = `${auth.uid}__profile__${SCORING_VERSION}`;
    const [profileSnap, sessionSnaps] = await Promise.all([
      adminDb.collection('independenceSnapshots').doc(profileId).get(),
      adminDb
        .collection('independenceSnapshots')
        .where('studentId', '==', auth.uid)
        .where('kind', '==', 'session')
        .where('scoringVersion', '==', SCORING_VERSION)
        .get(),
    ]);

    if (!profileSnap.exists) {
      // No snapshot yet is a real state, not an error: a student who has not
      // finished a turn has no trusted evidence, and §56.4's suppression rule
      // says an unknown score must look unknown.
      return NextResponse.json({
        profile: null,
        sessions: [],
        scoringVersion: SCORING_VERSION,
      });
    }

    const profile = profileSnap.data() ?? {};

    const sessions = sessionSnaps.docs
      .map((docSnap) => {
        const data = docSnap.data() ?? {};
        return {
          sessionId: typeof data.sessionId === 'string' ? data.sessionId : docSnap.id,
          totalScore: typeof data.totalScore === 'number' ? data.totalScore : null,
          coverage: typeof data.coverage === 'number' ? data.coverage : 0,
          suppressed: data.suppressed !== false,
          excludedForSystemError: data.excludedForSystemError === true,
          generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() ?? null,
        };
      })
      .sort((left, right) => (right.generatedAt ?? '').localeCompare(left.generatedAt ?? ''));

    return NextResponse.json({
      profile: {
        score: typeof profile.totalScore === 'number' ? profile.totalScore : null,
        band: typeof profile.band === 'string' ? profile.band : null,
        trend: typeof profile.trend === 'number' ? profile.trend : null,
        suppressed: profile.suppressed !== false,
        suppressionReason:
          typeof profile.suppressionReason === 'string' ? profile.suppressionReason : null,
        evidenceWeight: typeof profile.evidenceWeight === 'number' ? profile.evidenceWeight : 0,
        sessionsScored: typeof profile.sessionsScored === 'number' ? profile.sessionsScored : 0,
        sessionsConsidered:
          typeof profile.sessionsConsidered === 'number' ? profile.sessionsConsidered : 0,
        sessionsExcluded:
          typeof profile.sessionsExcluded === 'number' ? profile.sessionsExcluded : 0,
        suggestion: typeof profile.suggestion === 'string' ? profile.suggestion : null,
        components: Array.isArray(profile.componentDetail) ? profile.componentDetail : [],
        generatedAt: profile.generatedAt?.toDate?.()?.toISOString?.() ?? null,
      },
      sessions,
      scoringVersion: SCORING_VERSION,
    });
  } catch (error) {
    console.error('Independence snapshot read failed:', error);
    return NextResponse.json({ error: 'Failed to load progress.' }, { status: 500 });
  }
}
