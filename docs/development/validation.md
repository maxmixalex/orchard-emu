# Validation

## r23 diagnostics, infrared, directory synchronization and display (2026-10-24)

The production C/WASM candidate is SHA-256
`4bd0b8bba8ae7c71b116bb4a2c4396478e01730d9283bedc1f62a11f100db6e9`.
The [r23 release record](evidence/release-validation-r23.json) pins the local
source and asset identities. Remote Build, merge, Pages and live acceptance
are recorded separately in the release PR.
All firmware/application witnesses below retain their exact input identities
and physical-key procedures. ROMs, checkpoints, card images and original LCD
pixels remain private. The admitted 39-series presets now use the explicitly
conditional bank-1 SRAM decode; strict mode and legacy saved conditions remain
unchanged.

| Area | Observed result and scope |
| --- | --- |
| Factory FLASH | Original 39gs and 49g+ complete quick and full write tests through real NOR program/erase/polling. The final cold-boot probe matches the stock success text. [NOR evidence](evidence/nor-write-r23.json) records 58.5M/46.5M quick-test ticks and 3.4665B/5.6505B full-test ticks. Functional timings use the selected data sheets; electrical calibration remains open. |
| RS232 and IrDA | Applicable factory loopback tests return PASS and leave through ENTER. Original 49g+/48gII exchange and recall 12345/54321 in both directions. All four 39g+/39gs source/destination pairs cold-boot, transfer IRTEST and export identical complete 620-byte objects. The production Chromium pair also recalls 12345 and disconnects cleanly. [UART/IrDA evidence](evidence/uart-irda-r23.json). |
| SD directories | Persistent directory handles, aliases, baseline and card identity; reviewed two-way add/edit/delete/rename, conflict choices, revalidation and pause/eject/reinsert/resume. The browser fixture uses real OPFS/IndexedDB and explicit media acknowledgments; it does not claim a native picker or original-ROM end-to-end directory mount. [Directory evidence](evidence/sd-directory-r23.json). |
| Original SD/FILES | Original 49g+ reads root/nested 42 objects from a prepared 32 MiB card, writes TEST, exports and recalls it in a fresh boot. A 34,092,164-byte v6 checkpoint with 32 staged sector bytes continues identically on native and WASM. Original 48gII FILES returns to arithmetic. [Stock SD evidence](evidence/sd-stock-r23.json). |
| Wire batches | Opt-in recognition of stable original USB catalog/menu screens drives physical next-RECV keys for aplet/library queues. Original 39g+/39gs installs and exact SEND round trips pass; unknown screens, user input and failures cancel automation. It remains one stock receive transaction per object. [Wire evidence](evidence/hp39-wire-batch-r23.json). |
| Third-party programs | Arkalite on both 39 ROMs; native 2048, non-native BabalPlus and RPL conversion programs on 49g+; positive/negative-base RPL conversions on 48gII. Launch, actual input, return and subsequent arithmetic are separated from mere successful installation. [39 programs](hp39-programs-r23.md), [49 programs](apps-r23.md), [48 conversion evidence](evidence/baseconvert-48gii-r23.json). |
| GBP 0.3 | The original package's unaligned loader BSS clear fails before the player starts. A separately identified ALIGN4 diagnostic rebuild, with unchanged main.c, runs and returns on 39gs; the 39g+ IRQ-return fault remains unresolved. Original and rebuilt binaries are never combined into one compatibility claim. [Program evidence](evidence/hp39-programs-r23.json). |
| LCD publication | Completed-scan capture, optional 35 ms response and four spatial scaling kernels. Four-second actual GBP diagnostic workloads have identical final guest state; mean pixel changes are 1.425/1.310/0.986 for after-slice/scan/scan+smooth. Instant still exposes some genuine redraw intermediates. [GBP LCD evidence](evidence/gbp-lcd-r23.json). |
| LCD power | Both original 39gs/49g+ enable the LCD before replacing OFF text with ON text. Single-tick boundary observations retain old text initially and show the updated text within 65,536 subsequent ticks. This is a firmware order observation, not an optical measurement. [Power evidence](evidence/lcd-power-r23.json). |
| UI | Traditional landscape with LCD/FN grouping, narrow-screen scrolling, four actual scaling kernels, stable canvas identity, visible pause/resume and accessible settings actions. Duplicate SD and retired Local device entries are removed; infrared hides unrelated wired controls. Four models × four viewports pass in real Chromium. [Display evidence](evidence/display-r23.json). |

Release, retained-reference and ASan/UBSan with leak detection each pass
**23 native suites**. Native and WASM each pass **1,169,805 default core
assertions** plus **33,849 clock assertions** (**1,203,654 per host**).
The quarantined physical-read variant adds 217,824 WASM-only assertions outside
that total. The independent Unicorn corpus passes **17,075 cases**, with zero
mismatches or skips. Clang analysis covers **51 C files** with zero diagnostics.
Restoring the missing execution bit on the local reference SDI binary resolved
its initial launch failure; no test assertion was weakened. Test-only WASM
fixtures now allocate 32 MiB because multiple machines retain immutable and
mutable flash arrays; this does not increase the production initial memory.

Independent review found two concrete integration defects and verified their
fixes: cancellation during an asynchronous directory read/write could still
modify one local file, and changing UART2 mode immediately after transmitting
could discard an already-emitted tail byte. Directory tests now cover 86 cases,
including cancellation around each awaited mutation boundary. A new production
Worker + real WASM test covers six generated-ARM transmission/disable/loopback
scenarios. [Review record](evidence/review-r23.json).

The final Chromium component command passes all twelve scripts, and the
production Worker passes six profiles in both calculator/debug audiences with
generated ARM guests. Original 49g+ passes all seven 16 MiB SD browser stages,
including exact media retention and automatic running after both manual and
IndexedDB restore. Original 39gs/49g+ also pass physical/PC arithmetic,
capture, exact paused LCD restore and narrow layouts. A genuine same-ROM v5
full-card session imports, automatically resumes and re-exports as v6.
[Browser evidence](evidence/browser-r23.json) retains the tested assets;
the final rebuild changes only the distributable README's session wording.

Diagnostic tracing records the new UART channel input/output payloads and
IrDA attachment state. Only explicit read-only UART and host LCD observer
APIs are excluded. Real-WASM directed tests prove full checkpoint equality
with/without the observer and reject 23 malformed or unknown-API cases.
Instrumented browser stop and timeout runs replay all 7/64,780 API calls with
equal complete checkpoints. These generated-guest diagnostic fixtures are
separate from original-ROM browser acceptance.

Checkpoint v6 retains the immutable-ROM identity while saving changed flash
sectors and all UART hardware-buffer/event/queue state. Versions 1–5 migrate
explicitly. A successful restore resumes under the current focus policy;
historical stopped or exact-decode sessions retain their recorded conditions.
UART transport remains decoded bytes, with no bit-waveform/baud-time or FIFO
receive-timeout implementation. See [sessions](sessions.md) and
[UART scope](uart-irda.md).

