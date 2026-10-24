# Continuation handoff

## Current r23 continuation from 128554d (2026-10-24)

The user requested factory RS232/FLASH fixes, infrared, original application
coverage, two-way directory SD synchronization, easier Wire queues, clearer
pause/restore behavior, LCD sampling/scaling, traditional landscape and mobile
UI refinement. Native host-device/Conn3x work is explicitly retired. Work was
split across serial/infrared, NOR/checkpoints, display/UI, directory/transfer,
original-program investigation, independent review and production browser
acceptance. No original ROM or application was patched to obtain a stock pass.

The final production C/WASM is SHA-256
`4bd0b8bba8ae7c71b116bb4a2c4396478e01730d9283bedc1f62a11f100db6e9`.
The [validation page](validation.md) and
[r23 release record](evidence/release-validation-r23.json) distinguish local
working-tree evidence from the remote Build/Pages and live checks recorded in
the release PR. Private ROMs, checkpoints, card images, downloaded binaries and
original LCD pixels must remain outside Git and public artifacts.

### Core, firmware and infrared

Selected SST NOR devices now implement functional word program, sector/block/
chip erase, polling and supported suspend/resume. MMU/bus fast paths and idle
scheduling preserve those operations. The immutable input ROM remains separate
from programmed flash. Original 39gs and 49g+ complete both quick and full
factory FLASH write tests on the final core; their full tests consume
3.4665B/5.6505B reference ticks. This is functional selected-part behavior,
not electrical timing certification. See [NOR](nor-write.md).

Three UART channels have independent holding/FIFO buffers, host staging,
interrupt/event state, documented internal loopback and applicable modem
gating. Applicable original RS232/IrDA factory tests pass and return through
ENTER. UART transport remains decoded bytes: there is no bit-waveform,
baud-time or FIFO receive-timeout model. The admitted 49-family board condition
includes the documented infrared-related GPIO connection. See
[UART/IrDA](uart-irda.md).

Two browser tabs can pair through **Connections → Infrared** and exchange
original firmware traffic. The 49g+/48gII pair transfers and recalls objects in
both directions; all four 39g+/39gs source/destination combinations transfer
an aplet and export exactly the same 620 bytes. The production browser also
recalls `ORCHARD=12345` on 48gII after a 49g+ transfer and disconnects both
ends. Pairing keeps both tabs running under the link policy; manual pause,
reset, ROM/session replacement or a fatal error disconnects the pair. Review
fixed loss of an already-emitted tail byte when firmware disabled UART2 before
the host drained it. This is a two-instance virtual link, not host infrared
hardware or optical collision/range simulation.

The original 39 ROM infrared path reaches an external SRAM alias before any
UART traffic. The admitted `hp39-home` / `hp39gs-home` presets therefore now
select the explicitly conditional bank-1 low-address mirror, with the same
256 KiB physical RAM. Strict mode is unchanged, and legacy sessions retain
their saved decode condition. To use the new infrared path from an old
39-series session, export its objects, restart the original ROM under the new
preset and reimport them. Do not silently rewrite saved hardware conditions or
describe this hypothesis as a measured board decode.

Checkpoint v6 adds 4,377 scalar bytes after v5, then saves sorted changed flash
sectors after the existing RAM/boot SRAM/card payload. It validates all state
before mutation and retains v1–v5 imports. ROM identity uses the immutable
input; changed sectors can contain ROM-derived bytes, so sessions are private
too. Restoring a healthy state automatically resumes when the current focus
policy permits. A visible pause bar offers Resume; stopped states remain
stopped. See [sessions](sessions.md).

### Files, display and interface

Directory SD now persists a directory handle, aliases, common baseline and
card identity. Previewed two-way add/edit/delete/rename supports explicit
conflict choices and revalidation before writing. Mounted media follows
pause/eject/copy/preview/apply/reinsert/resume; cancellation guards each awaited
mutation boundary. A completed host-file write cannot be rolled back merely
because cancellation arrives afterward, and partial failure does not advance
the whole baseline. This is explicit synchronization, not an OS-mounted disk
or a background watcher. Native picker permission UI and an original-ROM
end-to-end native directory mount remain distinct from the real OPFS/IndexedDB
browser fixture and the stock SD-card tests. See [directory SD](directory-sd.md).

Wire labels match each original firmware menu. Opt-in next-RECV automation is
limited to recognized stable USB aplet/library catalogs on 39g+/39gs. It sends
ordinary physical keys only after the previous object completes, and cancels
on manual input, unknown screens or failure. Original two-object installs and
SEND round trips pass. It remains one firmware receive per object; reverse
Wire batch downloading and cross-catalog Note/program automation are not
implemented. Disk-drive receive remains available.

The LCD observer copies pixels/annunciators at completed scans without
changing guest state. Default Instant and optional 35 ms response are separate
from nearest/bilinear/bicubic/Lanczos-3 spatial scaling. Original 39gs/49g+
self-tests enable the LCD before replacing OFF text with ON text; the brief
old text is firmware order, not a hidden UI frame. Annunciator artwork follows
the official 39gs manual, without claiming physical calibration for every
model. Traditional landscape keeps F1–F6 with the LCD. Narrow screens retain
the display/soft keys while scrolling the main keys, and settings actions
remain reachable. Duplicate SD and Local device toolbar entries are removed.

### Original applications and known limits

Actual stock-install/use/exit/arithmetic witnesses cover native 2048, BabalPlus
and base-conversion programs on 49g+, the `.49` RPL converters on 48gII, and
Arkalite on 39g+/39gs. 2048 exposed legal DITHMODE `0x12210`, now stored/read
back alongside zero; undocumented pixel dithering phases are not invented.
The `.48` converter files load as strings on the admitted ARM 48gII firmware
and are not counted as successful program execution.

