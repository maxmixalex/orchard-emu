# Validation

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
