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

The last line is a target interface: only raw LCD preview and a functional
UART0 byte queue exist in this baseline. Physical keys and USB do not.

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
| Physical bus | `src/bus.c` | NOR/SRAM bounds, MMIO routing, candidate STN framebuffer decode |
| SoC | `src/soc.c`, `src/watchdog.c` | Functional INTC/timers/UART/watchdog; selected register storage |
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

NOR is at `0x00000000`; SRAM is at `0x08000000`, with exact per-profile bounds.
Flash does not silently mirror or pad. NOR command state machines are not yet
implemented: a 16-bit read-array reset is accepted, while other writes stop.
This alone prevents claiming ordinary stock firmware boot compatibility.

One virtual tick is counted before advancing the current functional peripherals;
a peripheral diagnostic stop therefore includes its triggering tick. A tick advances the peripherals and either takes
an interrupt, dispatches an instruction, or stays in WFI. It is **not** a CPU
clock cycle, oscillator tick or real millisecond. Guest time does not depend
on browser animation timestamps. The native host and browser may run different
batch sizes but must preserve the same virtual ordering.

INTC currently uses a fixed priority selection, not the full priority arbiter.
Timers implement a bounded functional countdown, not real PLL/PCLK timing.
Clock and memory-controller registers mostly retain values rather than
reconfigure bus timing. GPIO configuration/pull-up storage exists, but DAT
reads stop because board input wiring has not been established. UART is a
functional error-free host stream, not cycle-accurate FIFO/baud simulation.

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
layout. It is not a synthetic screenshot renderer. Bit order, panel mapping,
annunciators and per-model electrical details need independent ROM/hardware
witnesses. The UI reserves a separate annunciator region; no icons are faked.

A later keyboard implementation will inject **physical switch transitions**
into the board GPIO matrix with deterministic press/release timestamps. It
must not bypass firmware by editing Saturn keyboard variables. Model skins
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