The exact user GBP 0.3 package fails in its unaligned loader BSS clear before
the player starts. A separate **GBP39 ALIGN4** diagnostic rebuild aligns that
boundary, retains the original `main.c`, and runs/returns on 39gs. Its 39g+
IRQ-return fault remains open. The original package is not relabelled as
compatible. Four-second actual diagnostic-game LCD samples show mean pixel
changes of 1.425/1.310/0.986 for after-slice/scan/scan+35 ms response, with
identical final guest checkpoints. Instant still shows real redraw
intermediates; neither complete flicker removal nor a CPU speedup is claimed.
See [39 programs](hp39-programs-r23.md), [49 programs](apps-r23.md) and
[LCD](lcd.md).

Native/reference/ASan-UBSan-LSan each pass 23 suites. Native and WASM each pass
1,203,654 default-plus-clock assertions; the optional physical-read corpus is
separate. Independent Unicorn has 17,075 matching cases and Clang analysis
has zero diagnostics across 51 C files. The final 32 MiB original SD workflow
has byte-identical v6 native/WASM continuation. Production Chromium passes
the seven-stage 16 MiB original SD workflow, automatic/manual restore and
legacy v5 migration. Keep physical board/clock verification, original
HP40gs/HP50g admission, broader native-program compatibility and SD DMA/SDHC
as explicit remaining work. Do not revive the retired native-device roadmap.

## Historical r22 continuation from 2ae6512 (2026-10-23)

The user requested mapped-key highlighting and model isolation, system keyboard
layouts and calculator-side binding selection, persistent connection/SD panels,
less LCD flicker, local ROM recall, a working factory-test shortcut, and SD
creation from local directories plus progress toward native virtual devices.
The work is split across keyboard/UI, LCD/core peripherals, directory SD,
ROM/sidebar integration, host connectivity, original-ROM validation and
independent review.

The wider keyboard editor now shows bound/custom keys and a clickable calculator
with binding badges. Defaults use OS-resolved characters; physical custom
bindings retain their codes, model isolation and eight-step limit. Layout-map
labels have explicit denied/unavailable and capture fallbacks. Connections and
SD share a persistent sidebar: hiding it retains inputs/drafts while the
calculator remains usable. The narrow layout stacks the panel below the machine.

ROM remembering is enabled by default independently of optional calculator
autosave. It stores a read-only original-file handle when supported and a
labelled local copy for the standard input fallback. Startup only queries
permission; explicit Continue reading/Open requests it. Every reopen rechecks
identity. Disabling recall cancels pending automatic reads, including an
off/on transition, without canceling an explicit Open. Forget removes browser
records, never the original file or current calculator state. This replaces
the old claim that ROM bytes are never stored locally; they are never uploaded
or included in exported sessions. See [ROM storage](rom-storage.md).

Directory SD imports recursively into a 16/32 MiB FAT16 draft with deterministic
8.3 aliases and exact file contents. Native directory handles support explicit
re-read and additive write-back; conflicting local changes/deletions are
preserved, and card deletion never removes host entries. The directory input
fallback imports without write handles or empty folders. An atomic Worker
copy/validation/eject returns mounted media to the editor before synchronization.
The association lasts for the page session, including insert/eject; it is not
a mounted operating-system drive. [Directory SD](directory-sd.md) records
capacity limits, conflict handling and separate fixture/original-ROM evidence.

The optional local-device helper now carries USB/IP requests to the existing
browser Worker and its original calculator state. Generated guests pass real
Chrome Worker/HTTP/USB-IP checks; original HP48gII/HP49g+ objects make exact
round trips through the production bridge modules under Node. Original HP49g+
also passes the production Chrome page and Worker: stock FLAGS/SERVER input,
exact 15-byte SEND/GET/FINISH through a user-space USB/IP peer, transfer while
another real tab has focus, preserved connection across sidebar hide/reopen,
disconnect and visually checked `1+1=2`. Manual pause,
reset, ROM replacement and session operations tear down the connection;
autosave and internal transfers are excluded while it is active. SD insertion,
export, edit/eject and removal are guarded in both controller and Worker,
with translated UI guidance; separate unmounted drafts remain editable.
Rapid reconnect waits for the old cleanup. Canceling an allocated but unanswered
session POST waits for its bounded reply and then deletes the session before
reconnecting; total reply loss uses the documented lease fallback. Same-calculator
connection identities reject late status from older attempts. OS attachment,
HP driver binding and unmodified Conn3x remain independent acceptance gates.

