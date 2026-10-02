# Validation

## Current local acceptance: LCD hypotheses and scheduled recovery keys

Base revision `54f316d`. All results below were observed locally before
publication. Current commit-specific remote Build/Documentation outcomes are
recorded in [issue #1](https://github.com/zyf722/orchard-emu/issues/1). M0 remains
closed; this slice does not close full CPU, board or stock-boot acceptance.

| Check | Observed result | Scope |
| --- | --- | --- |
| GCC 14.2 Release CTest | Pass | Maintained original core and native CLI |
| Clang 17 Debug ASan/UBSan CTest | Pass | ROM-free regression |
| Clang 17 RelWithDebInfo ASan/UBSan CTest | Pass | Optimized instrumented core |
| Shared native / test-WASM regression | **115,545 assertions each**, zero failures | Not an independent CPU oracle |
| ROM/probe tool checks | **60 checks** pass | Includes event bounds, ordering and syntax |
| Six generated-guest integrations | Pass | Production CLI/WASM state, UART, LCD and replay |
| Existing circuit guest | Pass | Native/WASM initial ID/key state; WASM matrix/ON four-IRQ sequence |
| Scheduled circuit guest | Pass | Native CLI and production WASM matrix press/release, two IRQ returns and WFI, cold replay |
| New LCD research guest | Pass | Strict vs gated disabled read, enabled-video rejection, count/reset and event boundaries |
| New invalid native CLI cases | **22 cases**, pass before output creation | Bias, policy, frame view and event schedule; prior cases retained |
| Ten firmware/negative-control scenarios | Host comparison and cold replay pass | Exact conditions/results in boot research, not stock boot |
| Three optimized sanitizer firmware probes | Pass | 39g+ LCD, 48gII ADC and 50g key-1 paths |
| Clang static analysis | **17 translation units**, no diagnostics | Includes CLI, regression and optional GPIO-window helper |
| JS syntax and production WASM build | Pass | No actual browser lifecycle test |
| Documentation navigation/local targets | **16 pages**, pass | Strict rendering is a separate remote gate |

The unchanged main regression contributes 102,528 assertions; the new
`tests/lcd-input.c` contributes 13,017, for 115,545 on each host. Both are
CTest executables and separately compiled test-only WASM modules.
The additional C assertions test all raw keyboard switches with weak bias,
strong/weak priority, unresolved opposing bias, reset and validation; guarded
LCD reads and actual LDR execution; absolute bus-word lane addressing at two
base alignments, changing line alignment, four swap settings and three pixel
depths; nonlinear BLUELUT; and separate controller/packed-memory captures.
The tests remain active in Release. Seed: `0x09202410`.

A local regression-sensitivity check temporarily restored the former relative
lane rule, producing 1,089 failing assertions, and separately restored linear
2-bpp intensity, producing 4,192. These are multiple assertions for two behavior
regressions, **not thousands of independent bugs**. The restored corrected
source passes the suite. Neither experiment modified a ROM or ran on CI.

## Production-host checks

The ROM-free LCD guest executes a normal LDR of `+0x68` with video disabled,
then enables video and reads again. Strict mode stops on the first access;
explicit idle-zero records one unverified read and stops on the second.
Both hosts agree. A tick-zero event is consumed, but a future event is not
applied after the diagnostic stop. Same-tick ordering, chronological limits,
invalid masks, unsigned-overflow input and the 64-event bound are tested.

The scheduled circuit test uses real guest GPIO/EINT setup and exception
handlers, not direct IRQ injection. Native CLI events at ticks 2,000 and 2,256
match production-WASM switch changes at the same boundaries. Both return to
WFI after two guest IRQs and repeat from cold reset. The older four-event
matrix/ON sequence remains separately tested on WASM. No test module enters
`dist/` or the native install targets.

## Firmware experiment boundary

[Boot research](boot-research.md) lists all ten scenarios and exact results.
Each runs twice per host, comparing all 16 registers, CPSR, CP15/fault state,
counters, stop details, UART, the selected framebuffer interpretation and
applied-event counts. Original/backing-image hashes and compiled executable
hashes are recorded separately. The report schema is now `orchard-nor-probe-v4`.
It records strong inputs, weak bias, components, key schedule, view and the
unverified-read count. It never upgrades `boot_verified` to true.

The negative strong-drive scenario correctly reports contention and consumes
only the press event. Matching this expected failure across hosts does not
turn it into keyboard compatibility evidence. The positive HP50g choices
reach distinct USB/SD register writes after both press and release. They still
contain no operating system. The idle-zero 39g+/48gII scenarios are explicitly
hypothesis-enabled, not canonical hardware boot gates.

Three long probes repeat with optimized ASan/UBSan: 39g+ keyboard/idle-zero,
48gII component/idle-zero and HP50g weak-bias key 1. Their native state and
cold replay match production WASM. This does not claim all ten cases were
rerun under instrumentation or that the earlier full Debug timeout is solved.

## Reproduction

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
cmake -S . -B build-sanitize -DCMAKE_C_COMPILER=clang \
  -DCMAKE_BUILD_TYPE=Debug -DORCHARD_SANITIZE=ON
cmake --build build-sanitize --parallel
ctest --test-dir build-sanitize --output-on-failure
python3 tools/check-docs.py
```

Use `RelWithDebInfo` and `ORCHARD_SANITIZE=ON` for the long instrumented probes;
`ORCHARD_BUILD_DIR` selects the native directory. Probe commands are in boot
research. Firmware remains local and unchanged; ordinary CI is ROM-free.

## Remote and remaining gates

Prior accepted `54f316d` used 102,528 assertions and 15 pages. Its green build
is not automatically evidence for this slice. The existing Build workflow
runs all expanded maintained tests, and Documentation performs strict Zensical
rendering, Pages publication and exact deployed-revision verification. Observe
those new outcomes before accepting them. Local package-network access still
prevents a local Zensical render; link checks are not a substitute.

No firmware, private trace, reference source or manual is published. A separate
packed-memory interpretation does not resolve panel wiring. LCD `+0x68`, LCD
scan/pending behavior, ADC, real board bias, full ARM conformance, stock UI,
native payload return, USB/SD transfers and actual browser E2E remain open.
