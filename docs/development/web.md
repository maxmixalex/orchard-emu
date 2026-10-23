# Browser calculator

[Open calculator](https://maxmixalex.github.io/orchard-emu/emulator/) ·
[Developer workbench](https://maxmixalex.github.io/orchard-emu/emulator/debug.html)

The user page identifies the four supported complete ROMs automatically. It
shows Open ROM, Pause/Resume, Restart, Save/Restore, Connections and Settings;
CPU registers, boot presets and implementation counters stay in the workbench.
The viewport-filling workspace switches between immersive outlined skin,
[immersive landscape](landscape.md) and traditional LCD/HTML keys in Settings.
Landscape splits below the six FN keys, keeping them with the display on the
left and the remaining keyboard on the right. Help is a question-button tooltip;
confirmations and errors use Mantine modal dialogs.

Settings configure scale, blur/background policies, speed, model-specific
physical-key sequences, firmware sound/volume and optional IndexedDB autosave.
The separate **Transfer** tab contains the transfer-only Unlimited switch,
using the same Apply/Cancel draft behavior as the other settings. See
[interaction and clock boundaries](interaction.md) and [sessions](sessions.md).
Normal is paced to the existing functional timebase; it is not a measured
ARM920T instruction/clock calibration. Other rates are explicit.

Connections provides HP48gII USB/serial object transfers, HP49g+ USB object
transfers, and the separate HP39/40 Disk drive file host. Object workflows include
upload, named GET, calculator-initiated SEND/Receive, directory, FINISH and bounded
upload batches. HP39/40 uses the appropriate stock catalog's RECV/SEND menus:
APLET for aplets, or **SHIFT → 0 (NOTEPAD)** for Notes. The browser serves typed
objects and catalogs, and offers received files for explicit local download.
Direct Wire upload converts `HP39AscC` ASCII Notes into binary string objects accepted by
the calculator. Original HP39g+ and HP39gs Note installation/EDIT/export pass,
alongside the earlier aplet/library and native-reader workflows; HP40gs still needs its
full-ROM acceptance. File selection has no extension filter, recoverable
batch errors offer Retry/Skip, and the optional **Unlimited during transfers**
switch restores the user's chosen speed while waiting for the next RECV and
on completion or interruption. Transfer failures carry stable translated
messages; unknown errors have a translated summary and collapsed technical
details. See [file transfer](file-transfer.md).

The HP49g+ [SD dialog](sd-cards.md) prepares files and folders in an unmounted
FAT16 image, including file/folder rename and deletion of files or empty
folders, inserts the resulting card and exports its contents. It never
edits a mounted guest filesystem behind the calculator's cache. Manual and
automatic saves retain the whole card. [Firmware sound](buzzer.md) follows
GPIO/Timer2 output and starts after a user gesture. PWM, watchdog, ADC and SDI
now share the register-derived PCLK; physical board and speaker calibration
remain separate from this functional clock model.

All four admitted ROMs complete their normal inactivity shutdown and ON wakeup.
The [power model](power-management.md) preserves SRAM and external card contents,
so a blank powered-off screen can be resumed with ON. Host **Restart** remains
the separate cold-reset action that clears calculator RAM.

The Raw data tab retains UART0 and USB packet diagnostics. The USB host reads
actual guest descriptors. These internal connections do not create an operating
system device or access a physical cable. HP49g+ infrared uses UART2 and is not
implemented by the UART0 link; see [virtual links](virtual-link.md) and
[infrared](infrared.md).

## Build and use

Build with Python 3, Node.js 22+, Clang and wasm-ld using `npm run build`;
`npm run dev` serves the result on loopback, normally port 8123. The compiled
ZIP needs only Node.js: extract and run `node serve.mjs`. No npm packages or
ROMs are included. Use HTTP on localhost or HTTPS, not file URLs.

Open the original full NOR. On HP39g+ or HP39gs, acknowledge Memory Clear with F6/OK;
on HP48gII and HP49g+ first choose F6/NO at Try To Recover Memory, then F6/OK. These are
guest screens, not host-detected states. Restart clears memory; a saved HOME
session can be restored instead. Both main thread and Worker bind the image
to the documented hash. The displayed Beta is not an all-model support claim.

## Ownership, rendering and lifecycle

One Worker owns CPU and peripheral state. Its user pump runs bounded 1024-tick
calls in tasks capped around 6 ms, independently draining UART and polling the
USB host; user frame delivery is limited to about 30 Hz. Unchanged LCD pixels
reuse their ImageData and do not repaint. Unchanged key/annunciator attributes
are not rewritten. Debug snapshots retain their existing state layout.

Key macros are atomic bounded queues of switch transitions. Blur/hidden always
release keys even when pause is disabled. Pagehide pauses for safe cache return;
persisted pageshow does not automatically resume. Generation IDs reject old
ROM reads, snapshots, saves and restores. Private ROMs are never uploaded.

Seven skins retain Apache-2.0 attribution separately from the original MIT
core. Both matrix and guest-driven annunciator strip share the same data in
either view. Packed-LSB remains an explicit compatibility interpretation, not
an independently verified physical panel model. See [skins](skins-segments.md).

## Publication and verification

Build runs native/reference/sanitizer and production-module checks, strict
Zensical rendering and publication allowlists, then creates one tested site.
Pages promotes the exact successful current-main artifact, checks source and
hashes, and verifies all public HTTPS assets. It never recompiles during deploy.
Tests, firmware, saved sessions, reports and fonts are excluded.

Production Worker tests, preference/macro/storage tests and actual Chrome
Window/Worker tests complement native and WASM checks. The original HP48gII
and HP49g+ USB transfer witnesses use the real file picker, production page,
physical input and real browser downloads. HP48gII serial has separate stock
browser evidence. The HP49g+ lifecycle witness exercises cold boot, keyboard
input, 131×80 display, 4× PNG export, session save/restore and switching to an
older HP48gII saved session; see [HP49 startup](hp49-startup.md) and
[sessions](sessions.md). Private captures are kept outside publication.

These are bounded desktop-Chrome witnesses. Broad touch-device coverage,
background/foreground stress, long-term storage and sustained all-key use remain
separate acceptance work. The earlier browser policy block is historical and
does not describe the current validation environment.


## Current user frontend

The user page is now React/Mantine with bundled Chinese/English resources, a
clickable PC-keyboard mapping editor, printed modifier legends and PNG capture.
It preserves the existing model, pacing, storage and physical input contracts.
See [React UI](react-ui.md) for implementation and verification boundaries.
The old vanilla calculator controller is removed, not layered under React.
