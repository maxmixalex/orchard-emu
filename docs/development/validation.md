# Validation

## Current local acceptance: electrical input and software ID

Base revision: `d3d6528`. Current commit-specific CI/artifact evidence belongs
in [issue #1](https://github.com/zyf722/orchard-emu/issues/1). The checks below
were run locally before publication; they do not certify a complete board or
interactive stock boot.

| Check | Observed result | Scope |
| --- | --- | --- |
| GCC 14.2 Release build / CTest | Pass | Maintained core regression |
| Clang 17 Debug ASan/UBSan / CTest | Pass | Same ROM-free core suite |
| Shared native / test-WASM regression | **102,528 assertions**, zero failures on each | Not an independent ARM CPU oracle |
| ROM tooling | 45 existing checks pass | Local file identity/format/GPIO parsing |
| Six generated-guest integrations | Pass, including cold replay | Production native CLI/WASM |
| New circuit guest | Pass | Native/WASM released-key and NOR-ID state; dynamic production-WASM IRQ sequence |
| Firmware probes | 13 native/WASM comparisons and independent cold replays pass | Ten prior scenarios plus two progressed 48gII cases and one no-key 50g case |
| Optimized ASan/UBSan firmware probe | Progressed 48gII D-low case matches | RelWithDebInfo native vs production WASM, including cold replay |
| Clang static analysis | 15 translation units, zero diagnostics | Core, CLI, regression and existing GPIO-window helper |
| JavaScript syntax | Pass | No browser lifecycle claim |
| Documentation navigation/targets | 15 pages, pass | Strict rendering remains a separately observed CI gate |

New C cases cover 56 raw switches across eight selected columns, passive-net
propagation, conflicting strong drives, floating/unknown alternate-function
nets, direct keys, all eight EINT trigger encodings, pending masks/groups,
W1C, pin-history isolation and the explicit digital-filter stop. NOR cases
cover part/capacity checks, command sequencing, upper address/data bits, ID
read widths, reset, byte preservation and unsupported operations. Checks stay
active in Release. These are assertion counts, not counts of physical keys,
independent CPU instructions or HP boot scenarios.

## Production circuit guest

`tests/circuit-wasm.mjs` constructs a new synthetic guest and copies its code
into SRAM through guest instructions. It then issues actual NOR-ID commands,
checks the manufacturer/device words, returns to array read, programs GPIO
and EINT, clears initial configuration-time pending interrupts and enters WFI.
The production native CLI and production WASM agree on all 16 registers,
CPSR, execution counters and released-key/ID witnesses.

The production WASM test then presses/releases raw matrix position (3,2) and
ON. Its guest IRQ handler records four IRQ entries, reads the changing pads,
acknowledges pending sources, restores SPSR and returns to WFI each time.
Cold reset detaches the keyboard; explicit reattachment and the same event
sequence reproduce the same final state. **Dynamic events are tested on
production WASM here, not through the native CLI or a real browser UI.**
Two additional invalid CLI component-value cases are rejected. The previous
14 invalid GPIO cases remain in the existing integration test.

## Firmware scope

The ten earlier strict/conditioned scenarios are repeated unchanged; their
results remain in [boot research](boot-research.md). The new 48gII probes use
its unchanged pinned full NOR, an attached keyboard, explicitly selected
SST39VF1601, G `f801:f800`, and D `cc7f:0` or `cc7f:cc7f`. Both reach 8,210,200
instructions and the OS-region LCD `4d000068` stop with no guest exceptions.
Their exposed execution results agree after excluding only the recorded
D-level metadata. Each host's independent cold replay agrees.

The new 50g case has its unchanged native boot region with erased OS sectors,
an attached released keyboard, D `cc7f:0` and G `f801:f800`. It consumes its
2-million-quantum budget polling recovery input without a diagnostic stop.
It is not a full dump, interactive-key acceptance or stock OS boot.

Clang Debug instrumentation of the long 48gII probe exceeded the local time
budget; that full Debug firmware run is **not** claimed passed. A separate
Clang RelWithDebInfo ASan/UBSan build completed the same native/WASM cold-probe
comparison successfully. The short maintained CTest suite passes with Debug
instrumentation. These are distinct checks and should not be conflated.

All firmware probes compare registers, CPSR, CP15/fault state, counters,
stop metadata, pixels and UART. Probe v3 additionally compares native-reported
component and GPIO settings against the requested conditions. Reports bind
the immutable source/backing bytes and exact executable hashes. Ordinary CI
runs only ROM-free tests. The exploratory 50g strong-drive contention case in
the boot document is not one of the 13 accepted no-key probe scenarios.

## Commands

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

`ORCHARD_BUILD_DIR` selects another native build directory for probes and
WASM comparisons. Use `RelWithDebInfo` plus `ORCHARD_SANITIZE=ON` for the
instrumented long-ROM probe described above. No test-only WASM module, source
fixture, ROM or report enters `dist/` or CMake install outputs.

## Remote gates and publication

The previous accepted main was `d3d6528`, Build #6 / Documentation #3, with
100,423 assertions and 14 documentation pages. M0 remains closed. The new
checks above require a new observed Build/Documentation result; the existing
workflow dynamically inventories source files for static analysis and runs
the extended WASM script before artifact publication.

Pages publishes only the strict-built Zensical site. Deployment checks verify
live content and exact `revision.txt`. Local Zensical remains unavailable;
do not substitute a local link check for a site-render pass. The repository
stays private. No firmware, manuals, private traces or reference emulator
implementation is committed. Browser E2E, full board timing/pad bias, actual
all-model key usability, LCD `+0x68`/panel mapping, full CPU conformance, stock
ARM return and USB remain open.
