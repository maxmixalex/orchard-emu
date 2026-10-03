// SPDX-License-Identifier: MIT
// Production WASM plus a generated ARM guest, not a mocked RTC or browser E2E.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pacer } from '../dist/pacing.js';
const wasm = await readFile(new URL('../dist/orchard.wasm', import.meta.url));
const rom = new Uint8Array(1048576).fill(255);
const words = [0xea000000, 0xeafffffe, 0xe59f000c, 0xe3a01000,
  0xe5801000, 0xee071f90, 0xeafffffd, 0x53000000];
// Branch to reset code, disable watchdog, WFI; no writes to calendar/time.
words.forEach((word, i) => new DataView(rom.buffer).setUint32(i * 4, word, true));
async function create() {
  const { instance: { exports: c } } = await WebAssembly.instantiate(wasm, {});
  assert.equal(c.create(1), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0);
  return c;
}
function saved(c) {
  assert.equal(c.checkpoint_save(), 0);
  return new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), c.checkpoint_size()).slice();
}
function calendar(c, bytes) {
  // Checkpoint v1: RTC's 19 register bytes and 3 words precede RAM/boot SRAM.
  const offset = bytes.length - c.profile(1, 1) - 4096 - 31;
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), 1);
  return [...bytes.slice(offset + 12, offset + 15)];
}
for (const speed of [0.5, 1, 2]) {
  let expected;
  for (const [cap, intervals] of [[256, [1]], [4096, [3, 7, 11, 31]]]) {
    const c = await create(), p = new Pacer(c.timebase_hz());
    p.setSpeed(speed, 0);
    let now = 0, executed = 0, iteration = 0;
    while (now < 2000) {
      now = Math.min(2000, now + intervals[iteration++ % intervals.length]);
      let n;
      while ((n = p.available(now, cap))) {
        assert.equal(c.run(n), 0); p.consume(n); executed += n;
      }
    }
    assert.equal(executed, c.timebase_hz() * 2 * speed);
    const state = saved(c);
    assert.deepEqual(calendar(c, state), [2 * speed, 0, 0]);
    if (expected) assert.deepEqual(state, expected, 'Host chunking changed serialized guest state');
    else expected = state;
    // No paused time is injected on Resume, and an accidental large delay
    // grants at most 50 ms of credit rather than a minute of catch-up.
    p.reset(62000); assert.equal(p.available(62000, cap), 0);
    assert.equal(p.available(122000, 100000000), c.timebase_hz() * speed / 20);
  }
}
console.log('Paced production RTC: 0.5/1/2 rates produce 1/2/4 seconds, identical full state across host chunk sizes, bounded catch-up. Not physical clock calibration.');
