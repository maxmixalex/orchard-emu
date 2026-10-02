# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) owns the exact accepted
commit and remote outcomes. [Roadmap](roadmap.md) owns gates; [validation](validation.md),
[boot research](boot-research.md) and [LCD evidence](lcd.md) own reproducible evidence.

## Implemented in the current slice

- [x] Separate weak external bias from strong drives, with unresolved/conflicting nets preserved.
- [x] Schedule bounded raw matrix events at exact virtual ticks on the native CLI; compare the same events on production WASM and cold replay.
- [x] Real HP50g boot-only press/release selects distinct USB/card initialization paths without the former artificial strong-drive short.
- [x] Fix word-relative LCD lane addressing and nonlinear 2-bpp BLUELUT; keep packed-memory inspection distinct from raw controller output.
- [x] Add explicit, counted, disabled-video-only LCD `+0x68` idle-zero research mode. Strict defaults remain unchanged; register semantics are not declared solved.
- [x] Identify later conditioned HP39g+ LCDSRCPND and HP48gII ADC dependencies without modifying their NORs.
- [x] Maintain ROM-free tests, production-artifact separation and strict Pages deployment.

## Now / next

- [ ] Model documented LCD pending/mask/scan behavior and ADC from vendor specifications and local regression cases.
- [ ] Obtain stronger independent evidence for LCD `+0x68` and physical panel bit mapping; do not promote the research option into an implicit default.
- [ ] Establish physical pad bias and populated per-model key maps beyond conditioned recovery-menu experiments.
- [ ] Integrate the user's own HP39gs and HP49g+ full NOR dumps when supplied later. They are not a blocker for current work; do not request a new dump now.
- [ ] Continue HP40gs/HP50g complete-input work when useful, preserving the updater/boot-region/full-dump distinction.
- [ ] M1 conformance and M3 responsive stock boot remain open. Successful conditional or boot-only execution closes neither gate.