Native host-device/Conn3x work is retired at the user's request. Its former
source and r22 results remain reproducibility material; the UI no longer
advertises it. Full original HP40gs/HP50g admission, physical timing, SD DMA/
SDHC and wider original-program coverage remain separate future work.

## r22 keyboard, local files, LCD publication and factory-test continuation (2026-10-23)

The browser now has model-isolated keyboard editing with layout-aware defaults,
a persistent Connections/SD sidebar, independently controlled local ROM recall,
and recursive directory SD preparation with explicit write-back. LCD publications
follow observed completed scans. Held ON/F4 and ON/F3 controls use the original
firmware's factory-test entry and exit paths, with SPI and watchdog reset support.

| Area | Evidence and boundary |
| --- | --- |
| Keyboard settings | [Keyboard documentation](keyboard-settings.md) records mapped/custom highlights, calculator-side badges and target selection, independent model drafts, OS-resolved character dispatch, layout-change/capture fallback, and 1360×940 / 390×844 Chrome layout checks. The controlled layout source is a UI/input-routing fixture, not a physical-keyboard survey. |
| ROM memory | [ROM storage](rom-storage.md) separates original-file handles from labelled browser-local copies, startup permission queries from explicit permission requests, and ROM recall from calculator-state autosave. Maintained unit tests cover canceled automatic reads and explicit Open independence; real IndexedDB/OPFS reload tests are separate from stock-ROM production probes. |
| Persistent sidebar and directory SD | [Directory SD evidence](evidence/sd-directory-r22.json) records recursive import, name/capacity previews, real browser directory handles and the file-input fallback, atomic export/eject ownership, conflict preservation and additive write-back. Native-picker permission UI is not automated. The original-ROM card workflow and its tested WASM identity are recorded separately from the fixture. |
| LCD publication | [LCD evidence](evidence/lcd-publication-r22.json) compares 278 publication requests per original ROM: same-scan image changes fall from 6/4/11/7 to zero, with byte-identical final guest checkpoints on the recorded build. Synthetic browser bursts verify one animation-frame paint, genuine white frames, PNG and recording consistency. This does not establish physical panel response or a CPU speedup. |
| Self-test entry and exit | [SPI/watchdog evidence](evidence/spi-watchdog-r22.json) records the original four firmware version pages, normal exit and `1+1=2`, using physical keys and unchanged NOR/RAM. The 39gs/48gII/49g+ use the modeled watchdog reset; 39g+ uses its distinct path. No claim is made that every factory diagnostic passes. |
| Local device bridge | [Host mode](host-mode.md) separates real Chrome Worker/HTTP/USB-IP generated-guest checks, [original-ROM Node-module object transfers](evidence/usb-original-bridge-r22.json), and [original HP49g+ production-browser transfers](evidence/browser-local-devices-r22.json). Controlled real HTTP delays verify that reconnect waits for old DELETE and that Stop retrieves and deletes an already allocated session before opening the next one. OS attachment, HP driver binding and unmodified Conn3x are separate gates. |

Checkpoint v5 adds both SPI channels and the remaining watchdog reset pulse,
while preserving complete SD media and previous clock/PWM state. Versions 1–4
remain importable with explicit legacy-state boundaries. The new target set
contains 21 native/reference/sanitizer suites. Each record below or linked above
retains its own core and frontend identity; a component result on an earlier
build is not silently relabelled as a final production pass.

The final integrated production WASM is SHA-256
`51aded73e5d6cae3862fda4beec946118903dda97a39fccaa9fcf740214c8189`.

### Final core and SD checks

Release, retained-reference and ASan/UBSan each pass **21/21 suites**. Native
and WASM each pass **1,166,060 default assertions** plus **33,849 functional
clock assertions**, or **1,199,909 per host**. The separate quarantined
physical-read WASM checks add 217,824 assertions outside that total. The
independent Unicorn corpus passes **17,075 cases**, with zero mismatches or
skips. Clang static analysis covers **48 C files** with zero diagnostics.
Restored local build files initially lacked execution permission for one
reference and two sanitizer targets; after restoring those files' execution
bits the affected gates passed. Leak detection remained enabled.

The final 32 MiB directory-card workflow uses this production WASM and the
rebuilt native replay tool. Original HP49g+ recalls root and nested objects
as 42, writes TEST without changing them, and resumes a **34,087,787-byte v5
checkpoint** containing the whole card and 32 staged sector bytes identically
on native/WASM. HP48gII FILES, return to HOME and arithmetic also pass, with
no SD slot. The prepared and stock-written images match the previously
independently checked FAT images byte for byte; mtools extraction and
`fsck.fat -n` results therefore apply to the same final image identities.

The actual HP49g+ production browser completes seven SD stages: empty/card FILES,
stock write/recall, whole-card manual restore, atomic eject-to-edit, draft
hide/reopen and exact-byte reinsertion, automatic ROM reopen plus whole-card
autosave restoration, and read-only import. There are no page errors. The
[directory record](evidence/sd-directory-r22.json) binds all **47 tested browser
assets**, distinguishes the 16 MiB browser card from the 32 MiB native/WASM
workflow, and records the initial Activity-retention failure and verified fix.
The recalled 42 and narrow sidebar layout were visually inspected; stock
screenshots remain private.

The original HP39gs production-page ROM-recall and self-test toolbar/Escape+F4
paths also pass, with visually checked `1+1=2`. The original HP49g+ live-device
workflow drives stock FLAGS/SERVER through the production page and Worker,
then runs Kermit SEND/GET/FINISH through authenticated HTTP and a real user-space
USB/IP peer. All 15 object bytes return exactly. Another real tab retains focus
during transfer, sidebar hide/reopen preserves the connection, and disconnect
is followed by visually checked `1+1=2`. Its [separate record](evidence/browser-local-devices-r22.json)
binds the assets actually served; this is not an OS-driver or Conn3x witness.
The [r22 release record](evidence/release-validation-r22.json) pins the final
47-asset build, source identities and complete local gates. Source and packaged
host tests, all eleven actual-Chromium component scripts, production Worker and
stopped-core recovery, the Go receiver, Pages contract and strict documentation
build all pass. GitHub Build, merge, Pages and live-site checks remain separate
revision-specific evidence in the release pull request; local passes do not
imply deployment.

## Historical r21 transfer settings, FN layout, idle power, Note and peripheral clocks (2026-10-23)

The [r21 release record](evidence/release-validation-r21.json) identifies all
**43 production assets**, the final source hashes and local acceptance gates.
The production WASM is **133,810 bytes**, SHA-256
`36fe5da8630af83946503c76eab63f8dbb64274162b22eb06fd50f5a0d222108`.
Earlier idle-only and PCLK-preview results retain their original build identities
in the detailed records. GitHub Build, merge, Pages and live-browser acceptance
are recorded separately for their exact revisions in the release PR.

