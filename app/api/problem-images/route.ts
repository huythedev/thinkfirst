import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '@/lib/firebase/admin';
import { verifyRequest } from '@/lib/firebase/verify-request';
import { MAX_IMAGE_BYTES, validateProblemImage } from '@/lib/images/validation';
import { extractProblemFromImage } from '@/lib/images/extraction';
import { EXTRACTION_PROMPT_VERSION } from '@/services/ai-gateway/src/prompts/extraction.v1';
import {
  LOW_EXTRACTION_CONFIDENCE_THRESHOLD,
  requiresExtractionConfirmation,
} from '@/lib/images/confidence';
import { RATE_LIMITS, checkRateLimit, rateLimitHeaders } from '@/lib/security/rate-limit';

/**
 * `POST /api/problem-images` — upload a problem image, validate it, store it
 * privately, and extract the problem text.
 *
 * Section 33 sketches this as `POST /v1/problem-images/upload-url`, a signed-URL
 * flow. It is implemented as a direct upload instead, for a reason recorded in
 * `docs/ASSUMPTIONS.md`: signing a URL with the Admin SDK requires a
 * service-account signer, which this environment does not have, and more
 * importantly a signed URL puts the object in the bucket **before** any server
 * code has seen its bytes. The Phase 7 exit criterion requires the MIME type to
 * be validated from file content, so the bytes must pass through the server
 * anyway. Validating first and writing second means a rejected file is never
 * stored at all, rather than stored and then cleaned up.
 *
 * The trust-critical field here is `extractionConfidence`. It decides whether
 * tutoring may begin (policy rule R6), which makes it a policy input, which puts
 * it on section 41.1's never-trusted list. It is written here under Admin
 * credentials to a collection no client can write, and `firestore.rules` denies
 * every client write to `problemImages`. A student cannot declare their blurry
 * photo to be a confident extraction.
 */

export const runtime = 'nodejs';

/** Guards the body before it is buffered, so an oversized upload is refused early. */
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

export async function POST(req: NextRequest) {
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

    // Section 41 lists "abuse of image uploads" as a threat alongside rate-limit
    // bypass. This endpoint spends a multimodal model call and bucket storage per
    // request, so it is limited on the same terms as the tutoring endpoint, keyed
    // on the verified uid.
    const limit = await checkRateLimit({
      policy: RATE_LIMITS.imageUpload,
      uid: auth.uid,
      headers: req.headers,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many uploads. Please wait before uploading another image.',
          code: 'RATE_LIMITED',
          retryAfterSeconds: limit.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const declaredLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: 'Images must be 5 MB or smaller.', code: 'FILE_TOO_LARGE' },
        { status: 413 },
      );
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get('image');

    if (!form || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Attach an image file in the `image` field.', code: 'MISSING_FILE' },
        { status: 400 },
      );
    }

    // A lying content-length header does not get past this: the real byte count
    // is checked after buffering, by the validator.
    const bytes = new Uint8Array(await file.arrayBuffer());

    const validation = validateProblemImage(bytes, file.type || null);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.message, code: validation.code },
        { status: validation.code === 'FILE_TOO_LARGE' ? 413 : 400 },
      );
    }

    // Grade and language come from the student's own profile, server-side. They
    // only tune the extraction prompt, but reading them from the body would put
    // one more client-supplied value on a model call for no benefit.
    const profileSnapshot = await adminDb.collection('studentProfiles').doc(auth.uid).get();
    const profile = profileSnapshot.data() ?? {};
    const grade = typeof profile.grade === 'number' ? profile.grade : undefined;
    const language = profile.preferredLanguage === 'vi' ? 'vi' : 'en';

    const imageRef = adminDb.collection('problemImages').doc();
    // The storage path is derived from the verified uid, never from the request,
    // so one student cannot write into another student's prefix. It matches the
    // `problem-images/{userId}/{imageId}` pattern in `firebase/storage.rules`.
    const storagePath = `problem-images/${auth.uid}/${imageRef.id}`;

    const bucket = adminStorage.bucket();
    await bucket.file(storagePath).save(Buffer.from(validation.bytes), {
      contentType: validation.format,
      // Uniform bucket-level access plus the rules file keeps this object
      // private; nothing here makes it public.
      metadata: {
        contentType: validation.format,
        metadata: {
          ownerUid: auth.uid,
          metadataStripped: String(validation.metadataStripped),
        },
      },
    });

    const result = await extractProblemFromImage(validation.bytes, validation.format, {
      grade,
      language,
    });

    const confidence = result.extraction.confidence;

    await imageRef.set({
      id: imageRef.id,
      studentId: auth.uid,
      storagePath,
      contentType: validation.format,
      byteSize: validation.bytes.byteLength,
      width: validation.dimensions.width,
      height: validation.dimensions.height,
      metadataStripped: validation.metadataStripped,
      extractedText: result.extraction.extractedText,
      extractionConfidence: confidence,
      extractionWarnings: result.extraction.extractionWarnings,
      containsProblem: result.extraction.containsProblem,
      containsStudentWork: result.extraction.containsStudentWork,
      containsPersonalInformation: result.extraction.containsPersonalInformation,
      detectedLanguage: result.extraction.detectedLanguage,
      subject: result.extraction.subject,
      extractionAvailable: result.available,
      // Section 34 step 9 and 10. Confirmation state lives here rather than being
      // inferred at read time, so the two places that care -- the workspace and
      // the policy resolver -- cannot disagree about it.
      confirmationStatus: requiresExtractionConfirmation(confidence) ? 'required' : 'not_required',
      confirmedText: null,
      confirmedAt: null,
      extractionModel: result.modelName,
      extractionPromptVersion: EXTRACTION_PROMPT_VERSION,
      extractionLatencyMs: result.latencyMs,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      imageId: imageRef.id,
      extractedText: result.extraction.extractedText,
      confidence,
      confidenceThreshold: LOW_EXTRACTION_CONFIDENCE_THRESHOLD,
      requiresConfirmation: requiresExtractionConfirmation(confidence),
      warnings: result.extraction.extractionWarnings,
      containsProblem: result.extraction.containsProblem,
      containsStudentWork: result.extraction.containsStudentWork,
      containsPersonalInformation: result.extraction.containsPersonalInformation,
      subject: result.extraction.subject,
      detectedLanguage: result.extraction.detectedLanguage,
      width: validation.dimensions.width,
      height: validation.dimensions.height,
      extractionAvailable: result.available,
    });
  } catch (error) {
    // Never echo the underlying error: it can carry bucket names and internal
    // paths. Section 42.
    console.error('Problem image upload failed', error);
    return NextResponse.json({ error: 'Could not process that image.' }, { status: 500 });
  }
}
