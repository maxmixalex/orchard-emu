# Inactivity, Power_OFF and ON wakeup

The r21 inactivity failure was a reproducible hardware-model defect. It was
not a slow transfer, a timer added to the browser, or a firmware compatibility
timeout. Unmodified original ROMs eventually entered their normal shutdown
routine and reached previously missing GPIO/power behavior. The fixes execute
that routine and its reset-vector resume path; they do not patch the ROM,
write calculator objects into RAM, skip an instruction, or intercept an OS
power command.

The machine-readable record is [idle-power-r21.json](evidence/idle-power-r21.json).
Times below use Orchard's existing 12,000,000 functional reference ticks per
second. They establish repeatable emulator behavior, not measured physical
ARM instruction timing or identical wall-clock timeout values on real units.

## Original-ROM stops and their causes

The baseline used the existing admitted board presets, startup confirmation
keys and a 400-second virtual budget. No firmware or user RAM was modified.

| Original ROM | Baseline tick / virtual seconds | First stopping instruction | Missing behavior |
| --- | ---: | --- | --- |
| HP39g+ D1.55 | 958,633,453 / 79.886121 | `0x00006640`, `LDR` at `GPEDAT 0x56000044` | E14/E15 internal pull-ups |
| HP39gs complete capture | 3,624,042,428 / 302.003536 | `0x0001746c`, `LDR` at `GPEDAT 0x56000044` | E14/E15 internal pull-ups |
| HP48gII USB revision | 3,716,009,852 / 309.667488 | `0x0000a35c`, `LDR` at `GPEDAT 0x56000044` | E14/E15 internal pull-ups |
| HP49g+ complete capture | 3,694,280,355 / 307.856696 | `0x00007f90`, `STR 0` to `NFCONF 0x4e000000` | Disabling the unused NAND controller |

The HP39g+ pre-stop register snapshot has `GPECON=0x05555555` and
`GPEUP=0x3fff`: firmware explicitly enabled the E14/E15 pull-ups. The unresolved
mask was exactly `0xc000`. GPIO sampling previously implemented pull-ups only
inside the connected keyboard matrix. Adding strong test drives to an admitted
preset would have hidden this missing SoC behavior. Instead, B–H port sampling
now resolves the register-controlled internal weak pull-ups. Strong external
drives take precedence; an opposing explicit weak bias remains unresolved.
The keyboard matrix's connected-net resolver remains authoritative for its
pins. The existing HP49g+ preset already supplied strong E14/E15 high drives,
so that model exposed the next shutdown operation first.

The NAND subset is deliberately narrow. Aligned word reads of `NFCONF` return
the disabled model's zero value; an aligned word write of exactly zero disables
the unused controller. Nonzero configuration and NAND command/address/data
transactions still stop as unsupported. This is not NAND storage emulation.

After these accesses succeeded, the stock routines wrote `CLKCON` bit 3.
Previously the core stored the bit and kept executing the following branch
loop. Power_OFF now stops instruction issue and the non-retained peripheral
domains. The RTC and eligible external wake sources continue running.

## Functional Power_OFF reset and retained state

An EINT0–15 event or RTC calendar alarm wakes Power_OFF through a CPU/SoC reset
at the original reset vector. This differs from the host's explicit cold-reset
operation, which clears SRAM. The wake reset preserves:

- External SRAM, immutable loaded NOR, the RTC and GSTATUS3/4.
- Host GPIO drives and weak biases, physical held keys and keyboard attachment,
  ADC board inputs, and the host USB cable connection.
- The external SD image, capacity, insertion state, write-protection and dirty
  flags. The SDI controller and card protocol state reset; the medium's bytes
  do not disappear.
- The cumulative virtual tick and diagnostic instruction/exception counters.

Boot SRAM, CPU registers and CP15 state, interrupt/controller registers,
translation caches and NOR command state reset. `GSTATUS2.OFFRST` is set at
bit 1, following the manual's register table. The power chapter contains an
inconsistent prose reference to bit 2; the register table and the executing
original-ROM resume path agree on bit 1. GSTATUS2 remains write-one-to-clear.

An external event can wake Power_OFF even when its interrupt mask is set.
EINT0–3 preserve the direct source pending indication; EINT4–15 preserve an
EINTPEND bit only when the prior EINTMASK allowed it. A calendar-alarm wake
does not manufacture an RTC SRCPND bit. EINT16–23 and the periodic RTC tick
are not Power_OFF wake sources. Ordinary IDLE/IRQ behavior remains separate.

