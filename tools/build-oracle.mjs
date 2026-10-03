// SPDX-License-Identifier: MIT
// Separate test module: shares Orchard sources, never enters dist/ or install.
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build');
await mkdir(build, { recursive: true });
const sources = (await readdir(resolve(root, 'src'))).filter(name => name.endsWith('.c')).sort().map(name => `src/${name}`);
const result = spawnSync(process.env.CLANG || 'clang', ['--target=wasm32', '-std=c17', '-O3', '-flto', '-mbulk-memory',
  '-ffreestanding', '-nostdlib', '-fno-builtin', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
  '-Iinclude', '-Isrc', ...sources, 'tools/cpu-oracle.c', '-o', resolve(build, 'cpu-oracle.wasm'),
  '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,--stack-first', '-Wl,-z,stack-size=524288',
  '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216'],
{ cwd: root, stdio: 'inherit', timeout: 60000 });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Built isolated CPU differential test module (not a production artifact)');
