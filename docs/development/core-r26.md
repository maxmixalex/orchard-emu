# ARM exceptions and UART timeout in r26

This revision implements two defined missing core behaviors: guest delivery of
ARMv4T undefined-instruction exceptions, and PCLK-derived UART FIFO receive idle
timeout. The timeout state is portable in checkpoint v8. These close the bounded
M1 and M2 tasks from [the r25 follow-up](core-next-r25.md), while leaving the
separate hardware and original-ROM prerequisites explicit.

The combined production WASM has SHA-256
`bb53704a128319df23a0340da4bf7e8767d1a98ae8337a3b4d8572750d4ec7a3`.
Original-program, browser, model and peripheral acceptance for this exact build
belongs to the [combined r26 record](compatibility-r26.md). The [sanitized core evidence](evidence/core-r26.json) records counts, hashes
and retained timeout outcomes. The core checks below use generated instructions and fixed expectations; a stock diagnostic is not
an instruction-semantics oracle.

## Guest undefined-instruction handlers

Previously, fixed ARM `0xe6000010` and Thumb `0xde00` stopped the emulator.
They now enter UND mode at the selected low or high vector, save CPSR in
SPSR_und, set LR_und to the next instruction, switch to ARM state and mask IRQ
while preserving the FIQ mask. A guest handler executes normally and can return
with `MOVS pc,lr`, including a return to Thumb.

