// SPDX-License-Identifier: MIT
// ROM-free production CLI/ABI checks; no test fixture is packaged.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const exe = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build', process.platform === 'win32' ? 'orchard.exe' : 'orchard');
const dir = await mkdtemp(resolve(tmpdir(), 'orchard-memory-cli-'));
try {
  const image = Buffer.alloc(0x200000, 0xff);
  image.writeUInt32LE(0xeafffffe, 0); // Original synthetic branch to self.
  const input = resolve(dir, 'input.bin'), out = resolve(dir, 'must-not-exist.pgm');
  await writeFile(input, image);
  const base = ['run', '--model', 'hp48gii', '--rom', input, '--ticks', '8'];
  const invalid = [[], [''], ['exact'], ['mirror'], ['BANK1-MIRROR'], ['bank1-mirror '],
    ['1'], ['bank1-mirror', '--sram-decode', 'bank1-mirror']];
  for (const values of invalid) {
    const result = spawnSync(exe, [...base, '--frame', out, '--sram-decode', ...values], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error); assert.equal(result.status, 64, `Invalid SRAM policy accepted: ${values}`);
    await assert.rejects(access(out), { code: 'ENOENT' });
  }
  for (const args of [[], ['--sram-decode', 'bank1-mirror']]) {
    const result = spawnSync(exe, [...base, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.sram_decode, args.length ? 'bank1-mirror' : 'exact');
    assert.equal(state.sram_alias_reads, '0'); assert.equal(state.sram_alias_writes, '0');
    assert.equal(state.boot_verified, false);
  }
  const { instance: { exports: c } } = await WebAssembly.instantiate(await readFile(resolve(root, 'dist/orchard.wasm')), {});
  assert.equal(c.create(4), 0);
  assert.equal(c.sram_select(2), 1);
  assert.equal(c.sram_select(1), 0);
  assert.equal(c.profile(4, 1), 0x40000, 'Mirror must not expand SRAM capacity');
  assert.equal(c.sram_alias_reads(), 0n); assert.equal(c.sram_alias_writes(), 0n);
  c.reset();
  assert.equal(c.sram_alias_reads(), 0n); assert.equal(c.sram_alias_writes(), 0n);
  assert.equal(c.sram_select(0), 0);
  // Unknown firmware must not run the long original-ROM witness.
  const witness = spawnSync(process.execPath, ['tools/probe-hp48-startup.mjs', input, resolve(dir, 'report.json')],
    { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.ifError(witness.error); assert.notEqual(witness.status, 0);
  await assert.rejects(access(resolve(dir, 'report.json')), { code: 'ENOENT' });
  console.log('Memory CLI: eight invalid policies rejected before outputs, exact/mirror metadata, production WASM ABI and startup input identity checks pass');
} finally { await rm(dir, { recursive: true, force: true }); }
