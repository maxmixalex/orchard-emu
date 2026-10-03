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
- [x] Six native/test-WASM C suites, sanitizer suites, tool tests and production Worker regressions.

## Next

- [ ] Actual browser-origin file/key/lifecycle E2E; local Chromium navigation is policy-blocked, not passed.
- [ ] Broader original-OS key coverage, retained state, reset and sustained-use acceptance.
- [ ] Independently establish SRAM address pins, LCD `+0x68`, actual panel and pad/ADC/clock behavior.
- [ ] HP39g+ NOR component path, original HP50g GET_CONFIGURATION and real file/object transfers.
- [ ] Integrate later user-provided HP39gs/HP49g+ full dumps without blocking current work.

M0 remains accepted. Conditional HP48 OS functionality does not close complete
M1 CPU conformance, M2/M3 physical-board acceptance or M4 all-model support.
Neither mapped keys nor Node Worker execution is a real-browser key survey.
Firmware, private traces/screenshots and reports are excluded from source and
production packages. Pages publishes documentation only.
