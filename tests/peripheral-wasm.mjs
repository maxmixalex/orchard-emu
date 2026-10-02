// SPDX-License-Identifier: MIT
// Original guest takes ADC and LCD interrupts, acknowledges them and returns
// through SPSR to WFI. The public CLI/WASM probe performs the two-host replay.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseAdc } from '../tools/rom-inputs.mjs';
function guest() {
  const rom = Buffer.alloc(0x200000, 255), base = 0x100;
  const code = [], literals = [], branches = [], labels = new Map();
  const word = value => code.push(value >>> 0);
  function load(rd, value) { literals.push({ at: code.length, rd, value }); word(0); }
  function reg(addr, value) { load(0, addr); load(1, value); word(0xe5801000); }
  function read(addr, rd) { load(0, addr); word(0xe5900000 | (rd << 12)); }
  function label(name) { labels.set(name, base + code.length * 4); }
  function branch(name, condition = 14) { branches.push({ at: code.length, name, condition }); word(0); }
  reg(0x53000000, 0);
  reg(0x4a00001c, 0x3ff); reg(0x4a000008, 0x7ffeffff); // ADC and LCD IRQs.
  word(0xe10f0000); word(0xe3c00080); word(0xe121f000);
  reg(0x58000000, 0x42f9); // AIN7, /12, conversion start.
  label('adc-wait'); word(0xee070f90); word(0xe3590001); branch('adc-wait', 1);
  reg(0x4d000004, 1 << 14); reg(0x4d000008, 39 << 8); // 2 lines, 160 dots, 4-bit scan.
  reg(0x4d000014, 0x04001000); reg(0x4d000018, 0x1014); reg(0x4d00001c, 10);
  reg(0x4d00005c, 1); reg(0x4d000000, 0x6421); // CLKVAL=100, single scan.
  label('lcd-wait'); word(0xee070f90); branch('lcd-wait');
  label('handler'); read(0x4a000010, 1); word(0xe3110102); branch('lcd', 0); // TST r1,#bit31.
  word(0xe2899001); read(0x5800000c, 8); reg(0x4a000018, 0x400); branch('ack');
  label('lcd'); word(0xe28aa001); reg(0x4d000000, 0x6420);
  // Exercise the documented driver order: pending first, source second.
  reg(0x4d000054, 2); reg(0x4d000058, 2);
  label('ack'); reg(0x4a000000, 0xffffffff); reg(0x4a000010, 0xffffffff); word(0xe25ef004);
  for (const { at, name, condition } of branches) {
    const target = labels.get(name); assert.notEqual(target, undefined);
    code[at] = ((condition << 28) | 0x0a000000 | (((target - (base + at * 4) - 8) / 4) & 0xffffff)) >>> 0;
  }
  for (const { at, rd, value } of literals) {
    const offset = code.length * 4 - at * 4 - 8; assert(offset >= 0 && offset < 4096);
    code[at] = (0xe59f0000 | (rd << 12) | offset) >>> 0; word(value);
  }
  rom.writeUInt32LE(0xea00003e, 0);
  rom.writeUInt32LE(0xe59ff000, 0x18); rom.writeUInt32LE(labels.get('handler'), 0x20);
  code.forEach((value, i) => rom.writeUInt32LE(value, base + i * 4));
  return rom;
}
export async function checkPeripherals(root, build) {
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-peripheral-'));
  try {
    const input = resolve(dir, 'generated.bin'); await writeFile(input, guest(), { flag: 'wx' });
    for (const code of [null, 0, 1023]) {
      const p = spawnSync(process.execPath, ['tools/probe-rom.mjs', '--model', 'hp50g', '--rom', input,
        '--ticks', '24000', ...(code === null ? [] : ['--adc-input', `7:${code}`])],
      { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, ORCHARD_BUILD_DIR: build } });
      assert.ifError(p.error); assert.equal(p.status, 0, p.stdout + p.stderr);
      const report = JSON.parse(p.stdout), s = report.result;
      assert.equal(report.native_wasm_equal, true); assert.equal(s.boot_verified, false);
      if (code === null) {
        assert.equal(s.stop.code, 16); assert.equal(s.stop.detail, '00000007');
        assert.equal(s.exceptions, '0'); assert.equal(s.peripherals.adc_valid, false);
      } else {
        assert.equal(s.stop.code, 0); assert.equal(s.sleeping, true); assert.equal(s.exceptions, '2');
        assert.equal(parseInt(s.registers[8], 16), code);
        assert.equal(parseInt(s.registers[9], 16), 1); assert.equal(parseInt(s.registers[10], 16), 1);
        assert.equal(s.peripherals.adc_data, code); assert.equal(s.peripherals.adc_valid, true);
        assert.equal(s.peripherals.adc_remaining, 0); assert.equal(s.peripherals.lcd_frames, '1');
        assert.equal(s.peripherals.lcd_source_pending, 0); assert.equal(s.peripherals.lcd_interrupt_pending, 0);
      }
    }
    assert.deepEqual(parseAdc('7:1023,0:0'), [{ channel: 0, code: 0 }, { channel: 7, code: 1023 }]);
    const invalid = ['', '8:1', '-1:1', '7:-1', '7:1024', '7:0x100', '7:1.0', '7:', '7: 1',
      '7:00001', '07:1', '7:1x', '7:1,7:2'];
    const cli = resolve(build, process.platform === 'win32' ? 'orchard.exe' : 'orchard');
    for (let i = 0; i < invalid.length; ++i) {
      assert.throws(() => parseAdc(invalid[i]));
      const out = resolve(dir, `invalid-${i}.pgm`);
      const p = spawnSync(cli, ['run', '--model', 'hp50g', '--rom', input, '--frame', out,
        '--adc-input', invalid[i]], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(p.error); assert.equal(p.status, 64, p.stdout + p.stderr);
      await assert.rejects(access(out));
    }
    const duplicate = spawnSync(cli, ['run', '--model', 'hp50g', '--rom', input,
      '--adc-input', '7:1', '--adc-input', '7:2'], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(duplicate.error); assert.equal(duplicate.status, 64);
    console.log('Peripheral guest: native/WASM ADC -> IRQ -> WFI -> LCD frame IRQ, exact peripheral state and cold replay; unknown ADC control and 14 invalid CLI cases pass');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
