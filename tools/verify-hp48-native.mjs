// SPDX-License-Identifier: MIT
// Stock-OS installation and execution of an external, unchanged HP-GCC example.
// Private ROMs, SDK objects, checkpoints and pictures stay in the caller's
// local output directory. This tool contains no third-party calculator code.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HP48_ROM, applySetup} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';
import {FileTransfer} from '../web/file-transfer.js';
import {readFirmware, sha256} from './rom-inputs.mjs';

const usage = 'Usage: node tools/verify-hp48-native.mjs FULL-48GII-NOR.bin HPGCC-SDK-DIRECTORY NEW-OUTPUT-DIRECTORY';
if (process.argv.length === 3 && process.argv[2] === '--help') {
  console.log(usage + '\nCold boots the admitted private ROM, installs the unmodified SDK Library 275 in RAM port 0 over virtual USB,\nruns template/main.hp through stock ARMToolbox, returns with ON, calculates 1+1, and checks USB after return.\nRequires the pinned patched-hpgcc-1.1-sdk-for-hp39gs SDK; no firmware or SDK files are downloaded.');
  process.exit(0);
}
if (process.argv.length !== 5) throw new Error(usage);
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = resolve(process.argv[3]), output = resolve(process.argv[4]);
const romPath = resolve(process.argv[2]);
const wasmPath = process.env.ORCHARD_WASM || resolve(root, 'dist/orchard.wasm');
const [rom, wasm, library, program] = await Promise.all([
  readFirmware(romPath), readFile(wasmPath),
  readFile(resolve(sdk, 'L275_48.LIB')), readFile(resolve(sdk, 'template/main.hp')),
]);
assert.equal(sha256(rom), HP48_ROM, 'Requires the admitted complete HP48gII original NOR');
assert.equal(sha256(library), '9469877dbc9791f2d87993fc596d6c34c966cc91a9bbc99e63b43cacdadba188', 'Unexpected ARMToolbox fixture');
assert.equal(sha256(program), '423be27dbfa7f12f5645b666c0d389da28b1bfd9424813d00981601ce099248b', 'Unexpected HP-GCC example fixture');
await mkdir(output); // Never overwrite earlier evidence or another user's files.
const {instance: {exports: c}} = await WebAssembly.instantiate(wasm, {});
assert.equal(c.create(4), 0);
new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
assert.equal(c.load(rom.length), 0);
applySetup(c, 4, 'hp48-home');

