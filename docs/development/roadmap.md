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
| HP49g+ | User's full 2 MiB capture, unchanged cold boot, 131×80 display, arithmetic, CAS, graphing, sessions, USB/native ARM workflows, FILES and SD image read/write, shared-PCLK BEEP, inactivity shutdown and ON resume | Explicit SRAM mirror/LCD conditions; infrared/UART2, SD DMA/SDHC, NOR programming and physical-board calibration remain open |
| HP39gs | User's complete 1 MiB capture and its own bootloader, HOME arithmetic, APLET, browser sessions, Disk/Wire installation including Notes, native ROMstream dump/return/USB reuse, inactivity shutdown and ON resume | Explicit exact-SRAM/GPIO/ADC/LCD conditions; broader transfer, sound, native-program and sustained-use coverage |
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
precise partial transfer/writeback, cache/TLB behavior and implementation-defined
cases. Unsupported behavior must remain explicit.

**Gate:** independently derived cases and bounded instruction differentials pass,
failures reduce to precise input/state witnesses, and sanitizers pass. Comparing
two Orchard builds is a regression check, not an independent CPU oracle.

## M2 — SoC and physical board behavior

**Functional pieces implemented; canonical board gate open.** SRAM, GPIO drives
and bias, passive keyboard circuits, unfiltered EINT, IRQ arbitration, timers,
RTC/watchdog reset, LCD frame interrupts, normal ADC, USB PIO/packet transactions,
two bounded SPI channels and an SDI controller with SDSC media cover observed
paths. Selected SST39VF1601 /
SST39VF800A devices provide array/software-ID behavior, not flash programming.

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
component identities and pad bias, LCD/annunciator routing, flash commands,
DMA, larger SD media, attached SPI devices and further peripheral modes.
Digital input filters and physical reset/clock-switch transients remain open.

**Gate:** one model's dependencies follow independently supported register/pin
behavior with unchanged firmware and no unverified readback shortcuts. Current
counted LCD `+0x68` idle-zero and packed-memory display assumptions do not close it.

## M3 — Genuine stock execution and native return

**Four conditional stock systems; HP39g+, HP39gs and HP49g+ native-return witnesses.**
HP39g+, HP39gs, HP48gII and HP49g+ execute their own reset/startup and physical inputs.
Their ROMs remain unchanged. HP48gII and HP49g+ use explicitly declared bank-1
SRAM mirror conditions, retaining fixed physical capacity; HP39g+ and HP39gs use exact
physical SRAM bounds. All retain stated
GPIO/ADC/LCD conditions.

The original HP39g+ system installs ROMstream through its real USB file client.
The revised v2 reader reads the full NOR, shows block progress, returns after
disconnect and leaves HOME able to calculate `1+1=2`. The explicit cable input
and USB compatibility conditions are part of that witness. The user's complete
HP39gs 2.22 NOR now independently completes this workflow, including 64 double
reads matching its original bytes. The earlier derived fixture remains
historical OS-level evidence, distinct from the newly received native boot area.
Neither witness establishes arbitrary native-application support.

The independent [HP49g+ native workflow](hp49-native.md) installs the pinned
SDK ARMToolbox library and example through ordinary stock USB transfers. It
uses the original library's `PrRUN` in RPN mode, observes the native greeting,
returns with ON, calculates `1 ENTER 1 +` and reconnects for an exact GET.
The original ROM and guest RAM are not patched. This closes the specific
49g+ entry/return gap while wider native-application coverage remains open.

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
[Immersive landscape](landscape.md) cuts the unchanged skin below the six
function keys, placing those keys with the screen to the left of the remaining
keyboard. [Firmware sound](buzzer.md) observes GPB2/Timer2 edges with
gesture-gated Web Audio, mute and volume. Shared PCLK and buffered PWM now
produce the original HP49g+ BEEP's register-derived period; physical board
clock and speaker measurements remain open.
The separate workbench retains research controls and diagnostics. The 49g+ LCD
uses its full 131×80 dimensions in both views and capture export.

