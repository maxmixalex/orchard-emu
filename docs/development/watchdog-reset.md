# Watchdog reset and factory-test exit

Original HP39gs, HP48gII and HP49g+ firmware leaves the factory-test version
page by programming WTCON=`0x931`. The old core stopped with status 14 when
that timer expired. The timer now asserts its modeled internal reset, and the
unaltered ROM executes its reset handler. HP39g+ uses a different exit path;
it does not need a watchdog reset in the observed sequence.

## Reset domains

The reset path is separate from the host's destructive Restart and from
Power_OFF wake. Its state changes are explicit:

| State | Watchdog reset behavior |
| --- | --- |
| CPU registers, CP15 and instruction stream | Reset; the next execution begins at address 0 |
| Interrupt/controller, LCD, PWM, ADC, UART, SPI and USB state | Reset to the existing documented defaults |
| GSTATUS2 | Set WDTRST bit 2 while preserving uncleared cause bits; write-one-to-clear remains available |
| GSTATUS3 and GSTATUS4 | Clear; Power_OFF wake instead preserves these registers |
| External SRAM, NOR bytes and selected physical memory devices | Preserve |
| Internal boot SRAM | Preserve, because watchdog reset does not remove its power |
| SD image, insertion, protection and dirty state | Preserve; the functional SD controller/protocol state resets |
| Physical keys, external GPIO/bias and ADC samples | Preserve; controller/mux configuration resets |
| USB cable presence | Preserve; address, endpoints, FIFOs and packet state reset |
| RTC BCD calendar and independent oscillator phase/divider | Preserve and continue |
| RTC interface, alarm and tick configuration | Reset; software re-enables the interface |
| Host ticks, instruction/exception counters and memory-access evidence | Preserve as monotonic observation counters |
| Translation/input caches and pending host audio | Invalidate; audio starts a new epoch |

The supported NOR command/ID state is external to the SoC and stays intact.
No firmware memory, reset vector or calculator HOME address is patched.
CPU reset clears its old high-vector/MMU configuration, so the interpreter
fetches the real low reset vector. Reset takes precedence over the simultaneous
watchdog interrupt when both WTCON outputs are enabled.

The manual specifies a 128-PCLK reset assertion. The model holds CPU execution
and non-retained peripheral logic for 128 reset-domain edges, while the RTC
continues. Clock registers are at reset during this pulse, so the existing
functional Fin/PCLK model supplies one edge per reference quantum. Old
pre-reset fractional PCLK edges are not carried into a reset clock tree.
This does not model physical reset-pin propagation, analog rails, PLL lock
time or sub-quantum clock switching.

The hardware references are the
[Samsung S3C2410A manual, revision 1.0](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
sections 18-1/3 for the reset output and duration, 9-28 for reset causes and
INFORM retention, 17-1/5 for the independent RTC and reset interface, and
7-14/15 for the distinct Power_OFF domain. RTC control reset and retained
calendar/oscillator are the stated functional domain model; they are not a
measurement of the physical board's reset transient.

## Saved state and tests

Checkpoint v5 stores the remaining reset pulse as a uint32 at byte 4967,
after the 72 SPI bytes. Values above 128 are rejected. A session saved during
the pulse resumes the remaining hold and then runs the reset vector.
All earlier layouts remain supported. Their existing WDT counter and phase
continue into the new behavior, but an already stopped legacy status-14
checkpoint remains stopped. Its diagnostic cause is not silently removed.

`tests/watchdog-reset.c` supplies **640 assertions** on native and WASM:
all six profile reset vectors, exact assertion/release edges, IRQ-only and
IRQ+RESET, W1C causes, retained and reset domains, PCLK ratios, absence of a
separate CLKCON watchdog gate, Power_OFF freezing, cold-reset cancellation,
partial-pulse checkpoint/reference-runner equality, and v1–v4 live/stopped
imports. Existing watchdog countdown, Power_OFF, scheduler, clock and
checkpoint suites remain part of the regression gate.

## Original-ROM witness

The private witness cold-boots each unchanged admitted NOR, physically presses
ON then F4, releases both keys, observes the firmware version page, presses
ON then F3 to exit, and enters `1+1`. It uses normal matrix/dedicated key
inputs and bounded core runs. The version page is the factory-test entry
boundary; this witness does not claim every factory test has run or passed.
The entered versions, final arithmetic and WDTRST cause are listed in the
metadata-only [r22 evidence](evidence/spi-watchdog-r22.json). ROMs, framebuffer
pixels and checkpoints remain private.
