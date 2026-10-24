# Development board

The current [repository](https://github.com/maxmixalex/orchard-emu) and
[Actions runs](https://github.com/maxmixalex/orchard-emu/actions) identify accepted
source and publication results. Earlier issue/run links in historical notes
refer to the former repository owner. [Roadmap](roadmap.md) defines gates;
[validation](validation.md) and [performance](performance.md) record local evidence.

## Current implementation

- [x] Four unchanged original NORs reach conditional HOME and basic arithmetic, including the user's complete HP39gs capture and its own bootloader.
- [x] User/debug frontends; seven separately licensed skins and guest segments.
- [x] Scheduler/CPU/memory optimizations with retained reference paths.
- [x] Portable manual sessions, with .ord names and legacy .orchard import.
- [x] Settings: immersive, immersive landscape, traditional and traditional landscape view, viewport/scale, editable physical key sequences, independent blur/hidden policies; landscape keeps all six FN keys with the LCD.
- [x] Wider per-model keyboard editor with assigned-key highlights, calculator-side binding badges and target selection; OS-resolved character defaults, layout-map labels and captured-key fallback. See [keyboard settings](keyboard-settings.md).
- [x] Persistent Connections/SD sidebar keeps selections and drafts while the calculator remains usable; narrow layouts stack the panel below it.
- [x] Per-model local ROM recall with read-only original-file handles or labelled browser-local copies, explicit permission continuation and Forget, identity validation and cancellation of stale automatic reads. See [ROM storage](rom-storage.md).
- [x] Firmware-driven GPIO/Timer2 buzzer observation and browser sound with mute/volume/lifecycle cleanup; shared PCLK and buffered PWM correct the original HP49g+ BEEP period, while physical board/speaker calibration remains open.
- [x] Functional shared PCLK for all five PWM timers, watchdog, ADC, SDI and SPI, with fractional phase and peripheral gates; RTC remains independent.
- [x] GPIO pull-ups, bounded disabled NAND configuration, Power_OFF and retained reset-vector ON wakeup; all four original ROMs pass inactivity shutdown, exact off-state restore and continued arithmetic.
- [x] Normal wall-time pacing distinct from raw execution throughput; explicit faster modes.
- [x] Opt-in binary IndexedDB autosave with legacy localStorage migration, transactional writer-token checks, modal restore and quota/conflict handling.
- [x] User UART stream and bounded USB host; original bootloader descriptors observed.
- [x] Bounded HP48gII USB and serial upload, GET, Receive, directory and FINISH; stock object bytes agree. Both active SEND and connection reuse have production-browser evidence.
- [x] Complete-batch preflight and sequential multi-file upload on both transports; two-object stock browser round trips, per-file results and lifecycle cancellation.
- [x] Exact adjacent/disjoint ARM operand-pair diagnostics with GPR/NZCV dependencies; three historical HP39g+ scene checkpoints remain identical. That profiling work did not add a production instruction-fusion path.
- [x] Implemented and measured quiet-loop and cold-rollback candidates; withdrew both after Chrome gates failed, retaining the 48,561-check scheduler regression and all timing evidence.
- [x] HP39/40 Disk drive host, typed-file and alias-preserving catalog validation; original HP39g+ USB installs aplet/library and exports both. The complete HP39gs NOR independently installs the V2 reader; HP40gs remains open.
- [x] Direct HP39 ZIP import and standard ZIP download, bounded decompression/CRC checks, and reconstruction of the catalog entry omitted by stock SEND.
- [x] HP39 direct Wire upload with library-first package ordering, per-object RECV instructions and original-ROM SEND/ZIP verification; visible progress and cancellation recovery guidance.
- [x] ASCII Note packing for Wire with original 39g+/39gs installation, EDIT and exact export/repack checks; bounded receive-ACK recovery, large Note sequence wrap, and translated error metadata through Worker/controller/queue.
- [x] Optional transfer-only Unlimited in Settings → Transfer, content-based selection without extension filters, isolated per-file errors and retry/skip recovery, bounded Init-Info ACK retransmission.
- [x] HP49g+ full capture admission, fixed 512 KiB SRAM with explicit bank-1 mirror, 131×80 UI, arithmetic, CAS, graphing, menus, sessions and USB object workflows.
- [x] HP49g+ FILES recovery and bounded SD image read/write, FAT16 create/import/export/eject and write protection; HP48gII no-card FILES navigation.
- [x] Offline FAT16 file preparation: browse/extract files, create folders, add/rename files and folders, and delete files or empty folders transactionally before insertion; explicit 8.3 names, shared alias/long-name collision checks and no extension filter.
- [x] Recursive local-directory import into 16/32 MiB FAT16 with persistent handles/name mappings/baselines, two-way add/edit/delete/rename previews and conflict resolution, preview revalidation and atomic mounted-card handoff. This is explicit synchronization, not an OS virtual-drive mount. See [directory SD](directory-sd.md).
- [x] HP49g+ SDK native ARM example installed over stock USB, run through ARMToolbox, returned to HOME and followed by arithmetic and USB reconnect.
- [x] Checkpoint v6 retains complete SD/UART/NOR in-flight state, modified flash sectors and existing clock/SPI/reset state; v1–v5 imports remain supported with explicit migration. Successful restore conditionally resumes, and paused state has a prominent direct action.
- [x] Held ON/F4 factory-test entry and ON/F3 exit controls; bounded [SPI](spi.md) register/transfer behavior and [watchdog reset propagation](watchdog-reset.md) retain external SRAM, media and RTC. Factory-test entry does not claim every diagnostic passes.
- [x] Revised HP39gs ROMstream v2: visible progress, repaired mapping/cable/USB exit paths, one-launch double reads and corresponding source; original HP39g+ and original HP39gs full NORs complete dump/return/USB-reuse workflows. Earlier derived-OS evidence remains distinct.
- [x] Three functional UARTs with FIFO/line-format/clock-gate/interrupt/error/loopback behavior; original factory RS232/IRDA tests and same-origin tab infrared object transfer. See [UART/IrDA](uart-irda.md).
- [x] NOR word program, sector/block/chip erase, busy polling and VF1601 suspend; original 39gs/49g+ quick and full FLASH WRITE diagnostics pass.
- [x] Byte-table checkpoint CRC with unchanged format/full validation; independent checks on all six model capacities.
- [x] Production Pacer + WASM RTC comparison across rates and host partitions.
- [x] Explicit optimized sanitizer targets and 23 maintained native/reference/sanitizer suites, including buzzer, Power_OFF, PCLK/PWM, SPI and watchdog reset checks.
- [x] Checked WASM physical reads and bounded caught-up Worker pacing, with same-input comparisons.
- [x] Actual Chrome Window/Worker smoke coverage plus original-ROM file/restore/keyboard/result observation.

## Next

- [ ] Board clock/PLL lock/reset-domain calibration, shared-prescaler startup phase and cursor period; the runtime shared PCLK and Normal pace use an explicit functional reference.
- [ ] Identify the browser dispatch cost before another MOV-pair or ADD-to-CMP candidate; the r18 quiet-loop/cold-function experiments are withdrawn, not pending admission. Preserve precise faults, interrupts and self-modifying code.
- [ ] Broader browser focus/touch/download/storage/zoom E2E and sustained interaction; preserve and classify the observed rare HP48 Unlimited post-result stop.
- [ ] Broader original-OS keypad/Alpha-state coverage, additional power modes and sustained native applications; four-model Power_OFF/ON, HP49g+ warm-start and one native ARM return are now witnessed.
- [ ] Target HP40gs/HP50g stock acceptance, remote file management and broader stock capacity/recovery cases; preserve the original HP50g GET_CONFIGURATION counterexample, expand applicable infrared transfer/recovery coverage.
- [x] Receive the HP49g+ full A/B capture and independently validate original-byte boot and user workflows; retain the original acquisition sidecar unchanged.
- [x] Receive and validate the HP39gs full V2 image; admit its own unchanged boot/OS after native/WASM, browser, continuation and full-reader/return checks. Retain acquisition metadata unchanged.
- [ ] Independently establish SRAM/LCD/NOR/pad/analog assumptions; extend SD DMA/larger media, physical IrDA timing and the remaining NOR modes with their own evidence.


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

Local host-device simulation was retired in r23. The completed USB/IP entries below record r22 research; they are no longer current UI features or future targets.

- [x] Separate React/Mantine user frontend with English/Chinese i18n and PC keyboard editor.
- [x] Printed modifier/Alpha legends; native/4x matrix PNG capture.
- [x] Keep per-frame pixels outside React subscriptions; avoid unchanged canvas uploads.
- [x] Reuse live LCD image/palette buffers and defer traditional keypad construction until requested; keep captures independent.
- [x] Sample pixels/annunciators once per observed completed LCD scan, coalesce Canvas updates and share published images with PNG/recording; preserve genuine blank frames and immediate disabled/invalid states. [LCD evidence](lcd.md#host-presentation-synchronized-to-the-scan-counter) separates original-ROM checkpoint equality from synthetic browser fixtures.
- [x] Add bounded standalone loopback USB/IP/raw serial and generated-guest TCP tests.
- [x] Connect the same live browser Worker to the optional authenticated loopback HTTP/USB-IP helper, with exclusive transfer/card ownership, delayed-handshake cleanup and fresh connection identities. Generated guests pass real Chrome Worker/network tests; original HP48gII/HP49g+ object round trips pass through the bridge modules in Node. See [host mode](host-mode.md) for separate runtime and OS-driver boundaries.
- [x] Original HP49g+ completes SEND/GET/FINISH through the production Chrome page/Worker and a user-space USB/IP peer with all object bytes equal, keeps the connection while another tab has focus and the sidebar is hidden, and returns to arithmetic. Kernel attachment, installed HP drivers and unmodified Conn3x are not covered by this witness.
- [x] Preserve extra single-transfer reference tests, reject unproductive CPU optimization prototypes.
- [ ] Observe the accepted revision's Build/Pages and downloaded-package results in the current repository.
- [ ] Broader browser E2E, infrared recovery and physical clock calibration remain open. Native OS-device/Conn3x work is retired.
