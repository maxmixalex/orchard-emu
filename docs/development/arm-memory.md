# ARM memory and native-program compatibility

The r25 changes correct four core behaviors exercised by native calculator
programs. The original HP39g+ Tetris+ 1.1 now starts, responds to held controls,
returns through its own ARM wrapper and leaves HOME able to calculate `1+1=2`.
No ROM, program bytes, instruction address or model-specific opcode exception
is used by these implementations. Their hardware-evidence limits are recorded
separately from the successful software workflow.

## Multiple-load alignment

ARM `LDM` and Thumb `LDMIA`/`POP` now read aligned words without applying
the single-word `LDR` byte rotation. Previously all these instructions used
one rotated-load helper; when CP15 alignment checking was disabled, a base
ending in 1, 2 or 3 corrupted every loaded register. This could also rotate a
saved return address before it reached the PC.

The implementation uses the same translation, permissions and physical bus
path as other data accesses. It preserves the original effective address for
alignment checks and faults. With CP15.A set, an unaligned multiple load still
raises a data abort before changing its registers. With A clear, its memory
read is word aligned while base writeback keeps the original low address bits.
Ordinary word `LDR` and `SWP` retain their existing rotation behavior.

### References and checks

- [Samsung S3C2410A User's Manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
  ARM instruction set pp. 3-29 and 3-41: single-word rotation versus multiple
  transfers; Thumb formats 14/15 use the corresponding ARM multiple transfers.
- [ARM920T Technical Reference Manual, ARM DDI 0151C](https://documentation-service.arm.com/static/5e8e2a5b88295d1e18d381bb),
  §3.7.1: alignment checking precedes permission checks and remains active with
  the MMU disabled.

`tests/regression.c::multiple_load_alignment` supplies independent distinct-byte
memory expectations, all four ARM addressing modes, writeback on/off, low
address bits 0–3, both settings of CP15.A, Thumb stack and multiple loads, and
both production/reference dispatchers. A separate single-LDR control asserts
all four expected rotated values. These expectations failed in 60 cases before
the change. They run through the normal native and WASM regression gates.

## Store multiple with the base in its register list

The previous implementation stopped ordinary ARM `STM` and Thumb `STMIA`
instructions with writeback when their base register appeared after the first
register in the list. This rejected Tetris's entry wrapper at `0x0800bcfc`:
`STMDB sp!, {r0-r14}`. Rejecting the whole instruction is unnecessarily broad.

The [ARM Architecture Reference Manual, ARM DDI 0100I](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/1023/ARM-Architecture.pdf),
STM (1), A4.1.97, and Thumb STMIA distinguish two cases: a first base register
stores its original value; a non-first base register stores an UNPREDICTABLE
value. The latter description concerns the stored value, rather than making
all the other stores or final writeback optional. orchard-emu deterministically
stores the original value in both cases, then performs writeback. Its
user-bank restrictions, empty-list checks and existing load-multiple checks
are retained.

This is an explicit compatibility choice for the unspecified value, not a
claim that the value has been measured on ARM920T silicon. Samsung's S3C2410A
manual, p. 3-44, instead describes the updated value for a non-first base.
That documentary conflict remains open. The ARM920T's separately documented
base-restored **data-abort** behavior does not establish which base value is
stored during a successful instruction.

The original Tetris wrapper also provides useful software evidence. Its later
`LDM sp, {r0-r12, sp, pc}` expects the saved original stack pointer. An initial
implementation of Samsung's updated-value rule allowed gameplay but restored
SP 60 bytes too low; exit then looped through guest data aborts. The last game
image remained visible and the host reported no unsupported instruction. This
was caught by inspecting the return path and checking subsequent arithmetic;
a changing framebuffer and a zero host stop code were insufficient acceptance
criteria. The original-value choice completes the unchanged program's return.

`tests/regression.c` covers all four ARM addressing modes, writeback enabled
and disabled, base at the first, middle and last register, both dispatchers,
Thumb address low bits and alignment controls, and a complete generated
stack-save/restore sequence. Expected values come from fixed register and
memory values, not from running the implementation as its own oracle.

## LCD clock changes while enabled

The original game writes LCDCON1 `0x0a21` while video remains enabled. The core
now accepts a valid change confined to CLKVAL, preserving the current line and
elapsed line phase. The next scheduler tick applies the new period. A shortened
period that has already elapsed completes one line at that tick; it does not
invent earlier missed frame events. These are functional clock semantics,
not measured behavior at a physical divider transition.

The documented CLKVAL range still applies. Live mode, pixel-format and geometry
changes remain outside this supported path. `tests/lcd-adc.c` supplies fixed
period and line/phase expectations and retains invalid-mode and invalid-clock
controls. See [the LCD model](lcd.md) for the scan and panel limitations.

## Narrow reads of PWM observation counters

HP-GCC's original
[`sys_getPWMCounter0` source](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/hplib/sys/sys_getPWMCounter0.c)
uses a halfword load of TCNTO0. The same access occurs in the original Tetris
program at `0x0800d7c0`; its virtual address `0x07600014` translates to
physical `0x51000014`. The implementation now accepts naturally aligned byte,
halfword and word reads of the five read-only TCNTO registers and selects the
requested lanes from the existing counter value. Reads neither advance a
counter nor change IRQ state. Writes and narrow reads of timer control or
buffer registers retain their previous rejection behavior.

Samsung's register descriptions establish the 16-bit observation values and
their read-only status, but table 1-4 recommends 32-bit PWM accesses. Narrow
observation reads are therefore a bounded compatibility extension supported
by an original hardware-targeted consumer, not a claim that every peripheral
register implements arbitrary access widths. No synthetic counter or zero
substitute is returned. No HP-GCC source was copied into the core.

`tests/pwm-clock.c` checks all five registers and byte lanes, advancing and
stationary counters, IRQ invariance, invalid writes and widths, and actual
ARM/Thumb halfword-load instructions through both dispatchers.

## Public program acceptance

The first application-acceptance core in r25 has SHA-256
`57d5d586bbf4e22e8e733130630c961df73ba0df57f1bcf683fc53bb327b8547`.
The later [CP15 ID-read follow-up](core-next-r25.md) has a separate identity
and separately recorded regressions; these earlier runs are not relabelled.
ROMs and application binaries are privately supplied inputs, not repository
fixtures. The witnesses check input identity and execute the original guest
instructions through the production core.

| System and program | Accepted workflow |
| --- | --- |
| HP39g+, original [Tetris+ 1.1](https://www.hpcalc.org/hp39/games/tetris39gpls.zip) | Cold stock Wire installation, native game, visible held movement and retained Shift/Alpha contacts, ON return, HOME arithmetic, exact restored-checkpoint continuation |
| HP49g+, pinned HP-GCC ARMToolbox and original `main.hp` | Cold stock USB installation, ARM greeting, ON return, arithmetic and byte-exact USB GET of the installed library |
| HP48gII, original `L275_48.LIB` and `main.hp` | [Cold stock USB installation](hp48-native.md), ARM greeting, ON return, arithmetic and USB GET with exact object payload and the original OS's explicit header revision change |
| HP49g+, original 2048 | Thumb game, directional input, return and arithmetic from the stock-installed checkpoint |
| HP49g+, original BabalPlus | Saturn game, directional input, return and arithmetic from the stock-installed checkpoint |
| HP49g+, original BaseConvert/ListConvert | `42` to binary and inverse conversion back to `42`, followed by arithmetic |

The HP39 witness requires the independently viewed HOME arithmetic work area,
not merely a changed display; it also compares complete continuation
checkpoints after replay. Tetris's final full-LCD hash is
`191b93f122faf489989d0f139ea843c43d6e3309a14b27de4e546720c63c37ba`.
`tools/verify-hp49-apps.mjs` now asserts every reviewed application frame,
including both conversions and post-return arithmetic. Successful Node/WASM
execution does not establish browser UI behavior or physical performance.
Tetris's author specifies HP39g+; 2048 specifies HP49g+/HP50g. These witnesses
do not silently extend those programs' model support.

For the initial `57d5d586...` core, native, reference-dispatch and Clang
ASan/UBSan CTest configurations pass all 24 suites. The normal production WASM gates also pass, including 104,833 main
regression assertions, 4,597 LCD/ADC assertions and 2,807 PWM assertions. The
independent Unicorn comparison passes 17,075 applicable cases with no mismatch
or skip. Those counts describe tested cases, not a percentage of hardware
compatibility.

## Original GBP 0.3 remains a separate package fault

The original GBP 0.3 package was installed and exported byte-for-byte through
stock Wire on HP39g+ and HP39gs. Both reproduce its first alignment fault at
`0x090007f2` with CP15.A enabled: the loader's data end omits the two bytes of
alignment before its `.bss`. Relaxing the guest's requested alignment checks
would hide that fault. The package therefore does not reach gameplay; its
linker issue remains recorded in [the original-program record](hp39-programs-r23.md).

The explicitly named GBP39 ALIGN4 diagnostic package separately passed
selection, gameplay, ON return, exact warm checkpoint continuation and
subsequent `1+1=2` on both models after the multiple-load correction. It is
evidence for the corrected return path, not a successful run of the original
GBP package. No checkpoint field or ROM preset changed for these core fixes.
Partial-abort semantics, cache contents and physical-cycle behavior remain
separate work.
