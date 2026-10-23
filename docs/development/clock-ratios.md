# Conditional clock-register ratios

`tools/clock-ratios.mjs` decodes `MPLLCON`, `CLKSLOW` and `CLKDIVN` into
reduced rational FCLK/HCLK/PCLK multiples of the main input frequency `Fin`.
It is used by the existing input-boundary profiler and clock-policy probe.
The decoder improves research reports; calling it does not change execution.
The r21 runtime model described below separately tracks clock-write history
and fractional phase and supplies actual guest peripheral edges.

## What the result means

The API is `decodeClockRatiosIfSettled({ mpllcon, clkslow, clkdivn })`.
Successful results have `status: "conditional"`, a selected source, a
`conditional_on` list, and `ratios_to_fin` with integer numerator/denominator
pairs. Reports store the result as `clock_ratios_if_settled` and record the
decoder's SHA-256 as well as their own source identity.

All ratios require settled source and divider selections. MPLL results also
require that software has configured MPLL and that PLL lock has completed.
These are caller prerequisites, not states discovered from the registers.
In particular, a reset snapshot or a sample taken during a lock interval does
not establish the active clock. Neither tool acquires lock-history evidence.
Invalid divider encodings or MPLL-off outside slow mode produce `unavailable`
with a reason and null ratios; malformed non-uint32 inputs are rejected.

The decoder does not infer MHz, a board crystal/strap, clock gating, IDLE,
CP15's effective CPU clock selection, instruction cycles or elapsed time.
The diagnostic API does not change the runner or its input scheduling. Its
conditional output should not be confused with the runtime PCLK state.

## Independent examples

For the saved HP39 register values `MPLLCON=0x43012` and `CLKDIVN=3`:

| CLKSLOW | Conditional source | FCLK/Fin | HCLK/Fin | PCLK/Fin |
| --- | --- | ---: | ---: | ---: |
| `0x30` | Slow input | 1 | 1/2 | 1/4 |
| `0` | Configured, locked MPLL | 25/4 | 25/8 | 25/16 |

Sixteen input-clock periods therefore correspond to 16/8/4 or 100/50/25
F/H/P edges respectively, under the stated prerequisites. These are explicit
test constants, independent of the implementation's arithmetic. Further tests
cover the special `CLKDIVN=4` encoding, the zero and nonzero slow dividers,
PLL field extraction, reserved settings and non-mutating diagnostic sampling.

The reports retain the original raw words and read boundaries. The additional
fields do not turn boundary sampling into a complete clock-register write
trace, and a changed/restored value inside one core call can still be missed.
Both existing tools retain their historical contact schedules, including the
HP39 hold/gap of 1,500,000/900,000 quanta. That is not the current production
125/50ms contact schedule. Adding derived ratios does not produce a new
measurement of production response time or reinterpret an old latency sample.

## Sources and unresolved hardware evidence

The [Samsung S3C2410A User Manual, revision 1.0](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf)
defines the PLL formula in section 7-4, domain division in 7-8, slow mode in
7-11, and register fields in 7-19 through 7-22. Sections 7-2 and 7-6 explain
why reset values do not establish a configured PLL. Sections 7-12 and 7-13
distinguish leaving slow mode with an already locked PLL from simultaneously
enabling PLL and leaving slow mode.

The board-specific `Fin` and input-source straps remain unconfirmed in
[model evidence](models.md). The functional 12M timebase is not proof of a
12MHz crystal. The manual's `LOCKTIME` description identifies count fields
and a stabilization requirement, but this decoder does not assume a conversion
from the saved count to seconds. Establishing that conversion and the relevant
board input source remains a separate hardware-evidence task.

Runtime clock-domain modeling additionally needs transition history, phase
preservation and an independent RTC timebase. This diagnostic decoder supplies
none of those states; the following runtime implementation maintains them
separately rather than treating a register sample as proof of an active PLL.

## r21 functional shared PCLK

