// SPDX-License-Identifier: MIT
// Original ROM-free guest: runs from SRAM, identifies the selected NOR,
// samples the electrical keyboard and handles real emulated EINT IRQs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function circuitNor() {
  const rom = Buffer.alloc(0x200000, 0xff), ram = 0x08001000;
  const code = [], literals = [];
  const word = n => code.push(n >>> 0);
  function load(rd, value) { literals.push({ at: code.length, rd, value }); word(0); }
  function reg(address, value) { load(0, address); load(1, value); word(0xe5801000); }
  function read(address, rd, half = false) { load(0, address); word((half ? 0xe1d000b0 : 0xe5900000) | (rd << 12)); }
  function half(address, value) { load(0, address); load(1, value); word(0xe1c010b0); }
  reg(0x53000000, 0);
  half(0xaaaa, 0xaa); half(0x5554, 0x55); half(0xaaaa, 0x90);
  read(0, 4, true); read(2, 5, true); half(0x1fe, 0xf0); read(0, 9);
  reg(0x56000068, 1); reg(0x56000064, 0); reg(0x56000060, 0x5555aaa9);
  read(0x56000064, 6);
  reg(0x56000050, 0x2a02); reg(0x56000088, 0x06660006); reg(0x5600008c, 0x66666666);
  // Clear level-triggered events latched while the guest configured EINT.
  reg(0x560000a8, 0xffffff); reg(0x4a000000, 0xffffffff); reg(0x4a000010, 0xffffffff);
  reg(0x560000a4, ~0xfe70); reg(0x4a000008, ~0x31);
  word(0xe10f0000); word(0xe3c00080); word(0xe121f000); // unmask CPSR IRQ
  const wait = ram + code.length * 4;
  word(0xee070f90); word(0xeafffffd); // WFI, branch back to WFI after wake
  const handler = ram + code.length * 4;
  word(0xe28aa001); // ADD r10,r10,#1
  read(0x56000064, 7); read(0x56000054, 8);
  reg(0x560000a8, 0xffffff); reg(0x4a000000, 0xffffffff); reg(0x4a000010, 0xffffffff);
  word(0xe25ef004); // SUBS PC,LR,#4 restores SPSR and returns
  for (const { at, rd, value } of literals) {
    const offset = code.length * 4 - at * 4 - 8;
    assert(offset >= 0 && offset < 4096);
    code[at] = (0xe59f0000 | (rd << 12) | offset) >>> 0; word(value);
  }
  const boot = [0xe59f0018, 0xe59f1018, 0xe59f2018,
    0xe4903004, 0xe4813004, 0xe2522001, 0x1afffffb, 0xe59ff008,
    0x100, ram, code.length, ram];
  // Reset -> copied original synthetic payload in external SRAM.
  rom.writeUInt32LE(0xea00000e, 0); // B 0x40
  rom.writeUInt32LE(0xe59ff000, 0x18); rom.writeUInt32LE(handler, 0x20);
  boot.forEach((value, i) => rom.writeUInt32LE(value >>> 0, 0x40 + 4 * i));
  code.forEach((value, i) => rom.writeUInt32LE(value, 0x100 + i * 4));
  return { rom, wait };
}
export async function checkCircuit(root, build) {
  const { rom, wait } = circuitNor();
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-circuit-'));
  try {
    const input = resolve(dir, 'generated.bin'); await writeFile(input, rom, { flag: 'wx' });
    const cli = resolve(build, process.platform === 'win32' ? 'orchard.exe' : 'orchard');
    const args = ['run', '--model', 'hp50g', '--rom', input, '--ticks', '2000',
      '--keyboard', 'apples', '--nor-device', 'sst39vf1601', '--gpio-input', 'F:8e:0'];
    const native = spawnSync(cli, args, { encoding: 'utf8', timeout: 15000 });
    assert.ifError(native.error); assert.equal(native.status, 0, native.stdout + native.stderr);
    const state = JSON.parse(native.stdout);
    assert.equal(state.keyboard, 'apples'); assert.equal(state.nor_device, 'sst39vf1601');
    const { instance: { exports: c } } = await WebAssembly.instantiate(await readFile(resolve(root, 'dist/orchard.wasm')), {});
    assert.equal(c.create(6), 0);
    assert.equal(c.keyboard_attach(2), 1); assert.equal(c.nor_select(99), 1);
    assert.equal(c.keyboard_matrix(0, 0, 1), 1); // detached
    new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
    assert.equal(c.load(rom.length), 0);
    const snap = () => [...new Uint32Array(c.memory.buffer, c.snapshot(), 33)];
    function execute() {
      assert.equal(c.nor_select(1), 0); assert.equal(c.keyboard_attach(1), 0);
      assert.equal(c.gpio_inputs(5, 0x8e, 0), 0);
      assert.equal(c.keyboard_matrix(8, 0, 1), 1); assert.equal(c.keyboard_matrix(0, 7, 1), 1);
      assert.equal(c.keyboard_matrix(0, 0, 2), 1); assert.equal(c.keyboard_dedicated(7, 1), 1);
      assert.equal(c.run(2000), 0);
      const initial = snap();
      assert.deepEqual(initial.slice(0, 16), state.registers.map(x => parseInt(x, 16)));
      assert.equal(initial[16], parseInt(state.cpsr, 16));
      assert.equal(initial[20], Number(state.instructions)); assert.equal(initial[22], Number(state.ticks));
      assert.equal(initial[4], 0xbf); assert.equal(initial[5], 0x234b); assert.equal(initial[6] & 0xfe, 0xfe);
      assert.equal(initial[9], 0xea00000e); assert.equal(initial[10], 0);
      assert.equal(initial[15], wait + 4); assert.equal(initial[26], 1);
      assert.equal(c.keyboard_matrix(3, 2, 1), 0); assert.equal(c.run(256), 0);
      let s = snap(); assert.equal(s[10], 1); assert.equal(s[7] & 0xfe, 0xf6);
      assert.equal(s[24], 1); assert.equal(s[26], 1);
      assert.equal(c.keyboard_matrix(3, 2, 0), 0); assert.equal(c.run(256), 0);
      s = snap(); assert.equal(s[10], 2); assert.equal(s[7] & 0xfe, 0xfe); assert.equal(s[24], 2);
      assert.equal(c.keyboard_dedicated(0, 1), 0); assert.equal(c.run(256), 0);
      s = snap(); assert.equal(s[10], 3); assert.equal(s[8] & 0x71, 1); assert.equal(s[24], 3);
      assert.equal(c.keyboard_dedicated(0, 0), 0); assert.equal(c.run(256), 0);
      s = snap(); assert.equal(s[10], 4); assert.equal(s[8] & 0x71, 0); assert.equal(s[24], 4);
      assert.equal(s[26], 1); assert.equal(s[15], wait + 4); assert.equal(s[28], 0);
      return s;
    }
    const first = execute(); c.reset();
    assert.equal(c.keyboard_matrix(3, 2, 1), 1); // cold reset releases/detaches
    assert.deepEqual(execute(), first, 'Dynamic production keyboard replay differs');
    for (const [option, value] of [['--keyboard', 'bad'], ['--nor-device', 'bad']]) {
      const failed = spawnSync(cli, ['run', '--model', 'hp50g', '--rom', input, option, value], { encoding: 'utf8' });
      assert.ifError(failed.error); assert.equal(failed.status, 64);
    }
    console.log('Circuit guest: native/WASM NOR ID + released keyboard agree; production WASM press/release -> EINT -> IRQ -> WFI and cold replay pass');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
