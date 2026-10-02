# Development board

The live board is [GitHub issue #1](https://github.com/zyf722/orchard-emu/issues/1).
This page records the working convention and a compact repository snapshot;
the [roadmap](roadmap.md) owns milestone definitions and [validation](validation.md)
records the scope of each observed result.

## Current baseline

- [x] Original MIT C17 ARM/Thumb core, native CLI and freestanding WASM host.
- [x] Six candidate physical profiles, strict full-NOR loader and bounded runs.
- [x] Functional INTC/PWM/UART0 subset and raw STN framebuffer inspection.
- [x] Source, browser workbench, Zensical configuration and opt-in build workflow imported while preserving the existing LICENSE commit.
- [x] Existing issue #1 retained as the live board; no duplicate board or history rewrite.
- [ ] M0: strict Zensical rendering, observed remote CI and maintained regression corpus.
- [ ] M1: independent CPU conformance, abort/writeback and undefined-instruction audit.
- [ ] M2/M3: obtain the verified full-NOR bytes locally and resolve the first actual boot dependency.

## Fixture priority

Start with the existing HP39g+ D1.55 hardware dump from hpclang, not a new ROM
dumper. Its size/hash/provenance are known; the connected file read currently
returns a Git LFS pointer, not the binary. Local binary retrieval has failed.
Do not substitute another model's bootloader or mark real-ROM execution passed.
See [ROM inputs](roms.md) and the [handoff](handoff.md).

## Next

Complete boot-relevant peripheral behavior using primary register references
and local directed checks, then use a real full-NOR trace to set priorities.
Keep physical keyboard wiring, LCD annunciators, stock ARM launch/return and
USB endpoint/host/transfer behavior as separate, evidence-backed gates.

## Update rule

Keep issue #1 concise. Durable diagnosis belongs in these development pages.
A checked box needs an implementation revision, input, command and observed
outcome. Synchronize README, roadmap, validation and the issue after accepted
changes. A profile, synthetic guest or successful build is not a stock boot.
Run locally before CI; do not use the remote runner as an open-ended debugger.
