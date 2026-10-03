# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) records accepted
revisions and observed Build/Pages outcomes. [Roadmap](roadmap.md) defines
milestones; [startup](startup.md) and [web](web.md) define the current scope.

## Implemented and locally checked

- [x] Reconcile the local HOME slice with `6372cbe`; retain its x16 NOR adapter and both regression sets.
- [x] Explicit SRAM bank1-mirror option and counters without increasing RAM; exact decode stays default.
- [x] Original HP48gII HOME, `1+2=3`, `7*8=56`: native and production WASM, two cold runs each.
- [x] Browser setup selector, 51 mapped key positions, bounded physical-tap queue, pause/cold reset, frame view and diagnostic export.
- [x] Execute the unchanged production Worker through Node browser-global adapters; real-NOR taps produce the same calculation frame.
- [x] Seven native/test-WASM C suites, sanitizer suites, tool tests and production Worker regressions.

## Next

- [ ] Actual browser-origin file/key/lifecycle E2E; local Chromium navigation is policy-blocked, not passed.
- [ ] Broader original-OS key coverage, retained state, reset and sustained-use acceptance.
- [ ] Independently establish SRAM address pins, LCD `+0x68`, actual panel and pad/ADC/clock behavior.
- [x] Separate HP39g+ SST39VF800A experimental path reaches HOME and both calculations without SRAM mirroring.
- [ ] Independently confirm the actual component; resolve original HP50g GET_CONFIGURATION and real file/object transfers.
- [ ] Integrate later user-provided HP39gs/HP49g+ full dumps without blocking current work.

M0 remains accepted. Conditional HP48 OS functionality does not close complete
M1 CPU conformance, M2/M3 physical-board acceptance or M4 all-model support.
Neither mapped keys nor Node Worker execution is a real-browser key survey.
Firmware, private traces/screenshots and reports are excluded from source and
production packages. Pages publishes documentation and the emulator under `/emulator/`.

## Current additions from 1001d15

- [x] Seven pinned outlined skins with exact key geometry and separate licenses.
- [x] Guest-packed status segment accessor and modifier transitions on both original systems.
- [x] Model-specific 39g+ HOME setup and UI/Worker full-NOR hash validation.
- [x] Pages assembly preserves documents and adds the same-origin emulator with asset hashes.
- [ ] Deployment acceptance is recorded by exact commit/run in issue #1 after observation.

Independent physical SRAM/LCD/NOR/pad verification is not replaced by functional
arithmetic or a skin. Browser-origin navigation remains policy-blocked locally.


## Publication/lifecycle follow-up

- [x] Replace duplicate Pages compilation with promotion of the exact successful current-main Build artifact.
- [x] Require all production assets, source stamps and hashes; reject forbidden, extra and linked files locally before upload.
- [x] Pause rather than terminate on pagehide; persisted pageshow stays paused. EventTarget dispatch regression passes.
- [ ] Observe the new Build, Pages deployment and HTTPS hash verification; issue #1 owns exact accepted run IDs.

Build #15 was green but Pages #12 failed before publication during an APT proxy
outage. This follow-up does not claim that the failed run deployed anything.

## User interface and speed feedback

- [x] Separate `/emulator/` calculator from `debug.html`; automatic supported-ROM configuration.
- [x] User Worker payload excludes internal counters and CPU state.
- [x] Exact-key EINT memoization, empty-IRQ fast path, native CPU checkpoints and O3/LTO WASM.
- [x] Added differential cache, audience and identical-work benchmark tools.
- [ ] Record new revision, measured workload timings and deployment acceptance in issue #1.

The new UI does not change the supported firmware identities or promote
research assumptions to canonical hardware defaults.