### Requested behavior and original-system checks

| Area | Final result and evidence |
| --- | --- |
| Transfer settings | **Settings → Transfer** owns the transfer Unlimited switch, with Apply/Cancel semantics. It can be changed during transfer. Waiting for stock RECV, error, cancellation and completion restore the selected speed. Connections has no duplicate setting. |
| Immersive landscape | The cut is below all six FN soft keys. They remain with the LCD; the right piece contains the other 45 keys. The same LCD node and all 51 unique input regions survive appearance changes. Four models, four viewports and 50/100/180% zoom pass actual browser geometry and input checks. |
| Natural inactivity | Original HP39g+, HP39gs, HP48gII and HP49g+ all naturally power off about 300–301 functional seconds after arithmetic. CPU instructions remain frozen for another ten seconds; an off-state v4 checkpoint round-trips exactly; ON restores the prior screen and `7*8=56` works. A real older v3 session also imports and completes manual OFF/ON. [Power evidence](evidence/idle-power-r21.json). |
| Buzzer | Original HP49g+ `440 .2 BEEP` produces 88 cycles / 176 edges from Timer2. The modeled 12 MHz reference and guest PCLK configuration give approximately **434.028 Hz**, with 0.201567 seconds between first and last edges. Actual Chromium AudioContext playback produces nonzero PCM and clears on pause. [Buzzer evidence](evidence/buzzer-r21.json). |
| Note over Wire | Cold original HP39g+ and HP39gs receive a 321-byte packed Note from a 420-byte ASCII source, open it in EDIT, then return a 426-byte stock ASCII export. Title, lines, high bytes, all 40 HP escape symbols, literal backslash and repacked binary agree; HOME calculates `1+1=2`. Separate earlier identified long-Note runs cross Kermit sequence 63→0. [Note evidence](evidence/hp39-note-wire-r21.json). |
| Transfer recovery and language | Queue retry/skip retains other items; local read retry reconverts the latest bytes and applies the size limit after conversion. Typed errors cross Worker/controller boundaries and have English/Chinese main messages; raw diagnostics are collapsed. Independent review checks 38 error keys, ACK ordering/backpressure and bounded retry. [Transfer review](evidence/transfer-review-r21.json). |
| SD file management | The unmounted FAT16 draft can rename files and populated folders, delete files and empty folders, retire associated long-name entries, and reuse freed clusters. The edited image is accepted by original HP49g+: root and nested objects recall as 42, stock FILES writes TEST, and a partial-sector v4 checkpoint continues byte-identically on native and WASM. Independent tools validate the final exported image and all three object bytes. Original HP48gII FILES and HOME also pass. [SD evidence](evidence/sd-files-r21.json). |
| Native ROMstream continuation | Fresh original HP39gs cold boot and normal stock Disk installation run the existing V2 reader. All 64 × 16 KiB blocks pass double reads with zero retries; the complete 1 MiB equals the input NOR. Progress screens, FINISH/unplug, HOME `1+1=2` and stock USB reuse pass on the final core. [Native continuation](evidence/native-continuation-r21.json). |

The inactivity failure reached real GPIO pull-up, disabled-NAND and
CLKCON.Power_OFF behavior. The core now resolves board pull-ups, supports the
bounded disabled NAND probe, stops nonretained domains, and wakes through the
reset vector while retaining external SRAM and other declared retained state.
Saved SPSR mode bits may contain inactive patterns; active CPSR and exception
return validation remain enforced. No ROM/RAM patch or Saturn interception is
used. The original four NOR images remain the admitted inputs.

Buzzer work corrects the shared peripheral-clock path: MPLLCON/CLKSLOW/CLKDIVN
drive PCLK edges consumed by all five PWM timers, watchdog, ADC and SDI. PWM
reload and active compare state now survive checkpoints. Checkpoint v4 adds
64 bytes of clock/PWM state and accepts v1–v3; older formats cannot reconstruct
write history or an unrecorded partial cycle. PLL settling, switching phase,
prescaler details and physical frequency calibration retain documented bounds.
The audio observer does not change guest state or apply a pitch multiplier.

### Final regression and browser gates

Release, retained-reference and ASan/UBSan each pass **19/19 suites**. Native
and WASM each pass **1,159,939 default core assertions** plus **33,849 functional
clock assertions**, or **1,193,788 per host**. The additional 217,824 quarantined
physical-read WASM assertions are outside that total. Clang analysis covers
**45 C files**, with zero diagnostics. The independent Unicorn 2.1.4 corpus
passes **17,075 cases**, zero mismatches and zero skips; its CPU scope is
separate from later peripheral-clock tests. [Independent core review](evidence/core-review-r21.json).

ROM-free browser checks cover the production components, binary IndexedDB,
six FN keys, error localization, real AudioContext scheduling and 12 SD draft
workflows. The FAT editor has 220 parsing/mutation/rejection checks, and the
controller has 27 ownership/cancellation checks. Four independently checked
host images and the final stock-written image pass external FAT tools.
Production HTTP Worker, ordinary stop recovery, diagnostic trace recovery and
timer receiver checks also pass. [Frontend scope](evidence/frontend-validation-r21.json).

The final production HP39gs browser run uses the actual ROM picker and Worker,
visually displays `1+1=2` and `7*8=56`, exports/restores a v4 session exactly,
and returns from APLET in immersive landscape. All ten observed loaded
execution assets match the expected build; there are no page errors or upload
requests. These original-ROM results are recorded separately from synthetic
component fixtures.

Syntax, tools, trace, web, skins, calculator, protocol, sessions, Pages contracts,
loopback host and packaged host gates pass. The Go receiver passes tests, vet
and a Windows x64 build. Strict Zensical 0.0.67 documentation and local Pages
assembly cover 47 documentation pages and all 43 emulator assets. Known local
toolchain/launch failures and their successful reruns remain in the release
record, with no source or permission workaround attributed to product behavior.

Remaining work includes physical clock/audio calibration, UART2/IrDA,
SDHC/SDXC/DMA, FAT long-name creation, original HP40gs/HP50g admission and the
remaining native application regression matrix. SD capacity remains bounded
to 1/2/4/8/16/32 MiB SDSC; HP48gII has no SD slot. ROMs, sidecars, checkpoints,
card images and stock-OS pixels remain excluded from publication.

## Historical r20 original HP39gs, transfer recovery, sound and SD files (2026-10-23)

The [r20 release record](evidence/release-validation-r20.json) identifies all
**42 production assets**, source identities and local gates. The production
WASM is **123,871 bytes**, SHA-256
`1cffba4fb7bbdf9a8b203dfd999fc5071f1bb773f665c5699725484575916db7`.
The CPU execution policy, Normal pacing and physical-key dwell remain unchanged.
The optional transfer setting temporarily removes host pacing during an active
transaction; it is not a new CPU optimization or physical-clock calibration.

