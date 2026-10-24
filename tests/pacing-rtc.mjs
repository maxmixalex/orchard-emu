// SPDX-License-Identifier: MIT
// Production WASM plus a generated ARM guest, not a mocked RTC or browser E2E.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pacer } from '../dist/pacing.js';
const wasm = await readFile(new URL('../dist/orchard.wasm', import.meta.url));
const rom = new Uint8Array(1048576).fill(255);
const words = [0xea000000, 0xeafffffe], literals = [];
const ldr = (reg,value) => {literals.push({index:words.length,reg,value});words.push(0);};
// Disable watchdog, select four CPU slots per peripheral quantum, then WFI.
// No writes to calendar/time; legacy, idle and clocked policies must all keep
// the same paced RTC seconds despite different CPU issue counts.
ldr(0,0x53000000);words.push(0xe3a01000,0xe5801000);
ldr(0,0x4c000014);words.push(0xe3a01003,0xe5801000);
ldr(1,0xc0000078);words.push(0xee011f10,0xee071f90,0xeafffffd);
for(const {index,reg,value} of literals){words[index]=(0xe59f0000|(reg<<12)|(4*words.length-4*index-8))>>>0;words.push(value);}
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
  // Versions 2–6 append SDI, media, clock, SPI/reset and UART/NOR state after RTC.
  const offset = bytes.length - c.profile(1, 1) - 4096 - 52 - 709 - 64 - 76 - 4377 - 31;
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), 6);
  return [...bytes.slice(offset + 12, offset + 15)];
}
for (const policy of ['run','run_idle','run_clocked']) for (const speed of [0.5, 1, 2]) {
  let expected;
  for (const [cap, intervals] of [[256, [1]], [4096, [3, 7, 11, 31]]]) {
    const c = await create(), p = new Pacer(c.timebase_hz());
    p.setSpeed(speed, 0);
    let now = 0, executed = 0, iteration = 0;
    while (now < 2000) {
      now = Math.min(2000, now + intervals[iteration++ % intervals.length]);
      let n;
      while ((n = p.available(now, cap))) {
        assert.equal(c[policy](n), 0); p.consume(n); executed += n;
      }
    }
    assert.equal(executed, c.timebase_hz() * 2 * speed);
    assert.equal(c.clock_slots(),4);
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
console.log('Paced production RTC: legacy/idle/clocked policies at 0.5/1/2 rates produce 1/2/4 seconds, identical full state across host chunk sizes, bounded catch-up. Not physical clock calibration.');
