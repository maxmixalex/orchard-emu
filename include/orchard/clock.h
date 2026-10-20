/* SPDX-License-Identifier: MIT */
#ifndef ORCHARD_CLOCK_H
#define ORCHARD_CLOCK_H
#include "orchard.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Opt-in divided functional execution. Budget/ticks remain the existing
 * peripheral quanta; CPU issue slots follow CLKDIVN HDIVN/PDIVN (1,2,2,4).
 * Dividers are latched at a quantum boundary. Each issued instruction still
 * uses the interpreter, exceptions and live memory. WFI issues no instruction.
 * This is NOT cycle-accurate ARM execution: CPI, PLL/slow-mode transitions,
 * cache wait states and absolute peripheral clocks remain uncalibrated.
 * orchard_run() retains its original one-slot semantics for reproducibility.
 * Callers must select one run policy for a session and drain I/O in slices
 * small enough for four instruction slots per quantum (e.g. <=256 quanta).
 */
orchard_stop orchard_run_divided(orchard_machine *m, uint32_t tick_budget);
/* Returns 0 for an invalid machine, otherwise the current 1/2/4 slot ratio. */
unsigned orchard_clock_divisor(const orchard_machine *m);
/* Functional CPU/peripheral clock policy used by the calculator frontend.
 * CLKDIVN selects the FCLK:HCLK:PCLK ratios, including its 1:4:4 encoding.
 * CP15 c1[31:30] selects HCLK for FastBus and FCLK for synchronous/asynchronous
 * CPU issue. Settings are latched at the next peripheral quantum; interrupts
 * are checked before each issue slot. Reserved clock encodings stop explicitly.
 * An aligned word write with CLKCON.IDLE set sleeps the core until an unmasked
 * interrupt source requests wakeup. The register bit stays set; it does not
 * repeatedly request sleep without another write. CPU-wrapper ACK delay is
 * not calibrated. WFI and IDLE share the checkpoint's existing sleeping state.
 * Peripheral/RTC quanta remain the existing 12 MHz functional reference.
 * This does not model PLL/slow-mode absolute frequencies, CPI, bus/cache wait
 * states or a separate HCLK-driven LCD timebase. It is not hardware calibration.
 * Select one runner per session and drain I/O at least every 256 quanta.
 * The legacy run and experimental run_divided APIs retain their old semantics.
 */
orchard_stop orchard_run_clocked(orchard_machine *m, uint32_t tick_budget);
/* Current CPU issue slots per peripheral quantum; zero means invalid machine
 * or reserved CP15 clock mode / CLKDIVN encoding. */
unsigned orchard_clock_slots(const orchard_machine *m);
#ifdef __cplusplus
}
#endif
#endif
