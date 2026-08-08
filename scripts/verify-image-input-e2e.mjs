/**
 * End-to-end Phase 7 walk of image input against the emulators.
 *
 * Phase 7's exit criteria include claims that code review cannot settle: that
 * stored images are private and access is authorized, and that tutoring cannot
 * begin on a low-confidence extraction without confirmation. Both are statements
 * about what a hostile caller gets back from a live endpoint.
 *
 * So this script mints real ID tokens from the auth emulator and attacks the
 * running routes with them. The images are synthesized here as real PNG and JPEG
 * byte sequences rather than loaded from fixtures, so a check that says "a PDF
 * declared as image/png is refused" is refusing actual PDF bytes.
 *
 * Extraction itself calls Gemini, which needs a key and quota. Checks that
 * require a successful extraction are reported as SKIP when the upload route
 * returns a model failure, rather than being silently counted as passes.
 *
 * Usage: node scripts/verify-image-input-e2e.mjs [baseUrl]
 */

const baseUrl = process.argv[2] ?? 'http://localhost:3300';
const AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085';
const PROJECT_ID = 'thinkfirst-huythedeev';
const DATABASE_ID = 'ai-studio-thinkfirst-1bd3a5e3-9884-49d7-91b8-e5b1e8a4f1fa';

const DOCS = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function skip(name, reason) {
  skipped += 1;
  console.log(`  SKIP  ${name} -- ${reason}`);
}

async function signUp(email) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'emulator-password', returnSecureToken: true }),
    },
  );
  const body = await response.json();
  if (!body.idToken) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return { idToken: body.idToken, uid: body.localId };
}

