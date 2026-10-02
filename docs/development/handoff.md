# Continuation handoff

Work remains in private `zyf722/orchard-emu`, `main`, preserving the MIT
initialization ancestry and [issue #1](https://github.com/zyf722/orchard-emu/issues/1).
M0 is accepted. Commit `351a0da` adds the actual Pages workflow and private
research acquisition. No force push, duplicate board or visibility change.

## Inputs are available

The user supplied the exact HP39g+ D1.55 full NOR. The original author's
HP48gII USB-revision full-NOR mirror was downloaded and hash-checked, then
retrieved for local work. Both input identities and the three uploaded updater
identities are in [ROM provenance](roms.md). Do not repeat the old LFS-pointer
blocker or restart the retired dump tool. These are not bundled source assets.

## Current implementation

[Boot research](boot-research.md) records the real reset trace progression,
new boot SRAM, GPIO/reset-state, IRQ arbitration, RTC and LCD-lane work.
Native and WASM now execute both original images to explicit missing-hardware
stops, without guest exceptions. Neither shows an interactive stock UI.

Next investigations: HP39g+ LCD read at `0x4d000068`, and HP48gII input
sources at GPDDAT `0x56000034`. Resolve actual device semantics rather than
masking the stop, patching firmware or using arbitrary input levels. Further
CPU/MMU conformance and abort/writeback work remain independent requirements.

## Verification and publication

`tests/regression.c` and `tools/check-wasm.mjs` run without HP firmware.
`tools/probe-rom.mjs` takes an explicit local NOR and compares both hosts and
cold replays. Reports bind input and executable hashes; they are not stock
boot certificates. Keep definitions in Git and generated reports/private
inputs outside production artifacts. See [validation](validation.md).

The [Zensical site](https://zyf722.github.io/orchard-emu/) is deployed to Pages.
The first strict build and deployment succeeded in Documentation #1, run
36984188560. The documentation-only workflow does not publish the emulator
workbench, firmware or private research artifact. Check current Actions and
issue #1 for acceptance of later implementation revisions.
