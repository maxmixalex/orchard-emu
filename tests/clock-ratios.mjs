// SPDX-License-Identifier: MIT
// Independent constant expectations; no ROM, WASM instance or clock execution.
import assert from 'node:assert/strict';
import { decodeClockRatiosIfSettled } from '../tools/clock-ratios.mjs';

const registers = Object.freeze({ mpllcon: 0x43012, clkslow: 0x30, clkdivn: 3 });
const decode = changes => decodeClockRatiosIfSettled({ ...registers, ...changes });
const tuple = result => ['fclk', 'hclk', 'pclk'].map(name => {
  const { numerator, denominator } = result.ratios_to_fin[name];
  return [numerator, denominator];
});
const slow = decode(), pll = decode({ clkslow: 0 });
assert.deepEqual(tuple(slow), [[1, 1], [1, 2], [1, 4]]);
assert.deepEqual(tuple(pll), [[25, 4], [25, 8], [25, 16]]);
// Sixteen input-clock periods: independent edge totals for settled selections.
const edges = result => tuple(result).map(([n, d]) => 16 * n / d);
assert.deepEqual(edges(slow), [16, 8, 4]);
assert.deepEqual(edges(pll), [100, 50, 25]);
assert.equal(slow.status, 'conditional');
assert.equal(pll.status, 'conditional');
assert.equal(slow.source, 'slow-input');
assert.equal(pll.source, 'mpll');
assert.deepEqual(slow.conditional_on, ['source-and-dividers-settled']);
assert.deepEqual(pll.conditional_on,
  ['source-and-dividers-settled', 'mpll-configured-and-locked']);
assert.deepEqual(decodeClockRatiosIfSettled(registers), slow);

// CLKDIVN's five documented encodings, including HDIVN1's 1:4:4 setting.
for (const [clkdivn, expected] of [
  [0, [[25, 4], [25, 4], [25, 4]]],
  [1, [[25, 4], [25, 4], [25, 8]]],
  [2, [[25, 4], [25, 8], [25, 8]]],
  [3, [[25, 4], [25, 8], [25, 16]]],
  [4, [[25, 4], [25, 16], [25, 16]]],
]) assert.deepEqual(tuple(decode({ clkslow: 0, clkdivn })), expected);
assert.deepEqual(tuple(decode({ clkdivn: 4 })), [[1, 1], [1, 4], [1, 4]]);

// SLOW_VAL zero is a special divide-by-one selection, not division by zero.
for (const [clkslow, expected] of [
  [0x30, [[1, 1], [1, 2], [1, 4]]],
  [0x31, [[1, 2], [1, 4], [1, 8]]],
  [0x32, [[1, 4], [1, 8], [1, 16]]],
  [0x33, [[1, 6], [1, 12], [1, 24]]],
  [0x37, [[1, 14], [1, 28], [1, 56]]],
]) assert.deepEqual(tuple(decode({ clkslow })), expected);
// MPLL may remain on while slow-input is selected; UPLL control is unrelated.
assert.deepEqual(decode({ clkslow: 0x10 }), slow);
assert.deepEqual(decode({ clkslow: 0xb0 }), slow);
assert.deepEqual(decode({ clkslow: 0x80 }), pll);
// Additional constants cover MDIV/PDIV/SDIV extraction and fraction reduction.
assert.deepEqual(tuple(decode({ clkslow: 0, mpllcon: 0x78023, clkdivn: 0 })),
  [[4, 1], [4, 1], [4, 1]]);
assert.deepEqual(tuple(decode({ clkslow: 0, mpllcon: 0, clkdivn: 0 })),
  [[4, 1], [4, 1], [4, 1]]);
assert.deepEqual(tuple(decode({ clkslow: 0, mpllcon: 0xff3f3, clkdivn: 4 })),
  [[263, 520], [263, 2080], [263, 2080]]);

for (const clkdivn of [5, 6, 7]) {
  const invalid = decode({ clkdivn });
  assert.equal(invalid.status, 'unavailable');
  assert.equal(invalid.reason, 'reserved-clkdivn');
  assert.equal(invalid.ratios_to_fin, null);
}
const off = decode({ clkslow: 0x20 });
assert.equal(off.status, 'unavailable');
assert.equal(off.reason, 'mpll-off-outside-slow');
assert.equal(off.ratios_to_fin, null);
for (const field of ['mpllcon', 'clkslow', 'clkdivn'])
  for (const value of [-1, 0x100000000, 1.5, NaN, undefined, '0'])
    assert.throws(() => decode({ [field]: value }), TypeError);

console.log('Conditional clock-ratio constants passed (no ROM or clock execution).');
