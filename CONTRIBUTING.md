# Contributing to Orchard

Read `docs/development/roadmap.md`, `board.md`, `architecture.md`, `models.md`
and `licensing.md` before implementation. New work must preserve original MIT
source, unmodified full-NOR boot intent and a single native/WASM core.

Work on one evidence-backed dependency at a time. Reproduce locally, minimize
the failing instruction/register/packet case, cite its specification and
validate before pushing. Do not use remote CI as an open-ended debugger.
Never fix an unsupported register by returning a convenient zero or installing
a different model's ROM. Missing hardware remains explicit.

Use bounded APIs, unsigned arithmetic for guest overflow, exact array/bus
bounds, coherent reset state and deterministic virtual events. No host file,
socket, UI or wall-clock dependency belongs in the CPU. Optional connectivity
must not add unconditional host-network access.

Before review, compile with warnings as errors, run native sanitizers and
independent instruction/peripheral regressions, build WASM, compare identical
workloads, inspect real browser behavior where changed, and build Zensical
strictly. Record commands, toolchain, fixture hashes, revision and limitations.
The initial handoff's exploratory harness is not a maintained repository CI
suite; establishing that suite is an explicit M0/M1 task.

Update the README status, roadmap and live board together. Mark a model booted
only with its own cold-boot and interactive-state witness. Test payload success,
return control flow and responsive visible stock UI are separate claims.

Do not commit ROMs, bootloaders, personal dumps, generated screenshots, test
reports, build directories or distribution archives as ordinary source. Keep
fixture provenance and regression definitions distinct from firmware bytes.
Deployment archives contain production files only. Reference emulator code
must not be copied, translated or relicensed into the core.