const report = {
  schema: 'orchard-hp48-native-stock-v1', model: 4, preset: 'hp48-home',
  rom_sha256: HP48_ROM, wasm_sha256: sha256(wasm),
  tool_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  host_modules_sha256: Object.fromEntries(await Promise.all(
    ['hp48.js', 'virtual-usb.js', 'file-transfer.js', 'kermit.js'].map(async name =>
      [name, sha256(await readFile(resolve(root, 'web', name)))]))),
  execution_host: 'Node, production WASM and production virtual USB/Kermit modules',
  production_worker: false,
  cold_boot: true, physical_key_launch: true, guest_memory_patched: false,
  canonical_hardware_boot: false, frame_view: 'packed-lsb',
  original_programs_unchanged: true,
  expected_frames_visually_reviewed: true,
  sdk_source: 'https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2',
  library: {bytes: library.length, sha256: sha256(library), sdk_file: 'L275_48.LIB', destination: 'RAM port 0'},
  native_program: {bytes: program.length, sha256: sha256(program), sdk_file: 'template/main.hp'},
  keys: [], stages: [], transfers: [], usb_events: [], passed: false,
};
const state = () => Array.from(new Uint32Array(c.memory.buffer, c.snapshot(), 33));
// Independently viewed original-OS and original-program frames, including the
// greeting and the visible RPN result 2. Stale pixels with a zero host stop do
// not establish successful native execution or return.
const expectedFrames = {
  'wired-home': 'a3c5eb6d03253a32c0ad5a687502eaf6fec10e4ad1dc7c06e3904fb6c563faad',
  'installed': 'c21d63f6fde437f5bc38b32507043eaa1fbdf2c334aeeb4911d00406796f854a',
  'native-running': '0dca1d694e9f0fb347c10fafcab44b19f009cdca015d510235cd37a1955d188a',
  'returned-home': '5944f5eee52246376d0c05b8dd38917107b2965e4cf484474a79f58d31bf99e7',
  'one-plus-one': 'bbff9ce170d4414b382c8dfd4ba5bb7a822cc29e703000d4eed74f0a7953eb85',
  'final-home': 'bbff9ce170d4414b382c8dfd4ba5bb7a822cc29e703000d4eed74f0a7953eb85',
};
let tick = 0, previous = -1, request = 0, received = null;
const usb = new VirtualUSB(c, c.timebase_hz(), event => {
  report.usb_events.push({tick, ...event});
});
const transfer = new FileTransfer({core: c, usb, model: 4, notify: event => {
  if (event.type === 'file-transfer-received') received = event.bytes.slice();
}});
function run(n) {
  while (n) {
    const step = Math.min(1024, n);
    assert.equal(c.run(step), 0, JSON.stringify(state()));
    n -= step; tick += step;
    usb.poll(tick); transfer.poll(tick);
    assert.equal(c.uart_receive(), 0, 'Unexpected unsolicited UART data');
  }
}
function key(scan, down) {
  assert.equal(scan < 56 ? c.keyboard_matrix(Math.floor(scan / 7), scan % 7, +down) :
    c.keyboard_dedicated([0, 4, 5, 6][scan - 56], +down), 0);
  report.keys.push({tick, scan, down});
}
function tap(scan) {
  if (scan === previous) run(2000000);
  previous = scan;
  key(scan, true); run(1200000); key(scan, false); run(1200000);
}
const alphabet = [35, 36, 37, 38, 39, 40, 41, 46, 47, 48, 49, 50, 28, 21, 14, 7, 29, 22, 15, 8, 1, 30, 23, 16, 9, 2];
function type(text) {
  assert.match(text, /^[A-Z]+$/);
  for (const ch of text) { tap(57); tap(alphabet[ch.charCodeAt(0) - 65]); }
}
function command(text) { type(text); tap(6); run(5000000); }
async function picture(name) {
  assert.equal(c.frame_view(1), 0);
  const pixels = new Uint8Array(c.memory.buffer, c.frame_buffer(), 131 * 64).slice();
  const hash = sha256(pixels);
  await writeFile(resolve(output, name + '.pgm'), Buffer.concat([
    Buffer.from('P5\n131 64\n255\n'), Buffer.from(pixels.map(value => 255 - value)),
  ]), {flag: 'wx'});
  assert.equal(c.checkpoint_save(), 0);
  const checkpoint = new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), c.checkpoint_size()).slice();
  await writeFile(resolve(output, name + '.checkpoint'), checkpoint, {flag: 'wx'});
  report.stages.push({name, tick, frame_sha256: hash, checkpoint_sha256: sha256(checkpoint), stop: state()[28]});
  console.log(name, tick, hash);
  assert.equal(hash, expectedFrames[name], 'Stock LCD differs at ' + name);
}
function connect() {
  usb.start(tick);
  const deadline = tick + 120000000;
  while (usb.phase !== 'ready' && tick < deadline) {
    run(1024);
    assert(usb.connected, JSON.stringify(report.usb_events.at(-1)));
  }
  assert.equal(usb.phase, 'ready', 'Stock USB enumeration did not finish');
}
function operation(mode, name, bytes) {
  const start = tick;
  received = null;
  transfer.start({request: ++request, transport: 'usb', mode, name, bytes}, tick);
  const deadline = tick + 3600000000;
  while (transfer.active && tick < deadline) run(1024);
  assert.equal(transfer.session.phase, 'complete', JSON.stringify(transfer.lastProgress));
  report.transfers.push({mode, name, start_tick: start, end_tick: tick,
    transferred: transfer.session.transferred, sent_sha256: bytes ? sha256(bytes) : undefined,
    received_sha256: received ? sha256(received) : undefined});
  run(3000000); // Service the final ordinary ACK and the stock server's next wait.
  console.log('USB', mode, name || '', transfer.session.transferred);
  return received;
}
try {
  run(60000000); key(40, true); run(600000); key(40, false); run(59400000);
  key(40, true); run(600000); key(40, false); run(39400000);
  // CF(-33), CF(-78), SF(-35): wired, USB and binary. All input reaches the
  // original ROM through physical switches, exactly as in the ordinary UI.
  for (const scans of [[57, 37, 57, 40, 58, 4, 12, 12, 23, 45, 6],
    [57, 37, 57, 40, 58, 4, 24, 17, 23, 45, 6],
    [57, 15, 57, 40, 58, 4, 12, 18, 23, 45, 6]]) {
    for (const scan of scans) tap(scan);
    run(2000000);
  }
  await picture('wired-home');
  command('SERVER'); connect();
  operation('send', 'ARMTOOL', library);
  operation('send', 'ARMHELLO', program); // MAIN is reserved by this stock OS.
  // This ordinary User RPL file installs the already-uploaded library in RAM.
  // It neither writes guest memory from the host nor programs NOR flash.
  const installer = Buffer.from('%%HP: T(3)A(D)F(.);\n\\<< ARMTOOL 0 STO \\>>', 'ascii');
  operation('send', 'INSTALL', installer);
  operation('finish'); usb.disconnect(); transfer.resetUsb(tick); run(10000000);
  command('INSTALL'); run(15000000); await picture('installed');
  // Stock ON+F3 attaches the installed library. Use the SDK's documented RPN
  // launch route: ALG menu insertion alone does not supply PrRUN's argument.
  key(56, true); run(100000); key(37, true); run(1000000);
  key(37, false); key(56, false); run(30000000);
  for (const scan of [46, 23, 40]) { tap(scan); run(3000000); }
  command('ARMHELLO'); run(15000000);
  for (const scan of [59, 19, 35, 35]) { tap(scan); run(3000000); }
  await picture('native-running');
  report.native_program.visible_text = 'Hello From Lobakkang';
  report.native_program.execution_verified = true;
  tap(56); run(10000000); await picture('returned-home');
  for (const scan of [26, 6, 26, 5]) { tap(scan); run(3000000); }
  await picture('one-plus-one');
  report.native_return_verified = true;
  report.arithmetic_after_return_verified = true;
  command('SERVER'); connect();
  const returned = operation('get', 'ARMTOOL');
  // The admitted HP48gII ROM exports revision B even for a revision C input.
  // Check that exact original-OS header behavior separately from the object;
  // no other byte difference is accepted and neither guest input is changed.
  const exported = Buffer.from(returned);
  assert.equal(library.subarray(0, 8).toString('ascii'), 'HPHP49-C');
  assert.equal(exported.subarray(0, 8).toString('ascii'), 'HPHP49-B');
  assert.deepEqual(exported.subarray(8), library.subarray(8), 'USB GET after native return changed the library object');
  report.usb_after_return = {get_completed: true, bytes: returned.length,
    binary_file_byte_equal: false, object_payload_byte_equal: true,
    header_revision: {input: 'HPHP49-C', output: 'HPHP49-B', only_changed_byte: 7},
    exported_sha256: sha256(exported)};
  operation('finish'); usb.disconnect(); transfer.resetUsb(tick); run(10000000);
  await picture('final-home');
  report.sram_alias_reads = c.sram_alias_reads().toString();
  report.sram_alias_writes = c.sram_alias_writes().toString();
  assert.equal(report.sram_alias_reads, '1'); assert.equal(report.sram_alias_writes, '0');
  assert.equal(sha256(await readFirmware(romPath)), report.rom_sha256, 'ROM changed during acceptance');
  assert.equal(sha256(await readFile(wasmPath)), report.wasm_sha256, 'WASM changed during acceptance');
  assert.equal(sha256(await readFile(resolve(sdk, 'L275_48.LIB'))), report.library.sha256, 'Library changed during acceptance');
  assert.equal(sha256(await readFile(resolve(sdk, 'template/main.hp'))), report.native_program.sha256, 'Program changed during acceptance');
  report.application_results_verified = true;
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error.stack);
}
report.final_tick = tick; report.final_state = state();
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log('HP48 native ARM workflow', report.passed ? 'PASSED' : 'FAILED');
