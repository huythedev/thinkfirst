/**
 * Problem-image validation, per section 34 of
 * `instructions/07_FRONTEND_UX_ACCESSIBILITY.md` and the Phase 7 exit criteria in
 * section 49.
 *
 * Everything here is pure and byte-level so it can run before the object exists.
 * That ordering is the point: the exit criterion requires the MIME type to be
 * validated "from file content, not the extension", and neither a browser's
 * `File.type` nor Cloud Storage's stored `contentType` is file content. Both are
 * strings the client chose. A `.png` extension, a `Content-Type: image/png`
 * header and a `contentType` metadata field can all say PNG over a file that is
 * not one.
 *
 * So the format is decided by the leading bytes, the dimensions are read out of
 * the format's own header, and a file whose declared type disagrees with its
 * content is refused rather than corrected. The rule in `firebase/storage.rules`
 * that matches `image/.*` is a second line, not this line: it reads the declared
 * header too.
 *
 * No image library is used. Four formats are supported and all four state their
 * dimensions in a header, so a parser is a few dozen lines against a dependency
 * that would also decode pixels this application never looks at.
 */

/** Section 34 step 1. The formats a student can photograph or screenshot with. */
export const ALLOWED_IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ImageFormat = (typeof ALLOWED_IMAGE_FORMATS)[number];

/**
 * Section 34 step 2. The ceiling matches `firebase/storage.rules`, deliberately:
 * two limits that can disagree is one limit and one bug.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Below this, there is no legible problem in the frame, only wasted model spend. */
export const MIN_IMAGE_BYTES = 100;

/**
 * Dimension bounds. The upper bound exists because size alone does not bound
 * decode cost: a highly compressible 200 KB PNG can declare 40000x40000 and cost
 * far more to decode than its bytes suggest. The lower bound rejects frames too
 * small to carry readable text.
 */
export const MAX_IMAGE_DIMENSION = 8000;
export const MIN_IMAGE_DIMENSION = 32;

export interface ImageDimensions {
  width: number;
  height: number;
}

export type ImageRejectionCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_SMALL'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'DECLARED_TYPE_MISMATCH'
  | 'DIMENSIONS_UNREADABLE'
  | 'DIMENSIONS_TOO_LARGE'
  | 'DIMENSIONS_TOO_SMALL';

export interface ImageValidationSuccess {
  ok: true;
  format: ImageFormat;
  dimensions: ImageDimensions;
  /** Bytes with metadata removed where the format allows it. */
  bytes: Uint8Array;
  /** False when the format carries metadata this module cannot strip. */
  metadataStripped: boolean;
}

export interface ImageValidationFailure {
  ok: false;
  code: ImageRejectionCode;
  /** Safe to show a student: names the limit, never echoes file content. */
  message: string;
}

export type ImageValidationResult = ImageValidationSuccess | ImageValidationFailure;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index]);
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/**
 * The format a file actually is, decided by its leading bytes.
 *
 * Returns null rather than guessing. An unrecognized file is refused, never
 * passed to the model on the chance that it decodes.
 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';

  const header = ascii(bytes, 0, 6);
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';

  // WebP is a RIFF container; the fourth chunk word names the payload.
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';

  return null;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) + bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  // IHDR must be the first chunk: 8-byte signature, 4-byte length, 4-byte type.
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10) return null;
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
}

/**
 * JPEG states its dimensions in a start-of-frame segment, which sits at an
 * unpredictable offset because any number of metadata segments may precede it.
 * So the segment chain is walked rather than indexed.
 */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2; // past SOI

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1; // resynchronize across fill bytes rather than give up
      continue;
    }

    const marker = bytes[offset + 1];

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    // Start of scan: entropy-coded data follows and no frame header remains.
    if (marker === 0xda) return null;

    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) return null;

    // SOF0..SOF15, excluding the three markers that share the range but are not
    // frame headers: DHT (c4), JPG (c8) and DAC (cc).
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      // Segment body: precision (1), height (2), width (2).
      return { height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) };
    }

    offset += 2 + length;
  }

  return null;
}

/** WebP has three payload layouts and each stores dimensions differently. */
function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const chunk = ascii(bytes, 12, 4);

  if (chunk === 'VP8X' && bytes.length >= 30) {
    // Extended format stores canvas size minus one, as two 24-bit LE fields.
    return {
      width: readUint24LE(bytes, 24) + 1,
      height: readUint24LE(bytes, 27) + 1,
    };
  }

  if (chunk === 'VP8 ' && bytes.length >= 30) {
    // Lossy: a 3-byte frame tag, then the 0x9d012a start code.
    if (!(bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)) return null;
    return {
      width: readUint16LE(bytes, 26) & 0x3fff,
      height: readUint16LE(bytes, 28) & 0x3fff,
    };
  }

  if (chunk === 'VP8L' && bytes.length >= 25) {
    if (bytes[20] !== 0x2f) return null;
    // 14 bits of width-1 then 14 bits of height-1, packed little-endian.
    const packed =
      (bytes[21] + (bytes[22] << 8) + (bytes[23] << 16) + bytes[24] * 0x1000000) >>> 0;
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

/** Dimensions read out of the format's own header. Null when unreadable. */
export function readImageDimensions(
  bytes: Uint8Array,
  format: ImageFormat,
): ImageDimensions | null {
  const dimensions =
    format === 'image/png'
      ? pngDimensions(bytes)
      : format === 'image/jpeg'
        ? jpegDimensions(bytes)
        : format === 'image/gif'
          ? gifDimensions(bytes)
          : webpDimensions(bytes);

  if (!dimensions) return null;
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) return null;
  if (dimensions.width <= 0 || dimensions.height <= 0) return null;
  return dimensions;
}

