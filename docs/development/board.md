# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) records the exact
accepted revision, Build/Pages runs and post-publication verification.
[Roadmap](roadmap.md) defines gates; [validation](validation.md) records local evidence.

## Current implementation

- [x] Two unchanged original NORs reach conditional HOME and basic arithmetic.
- [x] User/debug frontends; seven separately licensed skins and guest segments.
- [x] Scheduler/CPU/memory optimizations with retained reference paths.
- [x] Portable manual sessions, with .ord names and legacy .orchard import.
- [x] Settings: exclusive immersive/traditional view, viewport/scale, editable physical key sequences, independent blur/hidden policies.
- [x] Normal wall-time pacing distinct from raw execution throughput; explicit faster modes.
- [x] Opt-in bounded localStorage autosave, modal restore/confirm and quota/conflict handling.
- [x] User UART stream and bounded USB host; original bootloader descriptors observed, stock file protocols still open.
- [x] IR/IrDA assessment with primary sources, not a claimed implementation.

## Next

- [ ] Physical PLL/PCLK/RTC domain calibration and cursor period; Normal uses the existing functional reference only.
- [ ] Reprofile decoded instruction/block execution without losing precise exceptions or self-modifying code.
- [ ] Actual browser-origin focus/touch/file/download/storage/zoom E2E and sustained interaction. Current local navigation is policy-blocked.
- [ ] Broader original-OS keypad/Alpha-state coverage, warm reset, power management and native ARM payload return.
- [ ] Stock USB/serial file/object protocols, preserving the original HP50g GET_CONFIGURATION counterexample; then infrared link between applicable boards.
- [ ] Independently establish SRAM/LCD/NOR/pad/analog assumptions. Integrate later HP39gs/HP49g+ dumps when supplied, without repeated acquisition requests.

Do not infer all-model or canonical physical-board support from skins, arithmetic,
packet enumeration, synthetic tests or public asset availability. M0 remains
accepted; the complete M1–M7 gates remain governed by their own witnesses.
