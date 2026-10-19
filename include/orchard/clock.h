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
#ifdef __cplusplus
}
#endif
#endif
