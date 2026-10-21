# Conditional clock-register ratios

`tools/clock-ratios.mjs` decodes `MPLLCON`, `CLKSLOW` and `CLKDIVN` into
reduced rational FCLK/HCLK/PCLK multiples of the main input frequency `Fin`.
It is used by the existing input-boundary profiler and clock-policy probe.
This improves research reports; it does not change execution or demonstrate a
response-time improvement.

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
There is no new core or WASM API and no change to the production runner,
functional 12M timebase, input scheduling, or checkpoint format.

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
none of those states and must not be used as justification for enabling an
experimental runner or scaling the default clock.
