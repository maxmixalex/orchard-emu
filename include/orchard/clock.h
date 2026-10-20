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
/* One-slot functional execution with CLKCON.IDLE support. Budget/ticks keep
 * the legacy peripheral quanta and at most one CPU issue slot per quantum,
 * independently of CP15 clock mode or CLKDIVN. An aligned CLKCON word write
 * with bit 2 set sleeps the core until an unmasked interrupt requests wakeup.
 * The bit remains sticky; only another write requests sleep again. Peripheral
 * time continues during sleep. This does not model the CPU/peripheral ratio
 * or the CPU-wrapper ACK delay and is not physical clock calibration.
 * Checkpoints retain their existing format; legacy run/run_divided are unchanged.
 */
orchard_stop orchard_run_idle(orchard_machine *m, uint32_t tick_budget);
/* Opt-in functional CPU/peripheral clock-ratio research policy.
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