The decode classification follows [ARM920T DDI 0151C](https://documentation-service.arm.com/static/5e8e2a5b88295d1e18d381bb),
sections 2.2.2 and 2.3.2, and [ARM DDI 0100I](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/1023/ARM-Architecture.pdf),
sections A2.6.3 and A3.16. It covers ARMv4T extension spaces, unallocated Thumb
words, ARMv5-only BLX/extension words, absent external coprocessors, user-mode
CP15 MRC/MCR, and CP15 CDP/LDC/STC. Condition-failed ARM instructions retain
their existing no-op behavior. Both dispatchers use the same classification;
the fast load/store path cannot consume the permanent-undefined transfer space.

Malformed operands of allocated instructions remain unpredictable diagnostics.
Unsupported privileged CP15 operations and the on-chip CP14 debug interface
remain explicit compatibility stops. Unknown peripheral registers are not
turned into CPU exceptions. This prevents an arbitrary unsupported operation
from looking like an architecturally specified UND instruction.

`tests/undefined.c` executes fixed words and a seven-instruction handler which
stores its LR, SPSR and CPSR, produces a result, returns, and executes the next
ARM/Thumb instruction. Cases cover both vectors, USR/SYS/SVC/FIQ register banks,
FIQ-mask variants, both dispatchers, preserved fault state, condition controls
and diagnostic boundaries. It reports **17,504 assertions**. Against the old
core, the same reproduction reported 4,182 failures before early returns;
those returns make the old run's total assertion count lower. The generated
WASM guest also executes Thumb UND, ARM UND and SWI handlers before WFI on all
seven declared synthetic profiles.

The generic stop/trace fixtures now use malformed MRS `0xe10f0100`, which
retains the explicit UNPREDICTABLE diagnostic, instead of a defined UND word.
They still require stop code 9 at PC `0x10` and tick 2, exact instruction/detail,
immutable stopped capture, held-key preservation, full checkpoint replay and
all 23 negative trace controls. Both production-Worker browser Save/recovery
and opt-in diagnostic-trace recovery pass with the final build. The latter also
replays an active-timeout observation and rejects missing Pause acknowledgment
or a changed generation. The ordinary browser Worker loop fixture needed no
change. These are generated-guest checks, not original-ROM application results.

## PCLK receive timeout and saved state

The [UART contract](uart-irda.md#pclk-fifo-receive-idle-timeout) defines three
complete functional frame times from ULCON and `16 × (UBRDIV + 1)` PCLK edges.
The timer starts when a decoded byte enters a hardware FIFO. Its deadline is
part of scheduler event selection, including fractional PCLK ratios. New data
restarts it; partial reads preserve the old idle age; drain/reset/disable
cancel it; clock gating pauses it. Pulse and level receive interrupts retain
separate behavior after expiry and interrupt-controller acknowledgment. A read
which first lowers an already idle FIFO below its trigger also emits the
timeout pulse; later below-trigger reads do not repeatedly emit it. A fixed
three-channel reproduction caught the previously missing pulse, and the final
regression checks this transition at all four trigger levels.

`tests/uart-timeout.c` reports **7,431 assertions** across three channels,
four trigger levels, eight formats, exact deadlines, restart/cancellation,
independent channels, clock gating, 1/2 and 9/2 PCLK ratios, maximum divisor,
invalid state rejection, and complete optimized/reference continuation after
save/restore. This is a functional timing contract. It does not claim physical
bit/optical timing, read-triggered silicon behavior absent from the manual, or
an observed UEXTCLK frequency. UEXTCLK FIFO timeout, DMA and send-break remain
explicitly unsupported.

Checkpoint v8 adds only **24 bytes**, two uint32 values per UART, after the v7
TLB fields. RAM moves from byte 11404 to 11428. A no-card, unmodified-flash
checkpoint is 277,668 bytes with 256 KiB RAM or 539,812 bytes with 512 KiB RAM.
Versions 1–7 remain readable under their existing validation and migration
rules. New timeout words default to zero; v7 TLB and all previously represented
state remain intact. The comparator preserves timing/TLB state rather than
normalizing it away. [Saved sessions](sessions.md) specifies the full format.

All seven declared profiles exercise synthetic legacy migration. Separately,
six private v7 saves made by original HP48gII/HP49g+ ARMToolbox workflows were
loaded by the final production build: native-running, returned-HOME and final
HOME for each model. Each v8 result preserved all previously represented bytes,
with only the 24-byte extension and required header/checksum changes. A fresh
restore of each result followed by 10,000 ticks matched complete continuation.
Original ROMs, sessions, changed flash sectors and application files are not
published with this evidence.

The final build also passes a cold original-HP39gs serial Wire workflow: two
self-authored Notes are received exactly through one listener, and the original
Arkalite aplet plus its 37-byte LIB1537 library complete two multipart SENDs
through another listener. All six returned objects satisfy the required exact
Note/aplet or library-body comparison. The calculator returns to HOME and the
known `1+1=2` work area. The earlier retained run exposed a separate host parser
error for a zero-length internal library title; the corrected receiver preserves
strict nonempty-name validation. This protocol regression does not turn an
observed serial stream into a physical baud calibration.

## Validation and limits

Native Release and reference builds each pass **26 CTest cases**, including
**1,289,801 counted assertions** and the separate ARM block collector test.
The final complete `npm run test:wasm` also passes: 1,250,312 default assertions
on each host plus 39,489 functional-clock assertions on each host, all seven
generated profile guests, and 25 instruction-driven TLB cases. The additional
254,128 experimental physical-read assertions are WASM-only and excluded from
the default per-host total. The independent Unicorn 2.1.4 comparison uses its
explicitly selected TI925T
model and covers **17,075 defined shared ARMv4T cases**, with zero mismatches
and zero skipped cases; native and isolated test-WASM records agree exactly.
Twelve malformed test-transport inputs are rejected. This comparison does not
cover ARM920T system coprocessors, exceptions, MMIO or physical board behavior;
the new UND handler checks use the ARM manuals as their separate oracle.

The first sanitizer run passed 22/26 cases; checkpoint, scheduler, execution
and clock-domain cases hit their 30-second wall-clock limits under concurrent
work, without a sanitizer diagnostic. In a reduced-load rerun the first three
passed in 22.66, 27.37 and 17.40 seconds with the original limits. Clock-domain
still hit 30 seconds; a separate instrumented completion passed all 39,489
assertions in 38.996 seconds. Its CTest limit is now 60 seconds only when
`ORCHARD_SANITIZE` is enabled, while its ordinary limit and every other test's
limit remain unchanged. This measured adjustment does not relabel the retained
30-second timeout reports as passes. A subsequent attempt overlapping builds
also hit 60 seconds; the retained follow-ups passed in 46.75 seconds with some
overlap and 47.13 seconds with the other agents idle. The updated 7,431-assertion
UART sanitizer test also passes. These are the full-run and targeted-rerun
results, not a claim of one clean 26/26 sanitizer invocation.

Reproduction commands for the core gates are:

```sh
cmake -S . -B build-core -DCMAKE_BUILD_TYPE=Release
cmake --build build-core -j2
ctest --test-dir build-core --output-on-failure -j2
cmake -S . -B build-core-reference -DCMAKE_BUILD_TYPE=Release -DORCHARD_REFERENCE=ON
cmake --build build-core-reference -j2
ctest --test-dir build-core-reference --output-on-failure -j2
cmake -S . -B build-core-sanitize -DCMAKE_BUILD_TYPE=Debug -DORCHARD_SANITIZE=ON
cmake --build build-core-sanitize -j2
ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 ctest --test-dir build-core-sanitize --output-on-failure -j1
python3 -m venv build/oracle-venv
build/oracle-venv/bin/python -m pip install -r tools/requirements-oracle.txt
ORCHARD_BUILD_DIR=build-core node tools/build-oracle.mjs
build/oracle-venv/bin/python tools/check-unicorn.py --build-dir build-core
```

The oracle test module is a separate build artifact and never enters `dist/`.
WASM compilation requires a suitable Clang/LLD toolchain through `CLANG` and
`PATH`. Counts are test scope, not a compatibility percentage. Seven synthetic
profiles are not seven independently acquired stock calculators. Original
HP40gs/HP50g full-NOR admission, external-clock timing, measured board inputs
and broader multiple-access abort conformance remain separate work.
