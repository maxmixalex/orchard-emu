# Orchard roadmap

The [development board](board.md) tracks current work. This roadmap defines
milestones and their acceptance criteria; [validation](validation.md) records
bounded results. Each source revision needs its own Build and Pages evidence.
A profile, passing test or published asset does not establish physical hardware
behavior or complete model compatibility.

## Project target

Run unchanged complete physical NORs on HP39g+, HP39gs, HP40gs, HP48gII USB
revision, HP49g+ and HP50g. Execute each guest's ARM Saturn interpreter and
native ARM applications through one original MIT C17 core for native and WASM
hosts. Provide usable calculator controls, persistent sessions and virtual PC
file transfer, without ROM patches or host-side Saturn interception.

External emulators remain research or separate-process comparison tools.
Firmware and private calculator data remain outside source, releases and Pages.

## Current functional acceptance

| Area | Implemented and observed | Remaining boundary |
| --- | --- | --- |
| HP39g+ D1.55 | Unchanged cold boot, HOME/arithmetic, browser controls, Disk drive and direct Wire installation including Notes, reverse SEND; full native ROMstream dump/return; inactivity shutdown and ON resume | Explicit board/LCD assumptions; broader reverse-SEND throughput/recovery, native-program and sustained-use coverage |
| HP48gII USB revision | Unchanged cold boot, arithmetic, sessions, USB and UART0 Kermit workflows, two-file browser batches, no-card FILES navigation, inactivity shutdown and ON resume | Explicit SRAM mirror/LCD assumptions; no physical SD slot; broader keypad, power-mode and long-run checks |
| HP49g+ | User's full 2 MiB capture, unchanged cold boot, 131×80 display, arithmetic, CAS, graphing, sessions, USB/native ARM workflows, FILES and SD image read/write, shared-PCLK BEEP, inactivity shutdown and ON resume | Explicit SRAM mirror/LCD conditions; physical IrDA timing, SD DMA/SDHC, unsupported flash modes and physical-board calibration remain open |
| HP39gs | User's complete 1 MiB capture and its own bootloader, HOME arithmetic, APLET, browser sessions, Disk/Wire installation including Notes, native ROMstream dump/return/USB reuse, inactivity shutdown and ON resume | Explicit SRAM/GPIO/ADC/LCD conditions; broader transfer, sound, native-program and sustained-use coverage |
| HP40gs / HP50g | Model profiles and scoped boot-region/updater research | Complete original NORs and independent stock acceptance |

Details: [HP39g+ startup](hp39-startup.md), [HP39gs startup](hp39gs-startup.md), [HP48 startup](startup.md),
[HP49 startup](hp49-startup.md), [SD cards](sd-cards.md), [file transfer](file-transfer.md),
[full HP39gs reader](hp39gs-rom-dump.md), [power management](power-management.md).

