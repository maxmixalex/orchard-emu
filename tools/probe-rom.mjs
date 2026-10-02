// SPDX-License-Identifier: MIT
// Local NOR/boot-region comparison with explicit provenance and external stimuli.
import assert from 'node:assert/strict';
import { models as names, prepareInput, parseGpio, readFirmware, sha256 as sha } from './rom-inputs.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!['--model', '--rom', '--bootloader', '--gpio-input', '--keyboard', '--nor-device', '--ticks', '--output'].includes(key) || !args[i + 1] || key in options)
    throw new Error('Usage: node tools/probe-rom.mjs --model SLUG (--rom FULL-NOR | --bootloader NATIVE-BOOT.bin) [--gpio-input D:cc7f:0,G:f801:f800] [--keyboard apples] [--nor-device sst39vf1601] [--ticks 1000000] [--output NEW.json]');
  options[key] = args[i + 1];
}
const id = names.indexOf(options['--model']) + 1;
if (!id || Boolean(options['--rom']) === Boolean(options['--bootloader']))
  throw new Error('Specify a known model and exactly one of --rom or --bootloader');
const stimuli = parseGpio(options['--gpio-input']);
const keyboard = options['--keyboard'] ?? 'detached';
const norDevice = options['--nor-device'] ?? 'unspecified';
if (options['--keyboard'] && keyboard !== 'apples') throw new Error('Expected --keyboard apples');
if (options['--nor-device'] && norDevice !== 'sst39vf1601') throw new Error('Expected --nor-device sst39vf1601');
const hardwareArgs = [
  ...(keyboard === 'apples' ? ['--keyboard', keyboard] : []),
  ...(norDevice === 'sst39vf1601' ? ['--nor-device', norDevice] : []),
];
const textBudget = options['--ticks'] ?? '1000000', budget = Number(textBudget);
if (!/^\d+$/.test(textBudget) || !Number.isSafeInteger(budget) || budget < 1 || budget > 10000000)
  throw new Error('Tick budget must be an integer between 1 and 10000000');
