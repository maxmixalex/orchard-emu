// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspectInput, prepareInput, assertModelIdentity, capacities, parseGpio, parseKeyEvents, parseProbeBudget, readFirmware } from '../tools/rom-inputs.mjs';
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
for (let id = 1; id <= 6; ++id) {
  const size = capacities[id - 1];
  const data = Buffer.alloc(size, 0xff); data.writeUInt32LE(0xea000006);
  const result = prepareInput(id, data, 'full-nor');
  test(() => assert.equal(result.input_kind, 'unverified-full-size-image'));
  test(() => assert.deepEqual(result.image, data));
  test(() => assert.equal(result.source.boot_verified, false));
  test(() => assert.equal(result.source.native_boot_region, null));
  test(() => assert.throws(() => prepareInput(size === 0x100000 ? 4 : 1, data, 'full-nor')));
  test(() => assert.throws(() => prepareInput(id, data, 'bootloader')));
}
// Identity-policy fixtures contain metadata only, never HP firmware bytes.
// A known boot prefix constrains model identity but cannot certify its OS.
for (const [id, slug] of [[5, 'hp49gplus'], [6, 'hp50g']]) {
  const source = { kind: 'unidentified', models: [], boot_verified: false,
    native_boot_region: { bytes: 0x4000, models: [slug] } };
  test(() => assert.doesNotThrow(() => assertModelIdentity(id, source)));
  for (let wrong = 1; wrong <= 6; ++wrong) if (wrong !== id)
    test(() => assert.throws(() => assertModelIdentity(wrong, source), /native boot region/));
  test(() => assert.equal(source.kind, 'unidentified'));
  test(() => assert.equal(source.boot_verified, false));
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
for (const bad of ['', '1:8:0:1', '1:0:7:1', '1:0:0:2', '-1:0:0:1',
  '2:0:0:1,1:0:0:0', '100:0:0:1', '1.0:0:0:1', '1:0:0:1,', '1:0:0',
  '9007199254740992:0:0:1', Array(65).fill('1:0:0:1').join(',')])
  test(() => assert.throws(() => parseKeyEvents(bad, 100)));
test(() => assert.deepEqual(parseKeyEvents(undefined, 1), []));
test(() => assert.deepEqual(parseKeyEvents('0:3:2:1,0:3:2:0,99:7:6:1', 100), [
  { tick: 0, column: 3, row: 2, down: 1 }, { tick: 0, column: 3, row: 2, down: 0 },
  { tick: 99, column: 7, row: 6, down: 1 }]));
test(() => assert.throws(() => parseKeyEvents(undefined, NaN)));
for (const [text, expected] of [[undefined, 1000000], ['1', 1], ['50000000', 50000000],
  ['100000000', 100000000], ['500000000', 500000000]]) test(() => assert.equal(parseProbeBudget(text), expected));
for (const text of ['', '0', '-1', '1.5', '1e7', ' 1', '500000001', '9007199254740992', null, 1])
  test(() => assert.throws(() => parseProbeBudget(text)));
test(() => assert.deepEqual(parseGpio('G:1:0,D:cc7f:0,F:8e:0').map(s => s.port), [3, 5, 6]));
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
