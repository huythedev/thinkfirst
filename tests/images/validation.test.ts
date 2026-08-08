import { describe, it, expect } from 'vitest';
import {
  ALLOWED_IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  detectImageFormat,
  readImageDimensions,
  stripImageMetadata,
  validateProblemImage,
} from '@/lib/images/validation';

/**
 * Phase 7 exit criterion: "MIME type is validated from file content, not the
 * extension. Size and dimensions are bounded."
 *
 * These build real format headers byte by byte rather than loading fixtures, so
 * the assertions state exactly which bytes decide each outcome.
 */

function pad(bytes: number[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  out.set(bytes.slice(0, total));
  return out;
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function be16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function crcPlaceholder(): number[] {
  return [0, 0, 0, 0];
}

function pngChunk(type: string, body: number[]): number[] {
  return [
    ...be32(body.length),
    ...Array.from(type, (character) => character.charCodeAt(0)),
    ...body,
    ...crcPlaceholder(),
  ];
}

function png(width: number, height: number, extraChunks: number[] = []): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
  const idat = pngChunk('IDAT', new Array(200).fill(0x55));
  const iend = pngChunk('IEND', []);
  return Uint8Array.from([...signature, ...ihdr, ...extraChunks, ...idat, ...iend]);
}

function jpeg(width: number, height: number, segments: number[] = []): Uint8Array {
  const soi = [0xff, 0xd8];
  // SOF0: length 17, precision 8, height, width, 3 components.
  const sof0 = [
    0xff,
    0xc0,
    ...be16(17),
    8,
    ...be16(height),
    ...be16(width),
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  const sos = [0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0];
  const scanData = new Array(200).fill(0x42);
  const eoi = [0xff, 0xd9];
  return Uint8Array.from([...soi, ...segments, ...sof0, ...sos, ...scanData, ...eoi]);
}

function exifSegment(): number[] {
  // APP1 carrying an EXIF header and a recognizable GPS-like payload.
  const payload = [
    ...Array.from('Exif\0\0', (character) => character.charCodeAt(0)),
    ...Array.from('GPSLatitude=10.762622', (character) => character.charCodeAt(0)),
  ];
  return [0xff, 0xe1, ...be16(payload.length + 2), ...payload];
}

function gif(width: number, height: number): Uint8Array {
  const header = Array.from('GIF89a', (character) => character.charCodeAt(0));
  return pad([...header, ...le16(width), ...le16(height), 0xf7, 0, 0], 300);
}

function webpLossy(width: number, height: number): Uint8Array {
  const riff = Array.from('RIFF', (character) => character.charCodeAt(0));
  const size = [0, 0, 0, 0];
  const webp = Array.from('WEBP', (character) => character.charCodeAt(0));
  const vp8 = Array.from('VP8 ', (character) => character.charCodeAt(0));
  const chunkSize = [0, 0, 0, 0];
  const frameTag = [0x30, 0x01, 0x00];
  const startCode = [0x9d, 0x01, 0x2a];
  return pad(
    [
      ...riff,
      ...size,
      ...webp,
      ...vp8,
      ...chunkSize,
      ...frameTag,
      ...startCode,
      ...le16(width),
      ...le16(height),
    ],
    300,
  );
}

describe('format detection reads content, not the declared type', () => {
  it('identifies each supported format from its signature bytes', () => {
    expect(detectImageFormat(png(64, 64))).toBe('image/png');
    expect(detectImageFormat(jpeg(64, 64))).toBe('image/jpeg');
    expect(detectImageFormat(gif(64, 64))).toBe('image/gif');
    expect(detectImageFormat(webpLossy(64, 64))).toBe('image/webp');
  });

  it('covers every format on the allowlist', () => {
    const detected = [png(64, 64), jpeg(64, 64), webpLossy(64, 64), gif(64, 64)].map(
      detectImageFormat,
    );
    expect(new Set(detected)).toEqual(new Set(ALLOWED_IMAGE_FORMATS));
  });

  it('refuses a non-image whatever its declared type claims', () => {
    // A PDF renamed to .png and uploaded as image/png. The extension and the
    // header both say PNG; the bytes do not.
    const pdf = pad(Array.from('%PDF-1.7\n%aaaa', (c) => c.charCodeAt(0)), 400);
    expect(detectImageFormat(pdf)).toBeNull();

    const result = validateProblemImage(pdf, 'image/png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('refuses an executable disguised as an image', () => {
    const executable = pad([0x4d, 0x5a, 0x90, 0x00, 0x03], 500);
    const result = validateProblemImage(executable, 'image/jpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('refuses a real image whose declared type disagrees with its content', () => {
    const result = validateProblemImage(png(64, 64), 'image/jpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DECLARED_TYPE_MISMATCH');
  });

  it('accepts a real image with no declared type at all', () => {
    expect(validateProblemImage(png(64, 64)).ok).toBe(true);
  });
});

describe('dimensions are read from each format header', () => {
  it('reads PNG IHDR', () => {
    expect(readImageDimensions(png(800, 600), 'image/png')).toEqual({ width: 800, height: 600 });
  });

  it('reads JPEG SOF0 past preceding metadata segments', () => {
    // The frame header sits at an unpredictable offset, so this is the case a
    // fixed-index parser gets wrong.
    const withExif = jpeg(1024, 768, exifSegment());
    expect(readImageDimensions(withExif, 'image/jpeg')).toEqual({ width: 1024, height: 768 });
  });

  it('reads GIF logical screen descriptor', () => {
    expect(readImageDimensions(gif(320, 240), 'image/gif')).toEqual({ width: 320, height: 240 });
  });

  it('reads WebP lossy dimensions', () => {
    expect(readImageDimensions(webpLossy(640, 480), 'image/webp')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('returns null rather than a guess when the header is truncated', () => {
    expect(readImageDimensions(pad([0x89, 0x50, 0x4e, 0x47], 10), 'image/png')).toBeNull();
  });
});

describe('size and dimension bounds', () => {
  it('refuses a file above the size ceiling', () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set(png(64, 64));
    const result = validateProblemImage(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses an empty file', () => {
    const result = validateProblemImage(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EMPTY_FILE');
  });

  it('refuses a decompression-bomb declaration that is small on disk', () => {
    // 40000x40000 in a few hundred bytes. Size alone does not bound decode cost,
    // which is why dimensions are a separate check rather than a derived one.
    const bomb = png(40000, 40000);
    expect(bomb.byteLength).toBeLessThan(1000);

    const result = validateProblemImage(bomb);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DIMENSIONS_TOO_LARGE');
  });

  it('accepts an image exactly at the dimension ceiling', () => {
    expect(validateProblemImage(png(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION)).ok).toBe(true);
  });

  it('refuses a frame too small to hold readable text', () => {
    const result = validateProblemImage(png(8, 8));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DIMENSIONS_TOO_SMALL');
  });
});

describe('metadata stripping', () => {
  it('removes an EXIF segment carrying location from a JPEG', () => {
    const original = jpeg(640, 480, exifSegment());
    const text = Buffer.from(original).toString('latin1');
    expect(text).toContain('GPSLatitude');

    const { bytes, stripped } = stripImageMetadata(original, 'image/jpeg');
    expect(stripped).toBe(true);
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('GPSLatitude');
  });

  it('keeps the image decodable after stripping', () => {
    const original = jpeg(640, 480, exifSegment());
    const { bytes } = stripImageMetadata(original, 'image/jpeg');

    expect(detectImageFormat(bytes)).toBe('image/jpeg');
    expect(readImageDimensions(bytes, 'image/jpeg')).toEqual({ width: 640, height: 480 });
  });

  it('removes PNG text chunks but keeps IHDR and IDAT', () => {
    const textChunk = pngChunk(
      'tEXt',
      Array.from('Author\0Student Name', (character) => character.charCodeAt(0)),
    );
    const original = png(200, 100, textChunk);
    expect(Buffer.from(original).toString('latin1')).toContain('Student Name');

    const { bytes, stripped } = stripImageMetadata(original, 'image/png');
    expect(stripped).toBe(true);
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('Student Name');
    expect(readImageDimensions(bytes, 'image/png')).toEqual({ width: 200, height: 100 });
  });

  it('reports honestly when a format is not stripped', () => {
    // GIF and WebP are not rewritten. Claiming otherwise would be a privacy
    // assertion this module cannot back.
    expect(stripImageMetadata(gif(64, 64), 'image/gif').stripped).toBe(false);
    expect(stripImageMetadata(webpLossy(64, 64), 'image/webp').stripped).toBe(false);
  });

  it('returns the original bytes rather than a truncation when parsing fails', () => {
    const malformed = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x01, 0x02]);
    const { bytes } = stripImageMetadata(malformed, 'image/jpeg');
    expect(Array.from(bytes)).toEqual(Array.from(malformed));
  });
});

describe('validateProblemImage end to end', () => {
  it('returns sanitized bytes, format and dimensions on success', () => {
    const result = validateProblemImage(jpeg(1200, 900, exifSegment()), 'image/jpeg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.format).toBe('image/jpeg');
    expect(result.dimensions).toEqual({ width: 1200, height: 900 });
    expect(result.metadataStripped).toBe(true);
    expect(result.bytes.byteLength).toBeLessThan(jpeg(1200, 900, exifSegment()).byteLength);
  });

  it('never echoes file content in a refusal message', () => {
    const hostile = pad(
      Array.from('<script>alert(1)</script>', (character) => character.charCodeAt(0)),
      400,
    );
    const result = validateProblemImage(hostile, 'image/png');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain('script');
  });
});
