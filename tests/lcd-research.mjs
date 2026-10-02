// SPDX-License-Identifier: MIT
// ROM-free production-host acceptance for the explicit research policy and
// event validation. The guest itself disables/enables LCD; no state injection.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function checkLCDResearch(root, build) {
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-lcd-policy-'));
  try {
    const rom = Buffer.alloc(0x100000, 255);
    rom.writeUInt32LE(0xea000006, 0);
    [0xe59f5018, 0xe5950068, 0xe3a01021, 0xe5851000, 0xe5950068, 0xeafffffe]
      .forEach((op, i) => rom.writeUInt32LE(op, 0x20 + i * 4));
    rom.writeUInt32LE(0x4d000000, 0x40);
    const input = resolve(dir, 'generated.bin'); await writeFile(input, rom, { flag: 'wx' });
    const cli = resolve(build, process.platform === 'win32' ? 'orchard.exe' : 'orchard');
    const common = ['run', '--model', 'hp39gplus', '--rom', input, '--ticks', '64'];
    const { instance: { exports: c } } = await WebAssembly.instantiate(await readFile(resolve(root, 'dist/orchard.wasm')), {});
    assert.equal(c.create(1), 0);
    assert.equal(c.lcd_probe68(2), 1); assert.equal(c.frame_view(2), 1);
    assert.equal(c.gpio_bias(0, 1, 0), 1); assert.equal(c.gpio_bias(6, 1, 2), 1);
    new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
    assert.equal(c.load(rom.length), 0);
    for (const enabled of [false, true]) {
      const args = [...common, ...(enabled ? ['--lcd-probe68', 'idle-zero'] : []),
        '--keyboard', 'apples', '--key-at', '0:0:0:1', '--key-at', '30:0:0:0'];
      const n = spawnSync(cli, args, { encoding: 'utf8', timeout: 10000 });
      assert.ifError(n.error); assert.equal(n.status, 2, n.stderr);
      const state = JSON.parse(n.stdout);
      assert.equal(state.stop.address, '4d000068'); assert.equal(state.boot_verified, false);
      assert.equal(state.stop.pc, enabled ? '00000030' : '00000024');
      assert.equal(state.lcd_unverified_reads, enabled ? '1' : '0');
      assert.equal(state.key_events_applied, 1); // Stop cannot deliver the future event.
      c.reset(); assert.equal(c.lcd_probe68_reads(), 0n);
      assert.equal(c.lcd_probe68(Number(enabled)), 0); assert.equal(c.keyboard_attach(1), 0);
      assert.equal(c.keyboard_matrix(0, 0, 1), 0); assert.equal(c.run(64), 7);
      const s = [...new Uint32Array(c.memory.buffer, c.snapshot(), 33)];
      assert.deepEqual(state.registers, s.slice(0, 16).map(n => n.toString(16).padStart(8, '0')));
      assert.equal(state.ticks, String(s[22])); assert.equal(state.instructions, String(s[20]));
      assert.equal(state.lcd_unverified_reads, c.lcd_probe68_reads().toString());
      const again = spawnSync(cli, args, { encoding: 'utf8', timeout: 10000 });
      assert.ifError(again.error); assert.equal(again.status, n.status); assert.equal(again.stdout, n.stdout);
    }
    const invalid = [
      ['--lcd-probe68', 'zero'], ['--frame-view', 'panel'], ['--gpio-bias', 'A:1:0'],
      ['--gpio-bias', 'F:100:0'], ['--gpio-bias', 'G:1:2'], ['--gpio-bias', 'G:1:0', '--gpio-bias', 'G:1:1'],
      ['--gpio-bias', 'G:0x1:0'], ['--gpio-bias', 'G:1:'], ['--gpio-bias', 'G:1:-1'],
      ['--key-at', '0:0:0:1'], // keyboard detached
      ...['0:8:0:1', '0:0:7:1', '0:0:0:2', '-1:0:0:1', '1.0:0:0:1',
        '18446744073709551616:0:0:1', '64:0:0:1', '1:0:0', '1:0:0:1x', '1::0:1']
        .map(e => ['--keyboard', 'apples', '--key-at', e]),
      ['--keyboard', 'apples', '--key-at', '2:0:0:1', '--key-at', '1:0:0:0'],
      ['--keyboard', 'apples', ...Array(65).fill(['--key-at', '0:0:0:1']).flat()],
    ];
    for (let i = 0; i < invalid.length; ++i) {
      const out = resolve(dir, `must-not-exist-${i}.pgm`);
      const failed = spawnSync(cli, [...common, '--frame', out, ...invalid[i]], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(failed.error); assert.equal(failed.status, 64, failed.stdout + failed.stderr);
      await assert.rejects(access(out));
    }
    // Two same-tick events execute in argument order, including tick zero.
    const same = spawnSync(cli, [...common, '--keyboard', 'apples', '--key-at', '0:0:0:1', '--key-at', '0:0:0:0'], { encoding: 'utf8' });
    assert.equal(same.status, 2); assert.equal(JSON.parse(same.stdout).key_events_applied, 2);
    console.log(`LCD research guest: strict/gated/live-video stops and replay agree across hosts; ${invalid.length} invalid CLI cases and event boundaries pass`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