async function writeUserDoc(uid, role) {
  const response = await fetch(`${DOCS}/users?documentId=${uid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      fields: {
        id: { stringValue: uid },
        role: { stringValue: role },
        displayName: { stringValue: 'image probe' },
        preferredLanguage: { stringValue: 'en' },
      },
    }),
  });
  if (!response.ok) throw new Error(`user write failed: ${await response.text()}`);
}

// --- Image synthesis -------------------------------------------------------

function be32(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function be16(value) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type, body) {
  return [...be32(body.length), ...Array.from(type, (c) => c.charCodeAt(0)), ...body, 0, 0, 0, 0];
}

function png(width, height) {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...pngChunk('IDAT', new Array(400).fill(0x55)),
    ...pngChunk('IEND', []),
  ]);
}

function jpegWithExif(width, height) {
  const exifBody = [
    ...Array.from('Exif\0\0', (c) => c.charCodeAt(0)),
    ...Array.from('GPSLatitude=10.762622', (c) => c.charCodeAt(0)),
  ];
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe1, ...be16(exifBody.length + 2), ...exifBody,
    0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3,
    1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0,
    ...new Array(300).fill(0x42),
    0xff, 0xd9,
  ]);
}

function pdfBytes() {
  const header = Array.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', (c) => c.charCodeAt(0) & 0xff);
  return Uint8Array.from([...header, ...new Array(400).fill(0x20)]);
}

async function upload(idToken, bytes, filename, contentType) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: contentType }), filename);

  const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
  const response = await fetch(`${baseUrl}/api/problem-images`, {
    method: 'POST',
    headers,
    body: form,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function readImageDoc(imageId) {
  const response = await fetch(`${DOCS}/problemImages/${imageId}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return { status: response.status, body: await response.json() };
}

async function patchImageAsStudent(imageId, idToken, fields, mask) {
  const params = mask.map((field) => `updateMask.fieldPaths=${field}`).join('&');
  const response = await fetch(`${DOCS}/problemImages/${imageId}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  return response.status;
}

async function main() {
  console.log(`Phase 7 image input walk against ${baseUrl}\n`);

  const stamp = Date.now();
  const student = await signUp(`image-${stamp}@example.com`);
  const intruder = await signUp(`image-intruder-${stamp}@example.com`);
  await writeUserDoc(student.uid, 'student');
  await writeUserDoc(intruder.uid, 'student');

  console.log('Authentication');
  const anonymous = await upload(null, png(400, 300), 'p.png', 'image/png');
  check('an unauthenticated upload is refused', anonymous.status === 401, `got ${anonymous.status}`);

  console.log('\nContent validation (bytes, not extension)');

  const disguised = await upload(student.idToken, pdfBytes(), 'problem.png', 'image/png');
  check(
    'a PDF named .png and declared image/png is refused',
    disguised.status === 400 && disguised.body?.code === 'UNSUPPORTED_FORMAT',
    `got ${disguised.status} ${disguised.body?.code}`,
  );

  const mismatched = await upload(student.idToken, png(400, 300), 'p.jpg', 'image/jpeg');
  check(
    'a real PNG declared as image/jpeg is refused',
    mismatched.status === 400 && mismatched.body?.code === 'DECLARED_TYPE_MISMATCH',
    `got ${mismatched.status} ${mismatched.body?.code}`,
  );

  const bomb = await upload(student.idToken, png(40000, 40000), 'bomb.png', 'image/png');
  check(
    'a small file declaring 40000x40000 is refused on dimensions',
    bomb.status === 400 && bomb.body?.code === 'DIMENSIONS_TOO_LARGE',
    `got ${bomb.status} ${bomb.body?.code}`,
  );

  const tiny = await upload(student.idToken, png(8, 8), 'tiny.png', 'image/png');
  check(
    'an 8x8 image is refused as too small to read',
    tiny.status === 400 && tiny.body?.code === 'DIMENSIONS_TOO_SMALL',
    `got ${tiny.status} ${tiny.body?.code}`,
  );

  const oversized = new Uint8Array(6 * 1024 * 1024);
  oversized.set(png(400, 300));
  const tooBig = await upload(student.idToken, oversized, 'big.png', 'image/png');
  check(
    'a 6 MB upload is refused',
    tooBig.status === 413,
    `got ${tooBig.status} ${tooBig.body?.code}`,
  );

  const empty = await upload(student.idToken, new Uint8Array(0), 'empty.png', 'image/png');
  check('an empty file is refused', empty.status === 400, `got ${empty.status}`);

  console.log('\nUpload, storage and extraction');
  const accepted = await upload(student.idToken, jpegWithExif(1200, 900), 'problem.jpg', 'image/jpeg');
  check(
    'a valid JPEG is accepted',
    accepted.status === 200 && typeof accepted.body?.imageId === 'string',
    `got ${accepted.status} ${JSON.stringify(accepted.body)?.slice(0, 200)}`,
  );

  const imageId = accepted.body?.imageId;

  if (!imageId) {
    skip('image document checks', 'upload did not return an imageId');
    skip('privacy checks', 'upload did not return an imageId');
  } else {
    const stored = await readImageDoc(imageId);
    const fields = stored.body?.fields ?? {};

    check(
      'the image document is written server-side with a storage path',
      typeof fields.storagePath?.stringValue === 'string' &&
        fields.storagePath.stringValue.includes(student.uid),
      JSON.stringify(fields.storagePath),
    );

    check(
      'EXIF metadata was stripped before storage',
      fields.metadataStripped?.booleanValue === true,
      JSON.stringify(fields.metadataStripped),
    );

    check(
      'the sniffed content type is recorded, not the declared one',
      fields.contentType?.stringValue === 'image/jpeg',
      JSON.stringify(fields.contentType),
    );

    check(
      'dimensions read from the file header are recorded',
      fields.width?.integerValue === '1200' && fields.height?.integerValue === '900',
      `${fields.width?.integerValue}x${fields.height?.integerValue}`,
    );

    if (accepted.body?.extractionAvailable === false) {
      skip('extraction produced text', 'the model call failed (no key or quota exhausted)');
      check(
        'a failed extraction still requires confirmation',
        accepted.body?.requiresConfirmation === true && accepted.body?.confidence === 0,
        JSON.stringify({
          requiresConfirmation: accepted.body?.requiresConfirmation,
          confidence: accepted.body?.confidence,
        }),
      );
    } else {
      check(
        'extraction returned a confidence in range',
        typeof accepted.body?.confidence === 'number' &&
          accepted.body.confidence >= 0 &&
          accepted.body.confidence <= 1,
        String(accepted.body?.confidence),
      );
      check(
        'the confirmation requirement matches the confidence',
        accepted.body?.requiresConfirmation === (accepted.body?.confidence < 0.7),
        JSON.stringify({
          confidence: accepted.body?.confidence,
          requiresConfirmation: accepted.body?.requiresConfirmation,
        }),
      );
    }

    console.log('\nPrivacy and authorization');

    const ownRead = await fetch(`${baseUrl}/api/problem-images/${imageId}`, {
      headers: { Authorization: `Bearer ${student.idToken}` },
    });
    check(
      'the owning student can fetch their own image',
      ownRead.status === 200 && (ownRead.headers.get('content-type') ?? '').startsWith('image/'),
      `got ${ownRead.status} ${ownRead.headers.get('content-type')}`,
    );

    const intruderRead = await fetch(`${baseUrl}/api/problem-images/${imageId}`, {
      headers: { Authorization: `Bearer ${intruder.idToken}` },
    });
    check(
      'another student gets 404, not 403, so ids cannot be enumerated',
      intruderRead.status === 404,
      `got ${intruderRead.status}`,
    );

    const anonRead = await fetch(`${baseUrl}/api/problem-images/${imageId}`);
    check('an unauthenticated image fetch is refused', anonRead.status === 401, `got ${anonRead.status}`);

    console.log('\nHostile writes to the confirmation gate');

    const forgedConfidence = await patchImageAsStudent(
      imageId,
      student.idToken,
      { extractionConfidence: { doubleValue: 1 } },
      ['extractionConfidence'],
    );
    check(
      'a student cannot raise their own extraction confidence',
      forgedConfidence === 403,
      `got ${forgedConfidence}`,
    );

    const forgedConfirmation = await patchImageAsStudent(
      imageId,
      student.idToken,
      { confirmationStatus: { stringValue: 'confirmed' } },
      ['confirmationStatus'],
    );
    check(
      'a student cannot mark their own extraction confirmed directly',
      forgedConfirmation === 403,
      `got ${forgedConfirmation}`,
    );

    console.log('\nConfirmation endpoint');

    const intruderConfirm = await fetch(`${baseUrl}/api/problem-images/${imageId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${intruder.idToken}`,
      },
      body: JSON.stringify({ confirmedText: 'hijacked' }),
    });
    check(
      "another student cannot confirm someone else's extraction",
      intruderConfirm.status === 404,
      `got ${intruderConfirm.status}`,
    );

    const forgedField = await fetch(`${baseUrl}/api/problem-images/${imageId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student.idToken}`,
      },
      body: JSON.stringify({ confirmedText: 'Solve 2x + 3 = 11', extractionConfidence: 1 }),
    });
    check(
      'a confirmation body carrying extractionConfidence is refused, not clamped',
      forgedField.status === 400,
      `got ${forgedField.status}`,
    );

    const emptyConfirm = await fetch(`${baseUrl}/api/problem-images/${imageId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student.idToken}`,
      },
      body: JSON.stringify({ confirmedText: '   ' }),
    });
    check('an empty confirmation is refused', emptyConfirm.status === 400, `got ${emptyConfirm.status}`);

    const goodConfirm = await fetch(`${baseUrl}/api/problem-images/${imageId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student.idToken}`,
      },
      body: JSON.stringify({ confirmedText: 'Solve 2x + 3 = 11' }),
    });
    const confirmBody = await goodConfirm.json().catch(() => null);
    check(
      'the owning student can confirm corrected text',
      goodConfirm.status === 200 && confirmBody?.confirmationStatus === 'confirmed',
      `got ${goodConfirm.status} ${JSON.stringify(confirmBody)?.slice(0, 160)}`,
    );

    const afterConfirm = await readImageDoc(imageId);
    check(
      'the correction is recorded server-side with a timestamp',
      afterConfirm.body?.fields?.confirmedText?.stringValue === 'Solve 2x + 3 = 11' &&
        Boolean(afterConfirm.body?.fields?.confirmedAt),
      JSON.stringify(afterConfirm.body?.fields?.confirmedText),
    );
  }

  const missing = await fetch(`${baseUrl}/api/problem-images/does-not-exist`, {
    headers: { Authorization: `Bearer ${student.idToken}` },
  });
  check('a missing image returns 404', missing.status === 404, `got ${missing.status}`);

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