The current browser continuation adds model-specific, layout-aware
[keyboard editing](keyboard-settings.md), persistent connection/storage sidebars,
[local ROM recall](rom-storage.md), and [directory-backed SD preparation](directory-sd.md).
[LCD publication](lcd.md#host-presentation-synchronized-to-the-scan-counter)
now follows observed completed scans. [SPI](spi.md) and
[watchdog reset propagation](watchdog-reset.md) support the factory-test
entry/exit path without patching firmware or substituting diagnostic results.
Exact build identities and evidence boundaries remain in [validation](validation.md).

The [r25 compatibility continuation](compatibility-r25.md) adds unchanged
Tetris+ play/return, sustained keyboard and touch contacts, short-window
layout fixes, original HP39gs serial Wire batches and convergent directory
changes. Its acceptance matrix separates downloaded native programs, guest
Saturn/RPL programs, production-browser workflows and generated regressions.
These completed flows expand the gates below; they do not convert missing
original images or unmeasured board behavior into a percentage of support.

## M0 — Repository, contracts and reproducibility

**Engineering baseline implemented; verify each revision.** Native/reference/
sanitizer builds, WASM, bounded diagnostics, exact-size immutable NOR loading,
license separation, strict documentation and publication allowlists are maintained.
The live deployment promotes the exact successful main-branch artifact.

**Gate:** a fresh checkout builds, all maintained checks pass, documentation and
support claims agree, production artifacts exclude firmware/test/private data,
and the deployed revision is independently observed. The original M0 acceptance
on `ecc0470` remains historical, not proof for later changes.

## M1 — ARM920T functional correctness

**Initial implementation and bounded independent oracle; complete conformance open.**
The independent Unicorn comparison covers common ARMv4T instructions on native
and test-WASM. It does not certify all ARM920T privileged/MMU/cache semantics.
See [CPU oracle](cpu-oracle.md).

Remaining work covers decode restrictions, pipeline PC semantics, shift/carry/
overflow edges, ARM/Thumb changes, banked registers, privilege and exception
returns; CP15, FCSE, descriptor permissions, domains, aborts and vector relocation;
precise partial transfer/writeback, cache contents/timing and implementation-defined
cases. Separate 64-entry instruction/data TLBs now retain guest translations,
implement the documented CP15 invalidation and lockdown operations, and survive
version-7 checkpoints. This functional subset and its independent instruction
cases are described in [ARM920T translation](arm920t-tlb.md); it is not complete
cache, pipeline or hardware-timing conformance. Unsupported behavior remains explicit.

ARM/Thumb multiple loads now retain word ordering at unaligned addresses when
alignment checking is off, without changing ordinary LDR rotation. The
deterministic ordinary STM base-in-list choice enables original HP-GCC context
save/restore; its architectural UNPREDICTABLE field, conflicting Samsung text
and physical-validation limit are explicit in [ARM memory behavior](arm-memory.md).
The subsequent source review also implements the six missing documented CP15
ID-read aliases, with fixed instruction encodings and independent expectations.
The [core follow-up](core-next-r25.md) retains its distinct build identity and
separates this completed fix from the remaining exception and abort work.

**Gate:** independently derived cases and bounded instruction differentials pass,
failures reduce to precise input/state witnesses, and sanitizers pass. Comparing
two Orchard builds is a regression check, not an independent CPU oracle.

## M2 — SoC and physical board behavior

**Functional pieces implemented; canonical board gate open.** SRAM, GPIO drives
and bias, passive keyboard circuits, unfiltered EINT, IRQ arbitration, timers,
RTC/watchdog reset, LCD frame interrupts, normal ADC, USB PIO/packet transactions,
two bounded SPI channels and an SDI controller with SDSC media cover observed
paths. Selected SST39VF1601 /
SST39VF800A devices provide array/software-ID, word program, sector/block/chip erase, busy polling and bounded VF1601 erase suspend; both original HP39gs and HP49g+ quick/full FLASH WRITE tests pass. See [NOR programming](nor-write.md).

PWM, watchdog, ADC, SDI and SPI share the functional PCLK derived from guest clock
register writes, with fractional phase, peripheral gates and buffered PWM
reloads. RTC time stays independent. The [Power_OFF model](power-management.md)
executes the original reset-vector wake path while retaining external SRAM,
RTC and SD media; four admitted original ROMs pass inactivity/ON continuation.
The SPI subset uses shared PCLK and resolved external pin inputs; it has no
invented attached-device reply. Watchdog expiry now propagates a 128-PCLK reset
pulse, preserving the declared external-memory/media and independent RTC
domains before the original reset vector executes. This path is separate from
host Restart and retained Power_OFF wake. The SDI subset models command duration, absent-card timeout, status/IRQ, clock
gating, a PIO FIFO and reads/writes of an actual host-owned card image. It does
not implement DMA or SDHC. The original
HP39 reader uses both documented 2410X/2410A MAXP addresses; their functional
compatibility is recorded without asserting a silicon alias.

Remaining work includes measured board input clocks, PLL lock duration,
physical reset and power-rail behavior, shared-prescaler startup phase, verified
component identities and pad bias, LCD/annunciator routing, unsupported flash modes,
DMA, larger SD media, attached SPI devices and further peripheral modes.
Digital input filters and physical reset/clock-switch transients remain open.

**Gate:** one model's dependencies follow independently supported register/pin
behavior with unchanged firmware and no unverified readback shortcuts. Current
counted LCD `+0x68` idle-zero and packed-memory display assumptions do not close it.

## M3 — Genuine stock execution and native return

**Four conditional stock systems with bounded native-return witnesses.**
HP39g+, HP39gs, HP48gII and HP49g+ execute their own reset/startup and physical inputs.
Their ROMs remain unchanged. The admitted HP39g+, HP39gs, HP48gII and HP49g+
presets use explicitly declared bank-1 SRAM mirror conditions while retaining
fixed physical capacity. Strict mode and legacy saved decode conditions remain
unchanged. All retain stated GPIO/ADC/LCD conditions.

The original HP39g+ system installs ROMstream through its real USB file client.
The revised v2 reader reads the full NOR, shows block progress, returns after
disconnect and leaves HOME able to calculate `1+1=2`. The explicit cable input
and USB compatibility conditions are part of that witness. The user's complete
HP39gs 2.22 NOR now independently completes this workflow, including 64 double
reads matching its original bytes. The earlier derived fixture remains
historical OS-level evidence, distinct from the newly received native boot area.
Neither witness establishes arbitrary native-application support. The separately
identified GBP 0.3 ALIGN4 diagnostic build now also exits to HOME and completes
`1+1=2` on both original 39g+ and 39gs systems. Its 39g+ return exposed a guest
translation that must survive an in-memory page-table change until TLB
invalidation; the core now retains it without patching the ROM or guest RAM.
The original GBP package's unaligned loader is a separate unresolved boundary.

The unchanged published Tetris+ 1.1 package now cold-installs and runs on its
declared HP39g+ target, responds to physical input, exits, calculates `1+1=2`
and continues identically after a warm restore. Its hardware dependencies
exposed real STM, LCD divider and PWM counter-access gaps. Arkalite and Hanoi
complete input/animation, return, arithmetic and exact checkpoint replay on
both original HP39g+ and HP39gs. An installed file or a changing title screen
alone is not accepted as a working application.

The independent [HP49g+ native workflow](hp49-native.md) installs the pinned
SDK ARMToolbox library and example through ordinary stock USB transfers. It
uses the original library's `PrRUN` in RPN mode, observes the native greeting,
returns with ON, calculates `1 ENTER 1 +` and reconnects for an exact GET.
The original ROM and guest RAM are not patched. This closes the specific
49g+ entry/return gap while wider native-application coverage remains open.

The [HP48gII native workflow](hp48-native.md) now independently installs its
own original ARMToolbox library and the unchanged SDK example. Six reviewed
frame assertions cover the native greeting, ON return, RPN arithmetic and
subsequent USB GET/FINISH. The original OS changes the returned binary file's
header revision from C to B; every payload byte must still agree. This expands
native-return coverage without treating the 49g+ library or a header-normalized
whole file as an identical 48gII export.

**Gate:** distinguish bootloader progress, initialized display, interactive stock
UI and native ARM entry/return. Require sustained operation, reset/input coverage
and independently supported physical conditions before canonical acceptance.
A recovery menu, guest PASS word or boot-only erased backing is insufficient.

## M4 — Independent acceptance for all six models

**Four images admitted to the user catalog; six-model gate open.** Each model
needs its own immutable full-NOR identity, memory bounds, display/keys, reset
and native return evidence. The HP48gII target is the USB revision.

The user's HP49g+ capture has been received and functionally validated; no repeat
short probes are requested. Its acquisition metadata remains separate from the
new execution evidence. The HP39gs image returned by the
[ROMstream v2 package](hp39gs-rom-dump.md) is also received and validated, with
its unchanged original bootloader, all 64 block hashes and separate native/WASM
execution witnesses. No repeat capture or preliminary probe is required.
HP40gs and HP50g acquisition continue
independently; padded updaters and foreign bootloaders are not full original NORs.

**Gate:** six independent original-image cold-boot, interaction and ARM-return
witnesses with accurate model-specific hardware limits.

## M5 — Usable browser calculator

**React/Mantine user calculator implemented with bounded browser acceptance.**
The bilingual UI automatically identifies four supported images, offers normal
calculator controls, seven separately licensed skins, traditional keys, editable
physical PC macros, captures, recording, settings and optional local autosave.
The keyboard editor isolates each model, highlights assigned PC keys and shows
bindings on a clickable calculator keypad. Default characters follow the OS
layout; API labels and captured keys identify physical custom bindings.
Connections and SD use a persistent sidebar that preserves drafts while the
calculator remains accessible. ROM recall is independently controlled in
Storage settings: read-only handles reopen original files where permitted,
and a labelled browser-local copy supports the ordinary file-input fallback.
[Landscape modes](landscape.md) keep six function keys beside the display in both immersive and traditional appearances. Narrow portrait traditional landscape stacks the main keypad below a sticky LCD/FN pane. Four scaling kernels and optional 35 ms response are selectable. Spatial display scaling does not affect exported pixels; the selected response is shared by the live display, PNG captures and recordings. [Firmware sound](buzzer.md) observes GPB2/Timer2 edges with
gesture-gated Web Audio, mute and volume. Shared PCLK and buffered PWM now
produce the original HP49g+ BEEP's register-derived period; physical board
clock and speaker measurements remain open.
The separate workbench retains research controls and diagnostics. The 49g+ LCD
uses its full 131×80 dimensions in both views and capture export.

One Worker owns execution. Bounded slices, explicit pacing, input queues,
operation/generation isolation and cancellation remain invariant. LCD pixels
and annunciators are captured inside the core at completed-scan boundaries and coalesced into browser animation frames. Optional 35 ms response does not change guest state; genuine blank/off frames remain represented. This is presentation policy, not physical panel calibration.
Version-7 sessions include architectural instruction/data TLBs alongside complete SD media, all UART state/queues, pending NOR operations, modified flash sectors, fractional PCLK, PWM/SPI and watchdog state. Successful restore resumes under the current lifecycle policy; a prominent pause bar remains whenever execution is paused.
Version-1/2/3/4/5/6 files remain importable with explicit legacy timing/device
migration; see [sessions](sessions.md). Binary IndexedDB
autosaves retain the card and migrate the former small localStorage records.
Original-ROM and native/WASM continuation are independently checked. Actual
Chrome file-picker/download/session and Worker tests supplement synthetic tests.

Ordinary keyboard and pointer presses now retain physical contacts until
their own release; multi-touch and simultaneous keys have independent owners.
Minimum guest-time dwell protects brief clicks, while character macros remain
finite. Blur, pause, cancellation and teardown release contacts. Original
Arkalite and Tetris+ production-browser runs exercise sustained movement and
subsequent arithmetic. Arkalite's combined-core browser return witness uses an
explicitly held DEL; ordinary short-DEL failures remain recorded and unresolved. Settings actions remain visible at narrow and short
sizes, Mantine menu navigation no longer reaches the guest, and short landscape
traditional mode scrolls usable keys rather than shrinking the whole keyboard.

Broader touch/focus/background/storage stress, zoom and sustained full-key use
remain open. Retain and classify the rare historical HP48 Unlimited post-result
stop instead of hiding it. Normal pace is based on the functional reference
clock, not measured physical ARM instruction timing.

**Gate:** production assets pass load/boot/key/resize/reset/save-restore/model-
change and sustained interaction without stale state, UI-thread instruction
loops or ROM upload. One desktop run is not all-browser acceptance.

## M6 — Virtual PC connectivity

**Stock object workflows, HP39 Disk drive and direct Wire send/receive implemented.** HP48gII
USB/UART0 and HP49g+ USB support upload, GET, calculator SEND/Receive, directory,
FINISH and sequential upload batches. Limits and per-file results are explicit.
HP48 export may change its transport-header revision; payload bytes match.
HP49 USB exports preserve complete test objects byte-for-byte.

HP39/40 reverses the protocol role: the calculator is the Kermit client and
Orchard serves `HP39DIR.CUR`, catalogs and typed files. Directory aliases are
preserved. Original HP39g+ stock USB installs the 7,373-byte reader aplet and
1,489-byte library and exports both through SEND. The OS may rename a library
header to its directory alias while preserving its object body. Responses are
queued for the next ordinary guest slice after USB input; no extra guest ticks
or wall-clock sleeps are inserted. The browser also reads an HP39 ZIP package
directly and writes received typed files as a standard ZIP. A missing
`HP39DIR.CUR` from stock SEND is regenerated without changing original catalog
aliases or object bytes, so the returned bundle can be imported into a fresh
machine. Direct Wire upload uses the stock D-handshake / CRC-16/KERMIT block
protocol, validates a whole package first, and uploads its library before the
aplet. Each object needs a fresh stock RECV selection. Optional automatic next RECV recognizes validated stock catalog/menu frames and presses physical keys for same-catalog USB batches. User input, errors and unknown/modal screens cancel automation; retry never sends blind ENTER. This is a faster upload
path. On the original 39g+ and 39gs USB connection, a single Wire listener now
accepts successive calculator SEND operations, including Notes and aplet/library
dependency negotiation. Completed files remain available after Stop or an error;
the shared receive budget is 16 files and 8 MiB. Object boundaries are parsed
instead of treating the last XMODEM block's padding as file content. Original
HP39gs serial Wire now also sends libraries and receives successive Notes and
multipart aplet/library groups; serial uses the stock receiver's supported
128-byte blocks. Original 40gs behavior remains unverified. The original complete
HP39gs now has its own Disk installation and native-reader return witness;
HP40gs still needs its complete NOR. ASCII Notes are converted to the binary
Saturn string format accepted by Wire; original 39g+ and 39gs install, EDIT and
export the same content through the NOTEPAD catalog. This does not compile
ASCII programs or aplets. HP39 receive sessions also retry a fully emitted ACK
when the next packet does not arrive, within existing retry/deadline bounds;
exact-object and real sequence-wrap checks cover the recovery. Content recognition replaces filename
extension filtering. Recoverable batch failures expose Retry/Skip without
resending completed items. Optional transfer-only Unlimited applies during
active protocol work and restores the user's selected pace at every terminal
or user-wait state. Its switch is in Settings → Transfer, with the same
Apply/Cancel behavior as other settings. Stable transfer error codes preserve
translated messages through the Worker and per-file queue. Initial Info ACK
and receive ACK retries do not add guest ticks or wall-clock sleeps.

SD preparation browses/extracts FAT16 files, creates directories, adds files,
renames files or directories and deletes files or empty directories
transactionally in an unmounted image. The original HP49g+ reads prepared
files and can add its own objects through FILES; the independent filesystem
checks and remaining 8.3/PIO/media limits are in [SD cards](sd-cards.md).
Local directories can be copied recursively into 16/32 MiB FAT16 drafts with
a reviewable name mapping. Direct handles support persistent two-way add,
update, delete and rename using baseline/local/card comparisons and conflict
choices. Preview revalidation and partial-failure protection avoid silently
replacing a concurrently changed file. Mounted synchronization pauses and
ejects the image before edits, then reinserts it and conditionally resumes.
Before changes are applied, Cancel or Back restores the original media, write
protection, directory association and prior running intent. A reset, session
restore or model change invalidates the old transaction; a failed insertion
retains the recoverable draft.
Identical deletions or replacements made on both sides now converge without
spurious conflicts; replacing a directory with a file removes its obsolete
descendant baselines, including after persistence/reload.
It does not create an OS block device or mutate a mounted filesystem behind
the guest cache. See [directory synchronization](directory-sd.md).

Three UARTs now implement their documented functional FIFO, stored line-format, clock-gate,
interrupt, error and internal-loopback behavior. Original RS232/IrDA factory
tests pass on the applicable admitted models. The [infrared link](infrared.md)
pairs two same-origin browser tabs; original HP49g+/48gII firmware exchanges
objects in both directions using IrLAP, IrCOMM and Kermit. Decoded bytes are
bounded and ordered; optical waveform and physical-adapter timing remain open.
The r25 continuation adds observed batch timing, an eight-packet bounded window,
exact connection epochs and hardware-RX-close clock reanchoring. Its final
production-browser Pause/re-pair/ON workflow completes both exact objects,
actual recalled values and all valid final acknowledgments. One bad reverse
Y3 recovers through the original firmware's retry; that retained observation
still needs an explanation and is not a zero-error reliability result.

**Native host-device simulation is retired at the user's request.** The Local
device UI was removed. OS USB/IP attachment, HP driver binding and Conn3x are
not future acceptance targets. Existing helper code and r22 evidence remain
historical reproducibility material, not a current browser feature.

Remaining connectivity work covers wider original-ROM IR object/cancellation
coverage, physical optical/baud calibration and larger SD media/DMA. Printer
IR is a separate protocol and has no support claim. Complete original HP40gs/HP50g
images remain necessary before adding them to the supported calculator catalog.

**Gate:** unchanged stock firmware completes both directions with file/object
identity, cancellation/reconnect recovery and responsive UI. Internal packets
do not imply a real OS USB/serial device or physical hardware connection.

## M7 — Stability and releases

**Per-revision release checks implemented; broad stability gate open.** Maintain
reproducible production artifacts, pinned dependencies and corresponding source,
license audits, resource budgets and explicit support claims. Verify Build,
Pages, revision manifests and downloaded package hashes after acceptance.

**Gate:** sustained supported-model use, wider browser/desktop compatibility,
repeatable packaging and documented limitations. All-model certification and physical timing remain separate work; native host-device integration is retired.

## Performance work

Correctness and real workload measurements govern optimization. Existing CPU,
TLB lookup, scheduler, WFI and rendering optimizations retain reference
paths and exact-state comparisons. [Operand-pair profiles](arm-block-profile.md)
identify independent MOV pairs and an ADD-to-CMP dependency as candidates;
structural instruction counts are not speedups. A new path needs identical
architecture, exceptions, interrupts and self-modifying-code behavior plus a
measured benefit before production admission.

The r18 continuation implemented and measured a quiet execution loop and a
separate cold-rollback function. Both preserved complete scene states but failed
the declared Chrome admission conditions and were withdrawn. Their samples and
independent review remain in [the performance record](performance.md); the
production CPU is unchanged and the stronger scheduler regression is retained.
This round does not establish lower HOME/APLET input latency.

The preceding feature round checked the incremental cost of the idle SDI
controller and checkpoint migration. Do not claim an interpreter speedup from
model admission, checksum work, display caching or input dwell changes. Physical
clock calibration remains independent of host execution throughput.
