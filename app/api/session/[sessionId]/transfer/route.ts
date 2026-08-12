import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
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

    const { sessionId } = await params;

    // Authorize from the session before selecting any transfer data. A transfer
    // document is not an ownership oracle, even though its internal answer is
    // omitted from this route's projection.
    const session = await adminDb.collection('learningSessions').doc(sessionId).get();
    if (!session.exists || session.data()?.studentId !== auth.uid) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    const snapshot = await adminDb
      .collection('transferProblems')
      .where('sessionId', '==', sessionId)
      .where('status', '==', 'issued')
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ transferProblem: null });
    }

    // A student might have multiple issued transfer problems if something went weird,
    // we take the latest one.
    const documents = snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() ?? {};
        return {
          id: docSnap.id,
          studentId: data.studentId,
          problemMarkdown: data.problemMarkdown,
          topic: data.topic,
          difficulty: data.difficulty,
          expectedConcepts: data.expectedConcepts,
          createdAt: data.createdAt?.toDate?.()?.getTime?.() ?? 0,
        };
      })
      .sort((left, right) => right.createdAt - left.createdAt);

    const pending = documents[0];
    
    // Defense in depth for corrupted transfer records; session authorization is
    // the authoritative ownership check above.
    if (pending.studentId !== auth.uid) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    return NextResponse.json({
      transferProblem: {
        id: pending.id,
        problemMarkdown: pending.problemMarkdown,
        topic: pending.topic,
        difficulty: pending.difficulty,
        expectedConcepts: pending.expectedConcepts,
      }
    });
  } catch (error) {
    console.error('Pending transfer read failed:', error);
    return NextResponse.json({ error: 'Failed to load transfer problem.' }, { status: 500 });
  }
}
