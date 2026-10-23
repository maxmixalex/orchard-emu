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
  assert.equal(migrated.length, old.length + 52 + 709);
  assert.deepEqual(migrated.subarray(32, 4070), old.subarray(32, 4070));
  assert.deepEqual(migrated.subarray(4831), old.subarray(4070));
  const reset = new Uint8Array(52); reset[21] = 0x20;
  assert.deepEqual(migrated.subarray(4070, 4122), reset);
  assert.deepEqual(canonicalCheckpoint(migrated), migrated);
  const v2 = new Uint8Array(old.length + 52);
  v2.set(migrated.subarray(0, 4122));v2.set(old.subarray(4070), 4122);
  new DataView(v2.buffer).setUint32(8, 2, true);
  new DataView(v2.buffer).setUint32(12, v2.length, true);repairCRC(v2);
  assert.deepEqual(canonicalCheckpoint(v2), migrated);
  const liveSDI = migrated.slice();
  liveSDI[4078] = 0xaa; repairCRC(liveSDI);
  assert.notDeepEqual(canonicalCheckpoint(liveSDI), migrated);
  const liveFIFO=migrated.slice();liveFIFO[4122+127]=0x5a;repairCRC(liveFIFO);
  assert.notDeepEqual(canonicalCheckpoint(liveFIFO), migrated);
  checks += 9;
  for (const offset of [0, 8, 12, 16, 24, 28, old.length - 1]) {
    const damaged = old.slice(); damaged[offset] ^= 0x40;
    assert.throws(() => canonicalCheckpoint(damaged)); ++checks;
  }
  for (const incomplete of [old.subarray(0, 31), old.subarray(0, old.length - 1)]) {
    assert.throws(() => canonicalCheckpoint(incomplete)); ++checks;
  }
}
// Media bytes are retained, and malformed image lengths cannot hide a suffix.
const card = new Uint8Array(4831 + 0x80000 + 4096 + 1048576);
card.set(new TextEncoder().encode('ORCHST01'));
const cv = new DataView(card.buffer);
for(const [offset,value] of [[8,3],[12,card.length],[16,5],[24,0x80000],[4825,1048576]])cv.setUint32(offset,value,true);
card[card.length-1]=0xa5;repairCRC(card);
assert.deepEqual(canonicalCheckpoint(card),card);++checks;
const changed=card.slice();changed[changed.length-1]^=1;repairCRC(changed);
assert.notDeepEqual(canonicalCheckpoint(changed),canonicalCheckpoint(card));++checks;
cv.setUint32(4825,1048575,true);repairCRC(card);
assert.throws(()=>canonicalCheckpoint(card));++checks;
console.log(JSON.stringify({checks, failures: 0, models: 6}));
