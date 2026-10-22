// SPDX-License-Identifier: MIT
// Build an isolated diagnostic core; production sources/assets are untouched.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function instrumentCPU(source) {
  assert(!source.includes('arm-block-profile.h'), 'CPU source is already instrumented');
  const declaration = 'static void cpu_step(orchard_machine *m, bool fast) {';
  const hook = '    if (fast && width == 4 && arm_without_checkpoint(m, instruction)) {';
  for (const anchor of [declaration, hook])
    assert.equal(source.split(anchor).length, 2, `Instrumentation anchor must occur exactly once: ${anchor}`);
  return source.replace(declaration, '#include "arm-block-profile.h"\n' + declaration)
    .replace(hook, '    arm_block_profile_fetch(m, instruction, width,\n' +
      '                            width == 4 && o_condition(c, instruction >> 28));\n' + hook);
}
export async function buildProfile(directory) {
  const out = resolve(directory);
  await mkdir(out); // Fail rather than replacing another build/evidence directory.
  const names = ['machine', 'cpu', 'thumb', 'mmu', 'bus', 'soc', 'checkpoint', 'scheduler',
    'watchdog', 'gpio', 'interrupt', 'rtc', 'keyboard', 'nor', 'sram', 'lcd', 'adc', 'usb'];
  const inputs = [...names.map(n => `src/${n}.c`), 'src/internal.h', 'include/orchard/orchard.h',
    'include/orchard/clock.h', 'app/wasm.c', 'tools/arm-block-profile.h',
    'tools/build-arm-block-profile.mjs'];
  const hashes = {};
  for (const name of inputs) hashes[name] = hash(await readFile(resolve(root, name)));
  const cpu = instrumentCPU(await readFile(resolve(root, 'src/cpu.c'), 'utf8'));
  const cpuPath = resolve(out, 'profile-cpu.c');
  await writeFile(cpuPath, cpu, { flag: 'wx' });
  const wasmPath = resolve(out, 'arm-block-profile.wasm');
  const compiler = process.env.CLANG || 'clang';
  const args = ['--target=wasm32', '-std=c17', '-O3', '-flto', '-mbulk-memory',
    '-ffreestanding', '-nostdlib', '-fno-builtin', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
    '-Iinclude', '-Isrc', '-Itools', ...names.map(n => n === 'cpu' ? cpuPath : `src/${n}.c`),
    'app/wasm.c', '-o', wasmPath, '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,--stack-first',
    '-Wl,-z,stack-size=524288', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216'];
  const manifest = { schema: 'orchard-arm-block-profile-build-v2', passed: false,
    compiler, arguments: args, source_sha256: hashes, generated_cpu_sha256: hash(cpu),
    purpose: 'Diagnostic counts only; instrumented elapsed time is not a performance measurement.' };
  try {
    const version = spawnSync(compiler, ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (version.error) throw version.error;
    assert.equal(version.status, 0, version.stderr);
    manifest.compiler_version = version.stdout;
    const result = spawnSync(compiler, args, { cwd: root, encoding: 'utf8', timeout: 120000 });
    manifest.build_stdout = result.stdout; manifest.build_stderr = result.stderr;
    manifest.build_status = result.status;
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    manifest.wasm_sha256 = hash(await readFile(wasmPath));
    const module = await WebAssembly.compile(await readFile(wasmPath));
    assert.equal(WebAssembly.Module.imports(module).length, 0);
    for (const name of ['reset', 'run_boundary', 'finish', 'count', 'pair'])
      assert(WebAssembly.Module.exports(module).some(e => e.name === `arm_block_profile_${name}`));
    for (const name of inputs)
      assert.equal(hash(await readFile(resolve(root, name))), hashes[name], `Source changed during build: ${name}`);
    manifest.passed = true;
    return manifest;
  } catch (error) { manifest.error = error.message; throw error; }
  finally { await writeFile(resolve(out, 'build.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv.length === 3 && process.argv[2],
    'Usage: node tools/build-arm-block-profile.mjs NEW-DIRECTORY');
  const report = await buildProfile(process.argv[2]);
  console.log(JSON.stringify({ passed: report.passed, wasm_sha256: report.wasm_sha256 }));
}
