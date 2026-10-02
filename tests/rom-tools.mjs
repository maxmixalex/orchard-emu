// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspectInput, prepareInput, parseGpio, readFirmware } from '../tools/rom-inputs.mjs';
let checks = 0;
function test(fn) { fn(); ++checks; }
for (const marker of ['KINPOHP39G+IMAGE', 'KINPOHP40G+IMAGE', 'KINPOUPDATEIMAGE']) {
  const data = Buffer.alloc(64); data.write(marker);
  test(() => assert.equal(inspectInput(data).kind, 'firmware-update'));
  test(() => assert.equal(inspectInput(data).plausible_arm_vector, false));
  test(() => assert.throws(() => prepareInput(1, data, 'full-nor')));
  for (let i = 0; i < 16; ++i) data[i] |= 128;
  test(() => assert.equal(inspectInput(data).kind, 'unidentified'));
}
for (const size of [0x100000, 0x200000]) {
  const data = Buffer.alloc(size, 0xff); data.writeUInt32LE(0xea000006);
  const id = size === 0x100000 ? 1 : 4;
  const result = prepareInput(id, data, 'full-nor');
  test(() => assert.equal(result.input_kind, 'unverified-full-size-image'));
  test(() => assert.deepEqual(result.image, data));
  test(() => assert.equal(result.source.boot_verified, false));
  test(() => assert.throws(() => prepareInput(size === 0x100000 ? 4 : 1, data, 'full-nor')));
  test(() => assert.throws(() => prepareInput(id, data, 'bootloader')));
}
const region = Buffer.alloc(0x4000, 255); region.writeUInt32LE(0xea000006);
test(() => assert.throws(() => prepareInput(5, region, 'bootloader'), /hash-pinned/));
for (const data of [Buffer.alloc(0), Buffer.alloc(3), Buffer.alloc(0x200001)])
  test(() => assert.throws(() => inspectInput(data)));
for (const bad of ['A:1:0', 'I:1:0', 'D:1:2', 'F:100:0', 'D:10000:0', 'D:1:0,D:1:1',
  'D:0x1:0', 'D:-1:0', 'D:1:', 'D:1:0,', 'D:FFFFFFFF:0', 'D:1:000000000'])
  test(() => assert.throws(() => parseGpio(bad)));
test(() => assert.deepEqual(parseGpio(undefined), []));
test(() => assert.deepEqual(parseGpio('d:cc7f:0'), [{ port: 3, name: 'D', known: 0xcc7f, levels: 0, cli: 'D:cc7f:0' }]));
test(() => assert.equal(parseGpio('B:7ff:555,F:ff:0').length, 2));
const temp = await mkdtemp(resolve(tmpdir(), 'orchard-rom-tools-'));
try {
  const good = resolve(temp, 'good'); await writeFile(good, region);
  assert.deepEqual(await readFirmware(good), region); ++checks;
  for (const [name, data] of [['short', Buffer.alloc(3)], ['large', Buffer.alloc(0x200001)]]) {
    const path = resolve(temp, name); await writeFile(path, data);
    await assert.rejects(readFirmware(path)); ++checks;
  }
  await assert.rejects(readFirmware(temp)); ++checks;
} finally { await rm(temp, { recursive: true, force: true }); }
console.log(`ROM/probe tool checks: ${checks} passed (ROM-free)`);
