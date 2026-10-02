# Native NOR bring-up

## Inputs and result scope

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

## Current investigations

HP39g+ polls LCD offset `0x68` immediately before enabling video. The reviewed
S3C2410A manual lists the normal LCD registers through LPCSEL at offset `0x60`,
but does not identify this read. The observed firmware loop toggles ENVID
while the value is nonzero. That is evidence to investigate a possible hidden
status/FIFO facility, **not enough to assign it a name or return zero**.

HP48gII stops on a GPIO read containing input-configured pins. The next step
is to establish their board connections and idle levels independently, not to
reuse output-latch bits as fabricated external inputs. Full NOR availability
is no longer the blocker for either model.

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
