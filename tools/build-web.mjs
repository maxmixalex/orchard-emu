// SPDX-License-Identifier: MIT
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
const physicalReads = process.env.ORCHARD_EXPERIMENTAL_PHYSICAL_READS;
if (physicalReads !== undefined && physicalReads !== '0' && physicalReads !== '1') {
  throw new Error('ORCHARD_EXPERIMENTAL_PHYSICAL_READS must be 0 or 1 (omit it for the default dispatch).');
}
await mkdir(out, { recursive: true });
const sources = ['machine', 'cpu', 'thumb', 'mmu', 'bus', 'soc', 'checkpoint', 'scheduler', 'watchdog', 'gpio', 'interrupt', 'rtc', 'keyboard', 'nor', 'sram', 'lcd', 'adc', 'usb'].map(name => `src/${name}.c`);
const args = [
  '--target=wasm32', '-std=c17', '-O3', '-flto', '-mbulk-memory', '-ffreestanding', '-nostdlib', '-fno-builtin',
  '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-Iinclude', '-Isrc',
  ...(physicalReads === '1' ? ['-DORCHARD_EXPERIMENTAL_PHYSICAL_READS=1'] : []),
  ...sources, 'app/wasm.c', '-o', resolve(out, 'orchard.wasm'),
  '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,--stack-first',
  '-Wl,-z,stack-size=524288', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216',
];
const result = spawnSync(process.env.CLANG || 'clang', args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const file of ['index.html', 'style.css', 'main.js', 'worker.js', 'hp48.js', 'skin.js', 'lifecycle.js', 'debug.html', 'session.js', 'catalog.js', 'preferences.js', 'pacing.js', 'task-scheduler.js', 'virtual-usb.js', 'kermit.js', 'file-transfer.js']) {
  await copyFile(resolve(root, 'web', file), resolve(out, file));
}
await copyFile(resolve(root, "LICENSE"), resolve(out, "LICENSE"));
console.log(`Web build: ${out} (${physicalReads === '1' ? 'experimental physical reads enabled' : 'default physical-read dispatch'})`);

const server = (await readFile(resolve(root, 'tools/serve.mjs'), 'utf8'))
  .replace("new URL('../dist/', import.meta.url)", "new URL('./', import.meta.url)");
await writeFile(resolve(out, 'serve.mjs'), server);
await writeFile(resolve(out, 'README.txt'), `Orchard experimental HP ARM calculator

Requirements: Node.js 22 or newer. No package installation needed.
In this folder run: node serve.mjs
Open the localhost URL printed by the server (default port 8123).
Do not open index.html with file://. No firmware is included.

Open the calculator page and choose Open ROM. Its model and compatibility
settings are selected automatically for the supported HP39g+ D1.55 and
HP48gII complete ROMs. It starts when the page is visible and focused.
HP39g+: at Memory Clear press the top-right key (OK).
HP48gII: at Try To Recover Memory press the top-right key (NO), then again
at Memory Clear (OK). Wait for HOME before typing a calculation.

Settings select immersive/traditional view, size, keyboard sequences, focus
policy and speed. Normal paces the functional clock; Unlimited accelerates
both calculations and timers. Save exports <model>-YYYYMMDD-HHMMSS.ord.
Restore accepts .ord and older .orchard files for the same ROM. Automatic
localStorage saves are opt-in and do not store the ROM; keep exported backups.
Connections > Files uploads HP48gII objects over internal USB or serial and retrieves
named objects for explicit local download. Start Kermit SERVER on the calculator
with the matching connection and binary transfer selected. Both connections support
Receive, directory and FINISH. Select up to 16 objects (8 MiB total) for a batch;
all files are checked before sending and each result is shown separately.
Raw data retains serial and USB packets. HP39 applets and complete Conn3x
replacement remain in development.
The browser connection does not create a device in the desktop operating system.
The beta supports two tested firmware versions, not all six target models.
The developer workbench is debug.html. It retains strict hardware mode,
research setup selectors, registers, counters, UART and diagnostics. Both
interfaces share the same optimized ARM/WASM core, skin and input mapping.
All limitations and hardware assumptions are described in the documentation.

Artwork: hp-calcs-svg, Apache-2.0; see licenses/hp-calcs-svg.
The original emulator remains MIT. No ROM or font files are bundled.
`);

const skins=spawnSync(process.env.PYTHON || 'python3',['tools/build-skins.py'],{cwd:root,stdio:'inherit'});
if(skins.error)throw skins.error;
if(skins.status!==0)process.exit(skins.status??1);

const frontend=spawnSync(process.execPath,["tools/build-frontend.mjs"],{cwd:root,stdio:"inherit"});
if(frontend.error)throw frontend.error;if(frontend.status!==0)process.exit(frontend.status??1);
