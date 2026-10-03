// SPDX-License-Identifier: MIT
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
const sources = ['machine', 'cpu', 'thumb', 'mmu', 'bus', 'soc', 'watchdog', 'gpio', 'interrupt', 'rtc', 'keyboard', 'nor', 'sram', 'lcd', 'adc', 'usb'].map(name => `src/${name}.c`);
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
for (const file of ['index.html', 'style.css', 'main.js', 'worker.js', 'hp48.js', 'skin.js']) {
  await copyFile(resolve(root, 'web', file), resolve(out, file));
}
await copyFile(resolve(root, "LICENSE"), resolve(out, "LICENSE"));
console.log(`Web build: ${out}`);

const server = (await readFile(resolve(root, 'tools/serve.mjs'), 'utf8'))
  .replace("new URL('../dist/', import.meta.url)", "new URL('./', import.meta.url)");
await writeFile(resolve(out, 'serve.mjs'), server);
await writeFile(resolve(out, 'README.txt'), `Orchard experimental HP ARM calculator

Requirements: Node.js 22 or newer. No package installation needed.
In this folder run: node serve.mjs
Open the localhost URL printed by the server (default port 8123).
Do not open index.html with file://. No firmware is included.

For the documented HP48gII USB-revision complete NOR:
1. Select HP48gII and HP48gII HOME - experimental.
2. Select your own complete NOR and press Run.
3. At Try To Recover Memory? press F6 (NO). Wait for Memory Clear,
   then press F6 (OK). Wait for HOME before entering calculations.
4. Click keys or use digits/operators/Enter on your computer keyboard.

Pause cancels held/queued taps. Cold reset clears RAM; it is not a
calculator warm reset. Switching tabs pauses. No save/restore yet.
The setup uses unverified SRAM decode, LCD and pad/ADC assumptions.
For HP39g+ D1.55 choose HP39g+ HOME - experimental, run, then press F6
at Memory Clear. This preset uses a separate 1 MiB NOR hypothesis and no
SRAM mirroring. Other models remain strict bring-up targets. Skins do not
imply that their original system has booted. Artwork: hp-calcs-svg, Apache-2.0;
see licenses/hp-calcs-svg. Original core remains MIT. USB/Conn3x controls are not exposed in this page.
`);

const skins=spawnSync(process.env.PYTHON || 'python3',['tools/build-skins.py'],{cwd:root,stdio:'inherit'});
if(skins.error)throw skins.error;
if(skins.status!==0)process.exit(skins.status??1);
