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
const sources = ['machine', 'cpu', 'thumb', 'mmu', 'bus', 'soc', 'checkpoint', 'scheduler', 'watchdog', 'gpio', 'interrupt', 'rtc', 'keyboard', 'nor', 'sram', 'lcd', 'adc', 'usb', 'sdi', 'spi', 'buzzer'].map(name => `src/${name}.c`);
const args = [
  '--target=wasm32', '-std=c17', '-O3', '-flto', '-mbulk-memory', '-ffreestanding', '-nostdlib', '-fno-builtin',
  '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-Iinclude', '-Isrc',
  ...(physicalReads === '1' ? ['-DORCHARD_EXPERIMENTAL_PHYSICAL_READS=1'] : []),
  ...sources, 'app/wasm.c', '-o', resolve(out, 'orchard.wasm'),
  '-Wl,--no-entry', '-Wl,--export-memory', '-Wl,--stack-first',
  '-Wl,-z,stack-size=524288', '-Wl,--initial-memory=16777216', '-Wl,--max-memory=100663296',
];
const result = spawnSync(process.env.CLANG || 'clang', args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
for (const file of ['index.html', 'style.css', 'main.js', 'worker.js', 'hp48.js', 'skin.js', 'lifecycle.js', 'debug.html', 'session.js', 'catalog.js', 'preferences.js', 'pacing.js', 'task-scheduler.js', 'virtual-usb.js', 'usb-device.js', 'host-bridge-client.js', 'host-bridge-protocol.js', 'kermit.js', 'file-transfer.js', 'hp39-files.js', 'hp39-transfer.js', 'hp39-archive.js', 'hp39-wire.js', 'transfer-errors.js', 'sd-card.js', 'sd-filesystem.js', 'buzzer-worker.js', 'buzzer-audio.js', 'lcd-frames.js']) {
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
settings are selected automatically for the supported HP39g+ D1.55, HP39gs 2.22,
HP48gII and HP49g+ complete ROMs. It starts when the page is visible and focused.
HP39g+/HP39gs: at Memory Clear press the top-right key (OK).
HP48gII/HP49g+: at Try To Recover Memory press the top-right key (NO), then again
at Memory Clear (OK). Wait for HOME before typing a calculation.

Settings select immersive, immersive landscape or traditional view, size,
keyboard sequences, sound/volume, focus policy and speed. Landscape keeps
the screen and six FN keys on the left, with the other keys on the right.
Keyboard settings are model-specific, highlight mapped PC keys, and show the
calculator keypad alongside them. Defaults follow keyboard characters; custom
bindings use physical key positions. Where available, the browser supplies the
current PC layout; otherwise labels are learned from pressed keys.
Normal paces the functional clock; Unlimited accelerates
both calculations and timers. Save exports <model>-YYYYMMDD-HHMMSS.ord.
Restore accepts .ord and older .orchard files for the same ROM. Automatic
device saves are opt-in, use IndexedDB when available, and do not store the ROM;
keep exported backups. SD media is included in both session and automatic saves.
Settings > Storage separately remembers one local ROM per model by default.
Supported browsers retain a read-only file handle; other browsers keep a local
copy. Reopening a handle reads the original file again. A revoked permission
needs Continue reading; moved/changed files must be selected again. Nothing is
uploaded. Disable automatic reopening or forget saved ROMs in the same tab.
Connections and SD open in a persistent sidebar beside the working calculator.
HP49g+ supports an emulated SD card: create a 16 or 32 MiB FAT16 card or import a
1, 2, 4, 8, 16 or 32 MiB raw card image. Use the calculator's FILES / port 3
to manage its files, and export the image to keep a standalone card backup.
Prepare files browses an unmounted FAT16 image, extracts files, creates folders,
adds or renames files/folders with explicit 8.3 names, and deletes files or empty
folders before inserting the image. Failed edits retain the complete draft.
Choose a local directory to build a card with a preview of its 8.3 aliases.
Where supported, associate its read/write handle for explicit reread and
conflict-checked writeback. First use Eject to edit / sync on a mounted card.
Directory synchronization is a session-level snapshot workflow: it does not
mount an operating-system drive or automatically synchronize in the background.
Connections > Files uploads HP48gII objects over internal USB or serial,
and HP49g+ objects over internal USB, and retrieves
named objects for explicit local download. Start Kermit SERVER on the calculator
with the matching connection and binary transfer selected. Both connections support
Receive, directory and FINISH. Select up to 16 objects (8 MiB total) for a batch;
files are checked by content and each result is shown separately. File selection
has no extension filter. Failed items can be retried or skipped independently.
HP39/40 files use the separate Disk drive host: select a ZIP package or aplet/library files,
start serving, and use APLET > RECV > Disk drive on the calculator. Reverse
SEND offers individual downloads and Download package creates a ZIP you can import again.
Wire uploads are faster on HP39g+: choose RECV > HP39/40 (Wire) for each object,
with required libraries before the aplet. HP39gs calls its wired USB choice
HP39/40 (USB). Follow the displayed model/connection-specific instructions.
For Notes, open SHIFT > 0 (NOTEPAD) before RECV; ASCII Notes are converted to
the binary string objects required by Wire, preserving the calculator encoding.
Downloads still use SEND > Disk drive. Settings > Transfer contains the optional
Unlimited during transfers switch. It accelerates active protocol work, restoring the selected speed between
files, while waiting for RECV and on every completion/error/cancel path.
Original HP39g+ and HP39gs both pass Note Wire installation and exact stock
SEND export; HP39gs also installs the V2 reader and completes native dump/return/USB reuse.
HP40gs still requires its own full-ROM witness. Raw data retains serial
and USB packets. Connections > Local device can link this same browser Worker
to the optional Node host/bridge.mjs USB/IP relay on 127.0.0.1. Supply its printed
address and access token. The operating system still needs its own USB/IP client
and calculator driver; no drivers are installed automatically. Host attachment
and a full Conn3x workflow remain separate acceptance gates.
The beta admits four tested complete firmware images.
Firmware-driven buzzer sound starts after a user gesture. Mute and volume are
available in Settings. The HP49g+ BEEP path uses the shared guest PCLK/PWM model;
physical board-clock calibration remains open. Pausing clears pending sound.
The four admitted original systems can automatically power off and resume with
ON while retaining their previous calculation. New v5 sessions retain PWM/SPI
phase and held watchdog reset; v1/v2/v3/v4 sessions remain readable with
documented migration. Factory-test entry uses real firmware key handling and
SPI registers; watchdog exits execute the original reset vector.
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
