# Orchard roadmap

The [development board](board.md) owns immediate work and [issue #1](https://github.com/zyf722/orchard-emu/issues/1)
records accepted commits and CI/Pages outcomes. This document owns milestones,
dependency order and completion criteria. A profile, passing build or exhausted
run budget never substitutes for a hardware/stock-boot witness.

## Project target

Boot unmodified complete physical NORs on HP39g+, HP39gs, HP40gs, HP48gII USB
revision, HP49g+ and HP50g. Run the guest ARM Saturn interpreter and native ARM
applications, using one original MIT C17 machine core for native and browser
hosts. Provide useful virtual PC connectivity without requiring a ROM patch,
replacement bootloader, custom OS or host-side Saturn interception.

External emulators are research or optional out-of-process comparison tools,
not implementation dependencies in the original core. Firmware storage and
publication remain separate from source, Pages and production packages.

## M0 — Repository, contracts and evidence discipline

**Engineering baseline complete**, originally accepted on `ecc0470` in
[Build #2](https://github.com/zyf722/orchard-emu/actions/runs/36981413547).

The baseline includes native/WASM builds, bounded diagnostics, exact-size NOR
loading, six candidate profiles, original-source licensing, maintained CTest
and generated-guest regressions, Zensical documentation and the live board.
Pages deployment and revision verification exist. New revisions require their
own observed checks; the original green build is not evidence for new code.

**Gate:** a fresh checkout builds, maintained tests run, the documentation
strictly renders, production outputs exclude test/firmware assets, and source,
roadmap, board and evidence agree. CPU conformance and stock boot are not M0.

## M1 — ARM920T functional CPU correctness

**Initial implementation; conformance gate open.**

A first [independent Unicorn comparison](cpu-oracle.md) now passes a bounded
common-ARMv4T corpus on native and test-WASM. It does not test complete ARM920T
privileged/MMU/cache behavior or close this milestone. Unicorn remains a
separate developer dependency, not a production interpreter replacement.

M1.1 covers decode restrictions, PC pipeline semantics, shifting/carry/overflow,
ARM/Thumb transitions, banked registers, privilege rules and exception returns.
M1.2 covers CP15, FCSE, table walks, AP/S/R/domain permissions, aborts and vector
relocation. M1.3 covers precise partial transfer/writeback, legal undefined
instructions versus unimplemented operations, and cache/TLB/lockdown behavior.

**Gate:** independently derived edge cases and bounded instruction differentials
pass on the native and WASM core. Failures reduce to explicit input/state
witnesses. Sanitizers pass; unsupported or implementation-defined cases are
identified rather than silently normalized to another CPU model. Comparing two
builds of Orchard is regression evidence, not an independent CPU oracle.

## M2 — Boot-relevant SoC and board model

**In progress, driven by genuine NOR traces.**

Implemented functional pieces include internal/external SRAM, GPIO latches,
explicit strong/weak pad conditions, opt-in passive keyboard circuits and
unfiltered EINT, two-level IRQ arbitration, RTC/timers/watchdog, LCD scan/frame
interrupts, normal ADC with explicit samples, and USB PIO/packet transactions.
Explicit SST39VF1601 selection supports array/software-ID behavior, not erase
or programming. Register storage alone is not full peripheral support.

Open work includes physical clock/reset domains, verified component identities
and pad bias, populated per-model keys, LCD panel/annunciator mapping, flash
command/write behavior, DMA, SD, power management and other traced peripherals.
Watchdog reset propagation, digital input filters and unsupported modes remain
explicit. Resolve dependencies from bounded traces with primary references and
minimal regressions, not convenient zero returns or interpreter model hacks.

**Gate:** one model's cold-boot dependencies work with independently supported
register/pin behavior and unmodified firmware, without unverified readback
policies. The LCD `+0x68` idle-zero experiment does not close this gate.

## M3 — First genuine stock cold boot

**Conditional HP48gII HOME and basic arithmetic observed; canonical gate open.**

Original HP39g+ and HP48gII full dumps execute from reset. The local continuation
based on `e236fcc` now takes HP48gII through memory recovery/clear and HOME,
then computes `1+2=3` and `7*8=56` with actual physical switch input. It uses
selected x16 NOR bus adaptation, an explicit SRAM bank1-mirror hypothesis,
declared pad/ADC inputs, counted LCD idle-zero reads and packed-memory display.
This is functional stock OS execution, not a canonical physical-board result.
See [the startup witness](startup.md); native payload/return and sustained use
are still separate, uncompleted checks. No other model inherits this result.

Record four separate witnesses: bootloader progression, initialized LCD,
interactive stock UI, and native ARM payload execution followed by return to a
responsive stock UI. A guest PASS word, recovery menu or nonblank buffer is
insufficient. Boot-only backing with erased OS sectors is not a full NOR.

**Gate:** one model-correct hash-pinned full dump cold-boots without mutation or
unverified hardware shortcuts, accepts physical press/release, survives reset
and sustained use/idle, runs an ARM payload and returns correctly. Virtual
checkpoints are compared independently of host timing.

## M4 — All six model/revision gates

**Profiles exist; all six stock acceptance gates remain open.**

Promote each model separately using its own bootloader and immutable full-NOR
manifest. Check physical memory bounds, model identity, keys, LCD body and
annunciators, reset behavior and ARM entry/return. The 48gII target is the USB
revision, not every calculator sold under that name.

**Gate:** six independent cold-boot, interaction and ARM-return witnesses.
An updater combined with different boot code cannot close a full-dump gate.
The user's later HP39gs/HP49g+ full dumps are deferred inputs, not a reason to
stop work on the available machines or repeat the acquisition request.

## M5 — Usable browser calculator

**Experimental HP48gII controls implemented; full browser usability gate open.**

The [page](web.md) exposes an opt-in HOME setup, physical tap queue, cold reset
and diagnostics. Node Worker tests are not HTTP/file-picker/browser lifecycle
E2E; that gate remains open.

Add correctly licensed skins, printed-key mappings over physical switches,
separate annunciators, calibrated LCD output, versioned persistence/export and
performance controls. Preserve single-Worker ownership, bounded slices,
cancellation and model/ROM generation isolation.

**Gate:** production assets pass real browser load/boot/key/resize/reset/
save-restore/ROM-change and sustained-interaction E2E. No stale state, UI-thread
instruction loop or ROM upload. Node WASM tests do not certify page behavior.

## M6 — Virtual PC connectivity

**Functional UART and USB PIO packet host exist; stock transfer gates open.**

M6.1 covers UART bytes, bounded queues, cancellation/replay/disconnect and an
optional native PTY/TCP adapter. M6.2 covers USB reset, EP0 control requests,
indexed CSR/FIFO ownership, guest descriptors, interrupts and SOF. M6.3 adds
internal host transactions and real firmware protocols, keeping typed HP39
files distinct from HP48/49/50 objects. M6.4 is an optional host-OS bridge with
its own driver, enumeration, legacy software, disconnect and security gates.

The original HP50g boot region supplies device/configuration/string responses
and completes SET_ADDRESS/SET_CONFIGURATION status. GET_CONFIGURATION remains
an explicit NAK counterexample. Synthetic 64-byte bulk tests and the retained
control guest pass; neither is stock object transfer or firmware installation.
See [USB](usb.md) and [virtual links](virtual-link.md).

**Gate:** actual stock firmware completes both transfer directions, hashes
match, failures/cancellation/disconnect recover, and the stock UI remains
responsive. Internal packet exchange is not OS-level device enumeration.

## M7 — Stability and releases

**Release gate open.**

Close long-run correctness, deterministic snapshots, resource budgets,
Windows/Linux/macOS packaging, browser compatibility, reproducible dependencies,
license audits, contributor/release workflows and known-issue documentation.
Optimize only after correctness witnesses exist; a JIT is optional and must
preserve the same architectural state contract.

**Gate:** reproducible production packages, sustained all-model use, a precise
compatibility matrix and no firmware or unqualified optional-device claims.

## Working order and research boundaries

Prioritize validation of the conditional HP48gII startup: independent SRAM
address-wiring/LCD evidence, real-OS operation coverage and ARM payload return.
Maintain local cold replay before CI. The HP39g+ NOR component and unresolved
EP0 response remain separate dependencies; full USB/SD work and skin polish
must not displace a reliable, correctly presented first calculator.

Historical checkpoints, commands and negative controls are linked by exact
revision from [boot research](boot-research.md); current local acceptance is in
[validation](validation.md). Explicit weak bias, ideal ADC codes, functional
clocks, packed-memory views and the counted idle-zero hypothesis are separate
conditions, never silently promoted to verified board defaults.
