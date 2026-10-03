// SPDX-License-Identifier: MIT
// A generated guest clears 4 KiB at physical NOR zero, then verifies that its
// instruction/data bytes survived SDP rejection. No real firmware is used.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
export async function checkNorBus(root, build) {
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-nor-bus-'));
  try {
    const rom = Buffer.alloc(0x200000, 0xa5);
    rom.writeUInt32LE(0xea00003e, 0); // B 0x100
    const words = [
      0xe3a00000, // MOV r0,#0
      0xe3a01c01, // MOV r1,#256
      0xe3a02000, 0xe3a03000, 0xe3a04000, 0xe3a05000,
      0xe8a0003c, // STMIA r0!,{r2-r5}
      0xe2511001, // SUBS r1,r1,#1
      0x1afffffc, // BNE STM
      0xe3a00000, 0xe5906000, // LDR r6,[0]: unchanged reset vector
      0xe2800004, 0xe5907000, // LDR r7,[4]: unchanged fill data
      0xee070f90, // WFI
    ];
    words.forEach((op, i) => rom.writeUInt32LE(op, 0x100 + 4 * i));
    const input = resolve(dir, 'generated.bin'); await writeFile(input, rom, { flag: 'wx' });
    for (const selected of [false, true]) {
      const p = spawnSync(process.execPath, ['tools/probe-rom.mjs', '--model', 'hp48gii',
        '--rom', input, '--ticks', '1000', ...(selected ? ['--nor-device', 'sst39vf1601'] : [])],
      { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, ORCHARD_BUILD_DIR: build } });
      assert.ifError(p.error); assert.equal(p.status, 0, p.stdout + p.stderr);
      const report = JSON.parse(p.stdout), s = report.result;
      assert.equal(report.native_wasm_equal, true); assert.equal(report.native_replay_equal, true);
      assert.equal(report.wasm_replay_equal, true); assert.equal(s.exceptions, '0');
      assert.equal(s.boot_verified, false);
      if (selected) {
        assert.equal(s.stop.code, 0); assert.equal(s.sleeping, true);
        assert.equal(s.registers[6], 'ea00003e'); assert.equal(s.registers[7], 'a5a5a5a5');
        assert.equal(s.instructions, '780'); assert.equal(s.registers[15], '00000138');
      } else {
        assert.equal(s.stop.code, 8); assert.equal(s.stop.address, '00000000');
        assert.equal(s.stop.pc, '00000118'); assert.equal(s.instructions, '7');
      }
    }
    console.log('NOR bus guest: selected x16 STM/SDP rejection preserves executing NOR; unknown-part stop and native/production-WASM cold replay agree');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
