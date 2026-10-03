# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) owns the accepted commit,
Build/Pages run IDs and online checks. [Roadmap](roadmap.md) defines acceptance;
[performance](performance.md) records measured speed, not a hardware speed claim.

## Current work

- [x] User calculator and independent developer workbench; supported-ROM configuration is automatic only on the user page.
- [x] Preserve the 2042ad8 GPIO/EINT and build optimizations; incoming Build #17 / Pages #14 were successful.
- [x] Exact-width memory reads, conservative no-checkpoint ARM dispatch and live-descriptor host translation memo.
- [x] Retained full-checkpoint/walker/reference paths, mutation checks and independent CPU subset comparison.
- [x] Local native/WASM original HP39g+ and HP48gII cold HOME + two-calculation replay; identical-work comparison against 2042ad8.
- [ ] Observe this revision's Build, strict documentation, Pages and downloaded production binary. Exact accepted IDs belong in issue #1.

## Next

- [x] Profile 980e1ec, implement bounded next-event phase accounting with MMIO/run-boundary synchronization and per-tick reference tests.
- [x] Portable Save/Load session: both original systems continue after restoration; native/WASM complete state agrees.
- [ ] Reprofile CPU decode/dispatch next; no decoded-block engine or JIT is included yet.
- [ ] Actual browser file/touch/focus/background/reset E2E; local Chromium origin navigation remains policy-blocked.
- [ ] Broader original-OS keys and sustained use, automatic persistence, warm reset and power management.
- [ ] Independently establish physical SRAM address wiring, LCD mapping/+0x68, NOR identity and pad/ADC/clock conditions.
- [ ] Native ARM payload/return and original-OS USB/file transfers; preserve the HP50g GET_CONFIGURATION counterexample.
- [ ] Integrate later user-provided HP39gs/HP49g+ full dumps; do not request them again or block present work on acquisition.

Both existing full NORs reach HOME and perform basic arithmetic under declared
compatibility conditions. HP39g+ uses exact SRAM; HP48gII uses an explicit
mirror hypothesis. Skins and guest modifier segments exist but do not certify
all six boards or all status signals. M0 is accepted; complete M1/M2/M3/M4/M5
acceptance remains open. Ordinary CI, Pages and production archives contain no
firmware, private traces/screenshots, tests/reports or fonts.
