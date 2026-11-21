// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectInput, prepareInput, prepareFirmwareUpdate, assertModelIdentity, capacities, parseGpio, parseKeyEvents, parseProbeBudget, readFirmware } from '../tools/rom-inputs.mjs';
import { HARDWARE_MOD_ROMS } from '../web/hardware-mod.js';
import { isPlayable, setupHash, applySetup } from '../web/hp48.js';
import { transferCapabilities } from '../web/file-transfer.js';
let checks = 0;
function test(fn) { fn(); ++checks; }
for (const variant of HARDWARE_MOD_ROMS) {
  test(() => assert.equal(isPlayable(variant.model, variant.preset), true));
  test(() => assert.equal(setupHash(variant.preset), variant.hash));
  for (let model = 1; model <= capacities.length; ++model) if (model !== variant.model)
    test(() => assert.equal(isPlayable(model, variant.preset), false));
  const operations = [], core = new Proxy({}, { get:(_, name) => (...args) => { operations.push([name,...args]); return 0; } });
  applySetup(core, variant.model, variant.preset);
  test(() => assert(operations.some(([name, part]) => name === 'nor_select' && part === variant.nor)));
}
for (const model of [undefined, null, 0, 8, '7'])
  test(() => assert.equal(isPlayable(model, 'unknown-preset'), false));
test(() => assert.equal(isPlayable(undefined, undefined), false));
test(() => assert.equal(transferCapabilities(7, 'usb').get, true));
test(() => assert.equal(transferCapabilities(7, 'serial').get, false));
for (const marker of ['KINPOHP39G+IMAGE', 'KINPOHP40G+IMAGE', 'KINPOHP48GIIMAGE', 'KINPOUPDATEIMAGE']) {
  const data = Buffer.alloc(64); data.write(marker);
  test(() => assert.equal(inspectInput(data).kind, 'firmware-update'));
  test(() => assert.equal(inspectInput(data).plausible_arm_vector, false));
  test(() => assert.throws(() => prepareInput(1, data, 'full-nor')));
  for (let i = 0; i < 16; ++i) data[i] |= 128;
  test(() => assert.equal(inspectInput(data).kind, 'unidentified'));
}
// Generated payloads exercise real container boundaries without HP ROM bytes.
function updater(marker = 'KINPOHP48GIIMAGE', length = 40, tail = 16) {
  const data = Buffer.alloc(24 + length + tail, 0xa5); data.write(marker);
  data.writeUInt32LE(length, 16); data.writeUInt32LE(length * 0xa5, 20);
  return data;
}
function donor(marker = 'KINPOHP48GIIMAGE', size = 0x200000) {
  const data = Buffer.alloc(size, 0x5a); data.writeUInt32LE(0xea000006);
  data.write(marker, 0x100); data.write('Kinposhcopyright', 0x4000); return data;
}
const upgrade = updater(), base = donor(), baseBefore = Buffer.from(base), updateBefore = Buffer.from(upgrade);
const installed = prepareFirmwareUpdate(4, base, upgrade);
test(() => assert.equal(inspectInput(upgrade).update.valid, true));
test(() => assert.equal(inspectInput(upgrade).update.trailing_bytes, 16));
test(() => assert.equal(inspectInput(upgrade).update.checksum_scope, 'native-region-only'));
test(() => assert.equal(installed.input_kind, 'locally-installed-firmware-update'));
test(() => assert.equal(installed.construction.reconstructed_full_dump, false));
test(() => assert.equal(installed.construction.stock_model_verified, false));
test(() => assert.deepEqual(installed.image.subarray(0, 0x4000), base.subarray(0, 0x4000)));
test(() => assert.equal(installed.image.subarray(0x4000, 0x4010).toString(), 'Kinposhcopyright'));
test(() => assert.deepEqual(installed.image.subarray(0x4010, 0x4000 + upgrade.length), upgrade.subarray(16)));
test(() => assert.deepEqual(installed.image.subarray(0x4000 + upgrade.length), base.subarray(0x4000 + upgrade.length)));
test(() => assert.deepEqual(base, baseBefore));
test(() => assert.deepEqual(upgrade, updateBefore));
for (const [data, expected] of [
  [upgrade.subarray(0, 16), 'truncated-header'],
  [updater('KINPOHP48GIIMAGE', 0), 'empty-native-region'],
  [upgrade.subarray(0, 25), 'truncated-native-region'],
]) {
  test(() => assert.equal(inspectInput(data).update.error, expected));
  test(() => assert.throws(() => prepareFirmwareUpdate(4, base, data), /Invalid firmware updater/));
}
const corrupt = Buffer.from(upgrade); corrupt[24] ^= 1;
test(() => assert.equal(inspectInput(corrupt).update.error, 'native-checksum-mismatch'));
test(() => assert.throws(() => prepareFirmwareUpdate(4, base, corrupt), /checksum/));
const wrapped = Buffer.from(upgrade); wrapped.writeUInt32LE(0xffffffff, 16);
test(() => assert.equal(inspectInput(wrapped).update.error, 'truncated-native-region'));
// The historical checksum covers only ARM native code, not Saturn data/fonts.
const changedTail = Buffer.from(upgrade); changedTail[changedTail.length - 1] ^= 1;
test(() => assert.equal(inspectInput(changedTail).update.valid, true));
test(() => assert.notEqual(inspectInput(changedTail).sha256, inspectInput(upgrade).sha256));
test(() => assert.throws(() => prepareFirmwareUpdate(4, donor('KINPOHP39G+IMAGE'), upgrade), /target/));
const noInstalled = Buffer.from(base); noInstalled.fill(0xff, 0x4000, 0x4010);
test(() => assert.throws(() => prepareFirmwareUpdate(4, noInstalled, upgrade), /installed firmware/));
const tooLarge = updater('KINPOHP39G+IMAGE', 0xfc000, 1);
test(() => assert.throws(() => prepareFirmwareUpdate(2, donor('KINPOHP39G+IMAGE', 0x100000), tooLarge), /capacity/));
for (const marker of ['KINPOHP39G+IMAGE', 'KINPOHP40G+IMAGE', 'KINPOUPDATEIMAGE'])
  test(() => assert.doesNotThrow(() => prepareFirmwareUpdate(4, donor(marker), updater(marker))));