### Original ROM and device workflows

| Workflow | Result and evidence |
| --- | --- |
| Original HP39gs admission | The user's complete 1 MiB NOR and all 64 capture-block records agree. Its native 16 KiB bootloader cold-boots without replacing any ROM bytes. Two native and two WASM runs agree through HOME, arithmetic and APLET; full checkpoint continuation also agrees. [Identity, setup and results](evidence/hp39gs-startup-r20.json). |
| HP39gs production browser | Actual Worker execution displays `1+1=2` and `7*8=56`, exports and restores a session exactly, and returns from APLET in the new landscape view. Both arithmetic screens were visually reviewed. Its tested bundle identity is recorded separately from the final recovery-help text update. |
| HP39gs direct USB and reverse SEND | Stock RECV → `HP39/40 (USB)` accepts the 1,489-byte library and 10,344-byte V2 aplet. Stock SEND returns the exact aplet and library object body. The roughly 405.4 guest-second reverse leg now completes within the existing 900-second service budget; its old 300-second child limit had stopped at 8,381 bytes despite continued progress. This is not a wall-clock performance measurement. |
| Original HP39gs full reader | Fresh stock Disk-drive installation, START/ENTER, all 64 blocks read twice, FINISH and unplug return to HOME for `1+1=2`. The captured 1 MiB equals the original input. A separate direct-USB run also verifies the reader's E03 cable-loss screen, ON confirmation and HOME return. |
| HP39g+ batch recovery | Real ON/CAN during a library transfer → Retry → completion; a later aplet cancellation → Skip; arbitrary-suffix reselection → completion; waiting cancellation; stock SEND byte/body/alias comparison and HOME `1+1=2` all pass. Successful items are not resent. Each terminal state restores the chosen speed. [Transfer evidence](evidence/hp39-transfer-r20.json). |
| SD files in HP49g+ | Browser-prepared root ANSWER and PROGRAMS/NESTED both recall as 42 in fresh original-ROM boots. Stock FILES adds TEST without changing those existing objects. Independent FAT tools accept the exported image. A checkpoint with 92 bytes of a sector staged includes the whole card; native and WASM continue identically. [SD evidence](evidence/sd-files-r20.json). |
| HP48gII FILES | Its original full NOR cold-boots, navigates FILES and returns to HOME. It has no SD slot and rejects card insertion. HP50g controller tests do not establish original-ROM support. |
| Firmware sound | Original HP49g+ `440 .2 BEEP` drives real Timer2/GPB2 transitions and consumes its arguments. Chromium schedules nonzero PCM and stops playback on pause. Current functional output is about 282.486 Hz over 0.30972 seconds; accurate physical pitch and duration remain open. [Buzzer evidence](evidence/buzzer-r20.json). |

The old HP39gs derived fixture remains a historical OS-execution witness. Its
995,328-byte OS region is identical to the original capture, but the generic
bootloader and constructed tail are different. It was not a captured physical
39gs NOR. The r20 catalog accepts only the full original hash, not that fixture.
The original capture JSON is left unchanged; the independent startup and
execution conclusions are recorded separately.

### Regression and independent checks

Release, retained-reference and ASan/UBSan each pass **17/17 suites**. Native
and WASM each pass **1,155,851 default core assertions** plus **32,949 clock
assertions**: **1,188,800 per host**, including 4,261 buzzer checks. The extra
217,824 quarantined physical-read WASM checks are outside that total. Independent
Unicorn comparison passes **17,075 cases**, zero mismatches and zero skips.
Clang static analysis covers **43 C files** with zero diagnostics.

The FAT16 editor passes 129 parsing/mutation/rejection checks, 27 controller
ownership and cancellation checks, and ten actual Chromium workflows. The
draft editor validates chains and both FAT copies before mutation, preserves
the complete draft on failure, and cannot edit a mounted card. Independent
`fsck.fat` and mtools checks cover prepared and stock-written images.

The [frontend record](evidence/frontend-validation-r20.json) covers component,
IndexedDB, audio, production Worker, ordinary stop recovery and diagnostic trace
checks. Landscape geometry and input cover four admitted models, four viewports
and 50/100/180% zoom. These synthetic fixtures are not original-ROM acceptance.
A diagnostic-only regression now recognizes exactly four host audio observers;
an unknown mutation still invalidates the trace. Actual GPIO audio drain/clear
and replay leave complete guest checkpoints unchanged. An independent randomized
probe also compares 542 complete checkpoints across 20,000 operations.

Protocol, tools, package provenance, session, recording, host bridge and Pages
contracts pass. Pinned Zensical 0.0.67 renders all 46 documentation pages in
strict mode with zero issues; local Pages assembly verifies all 42 assets.
The V2 reader archive was rebuilt from pinned source: only its
README, verification manifest, builder and checksums changed; calculator and
Windows receiver binaries remain byte-identical to r19 V2. The 49g+ capture
archive refresh similarly changes only its ROM identity helper and metadata.

Remaining limits include physical clock/audio calibration, UART2/IrDA,
SDHC/SDXC/DMA, FAT long-name creation/rename/delete, and original full-ROM
acceptance for HP40gs/HP50g. Reverse HP39 Kermit transfer remains slow.
The release record distinguishes harness/environment failures from product
fixes. ROMs, capture sidecars, checkpoints, card images and stock-OS pixels are
excluded from publication. GitHub Build, merge, Pages and live-asset verification
are separate per-revision results recorded in the release PR.

## Historical r19 FILES, SD media, transfer and reader fixes (2026-10-23)

The [r19 release record](evidence/release-validation-r19.json) pins all **39
production assets** and the fresh checks below. The final production WASM is
**120,723 bytes**, SHA-256
`eb79a3bc45e8cbdda32dbe82d36ca13ba1ebef28b8b2ce91099706f79a2cca0f`.
This is a new SD/controller/checkpoint build. The CPU interpreter, MMU/bus
execution sources, Normal pacer and physical-key dwell policy are unchanged;
no general CPU performance improvement is claimed.

### Core and browser gates

Fresh Release, retained-reference and ASan/UBSan runs each pass **16/16 suites**.
The final sanitizer run includes LeakSanitizer with `detect_leaks=1`.
Native and test-WASM execution pass **1,151,590 assertions per host**, including
**12,566 SD assertions** and **1,129 checkpoint assertions**, plus **32,949
functional-clock checks per host**. The quarantined physical-read experiment
has 217,824 additional WASM-only assertions; they are not counted twice in the
default total. The fresh independent Unicorn 2.1.4 corpus passes **17,075
cases**, with zero mismatches and zero skips. Clang static analysis covers the
exact 41-source CI set and reports zero diagnostics.

