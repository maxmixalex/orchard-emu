# Validation

## Scheduler and sessions after 980e1ec

Local Release, sanitizer and reference runs use eleven CTest suites. The
native/test-WASM total is **430,179 assertions per host**: previous 407,540,
21,882 scheduler checks and 757 checkpoint checks. The default independent
Unicorn 17,075-case shared ARMv4T corpus passes without mismatches or skips.
Clang static analysis produced 34 separate clean reports. Node
envelope/production Worker session checks pass alongside prior user/debug,
keyboard, skin, lifecycle and publication checks. No CPU ISA semantics change.

Both unchanged full NORs passed the maintained cold-HOME/two-calculation
witness twice natively and twice on production WASM. The same-input full
benchmark matches all prior output and measures ~1.4x throughput over 980e1ec;
see [performance](performance.md). A deliberately missing MMIO synchronization
fails eight new scheduling assertions; the mutant is not in the repository.

The new [session](sessions.md) study saves after the first original calculation,
restores to a fresh machine and completes the second calculation. Every
serialized architectural state byte matches uninterrupted execution. A native
process imports the same file and advances 50,000 ticks with byte-identical
output to WASM. Neither saved RAM nor ROM is committed or distributed.
Long firmware runs are ordinary local builds, not sanitizer or ordinary CI.

The installed Chromium still refuses the production HTTP origin with
ERR_BLOCKED_BY_ADMINISTRATOR. No policy was changed; browser downloads/file
selection, touch and background behavior are not accepted as E2E. Exact remote
Build/Pages/artifact acceptance is recorded in issue #1 after observation.

## Prior execution-optimization evidence


## Execution continuation from 2042ad8

The accepted incoming baseline is `2042ad8`: Build #17 and Pages #14 succeeded.
This continuation changes host execution work, not the ordinary calculator UI
or its two recognized ROM identities. The user/debug separation is preserved.

Nine Release suites, nine Debug ASan/UBSan suites, and nine native reference
suites pass locally. Native/test-WASM run **407,540 assertions each**, including
84,365 new decoder/memory-translation checks. The independent Unicorn default
corpus has **17,075 cases**, zero differences/skips. Static analysis produced
**29 separate clean translation-unit reports**. Existing generated peripheral,
USB, NOR and six-profile workloads pass, as do 76 tool checks, Worker/lifecycle,
calculator-audience, skin and nine publication-contract tests.

The added tests compare optimized execution with the retained full-checkpoint
path and uncached walker, including live descriptor changes, alias writes,
permissions, side effects, NOR ID state and relocation. A separately compiled
invalid first-level cache produced ten failures; that mutant is not committed.

On the identical complete original-ROM workloads, 2042ad8 versus this version
measured **14.382 -> 11.012 seconds (HP39g+)** and **18.274 -> 14.099 seconds
(HP48gII)** with all exposed state, pixels, segments, events and counters equal.
Both maintained startup tools then passed two native and two production-WASM
cold replays each. These are local firmware checks, not ordinary ROM-free CI.
A direct, three-run-per-binary short comparison against rebuilt 78ef22f
measured median ratios of 7.19x (39g+) and 7.33x (48gII), with equal outputs.
See [performance](performance.md) for hashes, methods and timing limits.

The tests do not certify complete physical hardware or actual browser E2E.
A fresh Chromium attempt at the local production HTTP origin still returned
`ERR_BLOCKED_BY_ADMINISTRATOR`; no browser policy was changed. New strict docs,
CI-produced binaries and Pages deployment need their own observed acceptance;
exact run/revision results are recorded in issue #1 after completion.


## User frontend and performance continuation from 78ef22f

The normal `/emulator/` now omits research controls and metadata; the separate
`/emulator/debug.html` retains them. Model-specific compatible ROMs are identified
by their existing immutable hashes, not by filename or a guessed boot setup.
The two pages share the same core and physical inputs. No new hardware claim
is implied by simplifying the UI.

