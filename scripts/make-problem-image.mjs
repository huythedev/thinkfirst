/**
 * Renders a real problem image with legible text, for verifying image
 * extraction end to end without a canvas dependency.
 *
 * Node ships zlib, and PNG is a documented container, so a valid image can be
 * encoded directly. The glyphs are a 5x7 bitmap font scaled up, which produces
 * genuinely readable text rather than a synthetic header with no pixels behind
 * it. That distinction matters: the Phase 7 criterion says extraction must work
 * "on a real image", and a header-only file proves the parser, not the model.
 *
 * Usage: node scripts/make-problem-image.mjs [outputPath] [text...]
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const SCALE = 6;
const GLYPH_W = 5;
const GLYPH_H = 7;
const SPACING = 1;
const MARGIN = 30;
const LINE_GAP = 10;

function renderLines(lines) {
  const longest = Math.max(...lines.map((line) => line.length));
  const width = MARGIN * 2 + longest * (GLYPH_W + SPACING) * SCALE;
  const height = MARGIN * 2 + lines.length * (GLYPH_H * SCALE + LINE_GAP);

  // White RGB canvas.
  const pixels = Buffer.alloc(width * height * 3, 0xff);

  const setPixel = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    pixels[offset] = 0x11;
    pixels[offset + 1] = 0x11;
    pixels[offset + 2] = 0x11;
  };

  lines.forEach((line, lineIndex) => {
    const baseY = MARGIN + lineIndex * (GLYPH_H * SCALE + LINE_GAP);
    Array.from(line.toUpperCase()).forEach((character, charIndex) => {
      const glyph = FONT[character] ?? FONT[' '];
      const baseX = MARGIN + charIndex * (GLYPH_W + SPACING) * SCALE;

      glyph.forEach((row, rowIndex) => {
        Array.from(row).forEach((bit, columnIndex) => {
          if (bit !== '1') return;
          for (let dy = 0; dy < SCALE; dy += 1) {
            for (let dx = 0; dx < SCALE; dx += 1) {
              setPixel(baseX + columnIndex * SCALE + dx, baseY + rowIndex * SCALE + dy);
            }
          }
        });
      });
    });
  });

  return { pixels, width, height };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng({ pixels, width, height }) {
  const stride = width * 3;
  // One filter byte per scanline; filter 0 (None) keeps the encoder trivial.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function createProblemImage(lines = ['SOLVE FOR X', '3X + 7 = 22']) {
  return encodePng(renderLines(lines));
}

// Keep the command-line image generator while allowing the live verification
// script to reuse the exact same valid-pixel encoder in memory.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputPath = process.argv[2] ?? 'problem.png';
  const lines =
    process.argv.length > 3 ? process.argv.slice(3) : ['SOLVE FOR X', '3X + 7 = 22'];

  const png = createProblemImage(lines);
  writeFileSync(outputPath, png);
  console.log(`wrote ${outputPath} (${png.length} bytes)`);
}