The complete ROM-free tool, frontend/controller/Worker, session, host-package,
recording, trace, skin and Pages contract gates pass. The
[frontend evidence](evidence/frontend-validation-r19.json) separately records
real Chromium component, IndexedDB, production HTTP Worker and both ordinary
and diagnostic stop-recovery runs. Synthetic model fixtures are not original
firmware acceptance. Binary IndexedDB testing covers a 17,277,216-byte record,
legacy migration, competing writers, stale-generation cancellation, reload
and deletion; the original-ROM test below covers an actual SD session.

Pinned Zensical 0.0.67 renders all 43 documentation pages in strict mode with
zero issues. Local Pages assembly validates all 39 emulator assets against
their exact bytes; publication metadata is regenerated for the resulting
commit instead of reusing an older revision/manifest.

### Original-system operations

| Workflow | Fresh result and precise scope |
| --- | --- |
| HP49g+ FILES without a card | Original cold boot, FILES navigation and return pass. The old FIFO stop and later SRAM boundary abort are both reproduced and recorded in the [SD evidence](evidence/sd-workflows-r19.json). |
| HP49g+ SD file persistence | Physical keys create TEST=42; stock FILES COPY writes it to port 3. Independent FAT16 parsing finds the exact 15-byte integer object. Both the same machine and a separate cold boot RCL the exported card's TEST as 42. |
| Partial SD write continuation | A snapshot taken with four bytes of a sector staged includes the whole 16 MiB card. Native and WASM continue 100,000 ticks and produce byte-identical 17,310,431-byte checkpoints. |
| Production browser SD lifecycle | The real page/Worker creates a card, writes and recalls TEST, exports its image, saves/restores the complete session, automatically saves, reloads and restores the exact image again, then imports it read-only. FILES, recalled 42 and the 390px modal were visually reviewed. |
| HP48gII FILES | Its own original full NOR cold-boots, navigates FILES and returns to HOME for `1+1=2`. It has no SD slot. |
| HP39g+ final Normal Disk upload | Original ROM cold boot and the original 8,862-byte two-object ZIP complete in **49.887 seconds**, measured from aplet selection to both acknowledgements. The old matching sample was 108.147 seconds. The installed aplet is visible and HOME calculates `1+1=2`. |
| HP39g+ Wire and reverse transfer | An independently identified earlier `25ceecb4…` build completes both Wire uploads in **13.138 seconds**, then stock SEND → Disk drive exports them with exact aplet bytes, exact library body and correct aliases. That reverse Kermit leg takes **184.716 seconds**. Its timing is not relabeled as a final-core run. |
| Revised HP39 ROM reader | Final-core normal installation, complete 64-block double reads, FINISH/disconnect, HOME `1+1=2` and stock USB reuse pass on the original HP39g+ NOR and a separately identified original 39gs 2.22 OS fixture. Six cable/control/reset/timeout/protocol exits also return correctly. |

The [transfer evidence](evidence/hp39-transfer-r19.json) preserves the exact
artifacts, timing windows and rejected fixed-delay experiments. These are
single coordinated host observations, not physical throughput or statistical
CPU benchmarks. Progress appears within the first second in the final Disk
sample; the earlier display threshold hid progress for about 40 seconds.
Wire upload still requires a new stock RECV for each object, with libraries
first. Reverse transfer continues to use Disk drive.

The [reader evidence](evidence/hp39-romstream-r19.json) distinguishes the final
payload/package, previous diagnostic builds and the derived 39gs fixture.
The original 39gs OS is exercised without guest RAM injection, but its boot
backing includes a generic bootloader. This is not a physical complete 39gs
NOR or native bootloader acceptance. The complete
[V2 download](hp39gs-rom-dump.md) replaces the invisible-progress reader;
physical HP39gs extraction and native Windows HID I/O remain unobserved.

### Compatibility and remaining limits

The HP49g+ HOME preset now explicitly selects bank-1 SRAM mirroring while
keeping the physical capacity at 512 KiB. Strict core defaults stay
exact-range. This declared condition resolves the observed stock counterexample;
it is not physical wiring proof for every board revision. Older sessions
preserve their saved decode condition. New ROM startup or Restart applies
the revised preset; restoring an old session does not silently change it.

[SD media](sd-cards.md) is bounded to 1/2/4/8/16/32 MiB SDSC with PIO.
SDHC/SDXC, DMA, physical SD timing calibration, UART2/IrDA and NOR programming
remain open. HP50g controller tests do not establish full original-system
support. Checkpoint v3 includes the complete card and in-flight state;
v1/v2 imports remain supported. Independent review also closed invalid-model
card-binding loss, stale autosave-error races and a correct-CRC write-protection
bypass before final verification.

Earlier failed controller/harness/environment trials are preserved with their
causes in the release record. Private ROMs, sessions, card images and stock-OS
screenshots are excluded. GitHub Build, merge, Pages and live-asset acceptance
are separate per-revision publication results recorded in the release PR.

## Historical r18 implementation and ZIP/native workflows (2026-10-23)

The [r18 release record](evidence/release-validation-r18.json) pins the final
37 production assets and the fresh checks below. The production WASM is
102,147 bytes, SHA-256
`5fb9626e86eed337fd4371ebf3e6ea27f5fa7af12bcee40e84d09e009121d48f`.
It is byte-identical to the recovered r17 final core: both new performance
candidates were withdrawn after their Chrome gates failed. The new ZIP UI,
native workflow tool, stronger regression tests and documentation remain.
GitHub Build, merge and Pages results are recorded separately for the published
revision; a local pass is not a deployment claim.

Fresh native Release, GCC reference and ASan/UBSan checks each pass 16 suites.
The native/test-WASM comparison passes **1,139,510 assertions per host** and
**32,949 functional-clock checks per host**, including the expanded
48,561-check scheduler suite. The compiler-portability fixes affect only the
checkpoint test's invalid-size guard and two unambiguously unconditional
returns in the replay tool. The [independent review](evidence/core-review-r18.json)
verifies that production core/include files are unchanged from the recovered
implementation. The [performance record](evidence/performance-r18.json)
separately identifies the 17,075-case fresh candidate/Unicorn differential;
it is not relabeled as a second final-core run.

