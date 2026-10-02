// SPDX-License-Identifier: MIT
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
const sources = ['machine', 'cpu', 'thumb', 'mmu', 'bus', 'soc', 'watchdog'].map(name => `src/${name}.c`);
const args = [
  '--target=wasm32', '-std=c17', '-O2', '-ffreestanding', '-nostdlib', '-fno-builtin',
  '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-Iinclude', '-Isrc',
  ...sources, 'app/wasm.c', '-o', resolve(out, 'orchard.wasm'),
  '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,--stack-first',
  '-Wl,-z,stack-size=524288', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216',
];
const result = spawnSync(process.env.CLANG || 'clang', args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const file of ['index.html', 'style.css', 'main.js', 'worker.js']) {
  await copyFile(resolve(root, 'web', file), resolve(out, file));
}
await copyFile(resolve(root, "LICENSE"), resolve(out, "LICENSE"));
console.log(`Web build: ${out}`);
