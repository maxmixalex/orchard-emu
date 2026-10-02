# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) is the live concise
board, including current commit/CI acceptance. [Roadmap](roadmap.md) owns gates;
[validation](validation.md), [boot research](boot-research.md) and
[native ROM research](native-roms.md) own evidence and provenance.

## Current implemented research slice

- [x] Preserve the original MIT history and M0 native/WASM engineering baseline.
- [x] Keep the strict Zensical documentation on GitHub Pages; add native-input inventory and exact deployed-revision checking.
- [x] Recover and hash-pin distinct HP49g+/50g original 16 KiB boot regions; keep them separate from full NORs and official OS updaters.
- [x] Locate the HP39gs original boot-region contribution; explicitly record that its attachment is not yet obtained.
- [x] Exclude the byte-identical HP39gs updater labeled `raw` and the 2 MiB Emu48+ image as full-NOR candidates.
- [x] Add opt-in external GPIO stimuli to the shared core, CLI and WASM; unknown inputs still stop by default and cold reset releases stimuli.
- [x] Validate 2,048 GPDDAT combinations over a bounded real-HP48gII execution window; record low/high cold-run progression separately.
- [x] Extend maintained ROM-free tests and input tooling; keep native-boot construction and conditional evidence explicit in probe reports.
- [x] Record the HP50g recovery-buffer bit-order counterexample without disguising a forensic reinterpretation as verified rendering.

## Now / next

- [ ] Resolve HP39g+ LCD offset `0x68` from independent behavioral evidence.
- [ ] Establish physical GPG input/keyboard wiring and LCD panel mapping; GPIO sensitivity is not measured board idle state.
- [ ] Obtain the located original HP39gs attachment and a verified HP40gs native boot region/full NOR; continue full-dump research for 49g+/50g.
- [ ] M1: independent CPU comparison, undefined exceptions and precise abort/writeback semantics.
- [ ] M3: first responsive stock cold boot. Neither a recovery buffer nor a conditional run closes this gate.

Default strict full-NOR stops remain unchanged. Explicit HP48gII D inputs
advance to GPGDAT; native 49g+ boot-only input reaches a USB-controller write,
and native 50g boot-only input reaches GPGDAT with recovery-buffer pixels.
The boot-only files have no OS, and all reports still say `boot_verified=false`.
No unknown LCD read was replaced with zero. No board idle levels were invented.

Run locally before pushing. Ordinary CI has no firmware dependency; production
packages exclude tests. Keep all-six-model usability, browser E2E, stock ARM
return and virtual PC connectivity as separate gates.
