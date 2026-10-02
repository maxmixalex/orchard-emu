# Native NOR bring-up

## Current continuation: weak bias, real recovery keys and gated LCD reads

Base revision `54f316d`. The core now separates weak bias from strong GPIO
stimuli and can schedule raw matrix changes on native CLI as well as WASM.
The following are **local** probes with source/binary hashes, exposed-state
comparison and independent cold replay on both hosts. No input NOR changes.
All listed cases have zero guest exceptions and data-fault state.

| Input and explicit condition | Retired instructions | Stop PC | Result |
| --- | ---: | --- | --- |
| HP39g+ full NOR, strict | 514,293 | `000035e8` | LCD `4d000068`, unchanged |
| HP48gII full NOR, strict | 94,497 | `08001820` | GPDDAT `56000034`, unchanged |
| HP39g+, idle-zero only | 516,679 | `00002d2c` | GPFDAT `56000054` |
| HP39g+, idle-zero + keyboard + F input `8e:0` | 518,006 | `000036b0` | LCDSRCPND `4d000058` read |
| HP48gII, components/pads below, strict LCD | 8,210,200 | `0000707c` | LCD `4d000068`, unchanged |
| Same HP48gII with idle-zero | 8,212,481 | `00004f34` | ADC `58000000` write, value `42f8` |
| HP50g boot-only, weak bias, no key | 3,000,000 | `08001310` | Recovery polling; budget completed |
| HP50g boot-only, weak bias, key 1 press/release | 2,634,075 | `08001d58` | USB `52000144` write |
| HP50g boot-only, weak bias, key 2 press/release | 2,634,106 | `08003334` | SD `5a000004` write |
| HP50g boot-only, former strong-high columns, key 1 | 2,168,086 | `08001c44` | Expected GPG11 contention; negative control |

The stopped cases consume one more tick than their instruction count. Every
idle-zero case records exactly **one unverified LCD read**; all other rows
record zero. Default strict behavior is unchanged. The optional read is bounded
to disabled-video word reads and is not claimed as the real register semantics;
see [LCD evidence](lcd.md). No case is an accepted stock calculator boot.

The component-enabled HP48gII uses `--keyboard apples --nor-device sst39vf1601`,
strong pads `D:cc7f:0,G:1:0`, and weak bias `G:f800:f800`. The 50g uses the same
keyboard/pads/bias, but no selected NOR-ID part and only its original 16 KiB
boot region with erased OS sectors. Selection events are at ticks 2,000,000
(press) and 2,400,000 (release), within a 3,000,000-quantum budget. Raw key 1 is
(3,5), key 2 is (2,5). Both events are consumed before the positive USB/SD
stops; the negative strong-drive case stops before release and reports one
applied event. This isolates the earlier artificial electrical conflict.

Firmware-decoded menu choices now follow different device paths, with no host
jump, guest-memory edit or keyboard-queue injection. USB and SD transactions
are **not implemented** by reaching these writes. The no-key packed-memory
view has 858 nonzero pixels; after a selection it has 175. Packed-memory
readability remains distinct from a validated physical LCD image.

The 39g+ keyboard/idle-zero, 48gII component/idle-zero and 50g key-1 cases also
repeat under optimized Clang ASan/UBSan with native/WASM agreement and cold
replay. The instrumented long probes are not full Debug-timing measurements.

```sh
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 10000000 --keyboard apples --nor-device sst39vf1601 \
  --gpio-input D:cc7f:0,G:1:0 --gpio-bias G:f800:f800 \
  --lcd-probe68 idle-zero --frame-view packed-lsb
node tools/probe-rom.mjs --model hp50g --bootloader /private/boot-50g.bin \
  --ticks 3000000 --keyboard apples --gpio-input D:cc7f:0,G:1:0 \
  --gpio-bias G:f800:f800 --key-at 2000000:3:5:1,2400000:3:5:0 \
  --frame-view packed-lsb
```

## Earlier progression records

The sections below preserve the earlier strict and strong-drive experiments.
Their then-current blockers are historical checkpoints; the table above owns
this continuation's scope. Prior full-dump identities remain unchanged.

### Current continuation: shared LCD blocker

