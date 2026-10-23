// SPDX-License-Identifier: MIT
// Reproducible, ROM-free native/WASM checks. Uses only generated guest bytes.
import assert from 'node:assert/strict';
import { checkUSB } from '../tests/usb-wasm.mjs';
import { checkPeripherals } from '../tests/peripheral-wasm.mjs';
import { checkLCDResearch } from '../tests/lcd-research.mjs';
import { checkCircuit } from '../tests/circuit-wasm.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build');
const suffix = process.platform === 'win32' ? '.exe' : '';
function command(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
await mkdir(build, { recursive: true });
function compileRegression(name, testModule, extraFlags = []) {
  command(process.env.CLANG || 'clang', [
    '--target=wasm32', '-std=c17', '-O3', '-flto', '-mbulk-memory', '-ffreestanding', '-nostdlib', '-fno-builtin',
    '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-Iinclude', '-Isrc', ...extraFlags,
    ...['machine', 'cpu', 'thumb', 'mmu', 'bus', 'soc', 'checkpoint', 'scheduler', 'watchdog', 'gpio', 'interrupt', 'rtc', 'keyboard', 'nor', 'sram', 'lcd', 'adc', 'usb', 'sdi', 'buzzer'].map(s => `src/${s}.c`),
    `tests/${name}.c`, '-o', testModule, '-Wl,--no-entry', '-Wl,--stack-first',
    '-Wl,-z,stack-size=524288', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216',
  ]);
}
let totalAssertions = 0, physicalReadAssertions = 0;
for (const name of ['regression', 'lcd-input', 'lcd-adc', 'usb', 'sdi', 'buzzer', 'power', 'nor-bus', 'physical-read', 'memory', 'segments-nor', 'performance', 'execution', 'cpu-transactions', 'scheduler', 'checkpoint']) {
  const testModule = resolve(build, `${name}.wasm`);
  compileRegression(name, testModule);
  const { instance: { exports: test } } = await WebAssembly.instantiate(await readFile(testModule), {});
  const native = JSON.parse(command(resolve(build, `orchard-${name}${suffix}`), []));
  assert.equal(test.regression(), 0, `WASM regression failed at C line ${test.first_failure()}`);
  assert.equal(test.checks(), native.checks, 'Native and WASM must execute the same assertions');
  assert.equal(native.failures, 0);
  console.log(`${name}: ${native.checks} assertions pass on native and WASM`);
  totalAssertions += native.checks;
  if (name === 'physical-read') physicalReadAssertions = native.checks;
}
console.log(`Combined default core regression: ${totalAssertions} assertions on each host`);

// Keep the quarantined array-read experiment covered without selecting it in
// the default application or including a second WASM run in the per-host total.
const experimentalPhysicalReadModule = resolve(build, 'physical-read-experimental.wasm');
compileRegression('physical-read', experimentalPhysicalReadModule, ['-DORCHARD_EXPERIMENTAL_PHYSICAL_READS=1']);
const { instance: { exports: experimentalPhysicalRead } } = await WebAssembly.instantiate(await readFile(experimentalPhysicalReadModule), {});
assert.equal(experimentalPhysicalRead.regression(), 0, `Experimental physical-read regression failed at C line ${experimentalPhysicalRead.first_failure()}`);
assert.equal(experimentalPhysicalRead.checks(), physicalReadAssertions, 'The experimental WASM must execute the same physical-read assertions');
console.log(`Experimental physical-read regression: ${physicalReadAssertions} additional WASM-only assertions pass (excluded from the default per-host total)`);

// Minimal independent guest: reset -> MMIO -> ARM/Thumb/BX PC -> SWI -> WFI.
// This fixture is generated in a temporary directory and is never packaged.
function syntheticNor(size, height) {
  const rom = Buffer.alloc(size, 0xff);
  rom.writeUInt32LE(0xea000006, 0); // B 0x20
  rom.writeUInt32LE(0xe1b0f00e, 8); // SWI vector: MOVS PC,LR
  let pc = 0x20;
  const literals = [];
  function word(value) { rom.writeUInt32LE(value >>> 0, pc); pc += 4; }
  function load(rd, value) { literals.push({ at: pc, rd, value }); word(0); }
  function reg(address, value) { load(0, address); load(1, value); word(0xe5801000); }
  reg(0x53000000, 0); // Disable watchdog in guest, not in the host.
  load(0, 0x50000000); word(0xe3a0104f); word(0xe5c01020); // UART 'O'
  word(0xe5d01024); word(0xe5c01020); // echo host byte
  reg(0x08001000, 0xa55a00ff);
  reg(0x4d000004, (height - 1) << 14);
  reg(0x4d000014, 0x08001000 >>> 1);
  reg(0x4d000018, ((0x08001000 + 18 * height) >>> 1) & 0x1fffff);
  reg(0x4d00001c, 9);
  reg(0x4d000010, 2); // BSWP: bytes stored in ascending address order
  reg(0x4d000000, 0x221); // 1bpp single-scan STN framebuffer
  reg(0x56000030, 0); // Explicit input-mode test, not inferred board wiring.
  load(0, 0x56000034); word(0xe5907000); // LDR r7,[r0]
  const targetLiteral = literals.length;
  load(0, 0); word(0xe12fff10); // BX r0
  literals[targetLiteral].value = pc | 1;
  rom.writeUInt16LE(0x2407, pc); pc += 2; // MOVS r4,#7
  rom.writeUInt16LE(0x3401, pc); pc += 2; // ADDS r4,#1
  rom.writeUInt16LE(0x4778, pc); pc += 2; // word-aligned BX PC
  rom.writeUInt16LE(0x46c0, pc); pc += 2; // skipped Thumb padding
  word(0xef000000); // SWI
  word(0xee070f90); // MCR p15,0,r0,c7,c0,4: WFI
  const sleepPc = pc;
  word(0xeafffffe);
  for (const { at, rd, value } of literals) {
    const offset = pc - at - 8;
    assert(offset >= 0 && offset <= 4095);
    rom.writeUInt32LE((0xe59f0000 | (rd << 12) | offset) >>> 0, at);
    word(value);
  }
  return { rom, sleepPc };
}
const dir = await mkdtemp(resolve(tmpdir(), 'orchard-regression-'));
try {
  const { instance: { exports: c } } = await WebAssembly.instantiate(await readFile(resolve(root, 'dist/orchard.wasm')), {});
  const names = ['hp39gplus', 'hp39gs', 'hp40gs', 'hp48gii', 'hp49gplus', 'hp50g'];
  for (let id = 1; id <= 6; ++id) {
    assert.equal(c.create(id), 0);
    const size = c.profile(id, 0), width = c.profile(id, 2), height = c.profile(id, 3);
    const { rom, sleepPc } = syntheticNor(size, height);
    const input = resolve(dir, `${id}.bin`), uartIn = resolve(dir, `${id}.in`);
    const uartOut = resolve(dir, `${id}.out`), frame = resolve(dir, `${id}.pgm`);
    await writeFile(input, rom); await writeFile(uartIn, Buffer.from('!'));
    const run = JSON.parse(command(resolve(build, `orchard${suffix}`), [
      'run', '--model', names[id - 1], '--rom', input, '--ticks', '1000',
      '--uart-in', uartIn, '--uart-out', uartOut, '--frame', frame, '--gpio-input', 'D:ffff:5aa5',
    ]));
    assert.equal(run.boot_verified, false);
    assert.equal(run.status, 'budget-exhausted');
    assert.equal(run.sleeping, true); assert.equal(run.exceptions, '1');
    assert.equal(parseInt(run.pc, 16), sleepPc);
    assert.equal((await readFile(uartOut)).toString(), 'O!');
    new Uint8Array(c.memory.buffer, c.rom_buffer(), size).set(rom);
    assert.equal(c.load(size), 0);
    function execute() {
      assert.equal(c.gpio_inputs(3, 0xffff, 0x5aa5), 0);
      new Uint8Array(c.memory.buffer, c.uart_input(), 1)[0] = 33;
      assert.equal(c.uart_send(1), 1);
      assert.equal(c.run(1000), 0);
      const state = new Uint32Array(c.memory.buffer, c.snapshot(), 33).slice();
      assert.equal(state[7], 0x5aa5); assert.equal(state[4], 8); assert.equal(state[15], sleepPc);
      assert.equal(state[16], parseInt(run.cpsr, 16));
      assert.equal(state[20], Number(run.instructions)); assert.equal(state[22], 1000);
      assert.equal(state[24], 1); assert.equal(state[26], 1);
      const count = c.uart_receive();
      assert.equal(Buffer.from(c.memory.buffer, c.uart_output(), count).toString(), 'O!');
      assert.equal(c.frame(), 0);
      const pixels = Buffer.from(new Uint8Array(c.memory.buffer, c.frame_buffer(), width * height));
      return { state: [...state], pixels };
    }
    const first = execute();
    assert(first.pixels.some(byte => byte !== 0), 'Synthetic LCD must not be a blank equivalence');
    const pgm = await readFile(frame), header = Buffer.from(`P5\n${width} ${height}\n255\n`);
    assert.deepEqual(pgm.subarray(0, header.length), header);
    assert.deepEqual(pgm.subarray(header.length), first.pixels.map(byte => 255 - byte));
    if (id === 1) {
      const invalid = ['', 'A:0:0', 'I:0:0', 'D:10000:0', 'F:100:0', 'D:1:2', 'D:-1:0', 'D: 1:0',
        'D:0x1:0', 'D:1:', 'D:1:0junk', 'D:fffffffff:0', 'D:1:000000000'];
      for (const value of invalid) {
        const result = spawnSync(resolve(build, `orchard${suffix}`), ['run', '--model', names[id - 1],
          '--rom', input, '--gpio-input', value], { encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error); assert.equal(result.status, 64, `Invalid GPIO accepted: ${value}`);
      }
      const duplicate = spawnSync(resolve(build, `orchard${suffix}`), ['run', '--model', names[id - 1],
        '--rom', input, '--gpio-input', 'D:1:0', '--gpio-input', 'D:1:1'], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(duplicate.error); assert.equal(duplicate.status, 64);
    }
    c.reset();
    assert.deepEqual(execute(), first, 'Cold reset and identical input must replay identically');
    console.log(`${names[id - 1]}: synthetic reset/MMIO/ARM/Thumb/SWI/GPIO/UART/LCD/WFI native=WASM, replay OK`);
  }
} finally { await rm(dir, { recursive: true, force: true }); }

await checkCircuit(root, build);

await checkLCDResearch(root, build);

await checkPeripherals(root, build);

await checkUSB(root, build);

const { checkUSBControl } = await import("../tests/usb-control.mjs");
await checkUSBControl(root, build);

const { checkNorBus } = await import('../tests/nor-wasm.mjs');
await checkNorBus(root, build);
await import("../tests/memory-tools.mjs");