This is a functional reset model. It does not yet model analog power rails,
the manual's 65,535-input-clock reset assertion interval, PLL stabilization,
or the board-level nBATT_FLT condition that can block physical wakeup.
Watchdog reset propagation remains a separate unsupported path.

## Saved status register restoration

Genuine ON resume uncovered an additional CPU defect: the original ROM
restores an unused bank's SPSR to zero (`MSR SPSR_fsxc,r3`). The core rejected
that saved mode bit pattern as if it were an immediately active CPSR mode.
HP39g+ stopped at `0x000271a0`; HP49g+ stopped at `0x0003fb84`, both on
instruction `0xe16ff003` with `r3=0`.

Writing a privileged SPSR now stores the supported saved bit pattern without
requiring its low five bits to name a current CPU mode. An actual CPSR write
or exception return still validates the mode before changing active state.
The regression covers all 32 low-bit patterns in all five exception-mode
banks, plus separate invalid active-CPSR and exception-return cases. A
two-instruction MSR/MRS experiment on Unicorn 2.1.4's TI925T engine independently
accepted all 160 saved patterns and left the active CPSR unchanged. That is an
independent ARMv4T-compatible execution check, not a physical ARM920T capture.

## Checkpoints and regression coverage

The inactivity/Power_OFF fixes themselves preserve checkpoint version 3 and
its byte layout. The existing CLKCON and sleeping fields contain the retained
power state; a wake request is computed and consumed within one SoC tick, so
there is no additional pending event to serialize. Historical v1/v2/v3 imports
retain their existing compatibility paths. Loading a session resets the
transient wake request and host audio epoch after successful validation only.

`tests/power.c` exercises all six generated model profiles: a real ARM STR
enters Power_OFF; idle instructions and non-retained counters stay frozen;
the RTC advances; scheduled and reference execution agree before and across
wakeup; off checkpoints round-trip; ON, masked EINT15, non-waking EINT16 and
calendar alarm behave distinctly; reset flags and retained SRAM/board inputs
survive; extra issue slots stop after the power-control instruction. The
HP49g+/HP50g generated cases additionally compare every byte of an external
1 MiB writable or read-only SD image after wake and check media flags and
controller reset. No real HP50g or HP40gs Power_OFF claim follows from those
generated profiles.

`tests/lcd-input.c` checks generic pull-up resolution and the reduced GPEDAT
read. `tests/regression.c` checks the bounded disabled NAND subset and saved
status register patterns. The idle-only native Release milestone passed 18/18 tests; the
power test contains 836 assertions after the SD-retention additions.

All four available original ROMs completed the corrected natural inactivity
path on production WASM SHA-256
`9121607afc0517f6c170c8e2c7f606a88461f0f7a3b2ad5729812f271bf08108`:

| ROM | Power_OFF observed at tick | Seconds after the pre-idle arithmetic capture | Off checkpoint → ON → retained `2` → new `56` |
| --- | ---: | ---: | --- |
| HP39g+ | 1,052,000,000 | 75 | Passed |
| HP39gs | 3,716,000,000 | 297 | Passed |
| HP48gII USB revision | 3,788,000,000 | 298 | Passed |
| HP49g+ | 3,776,000,000 | 297 | Passed |

The driver polls once per virtual second, so these are observation boundaries,
not exact power-control write timestamps. Each off state remained blank with
an unchanged instruction count for another ten virtual seconds. Each off
checkpoint round-tripped byte for byte; each ON screen matched its earlier
arithmetic screen pixel for pixel. The private four-model montage was inspected
to confirm the displayed results `2` and `56`, including retained history.

A genuine r20 v3 HP39gs checkpoint from the NOTE catalog was also imported.
Physical F6/HOME dismissed the old transfer error and returned to HOME; physical
SHIFT/ON then entered Power_OFF, an off-session round-trip preserved it, ON
restored the `1+1=2` screen, and new input produced `7*8=56`. The old session was
created by the old core naturally; it was not a newly generated session with
its version number changed.

### Shared-PCLK follow-up and v4

