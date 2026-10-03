# Startup memory: first conditional stock-OS prompt

## Progress and acceptance boundary

The unchanged HP48gII full NOR now reaches the original operating system's
**Try To Recover Memory?** prompt with YES/NO soft keys. This is a stock-OS
startup screen, not the HP50g bootloader's USB/card recovery menu. It is still
**conditional bring-up**, not accepted M3 cold boot: the run uses explicit
unmeasured pad/ADC conditions, four counted LCD `+0x68` hypothesis reads, and
the packed-LSB memory-inspection view rather than established panel wiring.
The ordinary calculator interface has not been reached.

No firmware bytes, PC patches, writable-ROM shortcut, replacement Saturn core,
RAM enlargement or SRAM mirror were added. The only production change in this
slice is the selected x16 NOR word-write adapter in `src/nor.c`.

## Why the address-zero store occurred

The earlier HP39g+ stop was ARM `STMHS r0!,{r2,r3,r12,lr}` at `0x22440`.
Tracing its caller found an explicit `MOV r5,#0` at `0x16408`, a length of
`0x1000` at `0x16434`, and a call through `r0=r5` at `0x1643c`. This is a
literal zero-address initialization request, not evidence of a failed
allocation that happened to return zero. At that stop, the section descriptor
was `0x00000c1a` and the implemented MMU translated the store to physical zero.
The trace does not by itself explain the original firmware author's intent.

The immediate emulator defect was narrower: `o_nor_write` rejected **every
32-bit store**, even with an explicitly selected 16-bit SST39VF1601. The
[S3C2410A memory-controller manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf)
shows the x16 ROM interface in Figure 5-7 (printed 5-8) and OM-selected bank-0
width in BWSCON (printed 5-14). The
[SST39VF1601 data sheet, DS25028A](https://ww1.microchip.com/downloads/aemDocuments/documents/OTH/ProductDocuments/DataSheets/25028A.pdf)
defines a x16 device, permanently enabled Software Data Protection, and
invalid-command return to array-read mode (printed 9, command table on 11).

An aligned CPU word store to the **selected x16 component** now issues its low
halfword at address A and its high halfword at A+2, in that order. Each cycle
passes through the existing command state machine. Ordinary zero-fill cycles
are not a valid programming sequence and leave flash contents unchanged.
Recognized but unimplemented program/erase/CFI/security commands still stop.
Range checks precede both cycles; a diagnostic on a later cycle does not undo
an earlier command-prefix effect. This is functional bus-width adaptation,
not full wait-state, BWSCON write-protection or cache timing emulation.

Unknown NOR parts stay strict. In particular, the 1 MiB HP39g+ input has not
been mislabeled as the 2 MiB SST39VF1601: its post-USB zero-store remains a
separate open component-model task. No model chooses a chip from file size.

## Explicit HP48gII run

The input is the existing 2,097,152-byte full NOR with SHA-256
`4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937`.
The original firmware is unmodified. Extending beyond the old stop reveals
additional real input reads: the existing component/pad case reaches GPFDAT;
adding the explicit F-pad condition reaches an unresolved AIN0 conversion.
Only after declaring that additional sample does the prompt appear.

```sh
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 50000000 --keyboard apples --nor-device sst39vf1601 \
  --gpio-input D:cc7f:0,G:1:0,F:8e:0 --gpio-bias G:f800:f800 \
  --adc-input 7:512,0:1023 --lcd-probe68 idle-zero --frame-view packed-lsb
```

The local probe wrapper now admits 1..100,000,000 ticks, with the same bounded
core slices and native child timeout; it is not an unbounded run. AIN0=1023
and AIN7=512 are ideal test codes, not claimed battery voltages or measurements.
The component selection, strong drives, weak bias, analog inputs, frame view
and hypothesis count are all present in the resulting report.

| Cold-run checkpoint | Instructions | PC | Result |
| --- | ---: | --- | --- |
| Existing D/G pads and AIN7 only, 20M budget | 16,046,345 | `00005070` | GPFDAT: missing external F input |
| Add F `8e:0`, without AIN0, 20M budget | 16,046,416 | `00004f58` | Unresolved AIN0 at actual conversion start |
| Add AIN0=1023, 50M budget | 49,998,631 | `00007fc4` | Original OS memory-recovery prompt; no data fault |

The 50M checkpoint has 132,568 total exceptions; software interrupts and IRQs
also contribute to this counter. It has zero DFSR/FAR. A total exception count alone
cannot classify a fault. Four unverified LCD reads and 225 functional LCD
frames have occurred. The native/production-WASM comparison and both independent cold replays
match at 50M ticks, including 477 nonzero pixels and raw frame SHA-256
`7b22ee2e00fcc43d41d4a36e3ff16f66fed6f067824d4547746dfd9c262faf43`.
The visible text is established by inspecting the actual
packed-LSB framebuffer, not by inserting text in the frontend.

## The next failure is now precisely located

Schedule raw matrix (5,5), the F6/NO soft key, down at tick 50,000,000 and up
at 53,000,000. The original OS reacts, leaves the prompt, and then fails on a
read at the **end of the configured physical SRAM**, not on a NOR write:

```text
First data-abort tick: 61,249,398
Faulting PC:          0x0001ce24
Instruction:          0xe5900008  (LDR r0,[r0,#8])
Base r0:              0x0803fff8
Requested address:    0x08040000
DFSR:                 0x00000008 (external data abort)
Abort vector / LR:    0x00000010 / 0x0001ce2c
```

The exact 61,249,398-tick endpoint also matches across native/production-WASM
and both cold replays: 61,247,918 instructions, vector PC `0x10`, DFSR/FAR
`8`/`08040000`, and five counted LCD hypothesis reads.

The key position is cross-checked against the
[hpclang physical-key map](https://github.com/zyf722/hpclang/blob/d1dd4688cc850bff1bf4c290c0d26a5e0619f55c/runtime/core/keyboard-key-map.c)
(bit 40 = F6). Register tracing shows a multiword/nibble extraction path near
the boundary, but this does not yet establish whether physical address-line
aliasing, the memory controller, or preceding guest state is responsible.
The last eight bytes of the declared 256 KiB SRAM are readable; the next
word is currently unmapped. Do not change the capacity to 512 KiB or install
unproven mirroring just to avoid the abort.

To reproduce immediately before/after the fault, replace the 50M budget above
with `61249397` / `61249398` and add:

```text
--key-at 50000000:5:5:1,53000000:5:5:0
```

Continuing the failing run to 90M reaches a repeating abort path with a blank
frame. That budget completion is **not idle, a working main interface or an
accepted boot**. The fifth unverified LCD read also remains visible. The
separate exact-tick checkpoints are more useful than simply running longer.

## Distance to a usable system

The current evidence establishes reset/bootloader progression, OS ARM
initialization, an OS-drawn prompt and one input-driven transition. It does
not establish the normal calculator interface, sustained key/display/interrupt
behavior, native payload return, or model-correct physical defaults.

The next concrete gate is to resolve the SRAM-boundary read from actual board
and memory-component evidence, then repeat the first normal-screen and key
interaction checks. Separately close the LCD hypothesis/panel and remaining
unmeasured input conditions before calling a run canonical. These are known
gates, **not a complete list of all bugs yet to be discovered**; instruction
counts, assertion totals and an early prompt cannot justify a completion
percentage or a fixed remaining-time estimate. Full six-model support has
additional independent ROM/revision gates.
