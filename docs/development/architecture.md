# Architecture

## Execution contract

```text
Native CLI / browser Worker
        |
        v
Original C17 machine API
        |
ARMv4T instruction interpreter + privileged ARM920T state
        |
CP15 translation -> physical bus
        |
NOR / SRAM / S3C2410 peripheral state / model wiring
        |
raw LCD output, physical key inputs, UART/USB host transport
```

Raw LCD preview, a functional UART0 queue, and an opt-in electrical keyboard
with unfiltered EINT sampling exist. The browser supplies physical key controls
and printed legends; complete board wiring and all-model acceptance remain open. A functional USB PIO
controller and explicit packet host now exchange real HP50g bootloader
control responses and bounded HP48gII object transfers; see [USB evidence](usb.md),
[file transfer](file-transfer.md) and [electrical input](input.md).

A stock image begins at physical address zero with MMU/caches off and the CPU
in supervisor mode with IRQ/FIQ masked. The guest supplies its own reset code,
exception vectors, MMU tables, ARM Saturn interpreter and calculator OS. No
host-side Saturn shortcut is planned. See the ARM/Samsung manuals in
[references](references.md).

## Source ownership

| Area | Files | Current responsibility |
| --- | --- | --- |
| Public API | `include/orchard/orchard.h` | Opaque caller-owned machine, profiles, bounded execution, diagnostics and I/O |
| CPU | `src/cpu.c`, `src/thumb.c` | Original ARM/Thumb dispatch, flags, register banks and exception entry/return |
| MMU | `src/mmu.c` | CP15 subset, guest table walks, access permission and alignment checks |
| Physical bus | `src/bus.c`, `src/sram.c` | NOR, external SRAM and 4 KiB internal SRAM bounds, MMIO routing; inspection in `src/lcd.c` |
| SoC | `src/soc.c`, `src/watchdog.c`, `src/gpio.c`, `src/interrupt.c`, `src/rtc.c` | Functional timers/UART/watchdog, two-level IRQ arbitration, GPIO latches and RTC subset |
| Input / NOR | `src/keyboard.c`, `src/nor.c` | Opt-in switch network, unfiltered EINT and explicit read/software-ID NOR subset |
| USB | `src/usb.c` | Functional EP0 / 64-byte bulk PIO, explicit packet host API, USB reset and IRQ25; no descriptor shortcuts |
| Machine | `src/machine.c` | Reset, loader, profiles and deterministic scheduler |
| Native host | `app/main.c` | Full-NOR loading, bounded CLI run, JSON/PGM/UART files |
| Web host | `app/wasm.c`, `web/` | Freestanding WASM adapter, Worker and diagnostic workbench |

C17 was chosen for a small, auditable, platform-neutral core with no runtime
package dependencies. The browser initially needs neither pthreads nor
SharedArrayBuffer. Native and WASM builds must not grow separate CPU logic.

## Implemented CPU surface, not a conformance certificate

The baseline handles ARM condition codes, barrel shifting, data processing,
PSR transfers, branches/BX, multiplication, byte/word/halfword and signed loads,
block transfers, SWP and SWI. Thumb-1 dispatch covers arithmetic, high registers,
branches/BL/BX, loads/stores, stack operations and SWI. Banked registers cover
user/system, FIQ, IRQ, SVC, abort and undefined modes.

CP15 covers identification, control, translation-table base, domain access,
fault registers, FCSE PID, a whitelist of maintenance operations and WFI.
Translation supports sections plus coarse/fine tables and large/small/tiny
pages. There is no ARMv5/Thumb-2/VFP extension layer. CP15 identification is currently
a fixed ARM920T reference identity, not a verified per-board silicon revision.

Known gaps are substantive: exhaustive decode validation, undefined-instruction
exception policy, ARM920T implementation-defined cases, precise multiple-access
abort behavior, cache/TLB/lockdown behavior and independent differential
conformance remain open. Some currently unsupported or unpredictable cases
halt the emulator rather than delivering a guest undefined-instruction trap.

