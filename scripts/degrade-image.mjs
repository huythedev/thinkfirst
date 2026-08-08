/**
 * Degrades a PNG so extraction confidence genuinely drops.
 *
 * Needed because Phase 7's low-confidence path cannot be verified with a clean
 * image, and faking a low confidence in a fixture would test the fixture rather
 * than the model. This applies real damage to real pixels: a box blur, additive
 * noise, and reduced contrast, which together produce the kind of photograph a
 * student actually takes in bad light.
 *
 * Usage: node scripts/degrade-image.mjs input.png output.png [passes]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const [, , inputPath, outputPath, passesArg] = process.argv;
const passes = Number(passesArg ?? 3);

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

/** Reads an uncompressed truecolour PNG produced by make-problem-image.mjs. */
function decode(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[9] !== 2) throw new Error('expected truecolour PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const pixels = Buffer.alloc(stride * height);

  // Filter 0 only, which is what the generator emits.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }

  return { pixels, width, height };
}

function boxBlur({ pixels, width, height }) {
  const output = Buffer.from(pixels);
  const radius = 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          total += pixels[(ny * width + nx) * 3];
          count += 1;
        }
      }
      const value = Math.round(total / count);
      const offset = (y * width + x) * 3;
      output[offset] = value;
      output[offset + 1] = value;
      output[offset + 2] = value;
    }
  }

  return { pixels: output, width, height };
}

function degrade({ pixels, width, height }) {
  const output = Buffer.from(pixels);
  for (let index = 0; index < output.length; index += 3) {
    // Compress the dynamic range toward mid grey, then add noise.
    const base = output[index];
    const flattened = 128 + (base - 128) * 0.45;
    const noise = (Math.random() - 0.5) * 90;
    const value = Math.max(0, Math.min(255, Math.round(flattened + noise)));
    output[index] = value;
    output[index + 1] = value;
    output[index + 2] = value;
  }
  return { pixels: output, width, height };
}

function encode({ pixels, width, height }) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let image = decode(readFileSync(inputPath));
for (let pass = 0; pass < passes; pass += 1) image = boxBlur(image);
image = degrade(image);

const encoded = encode(image);
writeFileSync(outputPath, encoded);
console.log(`wrote ${outputPath} (${encoded.length} bytes, ${passes} blur passes)`);
