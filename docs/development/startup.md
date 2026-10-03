# Conditional HP48gII HOME startup

## What now runs

The original, unmodified HP48gII USB-revision complete NOR reaches the stock
`Try To Recover Memory?` prompt, accepts physical F6/NO, proceeds through
`Memory Clear`, reaches HOME in ALG mode, evaluates `1+2` as `3`, and then
accepts a second expression `7*8`, returning `56`. This is the stock operating
system and its ARM-hosted Saturn interpreter, not the bootloader recovery menu
or a host-side calculator. No CPU instruction implementation or ROM byte was
changed for this continuation.

This is **conditional functional startup**, not canonical hardware acceptance.
The run declares a flash part, SRAM address-wiring hypothesis, electrical bias,
ideal ADC codes, counted LCD hypothesis and a packed-memory display view.
The profile still contains exactly 256 KiB SRAM. No six-model, real-browser,
retained-state, native-ARM payload/return or long-duration stability gate closes.

## Why the NOR-base store stopped

The earlier physical bus passed a 32-bit ARM word store directly to an x16
flash command decoder, which correctly rejected that *device-level* width.
For the explicitly selected SST39VF1601, the bus now presents an aligned word
as two ordered halfword cycles at address A and A+2. Both go through the
existing software-data-protection (SDP) state machine. A zero-fill is not a
valid flash programming sequence, so it leaves the array unchanged and returns
to read mode; valid but unimplemented program/erase requests still stop.