Starting from `d3d6528`, the opt-in electrical keyboard and explicit
SST39VF1601 software ID now let the unchanged HP48gII full NOR pass the
bootloader's keyboard/flash-identification checks, reach code in the original
OS flash region, enable its MMU and stop at LCD `0x4d000068`.

| Configuration | Retired instructions | PC | Result |
| --- | ---: | --- | --- |
| HP39g+ genuine full NOR, default strict | 514,293 | `000035e8` | Existing LCD `+0x68` stop |
| HP48gII genuine full NOR, default strict | 94,497 | `08001820` | Existing GPDDAT stop |
| HP48gII full NOR, keyboard + SST39VF1601 + recorded pads | 8,210,200 | `0000707c` | OS-region LCD `+0x68` read; not an interactive boot |
| HP50g native boot-only, keyboard + recorded pads, all keys released | 2,000,000 | `08001310` | Recovery polling, budget exhausted without diagnostic stop |

The new 48gII conditions are `--keyboard apples --nor-device sst39vf1601`
and `--gpio-input D:cc7f:0,G:f801:f800`. A separate cold run with D levels
`cc7f` has the same complete exposed execution result except its input metadata.
Both native/WASM comparisons and each host's cold replay agree. Both stop at
tick 8,210,201, instruction `e5950068`, with CP15 control `0000107f`, zero
exceptions/faults and a disabled/blank LCD. Native ASan/UBSan with optimization
reproduces the D-low result. The new part/keyboard inputs are explicit test
conditions, not automatically selected defaults or measured pad idle levels.

The bootloader actually writes the AA/55/90 command sequence and reads the
manufacturer/device halfwords. Their combined identity is `00bf234b`; F0
returns the selected NOR component to array reads. Flash bytes remain unchanged.
See [electrical input](input.md) for primary chip/wiring sources and the
limits of the identification state machine.

This narrows the next blocker: **39g+ and the progressed 48gII independently
read the same unidentified LCD offset**. It still has no accepted definition.
No zero-value shortcut or ROM patch was added. The original OS-region PC and
MMU enable are forward progress, not evidence of responsive calculator UI.

The 50g boot-only no-key experiment uses D `cc7f:0` and G `f801:f800`, without
selecting a NOR part. It still supplies no OS. Its existing 858 nonzero pixels
and per-byte bit-order counterexample remain unaccepted panel output. A local
exploratory key-1 press at tick 2,000,000 (raw column 3, row 5) instead exposes
contention on GPG11 at tick 2,168,087: the explicit strong high test drive fights
a guest-driven output through the closed switch. This is **not** accepted
real-ROM key interoperability. It is a concrete reason not to turn no-key
ambient stimuli into an automatic board preset. The reproducible ROM-free
production-WASM IRQ test uses only nonconflicting pad conditions.

```sh
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 10000000 --keyboard apples --nor-device sst39vf1601 \
  --gpio-input D:cc7f:0,G:f801:f800 --output /new/path/48-keyboard.json
node tools/probe-rom.mjs --model hp50g --bootloader /private/boot-50g.bin \
  --ticks 2000000 --keyboard apples \
  --gpio-input D:cc7f:0,G:f801:f800 --output /new/path/50-recovery.json
```

Probe v3 records the component selection, attachment and external drives and
reapplies all conditions after reset. Full-NOR, boot-only and generated guests
remain distinct. Ordinary CI still has no firmware dependency.

### Previous native-input research (`d3d6528`)

The following sections retain the earlier baseline and its bounded experiments;
statements about the then-unimplemented keyboard refer to that revision.

### Strict full-NOR baseline (unchanged by external-stimulus support)

Two **unmodified full physical NORs** now execute in Orchard: the user's
HP39g+ D1.55 dump and the hash-pinned HP48gII USB-revision mirror. Both reach
specific, reproducible missing-hardware stops. Neither reaches an interactive
stock calculator UI. The input hashes, binary hashes, CPU state and replay
checks are produced locally by `tools/probe-rom.mjs`; no ROM is uploaded by it.

| Fixture | Retired instructions | Final PC | Current blocking read | MMU |
| --- | ---: | --- | --- | --- |
| HP39g+ D1.55 | 514,293 | `0x000035e8` | LCD block `0x4d000068`, word read | Enabled, CP15 `0xc000107f` |
| HP48gII full NOR | 94,497 | `0x08001820` | GPDDAT `0x56000034`; unresolved input mask `0xcc7f` | Disabled, CP15 `0xc0000078` |

