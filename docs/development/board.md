# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) is the live concise
board. [Roadmap](roadmap.md) owns milestone gates; [validation](validation.md)
and [boot research](boot-research.md) own commands, evidence and diagnosis.

## Accepted / implemented

- [x] M0 engineering baseline, original MIT history and maintained native/WASM tests.
- [x] Strict Zensical site deployed to [GitHub Pages](https://zyf722.github.io/orchard-emu/); repository remains private.
- [x] Verify uploaded HP39g+ full NOR and acquire the original author's pinned HP48gII full NOR; keep update packages distinct.
- [x] Resolve shared GSTATUS2 reset stop and HP39g+ internal-SRAM abort loop.
- [x] GPIO configuration/output latches, two-level interrupt priority and normal-mode functional RTC.
- [x] Correct STN byte/halfword lane order and HP40gs 2 MiB physical NOR capacity.
- [x] Run both real images locally on native/WASM; verify all-register/end-state equivalence and cold replay.

## Now

- [ ] HP39g+: establish semantics of the LCD read at `0x4d000068`.
- [ ] HP48gII: establish physical input sources/idle levels for GPDDAT `0x56000034`.
- [ ] M1: independent CPU conformance, undefined exceptions and precise abort/writeback.
- [ ] M3: first interactive stock cold boot. Current original images reach early hardware stops; both screens remain blank.

## Later

All-six-model stock support, actual browser lifecycle E2E, native stock launch/
return and USB transfers remain distinct gates. Full-native boot areas for
the updater-only models remain separate acquisition work. Do not substitute
another model's bootloader or elevate a green build into a usability claim.

Validate locally before pushing, then observe CI rather than assuming success.
Firmware and generated traces remain outside source, Pages and release assets.