Eight native Release suites and all test-WASM suites pass **323,175 assertions
per host**: previous 202,097 plus 121,078 EINT-equivalence assertions. The new
suite compares the exact pre-optimization sampler against its memoized version
through trigger modes, 12,000 dependency mutations, mask/W1C changes, history,
attach/detach, errors and reset. A deliberately broken dependency comparison
failed 10,675 assertions locally; that mutation is not committed. Both the
Debug ASan/UBSan build and the native no-memoization reference build pass all
eight suites. The default **17,075-case Unicorn** corpus passes with zero
mismatches/skips; it remains a common ARMv4T subset, not full ARM920T validation.

Clang static analysis completed with 28 separate clean translation-unit reports.
The 76 tool checks, existing generated guests, production Worker lifecycle,
seven skins, nine publication-contract tests and the new calculator-audience
contract all pass locally. `tests/calculator.mjs` checks that user snapshots
actually omit CPU/setup/event/counter data, rather than only hiding it with CSS.
Node adapters are not browser DOM/file-picker tests. Actual Chromium HTTP
navigation remains blocked by the environment's administrative policy, which
was not changed. Script-free desktop/mobile layout inspection is not E2E.

The full before/after WASM comparison preserves the exact guest timeline and
produces the same architectural/peripheral state and calculation frame.
Measured core workload times: HP39g+ **109.707 → 18.197 seconds**; HP48gII
**141.675 → 23.641 seconds**, approximately 6× on this host. The inputs,
compiler scope and reproducible command are in [performance](performance.md).
These are fixed cold-start-plus-two-calculation workloads, not first-HOME
latency, browser UI timing, or a measured real-hardware speed ratio. After
that comparison, both maintained startup tools passed two native and two
production-WASM cold replays per model. Hardware assumptions and counters
are unchanged; there is no instruction skipping or virtual-time rescaling.

The optimized production Worker also reached both original HP48 HOME results
with live message arrival. Its 20 physical transitions were recorded at their
actual guest ticks and replayed through the native CLI. All sixteen registers,
CPSR/CP15/fault state, instruction/tick/exception counts, alias/LCD counters,
applied key events and every final frame pixel matched. This checks the new
host tick accounting; it does not assume identical host arrival times between
sessions. Both supported real ROMs also passed the user catalog's automatic
identification separately from the negative, ROM-free CI cases.

Exact accepted source, new strict docs/CI and published Pages hashes are
recorded in issue #1 after observation, not inferred from these local tests.


## Publication and lifecycle continuation after 2e02b32

