import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dpiFor, printSpec, gridFor, normaliseCm, equalShares, tileSizeCm } from '../src/engine/grid.js';
import { CONFIG } from '../src/config.js';

const rule = CONFIG.print.dpiRule;

test('DPI rule: 250 DPI when both sides are at most 70 cm', () => {
  assert.equal(dpiFor(70, 70, rule), 250);
  assert.equal(dpiFor(40, 60, rule), 250);
  assert.equal(dpiFor(10, 10, rule), 250);
});

test('DPI rule: 150 DPI as soon as one side is over 70 cm', () => {
  assert.equal(dpiFor(70.1, 70, rule), 150);
  assert.equal(dpiFor(50, 100, rule), 150);
  assert.equal(dpiFor(125, 175, rule), 150);
  assert.equal(dpiFor(100, 50, rule), 150);
});

test('print pixels follow cm and DPI', () => {
  const big = printSpec(125, 175, rule);
  assert.deepEqual([big.width, big.height, big.dpi], [7382, 10335, 150]); // same as the original admin export
  const small = printSpec(70, 70, rule);
  assert.deepEqual([small.width, small.height, small.dpi], [6890, 6890, 250]);
});

test('grid follows the print format with near-square tiles', () => {
  assert.deepEqual(gridFor(100, 140, 140), { width: 100, height: 140 });
  assert.deepEqual(gridFor(140, 100, 140), { width: 140, height: 100 });
  assert.deepEqual(gridFor(50, 50, 120), { width: 120, height: 120 });
  const g = gridFor(30, 90, 150);
  assert.deepEqual(g, { width: 50, height: 150 });
  const tile = tileSizeCm(30, 90, g);
  assert.ok(Math.abs(tile.x - tile.y) < 1e-9);
});

test('cm input accepts Danish decimal comma and clamps', () => {
  assert.equal(normaliseCm('50,5', 10, 300), 50.5);
  assert.equal(normaliseCm('5', 10, 300), 10);
  assert.equal(normaliseCm('999', 10, 300), 300);
  assert.ok(Number.isNaN(normaliseCm('abc', 10, 300)));
});

test('equal shares', () => {
  assert.deepEqual(equalShares(14000, 100), { base: 140, extra: 0 });
  assert.deepEqual(equalShares(14000, 300), { base: 46, extra: 200 });
});
