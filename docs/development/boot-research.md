# Native NOR bring-up

## Strict full-NOR baseline (unchanged by external-stimulus support)

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

## Dependencies resolved from the trace

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

## Explicit modeling limits

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

## LCD status investigation

HP39g+ polls LCD offset `0x68` immediately before enabling video. The reviewed
S3C2410A manual lists the normal LCD registers through LPCSEL at offset `0x60`,
but does not identify this read. The observed firmware loop toggles ENVID
while the value is nonzero. That is evidence to investigate a possible hidden
status/FIFO facility, **not enough to assign it a name or return zero**.

## GPDDAT dependency: read-modify-write, not a keyboard decision

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

## Original HP49g+/HP50g boot regions

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

## Reproduce locally

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
