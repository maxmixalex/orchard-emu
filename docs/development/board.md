# Development board

The current [repository](https://github.com/maxmixalex/orchard-emu) and
[Actions runs](https://github.com/maxmixalex/orchard-emu/actions) identify accepted
source and publication results. Earlier issue/run links in historical notes
refer to the former repository owner. [Roadmap](roadmap.md) defines gates;
[validation](validation.md) and [performance](performance.md) record local evidence.

## Current implementation

- [x] Two unchanged original NORs reach conditional HOME and basic arithmetic.
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
- [x] HP39 typed-file and applet-bundle validation, with opaque payload and hardware-upload limits explicit.
- [x] IR/IrDA assessment with primary sources, not a claimed implementation.
- [x] Byte-table checkpoint CRC with unchanged format/full validation; independent checks on all six model capacities.
- [x] Production Pacer + WASM RTC comparison across rates and host partitions.
- [x] Explicit optimized sanitizer targets; all fifteen native/reference/sanitizer suites pass locally.
- [x] Checked WASM physical reads and bounded caught-up Worker pacing, with same-input comparisons.
- [x] Actual Chrome Window/Worker smoke coverage plus original-ROM file/restore/keyboard/result observation.

## Next

- [ ] Physical PLL/PCLK/RTC domain calibration and cursor period; Normal uses the existing functional reference only.
- [ ] Evaluate specific independent MOV pairs and ADD-to-CMP forwarding from the operand profile without losing precise exceptions, interrupts or self-modifying code; require measured gains before enabling.
- [ ] Broader browser focus/touch/download/storage/zoom E2E and sustained interaction; preserve and classify the observed rare HP48 Unlimited post-result stop.
- [ ] Broader original-OS keypad/Alpha-state coverage, warm reset, power management and native ARM payload return.
- [ ] HP39 applet upload, calculator-initiated multi-file SEND, remote file management and broader stock capacity/recovery cases; preserve the original HP50g GET_CONFIGURATION counterexample, then implement applicable infrared links.
- [x] Provide an original staged HP49g+ read package, strict A/B assembler and known-boot model-mismatch rejection; physical address mapping and hardware capture remain unverified.
- [x] Provide the HP39gs ARM return aplet and a source-rebuilt 39-specific launcher with its complete corresponding source and license; hardware execution remains unverified.
- [ ] Independently establish SRAM/LCD/NOR/pad/analog assumptions. Validate the HP49g+ short probes and stock mapping, then integrate a complete capture; validate the HP39gs return probe before implementing its bounded reader.

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