| Fresh original-ROM check | Result and scope |
| --- | --- |
| HP49g+ cold startup | Two native and two WASM cold runs agree on all outputs, original HOME, `1+2=3` and `7*8=56`; no SRAM aliases. |
| HP49g+ CAS, menus and graph | Original `VERSION`, factorization, APPS/MODE, parabola and return pass through physical keys. Save/reset/restore and native/WASM continuation preserve the entire checkpoint. |
| HP49g+ production browser | Real ROM/session pickers, PC input, visually reviewed `1+1=2` and `7*8=56`, 524×320 PNG capture, exact displayed-LCD restore and narrow layouts pass on the final assets. |
| HP49g+ USB | Upload, named GET, directory, FINISH, active calculator SEND, subsequent GET and a two-file batch complete in the production browser; complete downloaded objects are byte-identical. |
| HP49g+ native ARM | A fresh cold boot installs the unchanged SDK library and example over USB, runs through ARMToolbox, returns with ON, calculates `2`, reconnects and retrieves the exact 4,474-byte library. [Evidence](evidence/hp49-native-r18.json). |
| HP39g+ full reader | Final WASM runs the actual installed ARM reader and Go receiver: all 64 blocks are read twice, the full 1 MiB equals the input NOR, and FINISH/disconnect/HOME/`1+1=2` succeed. This replay uses the prior USB-installed checkpoint. [Evidence](evidence/hp39-romstream-revalidation-r18.json). |
| HP39g+ ZIP round trip | A separately identified intermediate core completed user ZIP → stock RECV → stock SEND → real ZIP download → another fresh cold boot and RECV. Its frontend runtime modules are unchanged in the final build; its recorded WASM identity is retained. [Evidence](evidence/hp39-archive-r18.json). |

Final-asset [frontend checks](evidence/frontend-validation-r18.json) cover the
calculator/controller/Kermit/Worker chains, actual ZIP file selection/download,
component layouts and both normal and diagnostic stop recovery. Diagnostic
active-timeout replay agrees on every call and the complete stopped checkpoint.
Independent ZIP fixtures include Python-produced stored, DEFLATE and descriptor
archives, malformed CRC/length/paths, expansion limits and lifecycle cancellation.
The complete HP39gs download was independently rebuilt from its own included
sources plus external compilers and matched every archive byte.

HP39gs physical extraction, its own full-NOR acceptance and HP40gs/HP50g images
remain outstanding. Internal USB does not establish desktop device attachment
or complete Conn3x interoperability. SD media, UART2/IrDA and NOR programming
remain outside the current implementation. No firmware, private checkpoint or
raw guest picture is included in these public evidence records.

## HP49g+ and HP39/40 file-transfer continuation (2026-10-22)

The [release validation record](evidence/release-validation-r17.json) identifies
the frozen production assets and separates generated fixtures, original-ROM
workflows, package checks and publication checks. These are local acceptance
results for the continuation from `d199afd`; remote Build, Pages and deployed
revision acceptance must be observed separately after publication.

The core validation passes 16 Release, 16 retained-reference and 16 ASan/UBSan
suites. Native and test-WASM runs pass **1,119,781 assertions per host**, plus
**32,949 functional-clock checks per host**. The independent Unicorn corpus
passes 17,075 cases with zero mismatches and zero skips; Clang static analysis
reports no diagnostics across 41 native C sources. The
[independent core review](evidence/core-review-r17.json) additionally checks
256 scheduler/reference partitions and rejects a correct-CRC checkpoint that
tries to import an unsupported active SDI data mode before changing the
machine. Its 937 checkpoint assertions pass on native, reference, sanitizer
and test-WASM builds.

The final browser and host checks use the production WASM with SHA-256
`5fb9626e86eed337fd4371ebf3e6ea27f5fa7af12bcee40e84d09e009121d48f`.
Chrome is version 156.0.8078.47. The final asset manifest in the evidence record
also identifies the calculator bundle, Worker and transfer modules.

| Validation layer | Executed scope and result |
| --- | --- |
| React components | Lazy keypad/view/model races, exact full-canvas pixels and PNG capture, English/Chinese settings, upload batches, HP39 catalog/serve/download controls and four viewport widths pass. This fixture supplies explicit Worker events. |
| Production browser Worker | All 12 model/audience cases pass run, speed, pause, step, reset and checkpoint checks using generated ARM guests. The production UI passes 104 physical-key checks; page errors are empty. |
| Stop recovery | Ordinary and diagnostic browser runs preserve the original observation, wait for Save acknowledgement and recover the exact stopped checkpoint. The diagnostic run also replays an active timeout through the same WASM with every call result and the complete checkpoint equal. These generated guests do not reproduce the historical unclassified original-ROM stop. |
| Timer receiver | Delayed dispatch, cancellation, immediate-task fallback and shutdown pass. |
| Standalone host | Source and rebuilt package tests pass real loopback TCP, USB/IP split headers, guest EP0 transactions, cancellation, limits and binary-safe ARM UART echo. The package contains the same frozen WASM. Kernel attachment, COM/PTY devices and Conn3x remain separate acceptance tasks. |
| Documentation and Pages | Repository-pinned Zensical 0.0.67 strictly renders all 41 documentation pages without issues. Nine publication-contract tests and local assembly of all 36 emulator assets pass; assembled runtime bytes equal the frozen input. |

Original-ROM evidence is maintained in the
[HP49g+ support record](evidence/hp49-support-r17.json) and
[HP39 file-transfer record](evidence/hp39-file-transfer-r17.json).
HP49g+ has a fixed immutable-ROM startup, arithmetic, CAS, menus, graphing,
native/WASM continuation and production-browser USB file workflows. Its
browser lifecycle checks also cover exact LCD restore, PNG download, narrow
viewports and import of an earlier HP48gII session. The HP39g+ Disk drive path
uses the calculator as a Kermit client: the browser serves the original aplet
and library, receives the calculator's SEND output and returns to HOME for
arithmetic. Uploaded aliases and typed object bodies are checked independently
of the calculator's rewritten file-header title. The
[transfer review](evidence/transfer-review-r17.json) covers retained-download
capacity before EOF acknowledgement, atomic batch preflight and bounded
duplicate-final-ACK handling after actual timeout retransmissions.

The [complete ROM-reader record](evidence/hp39-romstream-r17.json) and
[independent package review](evidence/package-review-r17.json) cover reuse of
the existing hpclang reader, the complete 1 MiB stream, independent reads,
full archive rebuild and receiver failure handling. The new download includes
the Windows receiver and corresponding calculator sources. The calculator
aplet/SDK GPL sources stay in their independent download and notices; they are
absent from the MIT core, WASM, frontend bundle and standalone host build.

The Pages audit found and fixed two omitted runtime dependencies:
`hp39-files.js` and `hp39-transfer.js`. All 36 production assets now match the
strict allowlist; the nine Pages contract tests pass. The audited release
inputs contain no calculator ROM, private checkpoint or font files. The
release record retains download sizes/hashes and verifies final assembly
without publishing private screenshots, object contents or bus traces.

The functional support boundaries remain explicit: the HP49g+ SDI path models
an empty slot, and its stock file route is USB; SD media and UART2/IrDA are not
implemented. HP39gs and HP40gs share the implemented Disk drive host path but
still need their own complete-ROM original-system acceptance. The 39gs reader
has a complete original-HP39g+ emulator workflow; physical 39gs extraction and
Windows HID hardware operation remain to be observed. None of these local
results establishes physical clock timing or canonical board equivalence.
The dated sections below retain the scope and counts of their earlier builds.

## Performance continuation from 83a2d38 (2026-10-20)

