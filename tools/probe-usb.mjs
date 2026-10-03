// SPDX-License-Identifier: MIT
// Explicit local original-bootloader EP0 probe. Ordinary CI uses a synthetic guest.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFirmware, prepareInput, sha256 } from './rom-inputs.mjs';
import { nativeSession, wasmSession, controlQueries } from './usb-session.mjs';
const args = process.argv.slice(2);
if (![2,4].includes(args.length) || args[0] !== '--bootloader' || (args.length === 4 && args[2] !== '--output'))
  throw new Error('Usage: node tools/probe-usb.mjs --bootloader ORIGINAL-HP50G-BOOT.bin [--output NEW-REPORT.json]');
const root = fileURLToPath(new URL('../', import.meta.url));
const build = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build');
const executable = resolve(build, process.platform === 'win32' ? 'orchard-usb-session.exe' : 'orchard-usb-session');
const prepared = prepareInput(6, await readFirmware(args[1]), 'bootloader');
const moduleBytes = await readFile(resolve(root, 'dist/orchard.wasm'));
const dir = await mkdtemp(resolve(tmpdir(), 'orchard-usb-research-'));
try {
  const input = resolve(dir, 'boot-only.bin'); await writeFile(input, prepared.image, { flag: 'wx' });
  const native = nativeSession(executable, input, 'recovery');
  const { instance: { exports: c } } = await WebAssembly.instantiate(moduleBytes, {});
  const wasm = wasmSession(c, prepared.image, 'recovery');
  assert.deepEqual(wasm, native); assert.deepEqual(nativeSession(executable,input,'recovery'),native);
  assert.deepEqual(wasmSession(c,prepared.image,'recovery'),wasm);
  assert.equal(wasm.replies[1], '12011001ff000008f0032101000101020001');
  assert.equal(wasm.replies[4], '0902200001010080190904000002ff0000000705810240000007050302400000');
  assert.equal(wasm.usb[8],7); assert.equal(wasm.usb[9],0); assert.equal(wasm.stop_code,0);
  const report = { schema: 'orchard-usb-control-v1', model: 'hp50g', source: prepared.source,
    input_kind: prepared.input_kind, construction: prepared.construction, backing_sha256: sha256(prepared.image),
    native_sha256: sha256(await readFile(executable)), wasm_sha256: sha256(moduleBytes),
    conditions: { keyboard: 'apples', strong_gpio: ['D:cc7f:0','G:1:0'], weak_gpio: ['G:f800:f800'],
      key_events: [[2000000,3,5,1],[2400000,3,5,0]], bus_reset: [3000000,3000500],
      packet_service_quanta: 1000, maximum_retries: 100, lcd_hypothesis: false },
    setup_packets: controlQueries.slice(0,6), result: wasm, native_wasm_equal: true, cold_replays_equal: true,
    boot_verified: false, get_configuration_verified: false, bulk_transfer_verified: false, host_os_enumeration: false };
  const text = JSON.stringify(report,null,2)+'\n';
  if (args.length === 4) await writeFile(args[3],text,{flag:'wx'}); else process.stdout.write(text);
  console.error('Original HP50g boot-only EP0 descriptor/address/configuration status replay: native=WASM, cold replay OK; no Bulk/OS enumeration claim');
} finally { await rm(dir, { recursive: true, force: true }); }
