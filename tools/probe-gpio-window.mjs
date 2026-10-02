// SPDX-License-Identifier: MIT
// Hash-bound, local-only exhaustive stimulus experiment. No firmware uploads.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFirmware, prepareInput, sha256 } from './rom-inputs.mjs';
if (process.argv.length !== 3) throw new Error('Usage: node tools/probe-gpio-window.mjs HP48GII-FULL-NOR.bin');
const input = prepareInput(4, await readFirmware(process.argv[2]), 'full-nor');
if (input.source.sha256 !== '4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937')
  throw new Error('This checkpoint experiment requires the exact verified HP48gII fixture');
const root = fileURLToPath(new URL('../', import.meta.url));
const exe = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build',
  process.platform === 'win32' ? 'orchard-gpio-window.exe' : 'orchard-gpio-window');
const temporary = await mkdtemp(resolve(tmpdir(), 'orchard-gpio-window-'));
try {
  const path = resolve(temporary, 'input.bin');
  await writeFile(path, input.image, { flag: 'wx' });
  const run = spawnSync(exe, [path], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Window probe failed (${run.status}): ${run.stderr}`);
  const report = { schema: 'orchard-gpio-window-v1', source_input: input.source,
    helper_binary_sha256: sha256(await readFile(exe)), scope: 'native checkpoint + 8192 ticks; not a complete stock boot',
    result: JSON.parse(run.stdout) };
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
