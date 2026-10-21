// SPDX-License-Identifier: MIT
// Local-only stock HP48gII UART0 round trip. No ROM, state or raw trace in git.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { HP48_ROM, applySetup } from '../web/hp48.js';
import { decodeSession } from '../web/session.js';

const BASELINE_WASM = '76db5cb395cca4fffec807a76d3e969bf4cd73842662e39e81e38de4110527d0';
const args = process.argv.slice(2);
if (args.length < 5 || args.length > 6) {
  console.error('Usage: node tools/probe-stock-serial.mjs BASELINE.wasm HP48GII.bin HOME.ord|SERVER.checkpoint OBJECT.hp NEW-OUTPUT-DIRECTORY [FILE-TRANSFER.js]');
  process.exit(64);
}
const [wasmPath, romPath, checkpointPath, payloadPath, outputPath, moduleArg] = args;
const modulePath = resolve(moduleArg ?? fileURLToPath(new URL('../web/file-transfer.js', import.meta.url)));
const kermitPath = resolve(dirname(modulePath), 'kermit.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [wasm, rom, savedInput, payload, transferCode, kermitCode] = await Promise.all(
  [wasmPath, romPath, checkpointPath, payloadPath, modulePath, kermitPath].map(path => readFile(path)));
if (hash(wasm) !== BASELINE_WASM || hash(rom) !== HP48_ROM) throw new Error('The baseline WASM and admitted stock HP48gII ROM are required.');
const fromHome = savedInput.subarray(0, 8).equals(Buffer.from('ORCHARD1'));
let checkpoint = savedInput;
if (fromHome) {
  const saved = await decodeSession(savedInput.buffer.slice(savedInput.byteOffset, savedInput.byteOffset + savedInput.length));
  if (saved.model !== 4 || saved.romHash !== HP48_ROM || saved.preset !== 'hp48-home') throw new Error('The HOME session identity does not match.');
  checkpoint = saved.state;
}
const { FileTransfer, validateUpload } = await import(pathToFileURL(modulePath));
const { PacketReader } = await import(pathToFileURL(kermitPath));
validateUpload(4, 'OR13S', payload);
await mkdir(outputPath); // New directory only: retain every prior diagnostic.
const { instance: { exports: core } } = await WebAssembly.instantiate(wasm, {});
core.create(4);
new Uint8Array(core.memory.buffer, core.rom_buffer(), rom.length).set(rom);
if (core.load(rom.length)) throw new Error('Cannot load ROM.');
applySetup(core, 4, 'hp48-home');
new Uint8Array(core.memory.buffer, core.checkpoint_buffer(), checkpoint.length).set(checkpoint);
if (core.checkpoint_load(checkpoint.length)) throw new Error('Cannot restore checkpoint.');
const state = () => Array.from(new Uint32Array(core.memory.buffer, core.snapshot(), 33));
const initial = state();
let tick = initial[22] + initial[23] * 2 ** 32;
const report = { schema: 'orchard-stock-serial-roundtrip-v1', transport: 'uart0', model: 4,
  setup: 'hp48-home', wasm_sha256: hash(wasm), rom_sha256: hash(rom), checkpoint_sha256: hash(checkpoint),
  input_state_sha256: hash(savedInput), input_kind: fromHome ? 'home-session' : 'server-checkpoint',
  payload_sha256: hash(payload), file_transfer_sha256: hash(transferCode), kermit_sha256: hash(kermitCode),
  initial_tick: tick, keys: [], stages: [], packets: [], transfer: [], files: [], passed: false,
  payload_executed: false, physical_serial_validated: false };
const readers = { in: new PacketReader(), out: new PacketReader() };
const received = [];
const transfer = new FileTransfer({ core, usb: null, model: 4, notify: event => {
  if (event.type === 'file-transfer-received') received.push({ name: event.name, bytes: event.bytes.slice() });
  else {
    report.transfer.push({ tick, ...event });
    console.log('TRANSFER', JSON.stringify(event));
  }
} });
function trace(direction, bytes) {
  for (const packet of readers[direction].feed(bytes)) report.packets.push({ tick, direction,
    ...(packet.error ? { error: packet.error } : { sequence: packet.sequence, type: packet.type, data_bytes: packet.data.length }) });
}
const originalWrite = transfer.write.bind(transfer);
transfer.write = bytes => {
  const accepted = originalWrite(bytes);
  if (accepted) trace('out', bytes.subarray(0, accepted));
  return accepted;
};
function run(quanta, stop = () => false) {
  const until = tick + quanta;
  while (tick < until && !stop()) {
    const count = Math.min(1024, until - tick), status = core.run(count);
    if (status) throw new Error(`Guest stopped: status ${status}, reason ${state()[28]}.`);
    tick += count;
    const length = core.uart_receive();
    if (length) {
      const bytes = new Uint8Array(core.memory.buffer, core.uart_output(), length).slice();
      trace('in', bytes);
      transfer.receiveUart(bytes, tick);
    }
    if (transfer.pending) transfer.poll(tick);
  }
}
let previousScan = -1;
function key(scan, down) {
  const result = scan < 56 ? core.keyboard_matrix(Math.floor(scan / 7), scan % 7, +down)
    : core.keyboard_dedicated([0, 4, 5, 6][scan - 56], +down);
  if (result) throw new Error(`Physical key rejected: ${scan}.`);
  report.keys.push({ tick, scan, down });
}
function tap(scan) {
  if (scan === previousScan) run(2000000);
  previousScan = scan;
  key(scan, true); run(600000); key(scan, false); run(360000);
}
async function picture(name) {
  if (core.frame_view(1)) throw new Error('Cannot read LCD frame.');
  const pixels = new Uint8Array(core.memory.buffer, core.frame_buffer(), 131 * 64).slice();
  const pgm = Buffer.concat([Buffer.from('P5\n131 64\n255\n'), Buffer.from(pixels.map(value => 255 - value))]);
  await writeFile(resolve(outputPath, name + '.pgm'), pgm, { flag: 'wx' });
  report.stages.push({ name, tick, frame_sha256: hash(pixels), diagnostic_stop: state()[28] });
  console.log('STAGE', name, tick);
}