## Bus and timing model

NOR is at `0x00000000`; external SRAM is at `0x08000000`, with exact per-profile
capacity. Exact-range decoding is the default; explicit `bank1-mirror` maps
high addresses within nGCS1 to the same cells, without increasing RAM. Guest
alias transactions are counted; debug reads are pure. See [startup](startup.md). Internal boot SRAM occupies exactly `0x40000000..0x40000fff`; there is
no NAND controller or NAND image behind it. HP40gs uses 2 MiB NOR.
Flash does not silently mirror or pad. An explicitly selected SST39VF1601 (2 MiB) or SST39VF800A (1 MiB)
implements array read and software identification; program/erase/CFI/security
remain diagnostic stops. The default unspecified part only accepts read-array
reset. Selected x16 NOR receives aligned ARM word stores as two ordered
halfword device cycles; each uses the actual command decoder. Invalid SDP
sequences leave the array unchanged, while unsupported program/erase still
stops. Part identity is not inferred from a ROM hash or profile size.

One virtual tick is counted before advancing the current functional peripherals;
a peripheral diagnostic stop therefore includes its triggering tick. A tick advances the peripherals and either takes
an interrupt, dispatches an instruction, or stays in WFI. It is **not** a CPU
clock cycle, oscillator tick or real millisecond. Guest time does not depend
on browser animation timestamps. The native host and browser may run different
batch sizes but must preserve the same virtual ordering.

INTC implements two-level selection/rotation and a latched awarded IRQ.
Timers implement functional countdown, not real PLL/PCLK timing. Clock and
memory-controller registers largely retain values rather than change timing.
GPIO configuration, pull-up and output-latch state exists; DAT reads with
unresolved input pins stop. With the keyboard attached, its switch network
supplies pad levels and unfiltered EINT detection. Other alternate-function
producers and digital filters are not silently treated as implemented. UART is an error-free byte stream, not full FIFO/baud timing.

RTC uses a deterministic cold-fixture epoch and a provisional 12-million-quanta
timebase, not the host clock. Normal calendar carry and tick/alarm interrupts
are implemented; test modes, round reset, retained battery state and power-off
wakeup are not. See [boot research](boot-research.md) for the RTC word-access
compatibility observation and the exact remaining hardware stops.

## Stop and mutation rules

An unimplemented MMIO access reports PC, instruction, address and operation
value/width. It does not return arbitrary zero and pretend that a real device
answered. CPU registers are restored on a diagnostic stop. Earlier memory or
peripheral effects in a multiple-transfer instruction are not transactionally
rolled back: exact abort/partial-completion semantics require further work.
Reset clears CPU, SRAM and peripheral state, keeps loaded NOR and starts again
at the reset vector. This is a cold-machine reset, not a modeled calculator
warmstart or power-key event. No battery-backed state is persisted yet.

## Display and input

The LCD decoder reads guest-programmed addresses and candidate 1/2/4-bpp STN
layout. It is not a synthetic screenshot renderer. Word-MSB-first ordering and BSWP/HWSWP have directed lane tests. Panel mapping,
annunciators and per-model electrical details still need independent witnesses.
The decoder rejects dual scan/TFT and nonzero dithering rather than displaying
them as single-scan monochrome. The UI now has a separate annunciator strip. A pure accessor reads packed
column 131, rows 0–5; original HP39g+/48gII modifier transitions supply limited
behavioral evidence. Other segment naming and physical panel routing remain
provisional. Host keypresses never directly set annunciator values.

The optional keyboard API changes **physical switch connections** between
bounded run calls. EINT sampling and guest IRQ handlers consume those levels;
no Saturn keyboard variables are edited. Cold reset releases and detaches the
circuit. Raw switch positions are not a complete printed-key map. Model skins
are a separate presentation concern and may only use independently licensed
artwork.

