/**
 * Verifies real multimodal extraction against the running endpoint.
 *
 * Split from `verify-image-input-e2e.mjs` because this script needs Gemini quota
 * and that one does not. Everything here is a claim about what the model
 * actually read out of real pixels, which is the half of Phase 7's first exit
 * criterion ("work end to end on a real image") that byte-level tests cannot
 * reach.
 *
 * Usage: node scripts/verify-image-extraction-live.mjs [baseUrl] [imagePath]
 */

import { readFileSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://localhost:3300';
const imagePath = process.argv[3];
const AUTH_HOST = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';

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
  if (!body.idToken) throw new Error(`sign-up failed: ${JSON.stringify(body)}`);
  return body;
}

async function upload(idToken, bytes, filename, type) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), filename);
  const response = await fetch(`${baseUrl}/api/problem-images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const student = await signUp(`extract-${Date.now()}@example.com`);
const bytes = readFileSync(imagePath);

console.log(`Uploading ${imagePath} (${bytes.length} bytes)\n`);
const result = await upload(student.idToken, bytes, 'problem.png', 'image/png');

console.log(`HTTP ${result.status}`);
console.log(JSON.stringify(result.body, null, 2));
