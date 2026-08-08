import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminStorage } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { ALLOWED_IMAGE_FORMATS, type ImageFormat } from '@/lib/images/validation';

/**
 * `GET /api/problem-images/[imageId]` — serve a stored problem image to the
 * student who uploaded it.
 *
 * Section 34 step 4 and 5: stored privately, reached through authenticated
 * access. The workspace has to display the original image next to the extracted
 * text, and there are two ways to do that. A public or long-lived download URL
 * is the easy one and is wrong: the object stops being private the moment such a
 * URL exists, and a URL that leaks is a URL that works for everyone forever.
 *
 * So the bytes are streamed through this route instead, behind a verified ID
 * token and an explicit ownership check. Nothing about the object is guessable
 * from the outside, and revoking access needs no coordination with a token's
 * expiry.
 */

export const runtime = 'nodejs';

function isAllowedFormat(value: unknown): value is ImageFormat {
  return typeof value === 'string' && (ALLOWED_IMAGE_FORMATS as readonly string[]).includes(value);
}

export async function GET(
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
    const snapshot = await adminDb.collection('problemImages').doc(imageId).get();

    if (!snapshot.exists) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }

    const data = snapshot.data() ?? {};
    if (data.studentId !== auth.uid) {
      // Same body as a miss. A teacher gets this too: section 5.8 gives teachers
      // no default access to a student's problem content.
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }

    const storagePath = typeof data.storagePath === 'string' ? data.storagePath : null;
    if (!storagePath) {
      return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    }

    const [buffer] = await adminStorage.bucket().file(storagePath).download();

    // The stored contentType was set by the upload route from sniffed bytes, but
    // it is re-checked against the allowlist rather than echoed: a stored value
    // is still a value, and this response header decides how a browser treats
    // the body.
    const contentType = isAllowedFormat(data.contentType) ? data.contentType : 'image/png';

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        // Private: this response is specific to one authenticated student, so no
        // shared cache may keep a copy.
        'Cache-Control': 'private, max-age=300, no-store',
        'Content-Disposition': 'inline',
        // The body is student-supplied content served from our origin, so it is
        // pinned to being an image and nothing else.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; sandbox",
      },
    });
  } catch (error) {
    console.error('Problem image download failed', error);
    return NextResponse.json({ error: 'Could not load that image.' }, { status: 500 });
  }
}
