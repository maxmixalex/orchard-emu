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