Sources: Samsung's [S3C2410A manual, chapter 5](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf)
defines bus width and the x16 connection; the manufacturer's
[SST39VF160x data sheet, Software Data Protection](https://ww1.microchip.com/downloads/en/DeviceDoc/S71223_.pdf)
defines command sequencing and invalid-sequence return to read mode.
The reconciled implementation keeps the upstream adapter in `src/nor.c`;
there is no second bus shim. This is functional bus-width adaptation, not pin-timing or
arbitrary BWSCON reconfiguration emulation. No reference emulator code was used.

The split is restricted to the selected x16 component and valid aligned array
spans. An unspecified flash part still stops on the old word-store case;
byte stores and unsupported commands are not broadly ignored. Directed tests
check both halfword addresses/order, array bounds, ID mode, reset and unchanged
flash contents. The ARM core still executes the actual store instruction.

This removes the concrete 48gII NOR-store diagnostic stop. It does not establish
why HP's software issued that clear, or authorize inventing a 1 MiB flash part
for HP39g+. That model's unspecified-component checkpoint remains separate.

## The next obstruction: SRAM capacity versus address decoding

With x16 NOR handling, the stock system draws the memory-recovery prompt.
After NO, the exact-capacity SRAM decoder produces a data abort on a load
from `0x08040000`, immediately beyond 256 KiB. A bounded local instruction
trace identifies the first access in guest interpreter code: PC `0x0001ce24`,
base r0=`0x0803fff8`, a lookahead word at base+8, fault status 8. This is not
evidence that the machine needs 512 KiB or that its declared RAM should grow.

The SoC manual's figure 5-1 gives nGCS1 the physical window
`0x08000000..0x0fffffff`; figure 5-8 shows a finite-address-pin x16 SRAM
connected under a chip select. These are **generic SoC facts**, not a measured
HP48gII schematic. If only the SRAM's low address bits are connected, high
addresses within that select alias the same cells. Additional board decoding
could change this; independent verification of HP's actual wiring is pending.

The explicit `--sram-decode bank1-mirror` option models that hypothesis. It
maps low SRAM address bits *only within nGCS1*, never across unrelated banks.
It allocates no extra bytes, does not patch page tables and does not turn NOR
into RAM. `exact` remains the default. The core API is `orchard_sram_select`;
production WASM exposes `sram_select`. Cold reset retains this component
selection but clears the two diagnostic counters. Reselecting exact mode does
not erase prior alias-use evidence.

`sram_alias_reads` and `sram_alias_writes` count guest physical transactions
that use the mirrored region or cross the physical cell-array boundary.
Pure memory/frame inspection does not alter them. In the complete two-expression
witness there is **one alias read and zero alias writes**. Unsupported-bank
accesses still fail; tests cover all six capacities/configurations, wrap within
the same cells, no wrap across nGCS1, invalid requests and an actual ARM load.
These tests establish implementation behavior, not six verified HP boards.

## Reproduce from cold reset

After building the normal native CLI and production WASM:

```sh
node tools/probe-hp48-startup.mjs /private/48gii.bin /new/path/startup.json
```

The local-only wrapper requires the exact 2 MiB dump with SHA-256
`4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937`.
It neither downloads firmware nor fills in a bootloader. It launches the
shared v7 probe, which uses one immutable input copy and independently starts
the native and WASM machines twice. Each run has a 300-million-quantum budget.
The wrapper verifies all twenty physical switch events, fault state, alias/LCD
counters and the final framebuffer hash in addition to the generic host/replay
comparison. It refuses other inputs and existing output paths.

Declared configuration:

| Component/input | Value |
| --- | --- |
| NOR | Explicit `sst39vf1601`, unmodified original array |
| SRAM decode | `bank1-mirror`, still 256 KiB physical cells |
| Keyboard | Attached passive `apples` circuit |
| Strong GPIO | D `cc7f:0`, F `8e:0`, G `1:0` |
| Weak GPIO | G `f800:f800` |
| Analog input | AIN0=1023, AIN7=512; ideal codes, not battery voltages |
| LCD research | `idle-zero`; all unverified reads counted |
| Display | `packed-lsb`; memory inspection, not verified panel wiring |
| USB | Disconnected, no host packets |

The script schedules F6 at 60M/65M quanta (NO), F6 at 120M/125M (Memory Clear
acknowledgment), then 1, +, 2, ENTER at 180M,190M,200M,210M and 7, *, 8, ENTER
at 240M,250M,260M,270M. Expression keys are released 2M quanta after pressing.
These are deterministic guest scheduling units, **not elapsed seconds**.

The raw switch coordinates follow the independently maintained
[hpclang scan map, d1dd4688](https://github.com/zyf722/hpclang/blob/d1dd4688cc850bff1bf4c290c0d26a5e0619f55c/runtime/core/keyboard-key-map.c).
Only mapping facts are used, not its implementation. The host closes/opens
switches; guest firmware scans them and handles all dialogs and arithmetic.
No memory checkpoint, guest-variable editing, arithmetic interception or
pre-rendered image participates in the final cold witness.

## Observed native checkpoints

| Checkpoint | 240M quanta | 300M quanta |
| --- | ---: | ---: |
| Instructions | 239,992,930 | 299,991,128 |
| Guest exception entries | 600,374 | 751,151 |
| Data fault status/address | 0 / 0 | 0 / 0 |
| Diagnostic stop | None | None |
| Key transitions consumed | 12 | 20 |
| SRAM alias reads/writes | 1 / 0 | 1 / 0 |
| Counted LCD hypothesis reads | 16 | 24 |
| Visible result | HOME, `1+2` and `3` | HOME, both `1+2`/`3` and `7*8`/`56` |

The exception totals are not data-abort counts. This operating system uses
SWIs and IRQs; a sampled PC in the IRQ vector is not itself a crash. The table
reports actual totals without relabeling them as errors or claiming a complete
classification of every entry. The final framebuffer is 131x64 intensity bytes;
its SHA-256 is `53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9`.
The first-expression frame is
`8d3d7f90c1bfcf7df968df301de34a3164fb740e74104b2e5cf1ae34c6d20f54`.
Hashes refer to raw intensity bytes, not PNG metadata or inverted PGM bytes.
Images were visually inspected; no OCR or synthetic screen generation is used.

The fixed 300M witness passed twice on native and twice on production WASM,
with identical exposed architectural/peripheral state, events, UART and pixels.
These are cold replays of the same implementation, not independent silicon
validation. Current publication state belongs in [handoff](handoff.md);
[validation](validation.md) distinguishes this branch from newer remote work. Screenshots, private
instruction traces and firmware-bearing diagnostic checkpoints are not shipped
in source, Pages or production builds.

## Remaining gates

Obtain independent evidence for the actual SRAM high-address wiring and LCD
`+0x68`, then calibrate the controller-to-panel mapping and physical clocks,
pad bias and analog inputs. Expand real-OS operations, warm/cold reset and
long-running interaction; test native ARM payload entry/return and persistence.
The browser still needs explicit setup and printed-key controls: a Node WASM
witness is not a browser UI E2E pass. Other machines keep their own input and
hardware gates; the user's later 39gs/49g+ dumps remain deferred.

## Web continuation

The explicit setup is now exposed in the browser page with a mapped keypad
and counted assumptions; see [web operation](web.md). The production Worker
through Node adapters also reaches the same two-calculation frame with its
own tap-arrival schedule. Real browser-origin E2E remains blocked/unverified.
