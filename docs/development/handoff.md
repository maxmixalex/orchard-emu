# Continuation handoff

The HOME continuation has been reconciled on top of remote `6372cbe`, not
force-applied over it. Its exact source tree was verified before merging.
Keep the upstream x16 adapter in `src/nor.c`; there is no duplicate in the bus.
Both upstream NOR regressions and the local memory/SRAM regressions remain
active. The shared probe budget parser retains its rejection tests, with an
explicit 500-million-tick upper bound for the maintained startup witness.

[Startup](startup.md) owns the fixed original-NOR HOME/two-calculation record.
[Web](web.md) owns the new experimental setup and physical-tap interface.
[Validation](validation.md) distinguishes native/WASM replay, production
Worker tests, offline layout inspection and the still-blocked browser-origin
E2E. Issue #1 owns the exact accepted commit and observed CI/Pages outcomes;
local checks alone do not imply remote acceptance.

Next: verify production-page load/input/lifecycle on an allowed origin;
expand real-OS key/use/reset coverage and persistence; independently resolve
SRAM address wiring, LCD `+0x68` and panel mapping. Do not relabel the declared
HOME experiment as a fully verified board or all-six-model gate.

The user's later HP39gs/HP49g+ complete NORs remain deferred. Do not request
them now, restart the retired dumper or make the blocked forum attachment the
main task. HP39g+ NOR part identification and HP50g GET_CONFIGURATION remain
separate open items. Ordinary CI and production packages stay ROM-free.

## Current continuation from 1001d15

Skins are build-time pinned/hashes checked, served locally under the emulator
subdirectory, separately Apache-2.0 with NOTICE. Build creates one tested `orchard-pages` artifact containing documents and
the application. Pages consumes that exact successful main run without
reinstalling a compiler. Do not replace the established document URLs.

HP39g+ now has conditional HOME/arithmetic with its own 1 MiB NOR hypothesis
and exact SRAM. Shift/Alpha segment changes were observed on 39g+ and 48gII.
Do not describe the 39g+ path as still blocked at the old unspecified-part
write, or describe the new segment strip as merely a host key highlight.
Physical hardware assumptions and browser-origin E2E remain open.


## Publication continuation after 2e02b32

Build #15 succeeded, but the first combined Pages run #12 failed during an
APT proxy outage before deployment. A pushed workflow was not a deployed site.
The corrected pipeline promotes only an exact, successful current-main Build
artifact, verifies all assets before upload, and rechecks main before deploy.
The deployed revision and each emulator asset are checked over HTTPS afterward.
Tests live in `tests/pages.py`; `npm run test:pages` is ROM-free. No runner
proxy, Docker daemon, package source or browser policy was modified.

`pagehide` now pauses/releases rather than terminating the Worker, since the
page may be retained in the back/forward cache. A persisted `pageshow` stays
paused. `tests/lifecycle.mjs` checks dispatch through EventTarget, not an actual
browser-cache round trip. Browser-origin verification remains blocked locally.

## User frontend and performance continuation

The default page is now the user calculator with automatic ROM identification;
`debug.html` preserves the research workbench. Continue using the latter for
strict mode, unknown ROMs, state/event export and component investigations.
The two consumers share one Worker/core; `audience` controls snapshot detail.
Do not put CPU counters or experimental boot-setup controls back into the user
page. Keep current compatibility limits in short help and the documentation.

The main CPU cost was repeated passive-keyboard/EINT evaluation, now guarded
by exact dependency comparison. Level sources must still reassert after W1C,
edge sources must not, and group masks are remapped every tick. Retain the
reference algorithm and differential test when changing this optimization.
CPU rollback checkpoints and guest timing are preserved. WASM uses O3, LTO
and bulk-memory lowering; no JIT has been added. The successful Worker budget
updates its host tick count without a per-call debug snapshot allocation.

See performance.md for the measured ~6× fixed-workload result and follow-on
profiling targets. The ROMs, raw timing/state reports and layout previews are
local-only evidence and must not enter production or Pages packages.

## Execution continuation from 2042ad8

The same user/debug UI now uses exact-width checked memory reads, a conservative
ARM no-checkpoint path and a 64-entry host translation memo. Every hit checks
live descriptor words and translation context; MMIO/aliased table storage and
NOR ID mode take the uncached bus path. Do not replace these checks with stale
TLB-like semantics. Offsets are relative to the current machine arena and reset
clears them. Saved-session import treats this as disposable host state.

`ORCHARD_REFERENCE` disables EINT memoization and these execution optimizations.
`tests/execution.c` compares the full checkpoint/walker paths; the independent
Unicorn corpus and full original-system cold replay also pass. Full-workload
speed is approximately 1.30x relative to already optimized 2042ad8 in this
session, not an additional 6x and not a measured hardware speed ratio.
Publication acceptance belongs to issue #1, not an assumed successful push.


## Continuation from 980e1ec

The next-event scheduler materializes all delayed phase increments at MMIO and
public run boundaries. Preserve the exact per-tick reference and the directed
ADC/USB-latch/timer regressions; merely measuring speed is insufficient. Its
quiet intervals never skip guest instructions, timing events or fault checks.

Portable checkpoint APIs and user-facing Save/Load session now exist. The
serialized format excludes immutable NOR and disposable host caches, is bound
to the ROM identity and imports atomically. Schema changes require versioning.
Do not describe this as automatic storage, native warm reset or a completed
browser file-picker/download test. Continue broader original-OS use, physical
hardware validation and decoded CPU work without blocking on deferred dumps.

## Settings / timing continuation on 0b16b6b

The ordinary UI has been refactored into a viewport workspace and native modal
settings/connection controls. `preferences.js` owns validated per-model mapping
and optional localStorage records; `pacing.js` owns wall-time credit only;
`virtual-usb.js` advances an actual bounded EP0/packet host without running CPU
instructions itself. Debug stays unlimited with historical physical-tap timing.
The user Worker uses model-specific validated taps; avoid undoing the HP39
longer dwell after the short multiply-loss counterexample.

Core changes are deliberately small: one functional-timebase export and a
reference-tested WFI skip inside already-known quiet windows. The clock-rate
fix is not a calibrated PLL or invented cursor overlay. Physical clock-domain
work remains pending. Raw UART/USB controls are not Conn3x/file transfer.

Autosave copies between core runs, does not interrupt active taps/EP0 jobs,
never includes ROM and guards stale async results. Exit saving is best effort.
No private session, ROM or report is added to source or Pages. Re-run actual
production Worker tests, real-NOR short-key and fixed startup witnesses, and
then verify the accepted CI artifact. Documentation and issue #1 must retain
the separation of local checks, remote builds, asset deployment and browser E2E.
