# ARM920T follow-up after the r25 application checks

The final roadmap review found a documented CP15 read that the core rejected.
This follow-up implements that instruction behavior. It also separates the next
CPU and hardware work from the original-program acceptance already recorded in
[ARM memory and native compatibility](arm-memory.md).

## Implemented: CP15 ID read aliases

`src/mmu.c::o_cp15` now accepts all the ARM920T ID-read encodings documented in
[ARM920T Technical Reference Manual, ARM DDI 0151C](https://documentation-service.arm.com/static/5e8e2a5b88295d1e18d381bb),
sections 2.3.3 and 2.3.4. With `opcode_1=0`, `CRn=0` and `CRm=0`, `opcode_2=1`
reads the cache type; each other three-bit `opcode_2` value reads the ID code.
The previous implementation accepted only `opcode_2=0` for the ID and stopped
on the six other valid encodings.

A ROM-free, single-instruction reproduction from SRAM produced these results
before the fix. Each row starts from a fresh supervisor-mode machine with
`r0=0xdeadbeef` and `PC=0x08000100`.

| Instruction | Meaning | Previous result | Required result |
| --- | --- | --- | --- |
| `0xee100f10` | ID, `opcode_2=0` | `r0=0x41129200`, PC advances | Same |
| `0xee100f30` | Cache type, `opcode_2=1` | `r0=0x0d172172`, PC advances | Same |
| `0xee100f50` | ID, `opcode_2=2` | `ORCHARD_UNSUPPORTED_CP15`, PC unchanged | `r0=0x41129200`, PC advances |

The correction changes only the ID-read selection. The existing model ID and
cache values are retained; this does not establish the layout revision of any
physical calculator. Other `CRm` and `opcode_1` values, writes to register 0 and
reserved registers are not made permissive.

`tests/regression.c::cp15_identification` contains eight fixed instruction words
and independently specified expected values. It exercises both dispatchers,
ordinary destinations, the `Rd=PC` flag-transfer form and a condition-failed
control. Separate cases retain the current rejection of unprivileged access,
nonzero `CRm`/`opcode_1`, register-0 writes, reserved register 4, non-CP15 access
and ARMv4T undefined encodings. Those rejection assertions record the present
diagnostic policy; they do not claim that a host stop is the architectural
undefined-instruction exception.

The added cases contribute 226 assertions. They produce 96 failures against
the prior core, all in the six missing ID aliases, and are included in the
normal native, reference, sanitizer and WASM regression gates. This is a
documented instruction-compatibility fix, not evidence that any existing stock
ROM or application uses these alternate encodings.

The production WASM built for this follow-up has SHA-256
`178b165d61032be9a7cede597d6810c709fdbfb120330f1565df4b047c13085f`.
Earlier `57d5d586...` application and browser reports remain evidence for that
earlier binary. Original-program regression reports for this follow-up must
record the new identity independently.

For this CP15 revision, native and reference builds each pass 24 CTest cases;
the full native/WASM comparison and strict documentation build also pass.
The sanitizer run passes 23 cases but cannot start the generated performance
binary because its executable bit is absent. After restoring that local build
artifact's executable bit, the affected case passes separately with the same
source and sanitizer settings (`detect_leaks=0`, `halt_on_error=1`). This is
not recorded as a clean single-run 24/24 sanitizer result.

Original ARMToolbox installation, native entry/return, arithmetic and USB GET
pass independently on both HP48gII and HP49g+ with this binary. HP39g+ Tetris
and HP39g+/HP39gs Arkalite pass from stock-installed checkpoints, including
held controls, return, the known HOME arithmetic image and byte-identical warm
continuation. These are explicit `178b165d...` runs; the previous cold-boot
installation and other application reports have not been relabeled.

## Combined UART and CP15 acceptance

The subsequent core also includes the bounded
[UART FIFO reset correction](uart-irda.md): resetting the chip receiver no
longer deletes future host-staged octets. Its production WASM SHA-256 is
`36e2a4811a793413ca5ec49436e047b3f47a518112810f2c1835030322fa8569`.
It matches the independently built integration binary exactly.

Native and reference CTest each pass 24 cases, and the complete native/WASM
gate passes, including 105,059 main-regression and 5,455 UART assertions.
The sanitizer run passes 23 cases; this time the generated clock-domain
executable lacks its executable bit. Restoring that artifact's `u+x` and
rerunning just the affected case succeeds with the same sanitizer settings.
The original failed-to-start log and successful isolated rerun are retained.

Nine fresh private original-program reports use this exact binary: HP48gII
and HP49g+ cold ARMToolbox installation/execution/return/arithmetic/USB GET;
HP39g+ cold Wire installation and execution of Tetris; and cold Wire
installation and execution of Hanoi on HP39g+ and HP39gs. Each Arkalite model
has a separate cold library/aplet install with exact stock SEND round trip,
followed by gameplay and return from that newly generated installed checkpoint.
The Arkalite application reports correctly describe their checkpoint starts
as warm, while their associated installation reports describe the cold boot.

Both SDK workflows reproduce all six independently reviewed stage images.
All five HP39 application workflows verify HOME arithmetic and byte-identical
complete continuation after restoring their running-game checkpoint. These
are Node/production-WASM results. Browser interaction and the unresolved
historical infrared timing cases require their own evidence; neither is
inferred from the core gates or the FIFO fix.

## Next implementation priorities

### M1: Deliver defined undefined-instruction exceptions

`src/cpu.c::arm` and `src/thumb.c::o_thumb` currently stop the host for several
encodings which should enter the guest's undefined-instruction handler.
For example, ARM `0xe6000010` and Thumb `0xde00` reach the current diagnostic
paths. ARM920T DDI 0151C section 2.2.2 establishes the ARMv4T extension spaces;
section 2.3.2 also specifies a trap for unprivileged CP15 access.

Implement a shared ARMv4T decode classification, then use the existing
`o_exception` bank/vector machinery for only the architecturally defined
undefined cases. Keep `arm_without_checkpoint` consistent with that
classification. An arbitrary unimplemented peripheral, an unpredictable
register combination and an undefined instruction must remain distinguishable.
This is a next implementation task, not part of the ID-alias correction.

Acceptance needs no calculator ROM: execute fixed ARM/Thumb words, a
condition-failed ARM control, user-mode CP15 access and an ARMv5-only encoding.
At both vector locations, assert UND mode, saved CPSR, the next-instruction
link, ARM state, IRQ masking and preserved FIQ masking. A generated handler
must execute `MOVS pc,lr` and resume the following instruction, including
return to Thumb. These exception-entry/return requirements are specified in
[ARM Architecture Reference Manual, ARM DDI 0100I](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/1023/ARM-Architecture.pdf),
section A2.6.3. Both dispatchers and WASM must agree with fixed expectations.
Stock/native workflows then provide regression coverage, not the exception
oracle.

### M2: Add bounded UART FIFO idle timeout from the functional clock

`src/uart.c::o_uart_register` explicitly rejects UCON receive-timeout enable
when FIFO mode is active. `service` handles decoded octets atomically and
UBRDIV currently has no timing effect. This is a defined missing functional
mode, independently of any browser relay failure.

The [Samsung S3C2410A User's Manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
chapter 11, pp. 11-3, 11-5, 11-7 and 11-11, specifies FIFO receive timeout,
its receive-IRQ routing, the three-word interval and the PCLK baud divisor.
The first implementable scope is PCLK-selected UARTs with an explicit
functional character-time contract. Add per-channel phase/deadline state,
checkpoint serialization, reset and clock-gating behavior. Keep UEXTCLK
outside that scope until its input rate is supplied. Exact transition behavior
not settled by the manual needs a measured input, rather than a convenient
timeout constant.

In particular, the original infrared path's observed `UCON=0x705` selects
UEXTCLK through bit 10, rather than PCLK. Chapter 11, p. 11-11 identifies its
GPH8 input, but the present startup presets supply no frequency for that pin.
The observed UBRDIV values 312 and 25 therefore do not justify assigning a
physical character time from the functional PCLK. Preserving observed sender batch
timestamps and gaps at the host transport boundary is separate from inventing
an external clock or a UART waveform.

Use ROM-free FIFO cases with one byte below each trigger level; assert no
timeout just before the derived deadline and the receive IRQ at the deadline.
Cover new-byte restart, drain/reset cancellation, disabled FIFO/timeout,
independent channels, PCLK ratios and exact restored continuation. Retain the
original serial self-tests and complete two-calculator transfers as regression
gates. A timeout implementation does not establish optical pulse timing or
explain a historical malformed packet without a matching trace.

The broader board gate still requires physical observations for the declared
SRAM mirror, GPIO/ADC inputs, LCD panel mapping and the LCD `+0x68` behavior.
Sources, revision identity and raw measurements must accompany any replacement
of those assumptions. The functional clock convention alone does not establish
a calculator's physical oscillator or serial timing.

### M4: Admit HP40gs and HP50g only from their own complete NORs

The missing prerequisite is a trustworthy original input for each machine.
`src/machine.c` contains their profiles, but `web/hp48.js` and the catalog
intentionally do not promote them. The existing
[native-ROM inventory](native-roms.md) has a HP40gs updater and a HP50g native
boot region/updater, not either complete acquired NOR.

The next concrete feature is each model's stock startup and interactive
catalog entry. Its primary evidence must begin with a complete 2 MiB capture
from that identified hardware revision, equal independent block reads,
preserved original boot bytes and a whole-image identity. An updater padded
to the right size, or a foreign bootloader, cannot satisfy this input gate.
The inventory's HP preservation sources establish the available fragments;
they do not establish the contents of the missing complete images.

After acquisition, use `tools/rom-info.mjs` and the native/WASM boot witnesses
to isolate the first unsupported instruction or register without patching the
guest. Acceptance must include cold boot, native reset/wake, the correct LCD,
physical-key arithmetic, stock self-tests and transfer round trips. Add an
original native application's entry, return and subsequent arithmetic only
when that application's own target declaration includes the model. The
catalog change comes after these witnesses. No additional 39gs or 49g+ ROM
capture is needed for this gate.

## Multiple-access abort review

`src/cpu.c::cpu_step` currently restores its CPU snapshot on a data abort;
memory/MMIO side effects are not rolled back. In particular, a failed multiple
load restores destination GPRs as well as its base. This alone is not evidence
of an ARM920T defect: DDI 0151C section 2.2.1 requires base restoration, and
DDI 0100I section A2.6.6 leaves other multiple-load destinations unpredictable.
The latter also requires an unchanged base when a no-writeback load included
that base before the failing access.

Further M1 work should pin the mandatory contract with faults at the first,
middle and last access across a small/tiny-page permission boundary. Concrete
inputs include `LDMIA r0,{r0,r1,r2}`, writeback loads/stores in all four ARM
addressing modes and Thumb `POP` with PC last. Check base, fault address/status,
saved CPSR, abort link/vector and denied-write memory. Do not require invented
values for unspecified non-base destinations. Exact silicon partial-beat or
peripheral-side-effect fidelity needs additional ARM9TDMI detail or measured
hardware evidence. A broader generated test matrix alone would not complete
that hardware-conformance work.

## Program-driven follow-ups

### Arkalite short DEL

The combined core's held-DEL browser exits pass, but the retained ordinary
short-click failures remain open. The 28 paired initial/combined-core cases
reach equal full checkpoints and do not reproduce those failures. The failed
browser reports lack a complete preceding RIGHT-contact and core API history;
a nearby successful DEL tick is therefore not an independent timing oracle.

The next bounded investigation is one HP39gs capture from the second Restore
through the quit decision, with the original failing frontend identity and
36e2 core. Record every execution API, actual C key-contact edge, input owner,
pre-DEL full checkpoint and observed outcome. Require exact same-core replay
before comparing an earlier core or adding read-only GPIO/EINT observations.
If that capture succeeds, retain it as a non-reproduction rather than repeatedly
sampling for a preferred result. Separate host contact delivery, guest scanning,
instruction/interrupt behavior and LCD publication. The established return-title
region and complete HOME arithmetic frame remain outcome checks; increasing
DEL dwell is not itself a short-click fix. See the retained boundaries in the
[program compatibility record](compatibility-r25.md#browser-input-and-presentation).

### Original GBP entry environment

The [native prerequisite record](hp39-native-prerequisites.md) retains the
unaligned original-loader fault and the distinct working ALIGN4 diagnostic.
Before changing another CPU rule, identify the actual installed Library 275,
the original program's PrRUN/ARMSYS entry and every relevant CP15 alignment-bit
write up to the first BSS store. Follow the unmodified ROM's abort handler to
its observed return, retry or loop. An independently normal case must use the
same original package and established entry environment; a separately aligned
package or disabled alignment checking cannot supply that evidence. This is
an investigation plan, not new original-package acceptance.