The first combined Pages attempt (#12) did not deploy: the runner's APT proxy
failed while fetching package indices and the resulting LLVM dependencies
could not be resolved. Build #15 itself passed. These are separate outcomes.
The new pipeline reuses the successful Build's complete website artifact;
it does not retry package installation during deployment. Exact accepted
commit/run and live verification results are recorded in issue #1.

Local checks on the new source: seven Release CTest suites and **202,097
native/test-WASM assertions per host**, 76 existing tool checks, existing
production guest/Worker/skin checks, and the new lifecycle EventTarget tests
pass. Nine publication-contract tests (including per-asset subcases) reject
missing assets, firmware/fonts, extra files, invalid revisions, symlinks,
oversized files, invalid WASM, wrong source stamps and tampered hashes.
A separate local 12-case simulation of the actual workflow selector rejects
fork, PR, failed, wrong-workflow and stale-source inputs. An integration dry
run assembled new web assets beside the downloaded, previously strict-built
documentation; this is not a new local Zensical render. CI must render the
changed Markdown itself. No CPU or peripheral semantics changed in this slice.

Both fixed full-NOR witnesses were rerun on this source: HP39g+ at 230M ticks
and HP48gII at 300M, each two native and two production-WASM cold starts,
with matching state, frame, input identity and replay. The two historical
calculation-frame hashes below remain exact; 39g+ records zero alias accesses
and 22 LCD hypothesis reads, 48gII one alias read/no alias writes and 24 LCD
reads. Both separate modifier studies were also rerun and their released-key
levels checked explicitly: 39 Shift 255/0, Alpha 255/0/255/0; 48 left/right
Shift each 255/0, Alpha 255/255/0/255. These are local firmware experiments,
not ordinary CI or actual browser-origin tests.

The lifecycle fix removes unconditional Worker termination on `pagehide`,
which could leave a back/forward-cache-restored document attached to a dead
Worker. Hidden/blur/pagehide pause and release; persisted pageshow stays paused.
The DOM event adapter is tested, not actual browser-cache restoration.
Local Chromium still reports `ERR_BLOCKED_BY_ADMINISTRATOR` for the production
HTTP origin. Neither policy changes nor an actual-browser E2E pass are claimed.


## Skins / segments / HP39g+ continuation from 1001d15

The new seven-suite native/test-WASM total is **202,097 assertions per host**:
previous 200,839 plus 1,258 NOR800A/segment checks. The first complete local run
passed all suites, existing production guests, 76 ROM/probe tool checks and
the production Worker lifecycle tests. Seven Debug ASan/UBSan suites and the default 17,075-case independent Unicorn
corpus also pass. Clang static analysis produced 27 separate clean reports.
The new skin test checks all seven
pinned files, each 51-position scan set, glass bounds, strip separation,
attribution and the independent HP39 setup.

The HP39g+ fixed 230M-tick run passed **two native and two production-WASM cold
boots**, exact exposed architecture/peripheral state, raw pixels, UART and
input identity. It shows `1+2=3`, then `7*8=56`, with zero SRAM alias reads or
writes, 22 counted LCD hypothesis reads, and no data fault. Its frame hash is
`efec8205f401a7189f3cd77eeaac6947165d480b383033c9796c86e95e9f6968`.

Separate production-WASM studies start cold with the original HP39g+ or
HP48gII full NOR. They observe Shift/Alpha latch and release cycles from
packed segment samples, not host key state. See [segment evidence](skins-segments.md).
The HP48 modifier run is not a rerun of its historical 300M arithmetic witness.
An initial modifier/ON variant stopped on unimplemented MMIO; suspend/resume
is not accepted. Repeated modifier taps complete the bounded study.

Local Chromium still refuses the HTTP origin with ERR_BLOCKED_BY_ADMINISTRATOR.
The policy was not changed. Static offline HTML/CSS rendering at 1360/390 px
checked glass placement and overflow; it does not prove actual page interaction.
Commit-specific CI, strict docs and live Pages results belong to issue #1.

## Historical 1001d15 evidence


## Reconciled HOME and web-control continuation

Base: remote `6372cbe`, preserving its x16 NOR implementation and tests while
merging the former local `e236fcc` HOME continuation. The merged bus contains
one adapter, not two. Current commit-specific CI and Pages acceptance belongs
to [issue #1](https://github.com/zyf722/orchard-emu/issues/1).

| Check | Actual local outcome | Boundary |
| --- | --- | --- |
| Native Release CTest | Six suites pass | Release-active assertions |
| Clang Debug ASan/UBSan | Six suites pass | ROM-free tests, not long firmware instrumentation |
| Native/test-WASM assertions | **200,839 each**, zero failures | Includes retained upstream 1,974 and local 24,699 memory checks |
| Clang static analysis | 26 separate translation units, no diagnostics | Not absence of all bugs |
| Independent Unicorn differential | 17,075 cases pass, zero mismatches/skips | Common ARMv4T subset, not full ARM920T |
| ROM/probe tool checks | **76 pass** | Preserved shared parser, raised bounded budget to 500M |
| Existing production guests | Pass | Six profiles, keys/IRQ, LCD, ADC, USB control/bulk, NOR bus |
| SRAM tool/ABI checks | Pass | Eight invalid policies, exact/mirror metadata and input identity |
| New web controls | Pass under Node Worker adapter | Map uniqueness, bounded taps, cancellation, run/pause/step/reset, stale generation and wrong-ROM rejection |
| Fixed full-NOR HOME witness | Four complete 300M cold runs agree | Two native, two production WASM; actual stock calculations |
| Live production Worker NOR run | HOME/two calculations and frame hash agree | Node browser-global adapters, not browser HTTP/DOM E2E |
| Offline static layout | 1360/390 px: no horizontal overflow | HTML/CSS only, not interactive proof |
| Actual Chromium origin navigation | Blocked by administrative policy | No browser-origin E2E pass claimed |

Core counts: 102,530 + LCD/input 13,017 + LCD/ADC 4,571 + USB 54,048 +
upstream NOR bus 1,974 + local memory 24,699 = 200,839. These are assertions,
not unique instructions, physical keys or stock scenarios.

## Firmware evidence

`tools/probe-hp48-startup.mjs` verifies the exact complete NOR identity, the
fixed 20-transition schedule, 300M virtual quanta, all exposed native/WASM
state, each cold replay and the visually established raw frame hash:
`53a2eda0fe1c185236eda700cfaa6328fbb14bd89c8ffbe0b5ffde097bf527e9`.
It reaches original HOME and displays `1+2=3` and `7*8=56`. After reconciliation,
the complete four-run test was rerun successfully, not inherited by assertion.
There is one SRAM alias read, zero alias writes and 24 counted LCD hypothesis
reads in this fixed schedule. See [startup](startup.md).

The production Worker receives a different, real-time-arrival tap sequence.
It enforces two million guest ticks down and two million released between
queued taps. Its actual 20 transitions are recorded, not assumed equal to
the fixed schedule. The observed run stopped by host pause at 300,112,896
virtual ticks; it had no diagnostic stop or data fault, one alias read, zero
alias writes, 26 counted LCD hypothesis reads, and exactly the same final
calculation-frame hash. Different LCD counts reflect the different schedule.
The actual recorded Worker schedule was replayed on the native CLI at the
same stopping tick. All sixteen registers, CPSR, instruction/exception counts,
alias/LCD counters and every final framebuffer byte agree. This is not an
assertion that every live run has identical arrival ticks.

These are conditional experiments: NOR is unmodified, but SRAM address wiring,
LCD `+0x68`, packed pixel interpretation and electrical/ADC inputs remain
unmeasured. No private snapshot or guest-memory edits are used to reach HOME.
The long ROM runs use ordinary builds; short sanitizer passes are not claimed
as instrumented full startup. Ordinary CI never downloads or executes this ROM.

## Worker regression and discovered scheduling issue

The same production Worker source is imported by `tests/web-worker-node.mjs`;
only `self`, `postMessage`, parent message delivery and local WASM asset fetch
are adapted to Node. The emulator, configuration and queue code are unchanged.
A prototype MessageChannel pump delayed control delivery in this harness.
The retained implementation instead yields with a timer once per roughly
8 ms batch, while preserving 256-tick calls/UART drainage inside it. Pause,
step and reset now pass. This was diagnosed and fixed locally before pushing.

`tests/web.mjs` also checks 51 unique mapped scan positions, exact tap/release
boundaries and gap, queue overflow, cancellation, setup/API rejection,
strict reset and stale messages after recreation. It rejects a correct-size
but incorrect-hash image in the research setup. Mapping all 51 positions is
not stock-OS functional acceptance for all 51 keys.

## Reproduce

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run test:web
python3 tools/check-docs.py
```

Local firmware-only checks, excluded from ordinary CI:

```sh
node tools/probe-hp48-startup.mjs /private/48gii.bin /new/report.json
node tools/probe-web-worker.mjs /private/48gii.bin /new/worker.json
```

The existing [independent Unicorn](cpu-oracle.md) corpus remains separate from
the shared host regressions. No production CPU semantics changed in this merge.
Existing CPU/USB evidence is historical at `e236fcc`; it does not automatically
certify new browser lifecycle behavior. Run strict Zensical separately; the
workflow observes its result before deployment. Source publication, build
success and actual browser acceptance remain distinct.