let romPath = resolve(options['--rom'] ?? options['--bootloader']);
const original = await readFirmware(romPath);
const prepared = prepareInput(id, original, options['--rom'] ? 'full-nor' : 'bootloader');
const rom = prepared.image, wasm = await readFile(resolve(root, 'dist/orchard.wasm'));
const inputHash = sha(rom);
const { instance: { exports: c } } = await WebAssembly.instantiate(wasm, {});
assert.equal(c.create(id), 0);
assert.equal(rom.length, c.profile(id, 0), 'Expected a full physical NOR, not an updater');
new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
assert.equal(c.load(rom.length), 0, 'Full-NOR loader rejected the input');
const hex = n => n.toString(16).padStart(8, '0');
const u64 = (s, i) => ((BigInt(s[i + 1]) << 32n) | BigInt(s[i])).toString();
const nativeExe = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build', process.platform === 'win32' ? 'orchard.exe' : 'orchard');
const dir = await mkdtemp(resolve(tmpdir(), 'orchard-nor-'));
try {
  // Both hosts consume the same immutable local snapshot, not a path that
  // could change between hashing and the native runs. Full dumps stay byte-exact.
  romPath = resolve(dir, 'physical-image.bin');
  await writeFile(romPath, rom, { flag: 'wx' });
  async function nativeRun(index) {
    const frame = resolve(dir, `frame-${index}.pgm`), uart = resolve(dir, `uart-${index}.out`);
    const process = spawnSync(nativeExe, ['run', '--model', names[id - 1], '--rom', romPath,
      '--ticks', String(budget), '--frame', frame, '--uart-out', uart,
      ...hardwareArgs, ...stimuli.flatMap(s => ['--gpio-input', s.cli])],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    if (process.error) throw process.error;
    assert([0, 2].includes(process.status), `CLI failed: ${process.stderr}`);
    const state = JSON.parse(process.stdout);
    assert.equal(state.boot_verified, false);
    let pixels = null;
    if (!state.frame_status) {
      const pgm = await readFile(frame);
      const header = Buffer.from(`P5\n${c.profile(id, 2)} ${c.profile(id, 3)}\n255\n`);
      assert.deepEqual(pgm.subarray(0, header.length), header);
      pixels = pgm.subarray(header.length).map(n => 255 - n);
    }
    return { state, pixels, uart: await readFile(uart) };
  }
  function wasmRun() {
    assert.equal(c.nor_select(norDevice === 'sst39vf1601' ? 1 : 0), 0, 'NOR part incompatible with capacity');
    assert.equal(c.keyboard_attach(keyboard === 'apples' ? 1 : 0), 0);
    for (const s of stimuli) assert.equal(c.gpio_inputs(s.port, s.known, s.levels), 0);
    let status = 0;
    const uart = [];
    for (let spent = 0; spent < budget && !status; spent += 256) {
      status = c.run(Math.min(256, budget - spent));
      const n = c.uart_receive();
      if (n) uart.push(Buffer.from(new Uint8Array(c.memory.buffer, c.uart_output(), n)));
    }
    const words = [...new Uint32Array(c.memory.buffer, c.snapshot(), 33)];
    const frameStatus = c.frame();
    const pixels = frameStatus ? null : Buffer.from(new Uint8Array(c.memory.buffer,
      c.frame_buffer(), c.profile(id, 2) * c.profile(id, 3)));
    return { words, frameStatus, pixels, uart: Buffer.concat(uart) };
  }
  const n = await nativeRun(0), w = wasmRun(), s = w.words;
  assert.deepEqual(n, await nativeRun(1), 'Native cold replay differs');
  c.reset();
  assert.deepEqual(w, wasmRun(), 'WASM cold replay differs');
  assert.equal(n.state.keyboard, keyboard);
  assert.equal(n.state.nor_device, norDevice);
  assert.deepEqual(n.state.gpio_inputs, stimuli.map(s => ({ port: s.name, known_mask: hex(s.known), levels: hex(s.levels) })));
  assert.deepEqual(n.state.registers, s.slice(0, 16).map(hex));
  assert.equal(n.state.cpsr, hex(s[16]));
  assert.equal(n.state.cp15_control, hex(s[17]));
  assert.equal(n.state.fault_status, hex(s[18]));
  assert.equal(n.state.fault_address, hex(s[19]));
  assert.equal(n.state.instructions, u64(s, 20));
  assert.equal(n.state.ticks, u64(s, 22));
  assert.equal(n.state.exceptions, u64(s, 24));
  assert.equal(n.state.sleeping, Boolean(s[26]));
  assert.equal(n.state.stop.code, s[28]);
  for (const [key, index] of [['pc', 29], ['instruction', 30], ['address', 31], ['detail', 32]])
    assert.equal(n.state.stop[key], hex(s[index]));
  assert.equal(n.state.frame_status, w.frameStatus);
  assert.deepEqual(n.pixels, w.pixels); assert.deepEqual(n.uart, w.uart);
  const report = { schema: 'orchard-nor-probe-v3', model: names[id - 1], input_bytes: rom.length,
    input_sha256: inputHash, identified_fixture: prepared.source.identified_fixture, input_kind: prepared.input_kind,
    source_input: prepared.source, construction: prepared.construction,
    keyboard, nor_device: norDevice,
    gpio_inputs: stimuli.map(s => ({ port: s.name, known_mask: hex(s.known), levels: hex(s.levels) })),
    native_binary_sha256: sha(await readFile(nativeExe)), wasm_sha256: sha(wasm), budget,
    native_wasm_equal: true, native_replay_equal: true, wasm_replay_equal: true,
    boot_verified: false, frame_sha256: w.pixels ? sha(w.pixels) : null,
    nonzero_pixels: w.pixels ? w.pixels.reduce((n, p) => n + Number(p !== 0), 0) : null,
    uart_bytes: w.uart.length, uart_sha256: sha(w.uart), result: n.state };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (options['--output']) await writeFile(resolve(options['--output']), output, { flag: 'wx' });
  console.log(output.trimEnd());
} finally { await rm(dir, { recursive: true, force: true }); }
