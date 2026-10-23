# Development board

The current [repository](https://github.com/maxmixalex/orchard-emu) and
[Actions runs](https://github.com/maxmixalex/orchard-emu/actions) identify accepted
source and publication results. Earlier issue/run links in historical notes
refer to the former repository owner. [Roadmap](roadmap.md) defines gates;
[validation](validation.md) and [performance](performance.md) record local evidence.

## Current implementation

- [x] Three unchanged original NORs reach conditional HOME and basic arithmetic.
- [x] User/debug frontends; seven separately licensed skins and guest segments.
- [x] Scheduler/CPU/memory optimizations with retained reference paths.
- [x] Portable manual sessions, with .ord names and legacy .orchard import.
- [x] Settings: exclusive immersive/traditional view, viewport/scale, editable physical key sequences, independent blur/hidden policies.
- [x] Normal wall-time pacing distinct from raw execution throughput; explicit faster modes.
- [x] Opt-in bounded localStorage autosave, modal restore/confirm and quota/conflict handling.
- [x] User UART stream and bounded USB host; original bootloader descriptors observed.
- [x] Bounded HP48gII USB and serial upload, GET, Receive, directory and FINISH; stock object bytes agree. Both active SEND and connection reuse have production-browser evidence.
- [x] Complete-batch preflight and sequential multi-file upload on both transports; two-object stock browser round trips, per-file results and lifecycle cancellation.
- [x] Exact adjacent/disjoint ARM operand-pair diagnostics with GPR/NZCV dependencies; three HP39g+ scene checkpoints remain identical. Production CPU execution is unchanged.
- [x] Implemented and measured quiet-loop and cold-rollback candidates; withdrew both after Chrome gates failed, retaining the 48,561-check scheduler regression and all timing evidence.
- [x] HP39/40 Disk drive host, typed-file and alias-preserving catalog validation; original HP39g+ USB installs aplet/library and exports both. Target 39gs/40gs stock witnesses remain open.
- [x] Direct HP39 ZIP import and standard ZIP download, bounded decompression/CRC checks, and reconstruction of the catalog entry omitted by stock SEND.
- [x] HP49g+ full capture admission, empty-slot SDI, exact 512 KiB SRAM, 131×80 UI, arithmetic, CAS, graphing, menus, sessions and USB object workflows.
- [x] HP49g+ SDK native ARM example installed over stock USB, run through ARMToolbox, returned to HOME and followed by arithmetic and USB reconnect.
- [x] Checkpoint v2 SDI serialization and exact v1 migration on all six model capacities.
- [x] Complete HP39gs ROMstream package: proven hpclang bytes, one-launch double-read receiver, corresponding source and reproducible ZIP. Original HP39g+ OS installs/runs/returns with a complete equal 1 MiB capture.
- [x] IR/IrDA assessment with primary sources, not a claimed implementation.
- [x] Byte-table checkpoint CRC with unchanged format/full validation; independent checks on all six model capacities.
- [x] Production Pacer + WASM RTC comparison across rates and host partitions.
- [x] Explicit optimized sanitizer targets; all sixteen native/reference/sanitizer suites pass locally.
- [x] Checked WASM physical reads and bounded caught-up Worker pacing, with same-input comparisons.
- [x] Actual Chrome Window/Worker smoke coverage plus original-ROM file/restore/keyboard/result observation.

## Next

- [ ] Physical PLL/PCLK/RTC domain calibration and cursor period; Normal uses the existing functional reference only.
- [ ] Identify the browser dispatch cost before another MOV-pair or ADD-to-CMP candidate; the r18 quiet-loop/cold-function experiments are withdrawn, not pending admission. Preserve precise faults, interrupts and self-modifying code.
- [ ] Broader browser focus/touch/download/storage/zoom E2E and sustained interaction; preserve and classify the observed rare HP48 Unlimited post-result stop.
- [ ] Broader original-OS keypad/Alpha-state coverage, power management and sustained native applications; HP49g+ warm-start and one native ARM return are now witnessed.
- [ ] Target HP39gs/HP40gs stock acceptance, remote file management and broader stock capacity/recovery cases; preserve the original HP50g GET_CONFIGURATION counterexample, then implement applicable infrared links.
- [x] Receive the HP49g+ full A/B capture and independently validate original-byte boot and user workflows; retain the original acquisition sidecar unchanged.
- [ ] Receive the HP39gs full image using the complete ROMstream package; no preliminary return/short-read task is required.
- [ ] Independently establish SRAM/LCD/NOR/pad/analog assumptions; implement HP49 infrared/UART2 and SD storage with their own evidence.


Do not infer all-model or canonical physical-board support from skins, arithmetic,
packet enumeration, synthetic tests or public asset availability. M0 remains
accepted; the complete M1–M7 gates remain governed by their own witnesses.

## Publication boundary

Build, Pages deployment and the published revision are separate checks for each
accepted source commit. Earlier Build #21 on c3e8a36 timed out in two O0
sanitizer tests; its local O1/checksum follow-up remains in [validation](validation.md).
Use current-repository Actions and the site's revision manifest for the latest
release result. Do not treat a source push as deployment.


## React / connection continuation

- [x] Separate React/Mantine user frontend with English/Chinese i18n and PC keyboard editor.
- [x] Printed modifier/Alpha legends; native/4x matrix PNG capture.
- [x] Keep per-frame pixels outside React subscriptions; avoid unchanged canvas uploads.
- [x] Reuse live LCD image/palette buffers and defer traditional keypad construction until requested; keep captures independent.
- [x] Add bounded standalone loopback USB/IP/raw serial and generated-guest TCP tests.
- [x] Preserve extra single-transfer reference tests, reject unproductive CPU optimization prototypes.
- [ ] Observe the accepted revision's Build/Pages and downloaded-package results in the current repository.
- [ ] Broader browser E2E, kernel attachment/Conn3x transfer and physical clock calibration remain open.