The current [performance record](performance.md#physical-reads-and-worker-pacing-2026-10-20-from-83a2d38)
and [sample summary](performance-2026-10-20.json) separate core throughput,
Node Worker CPU cost and actual Chrome input latency. The retained default
changes are a caught-up Worker pacing fix and two boot SRAM pointer corrections.
The checked WASM physical-read fast path is now an explicit, default-off
experiment following the stop review; its core-throughput figures are not
default-release gains. The attempted CPU transaction optimization was withdrawn
after inconsistent timing, while its regression comparisons remain.

Historical fast-read candidate validation: local Release, reference and
ASan/UBSan each pass 14 CTest suites. Native and
test-WASM checks pass 1,118,080 assertions per host plus 9,902 divided-clock
checks. Unicorn reports 17,075 cases, zero mismatches and zero skips. Static
analysis reports no diagnostics across 38 native sources or the WASM bus path.
The production Window/Worker browser gate passes 12 model/audience cases and
104 physical-key checks without page errors. Source and packaged loopback
USB/IP/UART tests also pass; OS kernel attachment and Conn3x remain separate.

The two original-NOR HOME/arithmetic witnesses each pass two native and two
WASM cold runs with identical repeated/native/WASM outputs. Real Chrome file
selection, exact checkpoint restore and keyboard/result-pixel measurement
have now run locally on an HTTP origin. The initial 24-trial stock-ROM browser
sweep nevertheless contains one HP48gII Unlimited stop after a correct `56`;
the pointer-corrected fast-read candidate's separate 24-trial sweep passes
all 48 expressions. The
earlier stop remains unclassified; later passing trials do not explain it.
It prevents enabling the new physical-read path by default. The narrowed
release restores baseline physical-read dispatch and keeps the independently
measured Worker improvement. The detailed performance record
preserves both sweeps and their exact build identities. Do not describe the
initial sweep as fully passing or the existing physical clock, SRAM,
LCD and analog hypotheses as verified hardware.

The maintained failure probe now preserves the original observation before
using the real Save/download path to recover a stopped machine. A generated
guest browser test verifies the new Save acknowledgement, exact stopped state,
and preservation of the observation even if screenshot capture fails. It is
a diagnostic recovery gate, not a reproduction or resolution of the ROM stop.

Current source and CI live in
[maxmixalex/orchard-emu](https://github.com/maxmixalex/orchard-emu).
The historical issue/run links below refer to the earlier repository owner.
Remote acceptance requires observing the exact revision's Build and Pages
runs and the deployed revision/assets; local checks alone do not establish it.
The earlier full candidate is preserved as `aba2923` on
`codex/perf-wasm-worker-20261020` in
[PR #1](https://github.com/maxmixalex/orchard-emu/pull/1).
That stage had no remote Build because automatic triggers accepted only main
pushes. Commit `f95232a` adds pull-request validation on `ubuntu-24.04`, retaining
read-only permissions and disabling persisted checkout credentials. Pages
continues to require a successful exact-current-main push/manual Build;
pull-request artifacts cannot deploy. The narrowed default release requires
its own Build acceptance, separate from prior local fast-read results.

The input-timeline continuation uses the same production WASM artifacts and
unchanged `run()`/hold/gap settings. Eight sampled profiles (two models, two
expressions, baseline and candidate) match four unsampled baseline runs in
complete final checkpoint bytes, exact physical-key events, UART and LCD pixels.
The fixed-phase virtual profiles are also identical between builds. This gate
attributes guest-time intervals; it is not a browser wall-time benchmark or
physical-clock calibration. See the [continuation evidence](performance-continuation-2026-10-20.json).

The clock-observation extension passes another eight sampled profiles and four
unsampled references. Apart from execution timestamp, profiler source identity
and added clock fields, every field equals the preceding input report. Each
profile records 20,001 boundaries without changing its guest execution or
physical input schedule. Pure tool tests cover CLI rejection, copied observations
and boundary validity without loading a WASM or ROM.

Opt-in browser traces have passed four HP48gII Unlimited same-WASM replays
(105,412 API calls, 52,240 run calls), including every call result/tick/stop,
UART/USB payload and final complete checkpoint. Actual key arrival phases vary,
so these records are diagnostic evidence, not comparable latency samples.
The original failed browser stop remains unclassified. Generated-guest Chrome
recovery and Node trace-corruption controls provide separate tool acceptance;
the evidence record distinguishes their executed source identities from later
validator hardening. CI runs the Node replay gate after building the WASM and
uploads only generated browser reports/screenshots, never private traces or
checkpoint files.

## Historical frontend and host continuation

The interrupted React work was not present in main `2889f90`. This continuation
recovered hash-checked source fragments, rebuilt the missing frontend and
revalidated the result locally. Exact publication revision and observed CI/
Pages outcomes belong to issue #1, not this pre-publication record.

## Implemented

React/Mantine user controls, bundled English/Chinese translation resources,
clickable PC key mapping, traditional modifier legends, PNG capture and a
separate frame subscription now replace the vanilla calculator page. Existing
Worker, session/envelope and lifecycle tests remain. The developer workbench
uses the same unchanged core. See [React UI](react-ui.md).

The standalone loopback [host prototype](host-mode.md) exposes USB/IP and raw
serial. Generated ARM guest/TCP tests run both from source and the assembled
package. They do not prove kernel driver or Conn3x compatibility.

## Tests and scope

Eleven native and test-WASM suites now contain **443,311 assertions per host**.
The extra 6,912 assertions exercise 1,152 ARM single-transfer variants against
the retained reference: different addressing flags, alignment, aliasing,
PC destinations, memory bounds and MMIO. The attempted narrow rollback
optimization did not show a reliable full-workload improvement and was removed;
the extra tests remain. The shipped production C core is byte-for-byte the
accepted `2889f90` source; no CPU/peripheral timing semantics change here.

Local Release/reference/sanitizer suites, unchanged generated guests, Worker,
preferences/session/RTC, frontend/controller, skin and publication contracts
all passed. The independent Unicorn subset passed 17,075 cases with no
mismatches or skips. Both original-NOR cold-start arithmetic probes completed
two native and two production-WASM runs per model; frames and exposed states
agree. The checkpoint probe resumed each after 1+2=3, completed 7*8=56 and
matched uninterrupted serialized state; native continuation also matched.
These ROM-dependent runs are local, ordinary builds, not CI/sanitizer startup.
Strict Zensical rendered all 30 pages locally without issues. Remote run IDs
and deployed-asset verification are recorded after observation in issue #1.

Offline Chromium component tests use real React/Mantine but a fake Worker and
explicit in-memory artwork, not an HTTP origin. They caught a genuine sizing
regression: SkinView's inline aspect ratio incorrectly made the traditional
screen container as tall as an entire case. Traditional mode now overrides
that ratio, and a key-position assertion prevents its return. They also cover
language Apply/Cancel, PC selection, printed legends, PNG download and four
viewport widths. They are not original-firmware/browser-storage E2E.

## Measured display investigation

A local Node/V8 investigation at generated original-system states measures
only the production LCD accessor, annunciator accessor and copied pixels.
Median decode/copy cost was about **0.049 ms/frame on HP39g+ and 0.047 ms/frame
on HP48gII**. At 30 calls/s this is about 1.5 ms of CPU time per second.
Checkpoint bytes before/after sampling are equal. This does not include browser
canvas drawing, CSS scaling, compositor work, messages or real time calibration.
It does not support the decoder itself as the dominant observed slowdown.

The initial new RGBA helper allocated a subarray per pixel; typed-array palette
lookup removes that avoidable allocation. Its local 131x64 conversion dropped
from roughly 0.34–0.36 ms to 0.019 ms. This is a rendering-helper microbenchmark,
not a corresponding increase in calculator execution speed. The frontend also avoids unchanged
canvas updates and any per-frame React state subscription. Core profiling
instead shows interpretation/address translation as large CPU consumers.
Increasing translation-cache capacity alone and the narrow-rollback prototype
did not provide a reliable improvement, so neither is shipped. No headline
CPU speedup is claimed. Normal's functional timebase and its unverified
relationship to physical clocks are unchanged. See [performance](performance.md).

## Reproduce

```sh
npm ci --ignore-scripts
npm run build
npm run test:wasm
npm run test:web
npm run test:calculator
npm run test:skins
npm run test:pages
npm run test:host
npm run build:host
ORCHARD_HOST_ROOT=build/host-package npm run test:host
```

Native/reference/sanitizer and the independent Unicorn corpus retain their
existing commands. `python3 tests/browser-components.py` is an optional local
component test requiring Playwright and Chromium, not an unproven browser gate
in normal CI. `tools/profile-display.mjs` needs private local ROM inputs and
never acquires or publishes them.

## Accepted history


## Settings release follow-up on c3e8a36

[Build #21](https://github.com/zyf722/orchard-emu/actions/runs/37121793241)
passed Release but stopped in two unoptimized Debug ASan/UBSan tests at their
30-second CTest limits. No settings/timing deployment followed that failed
Build. The same incoming tests completed locally without assertion failures:
checkpoint 24.52 seconds, scheduler 28.25 seconds. These measurements explain
insufficient timeout margin; they are not a successful result for Build #21.

Sanitizer targets now explicitly use `-O1 -g`, retaining both sanitizers,
frame pointers, all assertions and the existing 30-second limits. This follows
[Clang's recommended sanitizer build](https://clang.llvm.org/docs/AddressSanitizer.html#usage).
With this change and the checksum optimization below, all eleven local
sanitizer suites pass in 16.70 seconds total; checkpoint takes 3.22 seconds,
scheduler 10.41 seconds. Ordinary Release and retained-reference suites also
pass. Exact remote Build/Pages acceptance remains recorded in issue #1 after
observation, not inferred from these local results.

### Faster checkpoints, unchanged format

The reflected CRC32 recurrence now advances a byte using a 1 KiB constant
table. Both the complete NOR identity checksum and payload checksum are still
recomputed on every call. No validation is removed or cached. The independent
bitwise test reference checks both fields on all six model capacities, adding
12 assertions: **769 checkpoint checks; 436,399 native/test-WASM checks per
host overall**. Version 1, file bytes and `.ord`/legacy envelope compatibility
are unchanged.

A local Clang 17 / Node 22.16.0 interleaved comparison uses the incoming
c3e8a36 production WASM and this build. Each model is loaded with its exact
owned NOR at reset; no guest execution is included in these timings. Of 16
alternating samples, the first three are discarded; medians of the remaining
13 are shown. Complete 270,310-byte checkpoints match before and after imports.

| Model | Save before / after | Import before / after |
| --- | --- | --- |
| HP39g+ | 7.383 / 4.828 ms | 7.587 / 4.806 ms |
| HP48gII | 12.980 / 8.723 ms | 13.201 / 8.499 ms |

This is approximately one-third less core snapshot blocking, **not** a CPU
throughput increase or end-to-end localStorage/file-picker benchmark. Browser
envelope hashing, base64, synchronous storage and shutdown delivery remain
separate costs and limitations.

### Clock and original-system continuation

`tests/pacing-rtc.mjs` now combines the actual production WASM with the shipped
Pacer and a generated ARM guest that disables the watchdog and enters WFI.
It does not write RTC time. At Half/Normal/Double, two synthetic monotonic wall
seconds produce exactly one/two/four guest RTC seconds. Different host arrival
intervals and 256/4096-quantum call caps produce byte-identical complete
checkpoints at each rate. Reset credit and bounded catch-up are also checked.
This integration test is part of `npm run test:calculator`; it is neither a
physical clock calibration nor actual browser scheduling acceptance.

The fixed original HP39g+ and HP48gII arithmetic witnesses were rerun twice
natively and twice on production WASM. Both preserve their established frames
for `1+2=3` and `7*8=56`, with the same explicit hardware assumptions. The
checkpoint continuation probe saves after the first calculation, restores in
a fresh machine and completes the second with byte-identical serialized state
against uninterrupted execution; a native continuation matches too. Short
physical-key arithmetic and the HP39 ALPHA/VARS input study also pass again.
Long original-firmware runs are ordinary builds, not sanitizer/CI workloads.

The default independent Unicorn corpus passes 17,075 cases without mismatches
or skips. All 34 static-analysis units are clean; 76 tool checks and the
production guest, Worker, settings, storage, connection, skin and publication
contracts pass locally. No CPU instruction, peripheral, tap or pacing semantics
were changed in this follow-up. Real browser-origin navigation remains blocked
by administrative policy; no file-picker, touch or real localStorage E2E is
claimed. New strict documentation rendering and deployed-asset verification
must still be observed on the accepted remote build.

## Reproduce and prior records

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
cmake -S . -B build-sanitize -DCMAKE_BUILD_TYPE=Debug -DORCHARD_SANITIZE=ON
cmake --build build-sanitize --parallel
ctest --test-dir build-sanitize --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run test:web
npm run test:skins
npm run test:calculator
npm run test:pages
python3 tools/check-docs.py
```

The successful remote Build must additionally run the retained-reference build,
independent Unicorn comparison, static analysis and strict Zensical render.
Local optional firmware commands (not ordinary CI) are the two fixed startup
probes, `probe-checkpoint.mjs` and `probe-interaction.mjs`. Their ROM and private
outputs stay outside the source and production archives.

[Prior validation records](validation-history.md) preserve the incoming
c3e8a36 validation page verbatim, including older revisions, counts and limits.
They are historical observations, not new acceptance. Current clock/input/
storage behavior is described in [interaction](interaction.md) and
[sessions](sessions.md); the roadmap and issue #1 keep physical fidelity,
real browser usability, virtual packets and stock file transfer separate.