/**
 * Section 34 step 3: strip unnecessary metadata when possible.
 *
 * The concern is not disk space. A photograph taken on a phone carries GPS
 * coordinates, a capture timestamp and a device identifier in EXIF, and section
 * 24's data minimization does not permit storing a student's home location
 * because they photographed their homework at the kitchen table.
 *
 * Only container-level metadata is removed. Both rewrites copy the surviving
 * segments verbatim, so PNG chunk CRCs stay valid without recomputation.
 */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const output: number[] = [0xff, 0xd8];
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;

    const marker = bytes[offset + 1];

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      output.push(0xff, marker);
      offset += 2;
      continue;
    }

    // From start-of-scan onward the file is entropy-coded data, not segments.
    if (marker === 0xda) {
      for (let index = offset; index < bytes.length; index += 1) output.push(bytes[index]);
      return Uint8Array.from(output);
    }

    const length = readUint16BE(bytes, offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;

    // APP1..APP15 hold EXIF, XMP and vendor blocks. APP0 is the JFIF density
    // header, which some decoders expect and which carries nothing personal.
    const isMetadata = (marker > 0xe0 && marker <= 0xef) || marker === 0xfe;

    if (!isMetadata) {
      for (let index = offset; index < offset + 2 + length; index += 1) output.push(bytes[index]);
    }

    offset += 2 + length;
  }

  // Unparseable tail: return the original rather than a truncated image.
  return bytes;
}

const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG']);

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let index = 0; index < 8; index += 1) output.push(bytes[index]);

  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const total = 12 + length;

    if (length < 0 || offset + total > bytes.length) return bytes;

    if (!PNG_METADATA_CHUNKS.has(type)) {
      for (let index = offset; index < offset + total; index += 1) output.push(bytes[index]);
    }

    offset += total;

    if (type === 'IEND') return Uint8Array.from(output);
  }

  return bytes;
}

export function stripImageMetadata(
  bytes: Uint8Array,
  format: ImageFormat,
): { bytes: Uint8Array; stripped: boolean } {
  if (format === 'image/jpeg') return { bytes: stripJpegMetadata(bytes), stripped: true };
  if (format === 'image/png') return { bytes: stripPngMetadata(bytes), stripped: true };
  // GIF and WebP can carry metadata in ways this module does not rewrite, so the
  // result reports honestly rather than claiming a strip that did not happen.
  return { bytes, stripped: false };
}

/**
 * The single entry point. Runs every section 34 check in order and returns
 * either the sanitized bytes or a named refusal.
 */
export function validateProblemImage(
  bytes: Uint8Array,
  declaredContentType?: string | null,
): ImageValidationResult {
  if (bytes.length === 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'The uploaded file is empty.' };
  }

  if (bytes.length < MIN_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_SMALL',
      message: 'That file is too small to contain a readable problem.',
    };
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Images must be ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`,
    };
  }

  const format = detectImageFormat(bytes);
  if (!format) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FORMAT',
      message: 'Upload a PNG, JPEG, WebP or GIF image.',
    };
  }

  // A declared type that disagrees with the content is refused rather than
  // silently corrected: the two disagreeing is a signal worth surfacing, and
  // rewriting it would hide the mismatch from the object's stored metadata.
  const declared = declaredContentType?.split(';')[0]?.trim().toLowerCase();
  if (declared && declared !== format) {
    return {
      ok: false,
      code: 'DECLARED_TYPE_MISMATCH',
      message: 'The file contents do not match the file type. Upload the image again.',
    };
  }

  const dimensions = readImageDimensions(bytes, format);
  if (!dimensions) {
    return {
      ok: false,
      code: 'DIMENSIONS_UNREADABLE',
      message: 'That image could not be read. Try a different photo or screenshot.',
    };
  }

  if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
    return {
      ok: false,
      code: 'DIMENSIONS_TOO_LARGE',
      message: `Images must be ${MAX_IMAGE_DIMENSION} pixels or fewer on each side.`,
    };
  }

  if (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION) {
    return {
      ok: false,
      code: 'DIMENSIONS_TOO_SMALL',
      message: `Images must be at least ${MIN_IMAGE_DIMENSION} pixels on each side.`,
    };
  }

  const { bytes: sanitized, stripped } = stripImageMetadata(bytes, format);

  return { ok: true, format, dimensions, bytes: sanitized, metadataStripped: stripped };
}
