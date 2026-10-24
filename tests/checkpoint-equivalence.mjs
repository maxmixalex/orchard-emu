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
  view.setUint32(400, 0x5c080, true); // Reset MPLLCON has no recoverable write history.
  for (let ch=0;ch<4;ch++) view.setUint32(1903+ch*4, 17+ch*23, true);
  old[4069] = 0x57; old[4070] = 0x93; old[old.length - 1] = 0x2e;
  repairCRC(old);
  const original = old.slice(), migrated = canonicalCheckpoint(old);
  assert.deepEqual(old, original);
  assert.equal(migrated.length, old.length + 52 + 709 + 64 + 76 + 4377 + 2056);
  assert.deepEqual(migrated.subarray(32, 4070), old.subarray(32, 4070));
  assert.deepEqual(migrated.subarray(11404), old.subarray(4070));
  const reset = new Uint8Array(52); reset[21] = 0x20;
  assert.deepEqual(migrated.subarray(4070, 4122), reset);
  assert.deepEqual(canonicalCheckpoint(migrated), migrated);
  const v2 = new Uint8Array(old.length + 52);
  v2.set(migrated.subarray(0, 4122));v2.set(old.subarray(4070), 4122);
  new DataView(v2.buffer).setUint32(8, 2, true);
  new DataView(v2.buffer).setUint32(12, v2.length, true);repairCRC(v2);
  assert.deepEqual(canonicalCheckpoint(v2), migrated);
  const v3 = new Uint8Array(old.length + 52 + 709);
  v3.set(migrated.subarray(0, 4831));v3.set(old.subarray(4070), 4831);
  const v3View=new DataView(v3.buffer);v3View.setUint32(8,3,true);v3View.setUint32(12,v3.length,true);repairCRC(v3);
  assert.deepEqual(canonicalCheckpoint(v3), migrated);
  assert.equal(new DataView(migrated.buffer).getUint32(8,true),7);
  assert.deepEqual(migrated.subarray(4831,4839),new Uint8Array(8));
  assert.deepEqual(migrated.subarray(4839,4855),old.subarray(1903,1919));
  assert.deepEqual(migrated.subarray(4855,4895),new Uint8Array(40));
  const spiReset=new Uint8Array(76);
  for(let channel=0;channel<2;channel++){spiReset[channel*36+4]=1;spiReset[channel*36+8]=2;}
  assert.deepEqual(migrated.subarray(4895,4971),spiReset);
  const v4=new Uint8Array(old.length+52+709+64);
  v4.set(migrated.subarray(0,4895));v4.set(old.subarray(4070),4895);
  const v4View=new DataView(v4.buffer);v4View.setUint32(8,4,true);v4View.setUint32(12,v4.length,true);repairCRC(v4);
  assert.deepEqual(canonicalCheckpoint(v4),migrated);
  // Unlike v1-v3, v4 carries these exact phases and latches. Migration must
  // keep them rather than reconstructing reset/guest-buffer values.
  for(const offset of [4831,4835,4839,4855,4875,4891])v4View.setUint32(offset,7,true);
  repairCRC(v4);
  assert.deepEqual(canonicalCheckpoint(v4).subarray(4831,4895),v4.subarray(4831,4895));
  v3View.setUint32(400,0x43012,true);repairCRC(v3);
  assert.equal(new DataView(canonicalCheckpoint(v3).buffer).getUint32(4835,true),1);
  const liveClock=migrated.slice();new DataView(liveClock.buffer).setUint32(4831,7,true);repairCRC(liveClock);
  assert.notDeepEqual(canonicalCheckpoint(liveClock),migrated);
  const livePWM=migrated.slice();new DataView(livePWM.buffer).setUint32(4839,9,true);repairCRC(livePWM);
  assert.notDeepEqual(canonicalCheckpoint(livePWM),migrated);
  const pending=migrated.slice();new DataView(pending.buffer).setUint32(4891,4,true);repairCRC(pending);
  assert.notDeepEqual(canonicalCheckpoint(pending),migrated);
  const liveSDI = migrated.slice();
  liveSDI[4078] = 0xaa; repairCRC(liveSDI);
  assert.notDeepEqual(canonicalCheckpoint(liveSDI), migrated);
  const liveFIFO=migrated.slice();liveFIFO[4122+127]=0x5a;repairCRC(liveFIFO);
  assert.notDeepEqual(canonicalCheckpoint(liveFIFO), migrated);
  const liveSPI=migrated.slice();new DataView(liveSPI.buffer).setUint32(4895+20,0x96,true);repairCRC(liveSPI);
  assert.notDeepEqual(canonicalCheckpoint(liveSPI),migrated);
  const heldReset=migrated.slice();new DataView(heldReset.buffer).setUint32(4967,91,true);repairCRC(heldReset);
  assert.notDeepEqual(canonicalCheckpoint(heldReset),migrated);
  const v6=new Uint8Array(migrated.length-2056);
  v6.set(migrated.subarray(0,9348));v6.set(migrated.subarray(11404),9348);
  const v6View=new DataView(v6.buffer);v6View.setUint32(8,6,true);v6View.setUint32(12,v6.length,true);repairCRC(v6);
  assert.deepEqual(canonicalCheckpoint(v6),migrated);
  const warmTLB=migrated.slice();warmTLB[9348+3]=4;repairCRC(warmTLB);
  assert.notDeepEqual(canonicalCheckpoint(warmTLB),migrated);
  checks += 25;
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
const v7Card=canonicalCheckpoint(card);
assert.equal(v7Card.length,card.length+64+76+4377+2056);++checks;
assert.deepEqual(v7Card.subarray(11404),card.subarray(4831));++checks;
assert.deepEqual(canonicalCheckpoint(v7Card),v7Card);++checks;
assert.equal(new DataView(v7Card.buffer).getUint32(4825,true),1048576);++checks;
const suppliedBuffer=Buffer.from(v7Card),independent=canonicalCheckpoint(suppliedBuffer);
independent[independent.length-1]^=1;
assert.deepEqual(new Uint8Array(suppliedBuffer),v7Card);++checks;
const changed=card.slice();changed[changed.length-1]^=1;repairCRC(changed);
assert.notDeepEqual(canonicalCheckpoint(changed),canonicalCheckpoint(card));++checks;
cv.setUint32(4825,1048575,true);repairCRC(card);
assert.throws(()=>canonicalCheckpoint(card));++checks;
console.log(JSON.stringify({checks, failures: 0, models: 6}));
