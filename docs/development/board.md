# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) is the live board,
including remote CI results. This repository snapshot describes the current
code slice; [roadmap](roadmap.md) owns milestone gates and
[validation](validation.md) owns reproducible local evidence.

## Accepted engineering baseline

- [x] Original MIT source import, preserving the LICENSE initialization history.
- [x] Checked-in CTest regression, also compiled/executed as a test-only WASM module.
- [x] Six-profile generated-guest comparison using production CLI/WASM, with state, UART, LCD and reset/replay checks.
- [x] Legal Thumb BX PC transition and ARMv4 MUL/MULL/MSR operand restrictions.
- [x] Watchdog registers, functional countdown, reload and IRQ; reset propagation remains an explicit stop.
- [x] Release and ASan/UBSan validation; build workflow runs these checks before packaging.
- [x] M0: strict Zensical rendering and first fully green remote build on `ecc0470`, with production web/docs artifacts. [Build #2](https://github.com/zyf722/orchard-emu/actions/runs/36981413547).

## Now / next

- [ ] M1: expand independent CPU comparison, undefined exceptions and abort/writeback cases.
- [ ] M2/M3: admit the existing HP39g+ full NOR locally and record the first genuine boot stop.
- [ ] Close model-correct NOR/GPIO/LCD dependencies before claiming stock UI support.

The existing HP39g+ dump is already acquired. Its LFS pointer and provenance
are known; local binary retrieval is still unresolved. Do not restart the
retired ROM dumper or substitute another model's bootloader. See
[handoff](handoff.md).

A profile, green synthetic guest or successful build is not a stock boot.
Keep all-six-model usability, browser E2E, stock ARM return and virtual USB as
separate gates. Run locally before pushing; keep durable diagnosis in docs
and short status in the issue.
