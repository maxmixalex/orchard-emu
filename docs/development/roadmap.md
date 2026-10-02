# Orchard roadmap

The [development board](board.md) owns immediate work. This document owns
milestones, dependency order and completion criteria. No milestone is closed
merely because an interface, profile or passing build exists.

## Project target

> Boot unmodified, complete physical NOR images on six modeled HP Apples
> machines; run stock calculator software and native ARM applications;
> expose the same machine through a responsive browser and useful virtual PC links.

The core remains original MIT code. External emulators are research and
optional out-of-process comparison tools, not redistributed implementation.
No mandatory ROM patch, custom OS, generic replacement bootloader or Saturn
interception is allowed in the canonical stock boot gate.

## M0 — Repository, contracts and evidence discipline

**Complete for the engineering baseline** on `ecc0470` in
[Build #2](https://github.com/zyf722/orchard-emu/actions/runs/36981413547). CPU conformance and stock boot remain open.

- [x] Original C17 core, native CLI and freestanding WASM build.
- [x] Exact-size full-NOR loader; original firmware excluded from deliverables.
- [x] Candidate six-model configuration, explicit stop states and bounded runs.
- [x] Architecture, source-independence policy, roadmap, board and Zensical config.
- [x] Publish the source preserving the existing LICENSE ancestry and retain live [issue #1](https://github.com/zyf722/orchard-emu/issues/1).
- [x] Render Zensical with `--strict` and obtain verified production web and documentation artifacts (Build #2).
- [x] Establish checked-in CTest/native/WASM regressions and a generated six-profile integration guest, separate from deployment artifacts.

**Gate:** fresh checkout builds natively and for WASM, documentation renders,
status claims point to durable evidence, and repository/board/implementation
agree. Build #2 exercised native Release/CTest, ASan/UBSan, static analysis,
WASM regression/integration and strict Zensical rendering. See
[validation](validation.md) for the accepted revision and limits.

## M1 — ARM920T functional CPU correctness

**Initial implementation; not conformance-closed.**

M1.1 covers instruction decode, PC pipeline semantics, shifter/carry/overflow,
ARM/Thumb transitions, banked state, user restrictions and exception returns.
M1.2 covers CP15, FCSE, all supported table levels, AP/S/R/domain semantics,
prefetch/data aborts and exception-vector relocation. M1.3 closes abort
writeback/partial-transfer details and separates legal undefined opcodes from
unimplemented implementation-defined operations.

**Gate:** reference-derived edge cases, randomized arithmetic and isolated
instruction differentials pass on native and WASM builds. Failures minimize
to an instruction/initial-state witness. Sanitizers pass, and unsupported
cases are enumerated rather than accidentally accepted. Current synthetic
checks are useful evidence, not this complete gate.

## M2 — Boot-relevant SoC and board model

**In progress, driven by genuine full-NOR traces.** Internal boot SRAM, GPIO
reset/latch state, two-level IRQ arbitration and a functional RTC now join
the watchdog/timer/UART subset. Both admitted ROMs pass the original reset
status stop. See [boot research](boot-research.md).

Watchdog reset propagation is still an explicit diagnostic stop, not an
implemented reset domain. See [validation](validation.md).

Implement and validate in boot-trace order: NOR command/ID/status state
machines; reset straps and SRAM bank decode; clocks; interrupt arbitration;
timers/RTC/watchdog; GPIO and physical-key matrix; LCD DMA/panel layout;
then the remaining peripherals actually exercised by firmware.

A register retaining its last written value is not full peripheral support.
Use bounded events in a virtual clock domain and explicit peripheral reset
state. Unknown accesses stop and enter a trace inventory. DMA, USB, SD, ADC,
I2C and power management are not silently treated as present.

**Gate:** independently specified register tests and boot traces cover the
first selected machine's cold-boot dependencies without placeholder readbacks,
firmware patches or instruction-interpreter model hacks.

## M3 — First genuine stock cold boot

**Genuine full-NOR execution established for HP39g+ and HP48gII; interactive
stock cold boot is still open.**

The two verified inputs execute 514,293 and 94,497 instructions, respectively,
without guest exceptions before explicit hardware stops. Native and WASM
state/replay agree. HP39g+ enables its own MMU and reaches LCD initialization;
HP48gII reaches copied SRAM startup code. Both displays remain blank.
The full NORs are available locally; update packages for the other models do
not replace missing native boot areas. See [ROM provenance](roms.md).

Record four separate witnesses: reset/bootloader progression; initialized LCD;
interactive stock UI; native ARM payload execution and return to a responsive
stock UI. Neither a nonblank screen nor a guest PASS word closes all four.

**Gate:** a hash-pinned, model-correct full NOR cold-boots without mutation,
accepts physical key transitions, survives reset and repeated idle/use runs,
executes a small ARM payload, and returns correctly. Compare deterministic
trace checkpoints and actual observable behavior, not identical host timing.

## M4 — All six model/revision gates

**Profiles exist; all six stock gates are open.**

Promote HP39g+, HP39gs, HP40gs, HP48gII USB revision, HP49g+ and HP50g
individually. Verify real memory bounds, model identity, bootloader, keys,
LCD body/annunciators, reset behavior and native-code entry/return.

**Gate:** six independent fixture manifests and six cold-boot/interaction/
ARM-return witnesses. An updater paired with a replacement bootloader must
remain a separate noncanonical experiment and cannot close full-dump boot.

## M5 — Usable browser calculator

**Diagnostic workbench exists; usable calculator is open.**

Add correctly licensed skins, a physical-key input layer, distinct annunciator
layout, calibrated LCD presentation, state persistence/versioning and export,
and performance controls. Preserve a single Worker state owner, bounded run
slices, cancellation and model/ROM generation isolation.

**Gate:** real production assets pass browser E2E on all six models: load,
boot, keys, resize, sustained interaction, reset, save/restore and ROM change.
No shared-state race, main-thread instruction loop, stale frame or ROM upload.
Native/WASM state equivalence remains a separate gate from page usability.

## M6 — Virtual PC connectivity

**Functional UART0 host queues exist; stock transfers and USB are open.**

- M6.1: tested bidirectional UART host stream, bounded queues, cancellation,
  disconnect and replay; optional native PTY/TCP adapter.
- M6.2: S3C2410 USB device controller: reset, EP0 control requests, guest
  descriptors, indexed endpoint CSR/FIFO behavior, interrupts and SOF.
- M6.3: in-process virtual USB host and actual firmware transfer protocols;
  typed HP39 files and HP48/49/50 objects remain distinct above transport.
- M6.4: optional native host-OS bridge for existing PC software, with separate
  enumeration, driver, protocol, disconnect and security acceptance.

**Gate:** stock firmware completes real bidirectional transfers on each enabled
model, hashes match, partial/disconnected transfers recover and the stock UI
remains usable. Internal virtual USB is not host-OS USB enumeration. See
[virtual connectivity](virtual-link.md).

## M7 — Stability and releases

Close long-run correctness, deterministic snapshots, memory/CPU resource
budgets, Windows/Linux/macOS packaging, browser compatibility, dependency and
license auditing, contributor workflows and release notes. Improve performance
only after correctness witnesses exist; a JIT is optional and must share the
same architectural state contract.

**Gate:** reproducible builds, sustained all-model interaction, documented
compatibility matrix and known issues, no firmware in distribution, and no
unqualified support claims for optional or missing devices.

## Working order

M0 and initial Pages deployment are accepted. Use M1 edge cases and the two
genuine full-NOR traces to drive M2/M3, starting with LCD offset 0x68 and
model-correct GPIO input sources. Keep all six profiles present but avoid
six parallel speculative peripheral implementations. M5 presentation polish
and M6 host-OS bridging must not displace the first stock boot gate.

## Native-region / external-input research follow-up

Matching HP49g+ and HP50g native boot regions are acquired and exercised with
explicitly erased OS sectors. The HP39gs original boot-region contribution is
located but its attachment is not recovered; HP40gs remains an acquisition gap.
A file named `raw` and the 2 MiB Emu48+ archive were independently excluded as
native dumps. See [native ROM research](native-roms.md).

M2 now includes explicit GPIO input-level injection and an exhaustive bounded
HP48gII GPDDAT sensitivity experiment. Conditional startup reaches GPGDAT after
LCD setup and firmware checking; this does not establish the keyboard matrix
or close M3. The strict no-stimulus stops remain recorded separately. The
HP50g recovery buffer exposes a panel bit-order counterexample, so nonblank
pixels alone remain insufficient for display acceptance. CPU conformance,
LCD status/FIFO semantics and all six stock-UI gates are still open.
