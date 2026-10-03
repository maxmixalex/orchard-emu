# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) owns the accepted
revision and observed Build/Pages outcomes. [Validation](validation.md) records
local checks, and [startup memory](startup-memory.md) owns the latest boot
investigation. Historical USB/CPU results remain in their respective pages.

## Current implemented slice (base `e236fcc`)

- [x] Adapt aligned CPU word writes to two ordered halfword cycles for an explicitly selected SST39VF1601; preserve SDP decoding and exact physical bounds.
- [x] Reject unknown-part/unsupported accesses and recognized unimplemented flash commands; do not mutate NOR or enlarge/mirror SRAM.
- [x] Minimize the original zero-fill request; it is literal guest initialization, not a demonstrated allocation failure.
- [x] Original HP48gII OS draws its memory-recovery prompt with explicit pad/ADC/LCD conditions; NO advances to a precisely located SRAM-boundary abort.
- [x] Add ROM-free bus-state and executing-NOR store regressions on native/test-WASM and production WASM; bound longer local probe budgets.

## Next

- [ ] Establish actual SRAM address decode / boundary behavior and the preceding guest state at `LDR r0,[r0,#8]`, PC `1ce24`, FAR `08040000`.
- [ ] Reach the normal calculator screen, verify input and sustained operation; an early prompt or completed budget does not close M3.
- [ ] Establish the HP39g+ NOR part/bus separately; do not assign the 2 MiB chip to its 1 MiB image.
- [ ] Independently resolve LCD `+0x68`, panel wiring, clocks and measured pad/analog defaults.
- [ ] Preserve the original HP50g GET_CONFIGURATION counterexample; expand stock protocol evidence separately from synthetic bulk tests.
- [ ] Integrate the user's later HP39gs/HP49g+ full NORs when supplied, without requesting them now.

M0 remains accepted. The existing independent Unicorn common-ISA differential
remains active, but full M1 privileged/cache/MMU and M2/M3 physical-board gates
are open. Ordinary CI and production packages contain no firmware or private
reports; the current framebuffer image is private research evidence, not a
published site asset. No reference emulator implementation is imported.
