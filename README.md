# Orchard

An original MIT-licensed ARM hardware emulator for HP 39g+, 39gs, 40gs,
48gII (USB revision), 49g+ and 50g. One C17 core runs natively and as WASM.
The ROM's ARM Saturn interpreter executes as guest software; there is no
host-side Saturn replacement or firmware patch.

**HP39g+ D1.55, HP48gII and the supplied HP49g+ complete ROM reach original
HOME and evaluate `1+2=3` and `7*8=56`.** [HP49g+](docs/development/hp49-startup.md)
also runs original-OS symbolic algebra, graphing, menus and
[native ARM programs that return to HOME](docs/development/hp49-native.md).
HP39g+ uses a separately selected
1 MiB NOR and exact SRAM, not the HP48gII mirroring hypothesis. LCD `+0x68`,
component identification, panel interpretation and pad/ADC conditions remain
unverified hardware assumptions.
This is conditional functional operation, not complete six-model support.

## Browser

**[Open the web emulator](https://maxmixalex.github.io/orchard-emu/emulator/)** ·
[Development documentation](https://maxmixalex.github.io/orchard-emu/)


```sh
npm ci --ignore-scripts
npm run build
npm run dev
```

Python 3, Node.js 22+, Clang/wasm-ld are needed to build; frontend dependencies are pinned in package-lock.json.
Open the printed localhost URL (default port 8123). In a downloaded web build,
only Node.js 22+ is needed: extract it and run `node serve.mjs` in that folder.
Do not use `file://`. No ROM is bundled or uploaded.

The default page is a calculator: **Open ROM**, Pause/Resume, Restart and
physical keys. It detects the three supported ROM identities and selects their
compatibility settings automatically. CPU counters, boot setup and internal
research controls live in the separate **[developer workbench](https://maxmixalex.github.io/orchard-emu/emulator/debug.html)**.
Both pages use the same optimized core, not different levels of emulation.
At startup use the top-right soft key for NO/OK as prompted; wait for HOME
before entering calculations. **Save** exports the paused machine to a timestamped
`.ord` file without its ROM. Open the same ROM and choose **Restore**, then
Resume, to continue without another cold boot. Automatic local saves are off
by default and can be enabled in **Settings → Storage**; loading the same ROM
then offers to restore its saved state. See [saved sessions](docs/development/sessions.md).

[Performance and benchmarks](docs/development/performance.md) ·
[Browser usage](docs/development/web.md) ·
[Skins and status segments](docs/development/skins-segments.md)

## Native and tests

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run test:web
npm run test:skins
npm run test:pages
npm run test:calculator
```

[Startup](docs/development/startup.md) records the full-NOR witness and exact
experimental conditions. A successful run budget is not a boot certificate.
The optional [Unicorn differential](docs/development/cpu-oracle.md) is a
separate developer tool, never a linked dependency of the MIT runtime.

## Development

[Documentation](https://maxmixalex.github.io/orchard-emu/) ·
[Roadmap](docs/development/roadmap.md) ·
[Board](docs/development/board.md) ·
[Validation](docs/development/validation.md) ·
[ROM provenance](docs/development/native-roms.md)

Zensical configuration is in `zensical.toml`; install
`tools/requirements-docs.txt` in a virtual environment and run
`zensical build --strict`. Pages publishes documentation at the root and the emulator at `/emulator/`. Tests and
private firmware evidence stay out of production packages. Pages promotes the
exact successful current-main Build artifact; it does not recompile the emulator
or deploy a failed/superseded Build.

[MIT](LICENSE) covers original source/documentation, not HP firmware or
trademarks. No external emulator implementation, firmware or font file is bundled.
Outlined calculator art is separately Apache-2.0, with its LICENSE/NOTICE
in `licenses/hp-calcs-svg`; see [licensing](docs/development/licensing.md).

## Settings and connections

Settings switches immersive/traditional view, scale, pause-on-focus/background,
per-model key sequences and optional automatic local saves. Normal uses a
fixed functional time rate instead of running clocks at maximum host speed;
physical timing is still being refined. CPU research details stay in the
developer workbench. Save exports `<model>-<yyyymmdd-hhmmss>.ord`; Restore also
accepts earlier `.orchard` files. No ROM is stored or uploaded.

Connections adds a Files tab for HP48gII USB/serial and HP49g+ USB object
upload, named retrieval and explicit local download. Start Kermit SERVER with
the matching connection selected. These supported links also provide Receive,
directory and FINISH. The file chooser accepts up to 16 objects per batch
(8 MiB total), validates them all before sending and shows each result. Serial
and USB two-object batches, active SEND and connection reuse have original-ROM
browser witnesses. HP39/40 uses its own disk-drive server: select typed files or
an applet bundle, start serving, then choose **RECV → Disk drive** in the
calculator. Directory requests and applet/library dependencies are served from
the selected files, preserving their original names and aliases. Calculator
**SEND → Disk drive** returns typed files for local download. Select an existing
HP39 ZIP directly, or download received objects as a reusable ZIP. The fixed
catalog entry point is restored when the stock SEND omits it, while original
directory aliases and object bytes are preserved. Raw data retains
UART and USB packets. Original-ROM HP39 file-transfer and ZIP round-trip
verification is for HP39g+; HP39gs/40gs still await their own ROM execution.
Browser connections are internal to the emulator and do not create desktop
USB or serial devices. See
[file transfer](docs/development/file-transfer.md),
[interaction](docs/development/interaction.md), [sessions](docs/development/sessions.md),
and [the infrared assessment](docs/development/infrared.md).

The [HP39gs full ROM capture package](docs/development/hp39gs-rom-dump.md)
reuses the exact calculator program from the user's successful hpclang HP39g+
capture. Its Windows receiver reads each 16 KiB block twice and compares every
byte, producing a complete 1 MiB image in one launch. The package includes the
rebuilt receiver, matching calculator files, complete corresponding source and
licenses. HP39gs hardware execution awaits the returned image; a separate short
probe is not required. The older ARM-return package remains historical.
The [HP49g+ capture package](docs/development/flash-capture.md) has now produced
the user's 2 MiB image used by the new model's startup and transfer validation.


## React user interface and host prototype

The user frontend now uses React + Mantine, with English/Chinese settings, a
clickable PC-keyboard editor, traditional Shift/Alpha legends and matrix PNG
capture. Existing `.ord`/legacy sessions and opt-in autosave remain compatible.
Live LCD drawing reuses its image and palette buffers, and the traditional
keypad is created when that view is first selected. These reduce display
allocation and hidden layout work; scene latency remains a separate benchmark.
The independent loopback USB/IP/raw serial package (`npm run build:host`) is
experimental: generated ARM/TCP tests pass, but OS attachment and Conn3x are
not yet verified. See [frontend](docs/development/react-ui.md) and
[host mode](docs/development/host-mode.md). No firmware or driver is bundled.