try {
  if (!fromHome) {
    await picture('initial-server');
    if (core.usb_connect(0)) throw new Error('Cannot detach prior virtual USB host.');
    tap(56); run(2000000);
  }
  await picture('home');
  // HP AUR C-2 and C-5: wire, serial rather than USB, binary Kermit objects.
  for (const [name, scans] of [
    ['cf33', [57, 37, 57, 40, 58, 4, 12, 12, 23, 45]],
    ['sf78', [57, 15, 57, 40, 58, 4, 24, 17, 23, 45]],
    ['sf35', [57, 15, 57, 40, 58, 4, 12, 18, 23, 45]]
  ]) {
    for (const scan of scans) tap(scan);
    await picture(name + '-entry'); tap(6); run(2000000); await picture(name + '-result');
  }
  for (const scan of [57, 15, 57, 39, 57, 22, 57, 30, 57, 39, 57, 22, 6]) tap(scan);
  run(4000000); await picture('serial-server');
  const length = core.checkpoint_size();
  if (core.checkpoint_save()) throw new Error('Cannot save the diagnostic serial checkpoint.');
  await writeFile(resolve(outputPath, 'serial-ready.checkpoint'),
    new Uint8Array(core.memory.buffer, core.checkpoint_buffer(), length).slice(), { flag: 'wx' });
  transfer.start({ request: 1, mode: 'send', transport: 'serial', name: 'OR13S', bytes: payload }, tick);
  run(360000000, () => !transfer.active); await picture('sent');
  if (transfer.session.phase !== 'complete') throw new Error(`Send did not complete: ${transfer.session.phase}.`);
  const storedName = transfer.session.name;
  run(1000000);
  transfer.start({ request: 2, mode: 'get', transport: 'serial', name: storedName }, tick);
  run(360000000, () => !transfer.active); await picture('retrieved');
  if (transfer.session.phase !== 'complete') throw new Error(`GET did not complete: ${transfer.session.phase}.`);
  for (const [index, file] of received.entries()) {
    const data = Buffer.from(file.bytes), wholeEqual = data.equals(payload), bodyEqual = data.subarray(8).equals(payload.subarray(8));
    const normalized = data.length === payload.length && data.subarray(0, 7).equals(payload.subarray(0, 7)) &&
      payload.subarray(0, 8).equals(Buffer.from('HPHP49-C')) && data[7] === 66 && bodyEqual;
    report.files.push({ name: file.name, bytes: data.length, sha256: hash(data),
      whole_file_equal: wholeEqual, object_payload_equal: bodyEqual, header_c_to_b: normalized,
      object_payload_sha256: hash(data.subarray(8)) });
    await writeFile(resolve(outputPath, `received-${index + 1}.hp`), data, { flag: 'wx' });
  }
  report.passed = report.files.length === 1 && (report.files[0].whole_file_equal || report.files[0].header_c_to_b);
  if (!report.passed) throw new Error('Returned file is not byte-identical modulo the explicit HPHP49-C to -B revision.');
} catch (error) {
  report.error = error.message; report.passed = false;
  console.log('ERROR', error.message); await picture('failure');
}
const finalTransfer = await readFile(modulePath), finalKermit = await readFile(kermitPath);
report.protocol_sources_unchanged = hash(finalTransfer) === report.file_transfer_sha256 && hash(finalKermit) === report.kermit_sha256;
if (!report.protocol_sources_unchanged) { report.passed = false; report.error = 'Protocol source files changed during the experiment.'; }
report.final_tick = tick; report.final_state = state();
await writeFile(resolve(outputPath, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log('FINAL', JSON.stringify({ passed: report.passed, error: report.error, files: report.files,
  packets: report.packets.length, protocol_sources_unchanged: report.protocol_sources_unchanged }));
if (!report.passed) process.exitCode = 1;