The runtime uses the existing 12,000,000 reference ticks/second as a **fixed
functional input Fin**. It is not a measured crystal frequency for all models.
The pinned [hpclang time implementation](https://github.com/maxmixalex/hpclang/blob/261dba7cc5b208828f7a907c2071d24c3b0d94ea/runtime/core/time.c)
uses a 12 MHz input convention and independently decodes the PLL and bus
dividers. Its file SHA-256 is
`90868908cdf7cc3f838994dd6bb03dde23954a967b090d87a12f714283673651`.
This supports the stated software convention, while board crystal/strap
measurement and LOCKTIME-to-duration evidence remain separate work.

The runtime corrects the reset CLKSLOW/CLKDIVN words to the manual's `4` and
`0`. Before the first MPLLCON write, the source is Fin regardless of the reset
MPLL register word. Every software write to MPLLCON, including a write of its
unchanged reset value, records that MPLL is configured. Subsequent slow-mode
and divider changes derive a reduced rational PCLK/Fin. Reserved CLKDIVN
encodings and selecting a disabled MPLL outside slow mode stop explicitly;
they do not silently choose a convenient ratio.

For example, the configured `0x43012 / 0 / 3` register combination produces
25 PCLK edges per 16 reference ticks. Its first six reference quanta supply
`1, 2, 1, 2, 1, 2` peripheral edges and retain fractional phases
`9, 2, 11, 4, 13, 6` over denominator 16. A faster legal register combination
can supply up to 132 PCLK edges in one quantum; the core processes every edge.
This does not increase the CPU's instruction-issue slots or multiply RTC time.

The shared edge stream advances all five PWM timers, the watchdog, ADC and SDI.
CLKCON bits 8, 15 and 9 respectively gate PWM, ADC and SDI; the watchdog has
no separate CLKCON gate. Closing a peripheral gate freezes that peripheral's
phase/counters but leaves the global PCLK fraction advancing. CPU/CP15 issue
policies, LCD line timing, UART byte streams and the USB packet interface retain
their earlier functional scope. This is a bounded shared-peripheral model,
not a complete calibrated FCLK/HCLK/PCLK SoC simulation.

PLL settling is **immediate at the register-write boundary** in this model.
The implementation does not invent a duration from LOCKTIME fields. Frequency
or source changes preserve fractional edge progress with
`floor(old_phase × new_denominator / old_denominator)`. This is quantized phase
preservation: it can lose less than one unit of the new denominator's phase
resolution per change. Gate toggles and run-call boundaries do not rescale or
reset the fraction. The PWM prescaler/count state remains unchanged through a
clock-source change. PWM still tracks per-channel prescaler phase; modeling
the two physical shared prescalers' relative channel-start phase remains open.

## Scheduler and zero/reload boundaries

If an enabled peripheral is `D` PCLK edges away from an event, with reduced
ratio `num/den` and phase `p`, its next reference deadline is
`ceil((D × den − p) / num)`. The scheduler takes the minimum of these deadlines
and the independent RTC/LCD deadlines, and skips only strictly earlier ticks.
It uses 64-bit intermediate arithmetic. Deferred synchronization computes
`E=floor((p+n×num)/den)` shared PCLK edges and the corresponding remainder;
only enabled peripheral phases/deadlines receive `E`.

PWM manual update loads the active count and compare. Terminal count raises
an interrupt and captures pending buffer values; the following timer edge
loads the captured values without decrementing again. A steady positive-count
period is therefore `(TCNTBn+1)` timer edges. Buffer writes from the terminal
ISR cannot retroactively change the captured cycle. Clearing auto-reload from
that ISR still permits the captured cycle to run to its terminal count. These
rules follow the manual's worked sequence on page 10-6.

A TCFG change does not reinterpret an existing phase as many missed timer
events. If the old phase exceeds the new divider, the next PCLK edge produces
one timer transition and resets the phase. The physical subcycle behavior of
changing a prescaler while running remains a separate calibration boundary.

## Checkpoint v4 and historical migration

Version 4 appends exactly **64 bytes** after the complete v3 scalar section.
All older offsets and the v1/v2/v3 import paths remain intact. The table uses
absolute byte offsets from the beginning of the checkpoint; all values are
little-endian uint32, including the configured flag:

| Byte offset | Field | Bytes |
| ---: | --- | ---: |
| 4831 | PCLK fractional phase | 4 |
| 4835 | MPLL configured, 0 or 1 | 4 |
| 4839 | Four active PWM compares | 16 |
| 4855 | Five pending reload counts | 20 |
| 4875 | Four pending reload compares | 16 |
| 4891 | Pending reload bit mask, low five bits | 4 |
| 4895 | Start of RAM payload | Model dependent |

The RAM payload started at 4070 in v1, 4122 in v2, and 4831 in v3. CRC checks,
ROM/model identity checks, memory bounds and two-phase atomic import remain in
force. New fields reject an invalid phase, configured flag, over-wide count or
compare, unknown pending bits, or a pending reload whose current count is not
zero. Host audio queues and optimization caches remain outside the format.

Historical formats did not save the first MPLL-write history, fractional PCLK
phase, active compare or pending reload. Import preserves their old registers,
counters and RAM, initializes fractional phase and pending state to zero,
copies the old TCMPB buffers into active compares, and infers configured MPLL
only when its saved word differs from `0x5c080`. A write of the unchanged reset
MPLL value is irrecoverably ambiguous in these formats. Similarly, a staged
next compare cannot reveal the old active compare. The first partial cycle
after an old import is consequently a documented migration approximation;
new v4 sessions preserve these states exactly. This is not a claim that old
session execution continues cycle-for-cycle identically to the old timer model.

Generated tests cover all three migrations, including a nonzero staged PWM
case and the ambiguous same-reset-value PLL case. A genuine r20 HP39gs session
also imports into v4, completes physical SHIFT/ON and ON resume with its prior
arithmetic screen, and accepts new arithmetic. Original-ROM sound and power
witnesses are described in [buzzer](buzzer.md) and
[power management](power-management.md).