## Watchdog continuation

`src/watchdog.c` models WTCON/WTDAT/WTCNT, their reset values, the prescaler
and four divider settings, countdown/reload and interrupt 9. WTDAT writes do
not silently initialize WTCNT. Illegal register widths/offsets remain visible.
Clock input is a provisional functional quantum; full PLL/PCLK timing remains
open. A watchdog reset request produces `ORCHARD_UNIMPLEMENTED_RESET`, not a
fake cold reset that erases external SRAM. Directed tests cover the supported
register/countdown behavior. See [validation](validation.md).

## Explicit external GPIO inputs

`orchard_gpio_inputs(machine, port, known_mask, levels)` replaces one port's
external input stimulus. It is serialized by the same machine owner as CPU
execution. Only input-configured pins use these levels; output pins retain
latch readback. Undefined input bits remain diagnostic stops. Cold reset clears
stimuli; probes reapply them for identical replay. The static API alone implies no EINT or board wiring. Explicit keyboard
attachment adds switch/pull-up resolution and unfiltered EINT sampling. Static
known levels are strong drives, not weak bias resistors.

The native CLI accepts repeated `--gpio-input D:cc7f:0` options, once per port.
The WASM export is `gpio_inputs(port, known, levels)`. `probe-rom.mjs` accepts a
comma-separated list and records it in its report. This API is a foundation
for board wiring and bounded sensitivity experiments, not a firmware shortcut.

## Counted hypotheses and observation layers

`src/lcd.c` separates the default controller stream from a packed-memory
inspection view. The latter is never automatically treated as panel wiring.
Its guarded `+0x68` policy is an explicitly enabled research assumption, with
an exposed read counter and reset behavior, not a resolved register definition.
See [LCD evidence](lcd.md). Weak pad bias and chronological native-host events
extend the external circuit/host interfaces without editing guest variables;
[probe v4](boot-research.md) records every supplied condition.

## LCD / normal ADC scheduling

`src/lcd.c` now owns the documented LCD registers, W1C frame/source latches
and functional single-scan timing. Reading LINECNT is observational. Frame
requests feed interrupt 16; unsupported FIFO interrupts cannot be unmasked.
`src/adc.c` owns normal conversion, holding an explicitly supplied sample for
five divided ADC clocks and raising subsource 10 on completion. No AIN has an
implicit board/battery value. See [LCD](lcd.md) and [ADC](adc.md) for exact
clock, startup, unsupported-mode and analog/panel limitations.

The scheduler supplies one provisional HCLK/PCLK quantum to these devices
before guest execution. This does not implement the real clock tree. The pure
`orchard_get_peripheral_state`/`peripheral_snapshot` interface separates
observation from MMIO reads that can start ADC conversion. The latter exports
ten 32-bit words: LCD control/source/pending/mask, frame count low/high, ADC
control/data/remaining/valid. Existing 33-word CPU snapshots are unchanged.


## USB packet boundary and diagnostics

The CPU accesses the USB controller through the same physical bus as every
other device. Host transactions change only USB device state; guest IRQ
handlers must program CSRs and move FIFO bytes themselves. The host never
installs descriptors or calls guest functions directly. USB is disconnected
by default and cold reset releases it. Bus reset does not cold-reset the CPU.

The optional native `orchard-usb-session` and JS host use public APIs only;
no debug memory-write interface is exposed. Pure USB snapshots contain the
exposed endpoint CSRs, packet byte counts, bus/address state and transaction
counters, not an exhaustive dump of all internal state. Returned packet bytes
are compared separately. Main CLI JSON and probe v6 compare this state, while
the older CPU and LCD/ADC layouts remain ABI-compatible. Read-only diagnostics
must not consume FIFO bytes or acknowledge interrupts. Exact supported scope
and known control-transfer limits are in [USB evidence](usb.md).
