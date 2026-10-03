# Native NOR bring-up

## Current continuation: conditional HP48gII stock-OS prompt

The [startup-memory record](startup-memory.md) supersedes the selected-48gII
zero-store stops below. A bounded x16 adapter now permits real bus cycles;
SDP still prevents firmware mutation. With additional explicit F pads and
AIN0, the unchanged full NOR draws its original memory-recovery prompt.
Selecting NO reaches an exact SRAM-boundary data abort, not a normal UI.
Strict defaults and the unspecified-part 39g+ stop remain unchanged.

## Current firmware evidence classes

| Input | Current scope |
| --- | --- |
| HP39g+ D1.55, genuine full NOR | Strict LCD checkpoint unchanged; conditioned USB initialization reaches a zero-store on its unspecified NOR part |
| HP48gII, genuine full NOR | Selected x16 component plus explicit electrical/analog/LCD conditions reaches an OS recovery prompt; NO leads to a SRAM-boundary data abort |
| HP49g+ / HP50g original boot regions | Native 16 KiB boot-only regions with erased OS backing, not additional complete NORs |
| HP50g separate host-attached experiment | Original bootloader descriptors and control status; GET_CONFIGURATION remains a NAK counterexample |

The latest exact state/command evidence is in [startup memory](startup-memory.md).
It includes a 50M-tick prompt checkpoint and a 61,249,398-tick first-abort
checkpoint, each compared on native and production WASM with both cold replays.
The actual framebuffer is inspected as packed LSB memory, not a validated
physical panel. No normally usable stock calculator is accepted.

The [USB record](usb.md) owns the separate 143-step bootloader transcript.
It was rerun after the x16 adapter change and still agrees across hosts and
cold replays. Its synthetic bulk echo is not HP file transfer. The original
full-NOR probes do not attach a USB host just because they initialize the
controller. These two kinds of experiment must not be conflated.

## Inputs and repetition

[ROM provenance](roms.md) and [native inputs](native-roms.md) preserve exact
full-image/boot-region/update identities. The local probe loads one immutable
snapshot for both hosts and refuses to overwrite an existing report.
[Electrical input](input.md), [LCD](lcd.md), and [ADC](adc.md) describe the
explicit conditions. Boot-ROM firmware is never committed to the source or
production packages. The user's HP39gs and HP49g+ full dumps remain deferred.

The local wrapper supports budgets of 1..100,000,000 virtual ticks. Its JSON
still reports `boot_verified=false` even at budget completion: an abort loop
or early prompt must not be promoted to stock boot. Do not compare elapsed
host seconds or assertion counts as a percentage of firmware initialization.

## Historical progression records

The [pre-adapter USB/CPU-era table, e236fcc](https://github.com/zyf722/orchard-emu/blob/e236fccd55947c119b4439eee85e2aa9825831de/docs/development/boot-research.md)
retains all thirteen earlier cases and the original zero-store diagnosis.

Older tables are retained at their exact Git revisions rather than repeatedly
presented as the current result. These linked records include their original
commands, negative controls and limitations:

- [Initial genuine-NOR progression, d08d349](https://github.com/zyf722/orchard-emu/blob/d08d349f3f87d184e86815a9d7dcf3e226ab5e2e/docs/development/boot-research.md): reset status, internal boot SRAM, RTC and LCD/GPIO stops.
- [Native-region and GPIO sensitivity, d3d6528](https://github.com/zyf722/orchard-emu/blob/d3d6528e536cbe2894ade76bba0c7cfc0e85ff8e/docs/development/boot-research.md): 2,048 bounded variants, original boot regions and the pixel-order counterexample.
- [Keyboard circuit and NOR identification, 54f316d](https://github.com/zyf722/orchard-emu/blob/54f316d7c3e8e3ebc62f7d3fbb9405d09e2008f5/docs/development/boot-research.md): first OS-region initialization and the strong-drive contention case.
- [Weak bias and counted LCD hypothesis, 5f93b3f](https://github.com/zyf722/orchard-emu/blob/5f93b3f661c53aa49e2f92badc6e41fa2be5c3a0/docs/development/boot-research.md): deterministic recovery-menu choices and subsequent LCD/ADC dependencies.
- [LCD/ADC to USB initialization, a9e03bd](https://github.com/zyf722/orchard-emu/blob/a9e03bd946b6c6cc47887f937458fe158236dd20/docs/development/boot-research.md): sample-code branches, frame interrupts and unresolved analog controls.
- [Earlier EP0-only continuation, 80a1466](https://github.com/zyf722/orchard-emu/blob/80a1466c77e9c6f047e8d6b74f1d616be3bb6058/docs/development/boot-research.md): the remote baseline reconciled with the fuller packet/bulk continuation.

These historical counts are not added to present test or stock-boot coverage.
No historical commit, ROM identity or canonical strict gate was replaced.