One Worker owns execution. Bounded slices, explicit pacing, input queues,
operation/generation isolation and cancellation remain invariant. LCD pixels
and annunciators are sampled at observed completed scans, then reused for
same-scan UI requests and coalesced into browser animation frames. Live display,
capture and recording share the published image, including real blank or
unavailable frames. This is presentation policy, not physical panel calibration.
Version-5 sessions include complete SD media, in-flight controller state,
fractional PCLK, PWM latches, both SPI channels and the watchdog reset hold.
Version-1/2/3/4 files remain importable with explicit legacy timing/device
migration; see [sessions](sessions.md). Binary IndexedDB
autosaves retain the card and migrate the former small localStorage records.
Original-ROM and native/WASM continuation are independently checked. Actual
Chrome file-picker/download/session and Worker tests supplement synthetic tests.

Broader touch/focus/background/storage stress, zoom and sustained full-key use
remain open. Retain and classify the rare historical HP48 Unlimited post-result
stop instead of hiding it. Normal pace is based on the functional reference
clock, not measured physical ARM instruction timing.

**Gate:** production assets pass load/boot/key/resize/reset/save-restore/model-
change and sustained interaction without stale state, UI-thread instruction
loops or ROM upload. One desktop run is not all-browser acceptance.

## M6 — Virtual PC connectivity

**Stock object workflows, HP39 Disk drive and direct Wire upload implemented.** HP48gII
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
aplet. Each object needs a fresh stock RECV selection. This is a faster upload
path; reverse SEND remains the separate Kermit workflow. The original complete
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
a reviewable name mapping. A validated copy/eject operation returns mounted
media to the editor. Associated directory handles support explicit re-read and
additive write-back with conflict preservation; the association is page-session
only. This snapshot workflow does not mount an operating-system block device
or synchronize a mounted filesystem concurrently.

The optional [local device bridge](host-mode.md) connects the live browser
Worker to a loopback HTTP/USB-IP helper. Generated ARM guests pass real Chrome
Worker, authenticated HTTP, USB/IP control/bulk, cancellation and reconnect
checks. Unchanged HP48gII and HP49g+ ROMs complete object round trips using the
same bridge modules under Node; each evidence record retains its runtime and
build identity. Original HP49g+ also completes exact SEND/GET/FINISH through
the production Chrome page and Worker, remains connected across sidebar
hide/reopen and another tab taking focus, then returns to `1+1=2`. Internal
transfers and live SD-card operations are excluded
while the bridge owns the machine; unmounted drafts remain editable. The
separate command-line calculator and raw serial entry point remain available.

Remaining work includes remote file management, broader capacity/recovery
cases, infrared/UART2, UART FIFO/baud timing, operating-system USB/IP attachment,
HP driver binding and unmodified Conn3x interoperability. The original-ROM
GET_CONFIGURATION timeout is retained rather than synthesized into success;
the earlier HP50g case also remains an explicit counterexample. See
[USB evidence](usb.md) and [virtual links](virtual-link.md).

**Gate:** unchanged stock firmware completes both directions with file/object
identity, cancellation/reconnect recovery and responsive UI. Internal packets
do not imply a real OS USB/serial device or physical hardware connection.

## M7 — Stability and releases

**Per-revision release checks implemented; broad stability gate open.** Maintain
reproducible production artifacts, pinned dependencies and corresponding source,
license audits, resource budgets and explicit support claims. Verify Build,
Pages, revision manifests and downloaded package hashes after acceptance.

**Gate:** sustained supported-model use, wider browser/desktop compatibility,
repeatable packaging and documented limitations. Full Windows/Linux/macOS device
bridges and all-model certification remain separate work.

## Performance work

Correctness and real workload measurements govern optimization. Existing CPU,
translation memo, scheduler, WFI and rendering optimizations retain reference
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
