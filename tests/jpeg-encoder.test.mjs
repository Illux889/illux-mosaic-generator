import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/engine/jpeg-encoder.js';

const { createEncoder, patchJpegDpi, _tables } = globalThis.IlxJpeg;

test('AC Huffman tables contain every baseline symbol exactly once', () => {
  const expected = new Set([0x00, 0xf0]);
  for (let run = 0; run < 16; run++) for (let size = 1; size <= 10; size++) expected.add((run << 4) | size);
  for (const [bits, values] of [[_tables.AC_LUMA_BITS, _tables.AC_LUMA_VALUES], [_tables.AC_CHROMA_BITS, _tables.AC_CHROMA_VALUES]]) {
    assert.equal(bits.reduce((a, b) => a + b, 0), values.length);
    assert.equal(values.length, 162);
    assert.deepEqual(new Set(values), expected);
  }
});

test('zigzag is a permutation of 0..63', () => {
  assert.deepEqual([..._tables.ZIGZAG].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
});

function encode(width, height, dpi, chunkRows) {
  const enc = createEncoder({ width, height, quality: 92, dpi });
  const rgba = new Uint8ClampedArray(width * chunkRows * 4);
  for (let y = 0; y < height; y += chunkRows) {
    const rows = Math.min(chunkRows, height - y);
    for (let r = 0; r < rows; r++) for (let x = 0; x < width; x++) {
      const p = (r * width + x) * 4;
      rgba[p] = x * 255 / width; rgba[p + 1] = (y + r) * 255 / height; rgba[p + 2] = (x ^ (y + r)) & 255; rgba[p + 3] = 255;
    }
    enc.writeRows(rgba, rows);
  }
  return Buffer.concat(enc.finish());
}

test('stream produces a well-formed JPEG with the requested DPI', () => {
  const bytes = encode(37, 21, 250, 5); // sizes not divisible by 8, odd strip heights
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
  assert.equal(bytes[bytes.length - 2], 0xff); assert.equal(bytes[bytes.length - 1], 0xd9);
  assert.equal(bytes.toString('latin1', 6, 10), 'JFIF');
  assert.equal(bytes[13], 1); // units: dots per inch
  assert.equal(bytes.readUInt16BE(14), 250);
  assert.equal(bytes.readUInt16BE(16), 250);
  // SOF0 carries the size
  const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  assert.equal(bytes.readUInt16BE(sof + 5), 21);
  assert.equal(bytes.readUInt16BE(sof + 7), 37);
});

test('row chunking does not change the output', () => {
  assert.deepEqual(encode(64, 40, 150, 1), encode(64, 40, 150, 13));
});

test('refuses too many or too few rows', () => {
  const enc = createEncoder({ width: 8, height: 8, quality: 90, dpi: 150 });
  assert.throws(() => enc.finish(), /jpeg-missing-rows/);
  enc.writeRows(new Uint8ClampedArray(8 * 8 * 4), 8);
  assert.throws(() => enc.writeRows(new Uint8ClampedArray(8 * 4), 1), /jpeg-too-many-rows/);
});

test('patchJpegDpi rewrites the JFIF density', () => {
  const bytes = encode(16, 16, 72, 16);
  assert.ok(patchJpegDpi(bytes, 300));
  assert.equal(bytes.readUInt16BE(14), 300);
});