for (let id = 1; id <= capacities.length; ++id) {
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
  for (let wrong = 1; wrong <= capacities.length; ++wrong) if (wrong !== id)
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
  // Exercise the actual CLI's filesystem guarantees with self-authored input,
  // including the report-write failure after an image was newly created.
  const basePath=resolve(temp,'base.bin'),updatePath=resolve(temp,'update.bin');
  await writeFile(basePath,base);await writeFile(updatePath,upgrade);
  const install=(output,report)=>spawnSync(process.execPath,[
    fileURLToPath(new URL('../tools/install-firmware-update.mjs',import.meta.url)),
    'hp48gii',basePath,updatePath,output,report,
  ],{encoding:'utf8',timeout:10000});
  for(const [output,report] of [[basePath,resolve(temp,'report.json')],
    [updatePath,resolve(temp,'report.json')],[resolve(temp,'output.bin'),basePath]]){
    test(()=>assert.notEqual(install(output,report).status,0,'Input paths cannot be output destinations'));
  }
  assert.deepEqual(await readFile(basePath),baseBefore);++checks;
  assert.deepEqual(await readFile(updatePath),updateBefore);++checks;
  const existing=resolve(temp,'existing.bin'),sentinel=Buffer.from('Preserve existing user data.');
  await writeFile(existing,sentinel);
  test(()=>assert.notEqual(install(existing,resolve(temp,'never-created.json')).status,0));
  assert.deepEqual(await readFile(existing),sentinel);++checks;
  const rollback=resolve(temp,'rollback.bin');
  test(()=>assert.notEqual(install(rollback,existing).status,0));
  await assert.rejects(access(rollback),{code:'ENOENT'});++checks;
  assert.deepEqual(await readFile(existing),sentinel);++checks;
  const output=resolve(temp,'installed.bin'),report=resolve(temp,'installed.json');
  test(()=>assert.equal(install(output,report).status,0));
  assert.deepEqual(await readFile(output),installed.image);++checks;
  assert.equal(JSON.parse(await readFile(report,'utf8')).construction.boot_preserved,true);++checks;
} finally { await rm(temp, { recursive: true, force: true }); }
console.log(`ROM/probe tool checks: ${checks} passed (ROM-free)`);
