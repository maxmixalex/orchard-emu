# Orchard roadmap

The [development board](board.md) owns immediate work; the current repository's
[Actions runs](https://github.com/maxmixalex/orchard-emu/actions) record CI/Pages
outcomes for each accepted commit. This document owns milestones,
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
Explicit SST39VF1601 / SST39VF800A selection supports array/software-ID behavior, not erase
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

**Conditional HP48gII and HP39g+ HOME/basic arithmetic observed; canonical gate open.**

Original HP39g+ and HP48gII full dumps execute from reset through their own
startup prompts into HOME, then compute `1+2=3` and `7*8=56` with physical
switch input. HP48gII uses selected SST39VF1601 and an explicit SRAM bank1-mirror
hypothesis; HP39g+ uses a separate 1 MiB SST39VF800A hypothesis and exact SRAM.
Both retain declared pad/ADC inputs, counted LCD idle-zero reads and a
packed-memory display interpretation. This is functional stock OS execution,
not a canonical physical-board result. See [HP48 startup](startup.md) and
[HP39 startup](hp39-startup.md). Native payload/return and sustained use
are separate, uncompleted checks. No other model inherits these results.

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

**Separate calculator/workbench, optimized shared core and skins implemented; browser gate open.**

The [calculator page](web.md) automatically selects the supported ROM configuration
and exposes normal calculator controls. The separate workbench retains both
opt-in HOME setups, seven skins, all model/debug controls and diagnostics.
Physical taps and guest-driven annunciators share the optimized core. Node Worker tests are not HTTP/file-picker/browser
lifecycle E2E; that gate remains open.

Manual versioned session export/import is now implemented and tested across
native/WASM, including continuation of both original systems. Automatic
persistence, migration and actual browser file-operation acceptance remain open.
Next are calibrated LCD output and broader stock-key
coverage and performance controls. Preserve single-Worker ownership, bounded slices,
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
Maintain local cold replay before CI. Independent HP39g+ component identification and unresolved
EP0 response remain separate dependencies; full USB/SD work and skin polish
must not displace a reliable, correctly presented first calculator.

Historical checkpoints, commands and negative controls are linked by exact
revision from [boot research](boot-research.md); current local acceptance is in
[validation](validation.md). Explicit weak bias, ideal ADC codes, functional
clocks, packed-memory views and the counted idle-zero hypothesis are separate
conditions, never silently promoted to verified board defaults.

## Skin / segments / HP39g+ continuation

The separate [HP39g+ D1.55 path](hp39-startup.md) now reaches HOME and both
arithmetic results with an explicit 1 MiB component and **exact** SRAM decode.
This is a second conditional functional witness, not closure of physical-board
M2/M3 or all-model M4. The original dumps are not modified.

M5 now includes seven pinned outlined skins, 51 geometric hit regions per
model, a separate guest-driven status strip, two hash-checked HOME setups,
and an emulator subdirectory in the same Pages site. Actual browser-origin
E2E, automatic persistence and sustained full-key compatibility remain open.

## Performance continuation

[Measured optimization](performance.md) removes repeated keyboard circuit
resolution, empty IRQ arbitration and debugger snapshot churn, with optimized
WASM compilation. The next round adds exact-width reads, conservative
no-checkpoint execution for non-faulting ARM classes, and host translation memo
entries revalidated against live descriptors on every hit. Fallible instructions
retain full rollback; the guest timeline and MMIO effects are unchanged.
This host memo is not a guest TLB model. Bounded next-event phase scheduling is now implemented with a per-tick
reference comparison. Decoded blocks and dynamic
translation remain future work; no hardware speed ratio or complete browser
E2E is claimed.


## Scheduling and session continuation after 980e1ec

M5 gains explicit Save/Load session file operations, without bundling the ROM
or exposing research controls. This is portable machine state, not just a
screenshot or SRAM dump. Original-OS continuation and native/WASM state identity
pass; automatic storage, format migration and actual browser-origin file
interaction remain separate tasks. See [sessions](sessions.md).

The scheduler now defers only phase accounting in intervals that end strictly
before any peripheral event. CPU instructions and interrupt acceptance retain
their original ordering. Every MMIO access and public run boundary synchronizes
state. This optimizes host work, not physical hardware fidelity. Tests and
[measurements](performance.md) compare against the accepted 980e1ec path.

## Settings / pacing / local storage / connection continuation

M5 adds native settings dialogs, mutually exclusive skin/traditional views,
viewport sizing, per-model macro bindings, opt-in localStorage autosave and
`.ord` export naming. Actual browser-origin E2E remains open. The Normal
time governor fixes the missing wall-rate limit; it does not close M2's
physical clock-domain calibration or certify the absolute cursor period.

M6 now exposes UART bytes and guest-derived USB enumeration/individual packets
to users. Full stock object/file transfer and an OS-level device bridge remain
open. [Infrared](infrared.md) is assessed as useful after those protocols and
clock foundations; no IrDA toggle is presented as a completed virtual link.

Continue CPU throughput work independently of pacing. WFI quiet-interval
skipping preserves the reference timeline and has dedicated comparisons; no
decoded-block or JIT implementation is claimed in this slice.


## React and host prototype checkpoint

M5 now includes a React/Mantine bilingual frontend, visual PC key mapping,
traditional legends and PNG capture; actual browser-origin E2E remains open.
Live display buffers are reused and traditional key geometry is constructed on
first use. These remove repeated allocation and hidden-view layout work, without
establishing an end-to-end arithmetic or Aplet latency improvement.
M6 includes a standalone loopback USB/IP/raw serial prototype validated with
generated ARM guests and real TCP, not OS-level or Conn3x acceptance.
Next gates: kernel client attach, stock transfer-mode enumeration and full
bidirectional Conn3x/object exchange. Performance still needs interpreter and
physical clock-domain work; small LCD decoding cost is not the primary finding.
