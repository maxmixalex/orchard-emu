// SPDX-License-Identifier: MIT
// A benchmark comparator must not hide new peripheral state or corrupted input.
import assert from 'node:assert/strict';
import {canonicalCheckpoint} from '../tools/checkpoint-equivalence.mjs';

function repairCRC(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(32)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  new DataView(bytes.buffer).setUint32(28, (~crc) >>> 0, true);
}
let checks = 0;
for (let model = 1; model <= 6; ++model) {
  const ramBytes = model >= 5 ? 0x80000 : 0x40000;
  const old = new Uint8Array(4070 + ramBytes + 4096);
  old.set(new TextEncoder().encode('ORCHST01'));
  const view = new DataView(old.buffer);
  for (const [offset, value] of [[8, 1], [12, old.length], [16, model], [20, 0x12345678], [24, ramBytes]])
    view.setUint32(offset, value, true);
  old[4069] = 0x57; old[4070] = 0x93; old[old.length - 1] = 0x2e;
  repairCRC(old);
  const original = old.slice(), migrated = canonicalCheckpoint(old);
  assert.deepEqual(old, original);
  assert.equal(migrated.length, old.length + 52);
  assert.deepEqual(migrated.subarray(32, 4070), old.subarray(32, 4070));
  assert.deepEqual(migrated.subarray(4122), old.subarray(4070));
  const reset = new Uint8Array(52); reset[21] = 0x20;
  assert.deepEqual(migrated.subarray(4070, 4122), reset);
  assert.deepEqual(canonicalCheckpoint(migrated), migrated);
  const liveSDI = migrated.slice();
  liveSDI[4078] = 0xaa; repairCRC(liveSDI);
  assert.notDeepEqual(canonicalCheckpoint(liveSDI), migrated);
  checks += 7;
  for (const offset of [0, 8, 12, 16, 24, 28, old.length - 1]) {
    const damaged = old.slice(); damaged[offset] ^= 0x40;
    assert.throws(() => canonicalCheckpoint(damaged)); ++checks;
  }
  for (const incomplete of [old.subarray(0, 31), old.subarray(0, old.length - 1)]) {
    assert.throws(() => canonicalCheckpoint(incomplete)); ++checks;
  }
}
console.log(JSON.stringify({checks, failures: 0, models: 6}));