The later r21 [shared PCLK/PWM implementation](clock-ratios.md) adds checkpoint
v4. All four original-ROM power tests were repeated on WASM SHA-256
`e41ae1105644be0ea617db5456acf0d535fa4c8912b5b1b942d8b115c7afe5c6`:

| ROM | Power_OFF observed at tick | Seconds after pre-idle capture | Full off/restore/ON/arithmetic flow |
| --- | ---: | ---: | --- |
| HP39g+ | 3,764,000,000 | 301 | Passed |
| HP39gs | 3,764,000,000 | 301 | Passed |
| HP48gII USB revision | 3,812,000,000 | 300 | Passed |
| HP49g+ | 3,824,000,000 | 301 | Passed |

The earlier 75-second HP39g+ interval belonged to the old one-PCLK-per-reference
approximation. Register-derived PCLK now puts all four observed firmware
inactivity boundaries near five functional minutes. This remains a functional
time result, not a physical timeout calibration. All four screens again
matched exactly after ON, remained blank/frozen through ten off seconds, and
displayed new `56` after restored `2`; the new private montage was inspected.
The genuine r20 HP39gs v3 session also completed the same manual off/ON test
after import into v4. The new native suite passes **19/19**, including 2,452
independent PWM/clock assertions and the unchanged 836 power assertions.

### Final production build

All four natural inactivity workflows and the genuine r20 v3 manual off/ON
workflow were repeated against the frozen production WASM SHA-256
`36fe5da8630af83946503c76eab63f8dbb64274162b22eb06fd50f5a0d222108`.
Every workflow passed. The observed power-off boundaries were again
3,764,000,000 ticks for HP39g+ and HP39gs, 3,812,000,000 for HP48gII, and
3,824,000,000 for HP49g+. Every captured CPU state, clock snapshot, LCD hash
and powered-off v4 checkpoint matched its earlier `e41ae110…` run exactly.
The new private four-model montage was also inspected: blank while off,
retained `1+1=2` after ON, then `7*8=56` with history preserved. The historical
v3 import likewise retained `2` and produced new `56` after its off-session
round-trip. The [metadata record](evidence/idle-power-r21.json) keeps these
final-production results separate from both preceding build identities.

## Reproducing the original-ROM witness

Build the production WASM, then supply a privately held, admitted complete NOR
image. The tool recognizes the model by its full SHA-256 and applies only the
existing explicit board setup and physical key inputs:

```sh
node tools/verify-stock-idle.mjs /private/original-full-nor.bin \
  /private/new-idle-evidence
```

It enters `1+1`, lets the original firmware time out naturally, verifies a blank
powered-off LCD and frozen instruction counter, saves/restores the off session,
wakes with ON, compares the entire previous LCD, and enters `7*8`. The output
directory must be new. It contains a metadata report, private LCD captures
for visual arithmetic review and an off checkpoint; it contains no ROM copy.
The report does not contain ROM, user RAM or LCD bytes. The tool's LCD-change
assertion does not by itself recognize the mathematical result; the captures
must be inspected before claiming displayed `2` and `56`.

To exercise a historical session without waiting for another inactivity cycle:

```sh
node tools/verify-stock-idle.mjs /private/original-full-nor.bin \
  /private/new-old-session-evidence \
  --checkpoint /private/old.checkpoint --manual
```

`--manual` uses physical SHIFT/ON. `ORCHARD_WASM` selects a separately preserved
build. None of the tool paths fetch firmware or modify a ROM on disk.

## Primary hardware references

- [Samsung S3C2410A User's Manual](https://pdfstore-manualsonline.prod.a.ki/pdfres_02/af/4c/af4c636f-a045-4652-865a-9643aaa6c16d.pdf),
  March 2004: NAND configuration 6-6; Power_OFF and wakeup 7-14 through 7-18;
  clock control 7-20; port E and pull-ups 9-14/9-15; GSTATUS2/3/4 9-28;
  ARM PSR transfers 3-18. Consulted PDF SHA-256:
  `4e3dd756e27d80d7116282a6ae062458237fc1c5b34f1b1d40529c92b2c18794`.
- [Unicorn 2.1.4 release](https://github.com/unicorn-engine/unicorn/releases/tag/2.1.4)
  identifies the separate CPU execution engine used for the saved-SPSR cross-check.

The original-ROM reports are runtime observations of the locally supplied
private inputs. They are separate from the manual's hardware specification
and from the admitted board assumptions documented for each model.
