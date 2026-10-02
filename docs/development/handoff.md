# Continuation handoff

Private `zyf722/orchard-emu`; preserve main ancestry and existing issue #1.
Base for this slice: `5f93b3f`. The live issue owns current accepted commit,
Build and Pages results. Do not force-push or change repository visibility.

## Input plan

The user will later provide original **HP39gs and HP49g+ full NOR dumps** from
their machines. Do not request those now or restart the retired dumper. This
is deferred input work, not a development blocker. Available full dumps remain
HP39g+ D1.55 and HP48gII USB revision. The two original 16 KiB 49g+/50g boot
regions remain separately classified with erased OS backing. No new firmware
was acquired. See [native inventory](native-roms.md).

## Current dependency

The documented LCD source/pending registers and functional scan counter now
work; normal ADC has explicit sample inputs and completion IRQ. Conditioned
39g+ reaches original OS PC `0000888c`; conditioned 48gII with AIN7=0/512/1023
reaches `0000c7ec`. Both next write 1 to USB `52000144`. With no analog input,
48gII instead stops at its real AIN7 conversion start (`00004f58`).

Every idle-zero run still records one unverified LCD `+0x68` read. Strict
39g+/48gII checkpoints remain unchanged. The next useful implementation is
the actual USB device-controller initialization, followed by guest descriptor
and host transactions. Do not call register acceptance enumeration or transfer.

LCD timing is functional and includes a documented manual discrepancy for
WDLY/WLH. FIFO, physical clocks/panel mapping and real pad/analog bias are not
closed. `packed-lsb` is memory inspection, not the physical LCD. ADC codes are
not battery voltages. See [LCD](lcd.md), [ADC](adc.md) and [boot research](boot-research.md).

## Validation / publication

Three CTest suites run natively and as test-only WASM. The production peripheral
guest exercises ADC and LCD IRQ entry/acknowledgment/SPSR return/WFI on both
hosts. Probe v5 records ADC conditions and side-effect-free peripheral state,
in addition to previous architecture and event schedules. Thirteen firmware
comparisons/cold replays and three selected optimized-sanitizer scenarios are
recorded in [validation](validation.md).

Run locally before pushing. Tests belong in the source repository but not
production packages. Firmware/manuals/private traces never enter Git or Pages.
Zensical deployment publishes docs only and verifies live content/revision.
M0 stays closed; no current conditioned run closes M3 or independent CPU gates.