LCD presentation samples pixels/annunciators at observed completed scans and
reuses them for other requests during that scan. Canvas paints coalesce at
animation frames. Real blank frames, disable and invalid data remain visible,
and live display, PNG and recording share the same published image. This host
cache does not change guest timing or claim a physical row-fetch/panel model.
The [LCD record](lcd.md#host-presentation-synchronized-to-the-scan-counter)
retains its measured build and exact checkpoint comparisons.

The self-test controls send held ON/F4 and ON/F3 physical combinations. SPI0
reads on entry required a bounded two-channel [SPI implementation](spi.md),
and the 39gs/48gII/49g+ exit path required real [watchdog reset propagation](watchdog-reset.md).
Four unchanged ROMs reach their factory version pages, leave and calculate
`1+1=2`; 39g+ uses its different non-WDT exit. This is not a full factory-test
PASS claim. Checkpoint v5 appends 72 SPI bytes and a four-byte reset-hold counter,
retaining v1–v4 imports. External SRAM, card contents and independent RTC are
preserved across the declared watchdog reset domain.

The final production WASM is SHA-256
`51aded73e5d6cae3862fda4beec946118903dda97a39fccaa9fcf740214c8189`.
Native/reference/sanitizer each pass 21 suites, including SPI and watchdog reset.
Native and WASM each have 1,199,909 default-plus-clock assertions; the optional
physical-read WASM checks remain separate. Unicorn has 17,075 matching cases,
and Clang analysis is clean for 48 C files. The final 32 MiB original-ROM SD
gate passes with byte-identical v5 native/WASM continuation. The real HP49g+
browser passes all seven sidebar/card/manual/automatic-restore stages. That
probe caught a draft reset on tab hide/reopen: Mantine Activity retention was
replaced by explicit display-none retention, and exact-byte reinsertion now
passes. The directory evidence pins all 47 browser assets from that run.
The [validation page](validation.md) separates final integrated gates from
earlier component/peripheral evidence and records each tested asset identity.
Host-device work and final release checks are still consolidated there; a
source change or a local passing test does not establish deployed acceptance.

Continue with physical clock/reset/pad evidence, broader stock key and native
application coverage, UART2/IrDA, full original HP40gs/HP50g admission, and the
remaining OS-device/Conn3x and larger-media/DMA gates. Keep user ROMs, acquisition
sidecars, checkpoints, card images and stock LCD pixels private. The earlier
derived39gs fixture remains historical and is not a physical ROM capture.

## Historical r21 continuation from 6b1a15e (2026-10-23)

The user requested a dedicated Transfer settings tab, more buzzer work, the
landscape cut below FN, a fix for compatibility termination after inactivity,
Note upload over Wire, and localized warnings. Work was split across core
power, peripheral clocks/PWM, original-ROM workflows, Note formats/protocol,
React/layout, SD management, browser validation, independent core review,
transfer review and documentation agents.

All requested areas have implementation and final local acceptance. The
transfer Unlimited setting is under **Settings → Transfer** and uses normal
Apply/Cancel semantics. FN keys remain with the display in immersive landscape;
the source artwork is unchanged. Note upload converts stock HP39AscC to its
binary string representation, preserving calculator charset and HP escapes.
The correct receive catalog is **SHIFT → 0 / NOTEPAD → RECV**, then Wire on
39g+ or HP39/40 (USB) on 39gs. Programs and aplets still require their supported
object format. Wire remains one stock RECV per object. Error identities are
localized through the whole queue/Worker/controller path; technical details are
available separately. Retry and Skip preserve other batch items.

Natural Power_OFF is now modeled, including GPIO pull-ups, the disabled NAND
probe, retained state and reset-vector wake. Four original ROMs all enter
natural OFF after about five functional minutes, remain off, round-trip their
v4 state, wake on ON and continue arithmetic. A genuine r20 v3 session imports
and survives OFF/ON as well. Earlier failed sessions already stopped at an
unsupported instruction should be restarted or restored from a healthy save;
loading a newer core does not rewrite their recorded stop state.

PCLK now derives from the guest's clock registers and feeds PWM, watchdog, ADC
and SDI. The original 49g+ `440 .2 BEEP` is observed at approximately 434.028 Hz
and 0.201567 seconds between first/last edges in the 12 MHz functional model.
This corrects the former approximately 282.486 Hz / 0.30972 s path. Browser
AudioContext playback is verified. PLL settle/switch-phase and physical
clock calibration remain bounded, as detailed in the clock and buzzer docs.
Checkpoint v4 adds clock/PWM latches and phase, keeps v1–v3 import, and documents
which old unrecorded timing history cannot be recovered exactly.

SD drafts can rename files and populated folders, delete files and empty
folders, and reuse released space. Imported long names share one validated
namespace with short aliases; explicit rename/delete retires the associated
long-name records. Creation still requires an explicit 8.3 name. Final original
49g+ runs accept a host-edited image, read root/nested objects, write TEST, and
resume an in-flight full-card checkpoint identically on native and WASM.
Independent FAT tools validate the export. HP48gII FILES still works and has no
SD slot; no original HP50g acceptance is claimed.

Final production WASM: **133,810 bytes**, SHA-256
`36fe5da8630af83946503c76eab63f8dbb64274162b22eb06fd50f5a0d222108`.
The [validation page](validation.md) and [r21 release record](evidence/release-validation-r21.json)
pin source/assets and distinguish final production results from earlier
idle-only/PCLK preview observations. Native/reference/sanitizer each pass
19/19 suites; native and WASM each have 1,193,788 counted assertions; 45 C
analyzer files are clean; Unicorn passes 17,075 cases. Final original39gs
browser arithmetic, session, landscape and production Worker checks pass.
Fresh stock installation of the unchanged ROMstream V2 also completes the
whole double-read capture, visible progress, normal exit and USB reuse on the
final core. Public packages remain byte-identical to r20.

The release PR records the exact remote Build, merge, Pages and live-site
acceptance. Do not treat local source validation as evidence that a different
revision is deployed. Keep original NORs, immutable capture sidecars, card
images, checkpoints and stock LCD pixels private. No guest patch or synthetic
ROM admission is allowed, and no new artwork should be generated without the
user requesting it.

Continue with physical PCLK/PWM and power-retention evidence, remaining native
application scenarios and protocol corner cases, UART2/IrDA, and later SDHC/DMA
or FAT long-name creation when supported by explicit hardware/protocol facts.
HP40gs/HP50g require complete original captures before stock-ROM admission.
The older derived39gs fixture remains historical only: updater OS + generic
bootloader + constructed tail, not a complete physical capture.

## Historical r20 continuation from f24ed9b (2026-10-23)

The user requested optional unlimited-speed transfers, actual firmware sound,
an immersive landscape split at the bottom of the screen cover, further SD
support, extension-free file selection, and recovery after one failed Wire
batch item. They also supplied a complete original HP39gs capture and asked
what the former derived ROM represented. Work was split across independent
transfer, audio, layout, SD, original-ROM, core-regression and review agents.

All six feature areas now have implementation and focused checks. The transfer
switch overrides host pacing only in active protocol phases; waiting for stock
RECV, serving an idle directory, pause, cancellation, error and completion use
the selected speed. Wire exposes Retry, Skip and replacement selection while
retaining completed items. A delayed CAN from a canceled request cannot cancel
the next request before its own D/C/NAK handshake. A CAN after that handshake
still fails immediately. Real HP39g+ cancellation/retry/skip/reselection and
stock SEND verification pass on the production core. Help explicitly asks the
user to press ON and wait for reception to exit before reopening RECV.

Typed HP39 files and ZIPs are recognized by contents, without chooser suffix
filters. Object validation remains. HP39gs uses the stock menu name
`HP39/40 (USB)` (or Ser for serial); HP39g+ uses Wire. Reverse Kermit still
uses the stock Disk-drive path and remains slow. An Info-ACK retry handles a
lost initial directory response without resetting the overall budget. Nested
Kermit sessions use the outer service's remaining 15 minutes instead of
prematurely applying a fresh five-minute cap.

The original HP39gs image is admitted by full SHA-256
`a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff`.
Its own bootloader passes cold native/WASM replay, original browser arithmetic,
sessions, APLET and segments. Fresh Disk-drive installation and V2 execution
read all 64 blocks twice and return correctly; separate direct-USB installation,
reverse SEND and native error return also pass. The old derived fixture combined
official updater OS bytes with a generic 50g bootloader and a constructed tail.
Its OS region exactly matches this original capture; it was never an original
complete 39gs NOR or catalog admission. Keep its old evidence historical and
keep the user's capture sidecar immutable.

Firmware sound observes GPB2 GPIO / Timer2 TOUT2 into a bounded host queue and
plays PCM after a browser gesture. It does not alter guest timers or checkpoint
bytes. Pause, reset, restore, mute and disposal clear playback; Unlimited drops
old audio rather than accumulating delay. Original HP49g+ BEEP and actual
Chromium playback pass, but its 440 Hz / 0.2 s request currently yields about
282.486 Hz / 0.30972 s on the functional clock. Physical pitch, duration and
peripheral-clock calibration remain work, not completed hardware fidelity.

Immersive landscape clips the existing artwork into two pieces, display left
and keyboard right, with one LCD and the original 51 hit regions. Four admitted
models, desktop/landscape-phone/portrait-phone viewports and multiple zoom levels
have real browser geometry/input coverage. Original HP39gs APLET/HOME also works
in this layout. Do not generate new artwork unless the user asks for it.

SD preparation now supports browsing, extracting, creating short-name folders,
adding arbitrary file bytes, exporting and inserting an unmounted FAT16 draft.
New names are explicit 8.3 names; existing LFN records are preserved through
their short aliases. Duplicate/malformed/full-image errors retain the previous
complete draft. Mounted cards remain exclusively owned by the Worker. Real
49g+ reads root and nested host-prepared objects, writes another object without
changing them, and continues complete-card partial-write checkpoints identically
on native and WASM. The 48gII has no SD slot; its FILES path remains checked.

The final core is 123,871 bytes, SHA-256
`1cffba4fb7bbdf9a8b203dfd999fc5071f1bb773f665c5699725484575916db7`.
Normal pacing, ARM execution policy and guest physical-key timing are unchanged.
The [r20 validation](validation.md) and public JSON records distinguish exact
tested bundle versions, core results, original-ROM observations and synthetic
component tests. The last UI-only update clarifies ON/reopen timing; it does
not change the tested protocol modules. A prior recovery harness entered IrDA
before the ROM had settled; keep that failed run distinct from the genuine
stale-CAN fix. UART2 remains unsupported rather than returning fake empty data.

Continue with physical-clock/audio calibration, reverse-transfer efficiency,
FAT management extensions and missing original model captures using independent
evidence. Do not publish ROMs, original sidecars, card images, checkpoints or
stock-OS pixel data. V2's refreshed download contains unchanged calculator and
receiver binaries plus current verification metadata. Verify PR Build, merged
Build, Pages and live assets before claiming publication; the release PR owns
those per-revision results.

## Historical r19 continuation from eb1e18b (2026-10-23)

The latest user report supplies four concrete targets: slow or apparently
stalled HP39g+ reception, HP49g+ FILES failure, SD media on models with a slot,
and the HP39gs reader's invisible progress / failed extraction. Three agents
work on transfer/protocol, controller/FILES and reader/acquisition, with
cross-reviews of the WASM media adapter, receiver and asynchronous saves.

HP39g+ now has a direct Wire upload mode, using the stock `HP39/40 (Wire)`
receiver over internal USB. Whole-package validation and library-first ordering
precede the first send; each object still requires another stock RECV selection.
The unchanged user ZIP completed both uploads in 13.138 seconds in one
coordinated Normal-speed browser observation. Stock SEND then exported the
aplet and library back for byte/body/alias verification and a ZIP download.
That reverse Kermit leg took 184.716 seconds and is not advertised as fast.
The precise assets, windows and limits belong to the transfer evidence; these
times are not CPU benchmarks or physical-link claims. Transfer bytes and waiting
time remain visible with the connection panel closed. Cancel stops the sender;
if the calculator remains in RECV, the UI tells the user to press ON.

HP49g+ FILES had two independent blockers: ordinary empty-slot SDIDAT access,
then a stock read one word beyond the 512 KiB SRAM boundary. The HOME preset
now declares the existing bank-1 mirror decode with unchanged physical
capacity. Strict core defaults remain exact-range. The [SD implementation](sd-cards.md)
adds bounded SDSC PIO, actual image reads/writes and complete media checkpoints.
The stock OS creates TEST=42, copies it into port 3, recalls it and produces
the corresponding FAT16 file; the exported bytes are independently parsed.
HP48gII no-card FILES navigation is also covered. It has no physical SD slot.
The HP50g controller profile does not substitute for its missing full-NOR
acceptance.

The browser creates a 16 MiB FAT16 card, imports 1–32 MiB raw images and exports
or ejects inserted media. Version-3 manual sessions and binary IndexedDB
autosaves include the full card. Legacy session versions 1/2 and small
localStorage saves remain readable. Writer-token transactions, stale-generation
checks and explicit replacement confirmation protect the previous complete
save. No ROM is persisted. Invalid model creation also preserves the current
card binding.

Deliver the complete [HP39gs ROMstream v2 package](hp39gs-rom-dump.md), with
source and a Windows receiver. It repairs the old reader instead of claiming
unchanged reuse: visible progress, safe lower L1 slots and private L2 mapping,
already-connected-cable handling, bounded control transfers and explicit exit
paths. The final program reads all 64 blocks twice, returns to HOME for `1+1=2`
and permits stock USB reuse on the original HP39g+ NOR and on a separate
39gs 2.22 original-OS fixture. The latter combines the official updater with
a generic boot fixture; it is not a full physical HP39gs capture or canonical
39gs boot. The user's physical full-image run remains the next acquisition
step, with no preliminary short probe requested.

The CPU execution policy, Normal pacer, functional clock and physical-key dwell
are unchanged. The withdrawn performance candidates remain disabled. This
round advances controller, transfer, persistence and model-acquisition roadmap
items; it does not claim faster HOME arithmetic or APLET execution.

The current validation and public evidence separate final-core runs, the
earlier Wire timing asset identity, original NORs, the derived 39gs fixture,
and physical hardware still awaiting observation. Preserve failed trials and
their causes. Do not publish ROMs, standalone SDK tools, private checkpoints,
card images or private stock-OS LCD captures. The reader's own progress/error
screens are a documented public example; its licensed calculator objects and
corresponding sources belong only in the separate reader download.
Verify the actual PR, merged Build, Pages deployment
and live assets before reporting publication.

## Previous continuation from d199afd (2026-10-23)

The user supplied both earlier conversations, the existing hpclang HP39g+
ROMstream package and a complete 2 MiB HP49g+ capture. The latest instruction
is to implement usable 49g+ support and HP39/40 transfers, deliver a complete
39gs reader without another preliminary probe, and continue measured CPU
performance work. The interrupted r17 implementation was recovered and
preserved as `9377548`; the subsequent r18 work builds on that exact tree.

The supplied HP49g+ NOR is admitted by its full SHA-256
`3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab`.
Its exact 512 KiB SRAM and empty-slot SDI controller support unchanged startup,
131×80 display, arithmetic, CAS, graphing, menus, sessions and USB Kermit
workflows. [Native ARM execution](hp49-native.md) follows the stock USB and
ARMToolbox route, including a warmstart, RPN launch and ON return. The
[model record](hp49-startup.md) lists explicit pad/ADC/LCD conditions. Empty SD
slot support does not implement SD media, UART2/IrDA or NOR program/erase.

The [HP39 Disk drive host](file-transfer.md) now serves catalogs and typed
objects through the original system's Kermit client. Original HP39g+ USB can
install the reader aplet and library, SEND them back, download a standard ZIP,
and install that ZIP in another freshly cold-booted machine. ZIP import accepts
the existing user package directly; export reconstructs only the fixed catalog
entry omitted by stock SEND, preserving original aliases and object bytes.
Input, expansion, CRC, file count and retained-download limits remain bounded.
HP39gs/40gs protocol availability is distinct from their still-missing original
NOR acceptance. The browser link is internal; desktop Conn3x interoperability
and the host-OS USB/IP bridge still need their own device-level evidence.

Deliver [hp39gs-rom-dump-v1.zip](../downloads/hp39gs-rom-dump-v1.zip) directly.
It contains the independent Windows receiver and all four original calculator
files, corresponding source and licenses. The entire package has been rebuilt
byte-for-byte; its current identity is recorded in the
[SHA-256 checksum](../downloads/hp39gs-rom-dump-v1.zip.sha256).
One launch reads every 16 KiB block twice and writes a complete 1 MiB image
plus its JSON. START opens the aplet; ENTER launches the reader. USB disconnect
returns to the OS after the receiver reports completion. No separate return
or short-read probe is required. This is a 39gs/39g+ package, not a 2 MiB
HP40gs reader. Physical HP39gs and Windows HID execution await the user's
full capture; original HP39g+ emulator execution is separately witnessed.

The CPU continuation implemented a quiet-interval loop and a separate cold
rollback-function candidate. Both preserved full machine behavior but failed
the predeclared Chrome performance conditions, so both were withdrawn. The
production CPU/MMU/scheduler remain the restored r17 implementation; the new
48,561-check scheduler regression is retained. The
[performance record](performance.md) includes all candidate identities, samples
and the independent withdrawal review. No additional HOLD branch was created,
and no new HOME/APLET speedup is claimed. Earlier HOLD candidates remain disabled.

The current [validation record](validation.md) separates recovered evidence,
fresh final-build runs, generated fixtures and original-ROM workflows.
Published CI and Pages identity are checked for the actual merged revision.
Do not publish ROMs, SDK binaries, checkpoints, private user objects or raw
LCD captures. The earlier sections below are historical and do not reinstate
their superseded requests for extra capture probes.

## Previous continuation from 640a229 (2026-10-22)

The user's latest instruction resumes three parallel lanes: measured `1+1` /
APLET performance work, browser file transfer toward Conn3x replacement, and
unsupported-model research with the user's HP39gs / HP49g+ machines available
for capture. This supersedes the older request below to defer those captures.

The production CPU and clock/input policies are unchanged in this continuation.
The isolated [ARM operand-pair profiler](arm-block-profile.md) now distinguishes
operand forms, GPR and NZCV dependencies, and fixed disjoint pairs. All three
HP39g+ scenes preserve full architectural checkpoints, LCD, UART, instruction
counts and key contacts. Simple independent MOV pairs cover only 4.20% / 5.02% /
5.15% of all fetches; ADD-immediate to CMP-immediate is a distinct `1+1`
candidate. No host timing was sampled and no speedup is claimed. Preserve the
prior HOLD candidates until a materially different implementation passes the
same functional and browser timing gates.

HP48gII [file workflows](file-transfer.md) now expose upload, GET, Receive,
directory and FINISH over both internal USB and UART0. A complete serial
production-browser witness covers active calculator SEND and another GET on
the same connection without USB. Both transports also complete two-object
upload batches and actual downloads with unchanged 37-byte object bodies.
The only full-file difference is the original system's binary-header C-to-B
revision. The UI keeps the selected connection across modal reopen. A complete
batch is validated before its first send; each subsequent request waits for
the preceding final ACK, and failure/cancel/lifecycle transitions stop the queue.
The 16-file/8-MiB bounds are deterministic-test coverage, not stock maximum-
capacity evidence. [Published summary](evidence/file-workflows-r16.json) pins
the tested assets and retains the earlier modal-reopen failure identity.

The [HP39gs return probe](hp39-return-probe.md) is a ready-to-transfer minimal
aplet, with the 39-specific L275 rebuilt byte-for-byte from source and distributed
with its corresponding source/license. Its single ARM instruction is `bx lr`;
it does not read Flash. Hardware installation, visible return and responsive
HOME still require the user's observation before implementing a bounded read
probe. The [HP49g+ staged read package](flash-capture.md) remains the other
capture path, with version, short samples and address mapping to verify first.
Neither package admits a new emulator model. HP39 uploads, complete remote
management, physical/host-OS connection, and all-model cold boots remain open.

Local validation covers native/reference/sanitizer regressions, the production
WASM and independent CPU oracle, controller/Worker/lifecycle cases and real
browser behavior. Keep GitHub Build, Pages deployment and published asset/revision
checks separate from these local results. ROMs, raw captures, sessions and full
browser/profiler reports stay in ignored local directories. The sections below
retain the previous sequence of work and its narrower historical scope.

## HP39 release gap after PR #2 (2026-10-20)

The continuation from merged `ac16d1d` changes only the HP39 calculator release
gap: **125/50 ms** replaces 125/75 ms. The press remains 1,500,000 quanta, and
the gap is now 600,000. HP48 stays at 50/30 ms; the workbench stays at 2M/2M.
The Worker retains legacy `run()` and the existing functional clock. Neither
research runner nor experimental physical reads is enabled by this change.

The isolated 125/30 ms trial failed immediately because the ROM missed the
second `1` in `1+1`. The selected 125/50 ms timing passed 80 arithmetic
executions across 74 distinct expression/phase combinations, checking every
LCD pixel and all physical contacts. Independent repeated-key `11+1` and
ALPHA/`KeyA` checks passed another 32 executions: 16 old-gap references and
16 new-gap cases. The final frame is checked after release and the final gap.
See [the current gap record](performance.md#hp39-release-gap-follow-up-2026-10-20)
and [input behavior](interaction.md#hp39-release-gap).

The four-key ENTER contact moves from 600 to 525 ms in functional-reference
time. This is a 75 ms queue reduction, not a browser wall-time result. A single
APLET click has no earlier queued key and gains no shorter initial contact.
`tools/probe-interaction.mjs` retains its explicit historical 125/75 ms HP39
witness; use `probe-input-dwell.mjs --runner run --hold 1500000 --gap 600000`
for current timing experiments. Historical records below retain their original
numbers and must not be read as current default timing instructions.

## Visible calculator latency after PR #1 (2026-10-20)

The PR #2 continuation started at `0215f19`. The calculator retains its
previous `run()` default and single-step behavior. `run_idle()` and
`run_clocked()` remain explicit research APIs, with their core implementation,
independent oracle and scene tools preserved. The first implements guest
CLKCON.IDLE at one CPU slot per peripheral quantum; the second also models
CP15 bus mode and CLKDIVN ratios. Both default activations were withheld after
browser measurements exposed regressions or unexplained slow samples.
Existing `run()` and `run_divided()` semantics remain available; the
workbench/native host also keep their legacy selection. Experimental physical
reads remain disabled.

Both new APIs respond to guest `CLKCON.IDLE` writes with CPU sleep,
peripheral advancement and interrupt wakeup. Trigger on each aligned word write
of bit 2, never on the retained bit's level; the bit does not clear on wake.
The run-policy flag is host-only and reset at API boundaries. Checkpoint version
1 already stores the sleeping state. Legacy runners preserve their earlier
register-only behavior, and the wrapper acknowledgement delay remains uncalibrated.

The [PR #2 scene record](performance.md#calculator-clock-ratios-and-visible-latency-2026-10-20)
targets `1+1`, Aplet Library and Function START. The early 576→170 and
1,022→281 ms observations describe functional-reference time under a rejected
ratio policy; they are not browser gains of the shipped default. Ratio plus
IDLE also regressed HP39 `1+1` in all three browser rounds (median first-key
latency 1,251→2,244 ms). The later one-slot IDLE candidate passed all 36
browser scene outputs, but Library medians were 1,017→2,616 ms, with candidate
samples of 2,881/2,616/1,168 ms. Those host-time observations remain unresolved.
Its arithmetic guest instruction reductions are research evidence and are not
enabled benefits of the shipped calculator. Use the
[PR #2 acceptance](https://github.com/maxmixalex/orchard-emu/pull/2) for the exact
retained scope, candidate identities and negative evidence. HP39 50/30 ms key timings
lost `7*8` at another phase even with the faster CPU policy, so PR #2 retained
125/75 ms. Its separate 100/60 ms trial also lost `1+1` at +12,000 quanta under
one-slot IDLE; the retained timings pass all 16 phase cases. HP48 retains
50/30 ms. The production Worker limits calculator calls
to 1,024 peripheral quanta and at most 1,024 CPU slots between I/O drains.

Normal still uses the provisional 12 MHz peripheral/RTC timebase. PLL and
slow-mode absolute frequency, instruction/bus costs and the separate LCD HCLK
domain are open. Remote acceptance belongs to the new performance PR's exact
head, Build and Pages evidence. The earlier handoffs below describe older
releases and must not override this continuation's measured policy decision.

## Current performance work from 83a2d38 (2026-10-20)

Use [maxmixalex/orchard-emu](https://github.com/maxmixalex/orchard-emu) and its
[published calculator](https://maxmixalex.github.io/orchard-emu/emulator/).
The earlier owner URLs and issue/run numbers in the historical entries below
are not the current publication destination.

The release retains the paced Worker improvement, which prevents a caught-up
pump from spending an entire task executing tiny earned allowances, and the
two boot SRAM pointer corrections. The new normal-NOR/physical-SRAM WASM read
specialization is now **experimental and disabled by default**. This isolates
the core candidate involved in the unclassified stop below while preserving
the independently measured Worker benefit. Live descriptor checks, exact key
boundaries and the original functional clock remain. Do not switch the UI to
the opt-in divided runner or shorten the validated HP39 key dwell based on
throughput figures.
The CPU halfword/block/Thumb rollback prototype was withdrawn because its
full-workload timings were inconsistent; its comparisons and benchmark remain.

[Performance](performance.md#physical-reads-and-worker-pacing-2026-10-20-from-83a2d38)
owns the exact baseline, measured artifacts, same-input results and new tools.
[Validation](validation.md) records the current gates. A rare HP48 Unlimited
core stop after a correct browser result remains explicitly recorded there;
passing replays alone must not be substituted for explaining that failure.
The fast-read candidate passes a separate 24-trial/48-expression Chrome sweep,
but those passes do not classify the original stop. That core candidate must
remain opt-in until a captured failing trace or other causal evidence resolves
the risk. The default release instead restores baseline physical-read dispatch;
the merge decision applies to this narrower scope. See the
[release scope](performance.md#release-scope-after-stop-review) and
[PR #1](https://github.com/maxmixalex/orchard-emu/pull/1) for its acceptance.
The earlier full candidate remains preserved in `aba2923`, whose remote tree
exactly matches the recovered local `4959a63` snapshot. Commit `f95232a` adds
read-only pull-request CI on GitHub-hosted runners; Pages continues to require
a successful exact-current-main build. A submitted workflow is not a passing
run or a deployed site.
The maintained browser probe preserves future
stop observations and recovers a private Save checkpoint for diagnosis.
Continue physical clock/input calibration and broader OS use from this state,
preserving the original failed trial and keeping ROMs/checkpoints private.

The new [input timeline record](performance.md#physical-contact-input-timeline)
separates queued taps from the actual Enter contact and sampled result pixels.
Eight sampled profiles match four unsampled baseline runs in their complete
checkpoints, pixels, UART and physical-key events. At the unchanged functional
timebase, the HP39g+ `1+1` witness is 600 ms to Enter and 576 ms after Enter;
the latter contains about 6.912M counted instructions. These fixed guest phases
are not directly interchangeable with earlier browser wall-time samples.
Do not shorten hold/gap timings or select the divided runner based on this
measurement alone. Profile the post-Enter guest execution and clock relationship
next. The additional AL/condition-table prototypes were not adopted because
their exploratory timings were unstable; their raw reports were lost during
the rollback and are not retained as performance evidence.

The input attribution was subsequently preserved in commit `db2aa40`. A second
eight-profile experiment observes clock registers at existing core-call
boundaries and matches every earlier measurement field and final checkpoint.
It captures CLKSLOW transitions between `0x30` and zero during input, with
frequent CLKCON changes. Use these observations to investigate the clock and
power model alongside post-Enter guest work; initial divider values alone do
not calibrate physical speed. The existing production runner is unchanged.

The [opt-in stop trace and replay tools](performance.md#opt-in-stop-capture-and-replay)
capture the first stopped checkpoint before Pause releases keys. A bounded
HP48gII Unlimited diagnostic group passed four same-WASM replays, covering
105,412 API calls and 52,240 run calls. These instrumented traces have different
actual browser input phases and are not A/B timing samples. Preserve the old
failure and keep the physical-read experiment disabled in normal builds. Use
a future captured failing trace to establish its cause; successful new traces
do not classify the old stop. The fixed-WASM Worker CPU measurements remain
applicable to the retained scheduling change, independently of the withdrawn
default core optimization.

## Earlier handoffs

The HOME continuation has been reconciled on top of remote `6372cbe`, not
force-applied over it. Its exact source tree was verified before merging.
Keep the upstream x16 adapter in `src/nor.c`; there is no duplicate in the bus.
Both upstream NOR regressions and the local memory/SRAM regressions remain
active. The shared probe budget parser retains its rejection tests, with an
explicit 500-million-tick upper bound for the maintained startup witness.

[Startup](startup.md) owns the fixed original-NOR HOME/two-calculation record.
[Web](web.md) owns the new experimental setup and physical-tap interface.
[Validation](validation.md) distinguishes native/WASM replay, production
Worker tests, offline layout inspection and the still-blocked browser-origin
E2E. Issue #1 owns the exact accepted commit and observed CI/Pages outcomes;
local checks alone do not imply remote acceptance.

Next: verify production-page load/input/lifecycle on an allowed origin;
expand real-OS key/use/reset coverage and persistence; independently resolve
SRAM address wiring, LCD `+0x68` and panel mapping. Do not relabel the declared
HOME experiment as a fully verified board or all-six-model gate.

The user's later HP39gs/HP49g+ complete NORs remain deferred. Do not request
them now, restart the retired dumper or make the blocked forum attachment the
main task. HP39g+ NOR part identification and HP50g GET_CONFIGURATION remain
separate open items. Ordinary CI and production packages stay ROM-free.

## Historical continuation from 1001d15

Skins are build-time pinned/hashes checked, served locally under the emulator
subdirectory, separately Apache-2.0 with NOTICE. Build creates one tested `orchard-pages` artifact containing documents and
the application. Pages consumes that exact successful main run without
reinstalling a compiler. Do not replace the established document URLs.

HP39g+ now has conditional HOME/arithmetic with its own 1 MiB NOR hypothesis
and exact SRAM. Shift/Alpha segment changes were observed on 39g+ and 48gII.
Do not describe the 39g+ path as still blocked at the old unspecified-part
write, or describe the new segment strip as merely a host key highlight.
Physical hardware assumptions and browser-origin E2E remain open.


## Publication continuation after 2e02b32

Build #15 succeeded, but the first combined Pages run #12 failed during an
APT proxy outage before deployment. A pushed workflow was not a deployed site.
The corrected pipeline promotes only an exact, successful current-main Build
artifact, verifies all assets before upload, and rechecks main before deploy.
The deployed revision and each emulator asset are checked over HTTPS afterward.
Tests live in `tests/pages.py`; `npm run test:pages` is ROM-free. No runner
proxy, Docker daemon, package source or browser policy was modified.

`pagehide` now pauses/releases rather than terminating the Worker, since the
page may be retained in the back/forward cache. A persisted `pageshow` stays
paused. `tests/lifecycle.mjs` checks dispatch through EventTarget, not an actual
browser-cache round trip. Browser-origin verification remains blocked locally.

## User frontend and performance continuation

The default page is now the user calculator with automatic ROM identification;
`debug.html` preserves the research workbench. Continue using the latter for
strict mode, unknown ROMs, state/event export and component investigations.
The two consumers share one Worker/core; `audience` controls snapshot detail.
Do not put CPU counters or experimental boot-setup controls back into the user
page. Keep current compatibility limits in short help and the documentation.

The main CPU cost was repeated passive-keyboard/EINT evaluation, now guarded
by exact dependency comparison. Level sources must still reassert after W1C,
edge sources must not, and group masks are remapped every tick. Retain the
reference algorithm and differential test when changing this optimization.
CPU rollback checkpoints and guest timing are preserved. WASM uses O3, LTO
and bulk-memory lowering; no JIT has been added. The successful Worker budget
updates its host tick count without a per-call debug snapshot allocation.

See performance.md for the measured ~6× fixed-workload result and follow-on
profiling targets. The ROMs, raw timing/state reports and layout previews are
local-only evidence and must not enter production or Pages packages.

## Execution continuation from 2042ad8

The same user/debug UI now uses exact-width checked memory reads, a conservative
ARM no-checkpoint path and a 64-entry host translation memo. Every hit checks
live descriptor words and translation context; MMIO/aliased table storage and
NOR ID mode take the uncached bus path. Do not replace these checks with stale
TLB-like semantics. Offsets are relative to the current machine arena and reset
clears them. Saved-session import treats this as disposable host state.

`ORCHARD_REFERENCE` disables EINT memoization and these execution optimizations.
`tests/execution.c` compares the full checkpoint/walker paths; the independent
Unicorn corpus and full original-system cold replay also pass. Full-workload
speed is approximately 1.30x relative to already optimized 2042ad8 in this
session, not an additional 6x and not a measured hardware speed ratio.
Publication acceptance belongs to issue #1, not an assumed successful push.


## Continuation from 980e1ec

The next-event scheduler materializes all delayed phase increments at MMIO and
public run boundaries. Preserve the exact per-tick reference and the directed
ADC/USB-latch/timer regressions; merely measuring speed is insufficient. Its
quiet intervals never skip guest instructions, timing events or fault checks.

Portable checkpoint APIs and user-facing Save/Load session now exist. The
serialized format excludes immutable NOR and disposable host caches, is bound
to the ROM identity and imports atomically. Schema changes require versioning.
Do not describe this as automatic storage, native warm reset or a completed
browser file-picker/download test. Continue broader original-OS use, physical
hardware validation and decoded CPU work without blocking on deferred dumps.

## Settings / timing continuation on 0b16b6b

The ordinary UI has been refactored into a viewport workspace and native modal
settings/connection controls. `preferences.js` owns validated per-model mapping
and optional localStorage records; `pacing.js` owns wall-time credit only;
`virtual-usb.js` advances an actual bounded EP0/packet host without running CPU
instructions itself. Debug stays unlimited with historical physical-tap timing.
The user Worker uses model-specific validated taps; avoid undoing the HP39
longer dwell after the short multiply-loss counterexample.

Core changes are deliberately small: one functional-timebase export and a
reference-tested WFI skip inside already-known quiet windows. The clock-rate
fix is not a calibrated PLL or invented cursor overlay. Physical clock-domain
work remains pending. Raw UART/USB controls are not Conn3x/file transfer.

Autosave copies between core runs, does not interrupt active taps/EP0 jobs,
never includes ROM and guards stale async results. Exit saving is best effort.
No private session, ROM or report is added to source or Pages. Re-run actual
production Worker tests, real-NOR short-key and fixed startup witnesses, and
then verify the accepted CI artifact. Documentation and issue #1 must retain
the separation of local checks, remote builds, asset deployment and browser E2E.


## Historical React frontend recovery

Do not retry the old incomplete compressed React transport. The missing frontend
was rebuilt and the standalone host prototype recovered/checked locally. The
production C core stays unchanged: two attempted optimizations were not worth
shipping; their directed tests remain. Publish the current tested tree rather
than repeating historical performance claims. See react-ui.md, host-mode.md and
the top of validation.md. Real browser-origin and OS/Conn3x gates remain open.
