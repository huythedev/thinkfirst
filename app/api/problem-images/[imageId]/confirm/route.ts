import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';

/**
 * `POST /api/problem-images/[imageId]/confirm` — the student confirms or corrects
 * the extracted problem text.
 *
 * Section 34 steps 9 and 10, and the Phase 7 exit criterion "tutoring cannot
 * begin on low-confidence extraction without confirmation".
 *
 * Note what the client may and may not send. It may send the corrected text,
 * because the student rewriting a misread exponent is the entire point of the
 * correction flow, and that text is the student's own problem statement -- the
 * same trust level as typing it in the first place. It may **not** send the
 * confidence, or the confirmation status directly: those decide whether the
 * policy engine permits tutoring, so they are computed here.
 *
 * A confirmed image is stamped with `confirmedAt` server-side. The tutoring
 * endpoint reads that stamp, not a client claim.
 */

export const runtime = 'nodejs';

const confirmSchema = z
  .object({
    // The corrected problem text, or the extracted text unchanged when the
    // student accepts it. Bounded to the same length as a typed problem.
    confirmedText: z.string().min(1).max(5000),
  })
  .strict();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ imageId: string }> },
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

    const { imageId } = await params;

    const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const imageRef = adminDb.collection('problemImages').doc(imageId);
    const snapshot = await imageRef.get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }

    // Admin credentials bypass security rules, so ownership is checked here.
    // Another student's image returns 404, not 403, so ids cannot be enumerated
    // -- the same choice `requireClassroomOwner` makes in Phase 6.
    const data = snapshot.data() ?? {};
    if (data.studentId !== auth.uid) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }

    const confirmedText = parsed.data.confirmedText.trim();
    if (confirmedText.length === 0) {
      return NextResponse.json(
        { error: 'The problem text cannot be empty.', code: 'EMPTY_TEXT' },
        { status: 400 },
      );
    }

    const corrected = confirmedText !== (data.extractedText ?? '');

    await imageRef.update({
      confirmedText,
      confirmationStatus: 'confirmed',
      // Recorded because section 35 asks for an image-extraction confirmation
      // rate, and "confirmed unchanged" and "confirmed after correction" say very
      // different things about extraction quality.
      correctedByStudent: corrected,
      confirmedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      imageId,
      confirmedText,
      corrected,
      confirmationStatus: 'confirmed',
    });
  } catch (error) {
    console.error('Problem image confirmation failed', error);
    return NextResponse.json({ error: 'Could not confirm that extraction.' }, { status: 500 });
  }
}