Budget: 1,000,000 virtual ticks. Actual stop ticks: 514,294 and 94,498,
respectively. Both finish with zero guest exceptions, zero data-fault status
and zero data-fault address. Both LCD outputs are still blank/disabled, and
neither emits UART bytes. The HP48gII PC is in external SRAM: the original
bootloader has progressed into copied startup code, not a host-injected image.

Native and production WASM agree on all 16 registers, CPSR, CP15 control,
fault registers, counters, stop PC/opcode/address/detail, raw pixels and UART
bytes. Independent cold replays agree on both hosts. This establishes
repeatability and host consistency, **not an independent CPU oracle or boot
completion**. No ROM patches, replacement bootloaders, GPIO input guesses or
unknown-register zero-read fallbacks were used.

### Dependencies resolved from the trace

The prior published core stopped both images after 71 instructions at
`PC=0x78`, reading `GSTATUS2` (`0x560000b4`). Implementing its power-reset
cause and write-one-to-clear behavior exposes the next real dependency.

HP39g+ then stores to the 4 KiB internal boot SRAM at `0x40000000`, from
`PC=0x4f18`. With that memory absent, it repeatedly takes a data abort and
restarts. An exhausted run budget was therefore not evidence of forward boot
progress. Exact-size boot SRAM eliminates this exception loop without changing
the NOR or expanding external SRAM. The guest subsequently builds its own MMU
mappings and uses this internal SRAM for early LCD DMA backing.

Next were GPIO latch/configuration accesses, interrupt `PRIORITY`, and a
write disabling LCD dithering. Their definitions come from the Samsung manual,
not a transplanted emulator device implementation. GPIO DAT reads with
unresolved input pins still stop. IRQ arbitration now has six leaf arbiters
and one top arbiter, fixed REQ0/5 and selectable/rotating REQ1..4; it no longer
always awards the lowest source bit.

HP48gII additionally reads RTC BCDYEAR with a **word LDR** at `PC=0x88`.
The RTC implementation provides a stateful BCD clock, normal-mode writes,
calendar carry, leap years, alarm/tick IRQs and deterministic clock division.
The programming manual recommends byte accesses; the HP bootloader establishes
that aligned word reads must also be accommodated. Orchard aliases the low
byte and chooses zero for the upper lanes. Those upper-lane electrical values
have not been measured on hardware.

### Explicit modeling limits

The cold-fixture RTC seed is **2000-01-01 00:00:00, weekday 7**. It is a
repeatable external starting condition, not a date extracted from the dump.
The provisional timebase is 12,000,000 scheduling quanta per second, converted
rationally into 32,768 RTC edges per second. This does not establish a physical
CPU/PCLK/PLL ratio. RTC test modes and enabled round-reset commands stop;
invalid BCD calendar state stops when it must advance. Cold reset reseeds the
clock; retained battery state, power-off wakeup and host-time synchronization
remain open.

GPIO CON/UP, output latches, reset cause/information and selected routing
registers exist. Routing-register storage is **not** a simulated external
interrupt pin, keyboard matrix or clock output. Unspecified output-latch reset
values are chosen zero; externally driven input pins are never inferred from
that choice. External interrupt detection remains open.

The raw single-scan STN decoder now observes word-MSB-first order, BSWP and
HWSWP. The former decoder had incorrect lane order and accepted dual scan as
single scan. Directed asymmetric-word tests replace that ambiguity; TFT/dual
scan and nonzero dithering remain unsupported. Board-specific panel wiring,
annunciator rows, polarity, LCD timing and FIFO behavior are not established.

### LCD status investigation

HP39g+ polls LCD offset `0x68` immediately before enabling video. The reviewed
S3C2410A manual lists the normal LCD registers through LPCSEL at offset `0x60`,
but does not identify this read. The observed firmware loop toggles ENVID
while the value is nonzero. That is evidence to investigate a possible hidden
status/FIFO facility, **not enough to assign it a name or return zero**.

### GPDDAT dependency: read-modify-write, not a keyboard decision

