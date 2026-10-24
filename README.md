# Orchard

An original MIT-licensed ARM hardware emulator for HP 39g+, 39gs, 40gs,
48gII (USB revision), 49g+ and 50g. One C17 core runs natively and as WASM.
The ROM's ARM Saturn interpreter executes as guest software; there is no
host-side Saturn replacement or firmware patch.

**Four original full ROMs are admitted: HP39g+ D1.55, HP39gs 2.22, HP48gII
and the supplied HP49g+.** They reach original HOME and evaluate arithmetic,
including `7*8=56`. [HP39gs](docs/development/hp39gs-startup.md) now uses the
user's own complete capture, including its native bootloader.
[HP49g+](docs/development/hp49-startup.md)
also runs original-OS symbolic algebra, graphing, menus and
[native ARM programs that return to HOME](docs/development/hp49-native.md).
Its original FILES manager can read and write an [emulated SD card](docs/development/sd-cards.md).
All four admitted original systems also complete their normal inactivity
shutdown and [ON wakeup](docs/development/power-management.md), retaining their
previous calculation and accepting new input after wake.
HP39g+ uses a separately selected 1 MiB NOR and 256 KiB physical SRAM.
The admitted 39/48/49 presets explicitly select a bank-1 low-address mirror;
strict mode keeps exact decoding and no extra RAM capacity is granted. LCD `+0x68`,
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