Disassembly of the unmodified HP48gII image shows the blocked read is followed
by masking with `0xcc7f`, setting output bits `0x300`, and writing GPDDAT.
It preserves input bits while changing outputs; it is not interpreting a key.
The S3C2410A manual, chapter 9, specifies separate external-input and output-latch
readback. The new `orchard_gpio_inputs()` interface therefore supplies **only
explicit externally known levels**; it does not reuse latches as inputs.

Ports B through H have independent known/level masks. Unspecified input bits
still stop, bad masks fail without mutation, output mode still reads the guest
latch, and reset clears external stimuli. The function neither creates EINT
edges nor implements a keyboard matrix. Native CLI and WASM expose the same
interface; no automatic board preset or generic MMIO fallback was added.

The native checkpoint probe exhausts **all 2,048 combinations** of the eleven
GPDDAT input bits. From the checked pending-read checkpoint, each variant runs
8,192 more ticks, ending at `PC=0x08002a2c`. Every PC trace, exposed architectural
state, external SRAM byte, LCD register and driven output bit agrees; NOR stays
unchanged. This closes input-value sensitivity for that bounded window only,
not arbitrary future firmware or actual idle-level measurements. The separate
ROM-free C regression tests the minimized ARM read/modify/write sequence.

```sh
node tools/probe-gpio-window.mjs /private/48gii.bin
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --gpio-input D:cc7f:0 --ticks 2000000
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --gpio-input D:cc7f:cc7f --ticks 2000000
```

Both longer, independently cold-started conditions pass LCD setup and the
bootloader's firmware-check path, then stop at GPGDAT `0x56000064`,
`PC=0x08001b60`, after **1,121,326 instructions**. Their CPU outputs agree,
with no guest exceptions. The source NOR is still the original full dump;
the explicitly supplied external signals make these **conditional** witnesses,
not strict no-stimulus boot acceptance. The framebuffer remains blank.

### Original HP49g+/HP50g boot regions

The matching 16 KiB regions are now available; see [preservation research](native-roms.md).
The remaining NOR is explicitly erased in these experiments, not populated with
an invented or cross-model OS. Budget: 2,000,000 ticks; all cases replay on each
host and agree between the native CLI and production WASM.

| Input / explicit condition | Instructions | Stop PC | Missing access | Nonzero raw pixels |
| --- | ---: | --- | --- | ---: |
| HP49g+ boot region, no GPIO stimulus | 415,989 | `0x08001afc` | GPDDAT, mask `0xcc50` | 0 |
| HP49g+, D known `cc50`, low or high | 419,223 | `0x08002148` | USB write `0x52000144` | 0 |
| HP50g boot region, no GPIO stimulus | 94,497 | `0x08001820` | GPDDAT, mask `0xcc7f` | 0 |
| HP50g, D known `cc7f`, low or high | 153,879 | `0x08001b60` | GPGDAT `0x56000064` | 858 |

All four stop classes have zero guest exceptions and data-fault state. The
HP50g bootloader produces recovery-menu framebuffer content because the OS
sectors are erased. This is **not** the calculator OS booting or USB working.

That nonblank framebuffer also exposes an outstanding display issue: the raw
controller preview has per-byte reversed character bits. A separate memory
inspection with LSB-first pixel extraction resolves the bootloader's recovery
text and version. This establishes the guest buffer's bit convention, **not**
the complete electrical panel mapping. The SoC decoder has not been silently
changed to fit a readable screenshot. Correct panel bit order is now an
explicit counterexample/gate, alongside the already unresolved FIFO/status read.

### Reproduce locally

Build the native CLI and production WASM first, then:

```sh
node tools/probe-rom.mjs --model hp39gplus --rom /private/39g+.bin \
  --ticks 1000000 --output /new/path/hp39gplus.json
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 1000000 --output /new/path/hp48gii.json
```

The script checks input size/hash identity, runs each host twice, compares
architectural output, and creates reports exclusively (existing output paths
are rejected). It does not contain firmware or require it for ordinary CI.
Reports identify the exact compiled native/WASM binaries used. All probes in
this slice were executed locally, including the sanitizer native runs.

Source references: [Samsung S3C2410A User's Manual](references.md), chapters
6 (internal boot SRAM), 9 (GPIO/reset status), 14 (IRQ arbitration), 15 (LCD)
and 17 (RTC); [fixture provenance](roms.md).