The default page is a calculator: **Open ROM**, Pause/Resume, Restart, Self-test and
physical keys. It detects the four supported ROM identities and selects their
compatibility settings automatically. CPU counters, boot setup and internal
research controls live in the separate **[developer workbench](https://maxmixalex.github.io/orchard-emu/emulator/debug.html)**.
Both pages use the same optimized core, not different levels of emulation.
At startup use the top-right soft key for NO/OK as prompted; wait for HOME
before entering calculations. **Save** exports the paused machine to a timestamped
`.ord` file. Open the same ROM and choose **Restore** to resume under the current
focus/visibility policy. A prominent pause bar provides a direct resume action.
Sessions omit the complete original ROM but can contain changed flash sectors;
keep them private. Automatic local saves are off
by default and can be enabled in **Settings → Storage**; loading the same ROM
then offers to restore its saved state. See [saved sessions](docs/development/sessions.md).

**Settings → Storage → Remember local ROMs** is enabled by default and remembers
one ROM per model. Supported file pickers retain a read-only reference to the
original file; the standard file input stores a clearly labelled browser-local
copy instead. The last ROM reopens when permission allows. If the browser needs
permission again, use **Continue reading**; startup never opens a permission prompt.
The switch and **Forget saved ROM locations and copies** are separate from calculator-state
autosave. ROMs remain on this device; sessions separately record any changed flash sectors. See
[local ROM storage](docs/development/rom-storage.md).

On HP49g+, **Connections → SD card** opens a persistent sidebar. It creates a 16 MiB FAT16
card or imports a supported 1–32 MiB raw image; the original calculator accesses
it as port 3. **Prepare card files** browses, extracts, adds, renames and deletes
files or empty folders in an unmounted draft. **Choose local folder** recursively
copies a directory into a 16 or 32 MiB card, with an explicit preview of 8.3
aliases for long or non-ASCII names. Files retain their exact bytes and accept
any extension. With direct directory access, synchronization compares the saved
baseline with both the current directory and card. Additions, edits, deletions
and renames propagate in either direction after a reviewable preview; conflicts
require a choice or retain both versions. The directory handle, aliases and
baseline persist across reloads and reattach only to the matching card identity.
A mounted card is paused and ejected before synchronization, then reinserted;
running resumes only when it was running before and the current policy allows it.
This is explicit directory synchronization, not an operating-system mounted drive.
See [directory SD cards](docs/development/directory-sd.md).

Export the image for a separate card backup. Manual and automatic sessions
include the whole inserted card. HP48gII has no SD slot; HP50g still requires
its own full-ROM acceptance before it can join the supported calculator catalog.

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
[ROM provenance](docs/development/native-roms.md) ·
[Keyboard settings](docs/development/keyboard-settings.md) ·
[Local ROM storage](docs/development/rom-storage.md) ·
[Directory SD cards](docs/development/directory-sd.md)

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

Settings switches immersive, **immersive landscape**, traditional and
**traditional landscape** view, scale, nearest/bilinear/bicubic/Lanczos screen
resampling, optional 35 ms LCD response, pause-on-focus/background,
per-model key sequences, local ROM recall and optional automatic calculator
saves. Normal uses a
fixed functional time rate instead of running clocks at maximum host speed;
physical timing is still being refined. CPU research details stay in the
developer workbench. Save exports `<model>-<yyyymmdd-hhmmss>.ord`; Restore also
accepts earlier `.orchard` files. Remembered ROMs stay in the browser's local
storage; no ROM is uploaded. Changed flash sectors are private session data.
Landscape splits the unchanged skin below the six FN keys, keeping those
soft keys with the screen on the left and the remaining keyboard on the right.
[Firmware sound](docs/development/buzzer.md)
plays observed GPB2/Timer2 output through Web Audio, with mute and volume controls.
The original HP49g+ `BEEP` path now uses the shared register-derived peripheral
clock and buffered PWM counters. Physical board clock and speaker calibration
remain open.

Connections and SD share a persistent sidebar, leaving the calculator available
for stock RECV and file-manager actions. Switching tabs or hiding the sidebar
retains in-progress selections and drafts. Connections adds a Files tab for HP48gII USB/serial and HP49g+ USB object
upload, named retrieval and explicit local download. Start Kermit SERVER with
the matching connection selected. These supported links also provide Receive,
directory and FINISH. The file chooser accepts up to 16 objects per batch
(8 MiB total), checks their content and shows each result. Failed items can be
retried or skipped without resending successful items. Serial
and USB two-object batches, active SEND and connection reuse have original-ROM
browser witnesses. HP39/40 uses its own disk-drive server: select typed files or
an applet bundle, start serving, then choose **RECV → Disk drive** in the
calculator. Directory requests and applet/library dependencies are served from
the selected files, preserving their original names and aliases. Calculator
**SEND → Disk drive** returns typed files for local download. Select an existing
HP39 ZIP directly, or download received objects as a reusable ZIP. The fixed
catalog entry point is restored when the stock SEND omits it, while original
directory aliases and object bytes are preserved. Raw data retains
UART and USB packets. **Wire** provides a faster upload route: choose
**RECV → HP39/40 (Wire)** on HP39g+, or **RECV → HP39/40 (USB)** on HP39gs,
for each object, sending required libraries before the aplet. Optional
**Automatically open the next RECV** observes the verified stock catalog/menu
and sends real keys for the next same-catalog USB object. Unknown screens,
manual input and errors stop that automation; retries never press ENTER blindly.
`HP39AscC` ASCII Notes are
converted to the binary string format accepted by Wire. For a Note, first open
**SHIFT → 0 (NOTEPAD)** and use that catalog's RECV menu. Both original ROMs
pass installation, EDIT and exact content round trips. On HP39g+/HP39gs USB,
**Receive from calculator** in Wire mode stays listening across successive
**SEND → HP39/40 (Wire/USB)** operations, including aplet dependency libraries.
Completed files remain available after a later error or Stop; the download
list is bounded to 16 files and 8 MiB. Original-ROM HP39
file-transfer and ZIP round-trip verification uses the complete HP39g+ NOR.
HP39gs has its own original-ROM Disk installation and native-reader return
witness; HP40gs still needs its complete original NOR. File choosers accept
arbitrary filename extensions and identify the actual typed/ZIP content.
The optional **Settings → Transfer → Unlimited during transfers** switch accelerates active protocol
work, then restores the selected speed. Waiting for the calculator's next RECV
selection retains the selected speed. A Wire failure leaves the failed item
available for Retry or Skip; return the calculator to RECV before retrying.
Transfer errors and recovery instructions follow the selected UI language;
unknown technical details remain available in a collapsed diagnostic section.
Browser connections are internal to the emulator and do not create desktop
USB or serial devices. See
[file transfer](docs/development/file-transfer.md),
[interaction](docs/development/interaction.md), [sessions](docs/development/sessions.md),
and [infrared](docs/development/infrared.md).

**Connections → Infrared** pairs two calculators in tabs of the same browser
origin. One creates a code and the other joins it; select the normal IR send
and receive functions on the calculators. Original firmware handles discovery,
IrCOMM and object transfer over the modeled UART2 path. HP49g+ and HP48gII
complete transfers in both directions. HP39g+/HP39gs same-model and cross-model
aplet transfers also preserve complete object bytes. Old 39-series sessions
retain their saved exact SRAM decode; export wanted objects, Restart from the
original ROM to use the new preset, then reimport them before using this path.
Linked tabs keep running in the
background; Pause, reset, session replacement or disconnect ends the link.
This models decoded serial bytes and does not access a physical infrared adapter.
Original RS232/IrDA factory loopback diagnostics also pass on the applicable
four admitted systems. [NOR programming](docs/development/nor-write.md) lets
both original 39gs and 49g+ complete quick and full FLASH WRITE tests.

The [HP39gs full ROM capture package](docs/development/hp39gs-rom-dump.md)
now includes a revised reader with visible block progress, bounded USB waits,
safe temporary mappings and explicit recovery messages. Its Windows receiver
reads each 16 KiB block twice and compares every byte, producing a complete
1 MiB image in one launch. The package includes the rebuilt receiver, matching
calculator files, complete corresponding source and licenses. Emulator checks
cover the original HP39g+ full NOR and the user's complete HP39gs capture.
The received HP39gs image passes all 64 block hashes and repeated-read metadata;
its unchanged bytes now cold-boot and complete the same full-reader/return/USB
workflow. The earlier derived fixture is retained only as historical OS-level
evidence: it combined the official 2.22 OS with a foreign generic boot area,
and was never a physical full-ROM capture or catalog admission. See the exact
[region comparison](docs/development/hp39gs-startup.md#earlier-derived-fixture).
The older ARM-return package remains historical.
The [HP49g+ capture package](docs/development/flash-capture.md) has now produced
the user's 2 MiB image used by the new model's startup and transfer validation.


## React user interface

The user frontend uses React + Mantine, with English/Chinese settings,
traditional Shift/Alpha legends and matrix PNG capture. The wider keyboard
editor highlights bound PC keys, shows bindings on a clickable calculator
keypad, and keeps each model's mappings independent. Default text keys follow
the operating system's resolved characters; available layout labels and a
capture fallback avoid assuming QWERTY. Existing `.ord`/legacy sessions and
opt-in autosave remain compatible.

The core captures the image at the completed LCD-scan boundary, and
the Canvas coalesces updates at browser animation frames. This prevents UI
requests from showing several different partial RAM redraws during one scan.
An optional response filter smooths the live image; native PNG captures and
recording keep the raw published pixels. Genuine blank frames remain visible.
See [LCD presentation](docs/development/lcd.md#host-presentation-synchronized-to-the-scan-counter)
for its timing and physical-panel limits.
The local-device UI has been removed at the user's request. Native USB/IP,
OS-driver attachment and Conn3x integration are no longer planned work.
The earlier helper and regression records remain archived for reproducibility;
they are not a current browser feature. See [frontend](docs/development/react-ui.md)
and [archived host research](docs/development/host-mode.md).
