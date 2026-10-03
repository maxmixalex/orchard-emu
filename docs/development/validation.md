# Validation

## Current local acceptance — USB continuation, 2026-10-03

The USB work was originally prepared against `a9e03bd`. Before publication,
remote `80a1466` was discovered and its exact tree was retrieved and compared.
This continuation reconciles the local packet/bulk implementation onto that
parent rather than rewriting history. The unchanged `80a1466` control guest
is retained in `tests/usb-guest.S` and rerun using the expanded host API.
The provisional EP0-only session helpers are superseded by one packet host.

The following checks were rerun locally on the reconciled source before pushing.
Current commit/CI/Pages acceptance is tracked in issue #1. The earlier
145,021-assertion remote baseline and 174,166-assertion local patch are distinct
historical inputs, not interchangeable evidence.

| Check | Observed result | Scope |
| --- | --- | --- |
| GCC 14.2 Release CTest | 4/4 pass | Release-active maintained suites |
| Clang 17 Debug ASan/UBSan CTest | 4/4 pass | ROM-free CPU/peripheral assertions |
| Clang 17 RelWithDebInfo ASan/UBSan CTest | 4/4 pass | Optimized instrumentation |
| Native / test-WASM assertions | **174,166 per host**, zero failures | 120,118 prior + 54,048 USB assertions; not independent CPU conformance |
| ROM tooling checks | 60 pass | Existing file, event and input syntax checks |
| Existing generated guests | Pass | Six profiles, keyboard/circuit, LCD policy, ADC/LCD IRQ returns and cold replay |
| New USB generated guest | **49 exact steps** agree | Guest reset/setup IRQ, control reply, five bulk echoes and cold replay |
| USB session input checks | 22 malformed commands and 4,096-command cap rejected | No state record from a malformed first command |
| Original HP50g USB transcript | **143 exact steps** agree | Native/WASM exposed CPU/USB state and packets; both independent cold replays |
| Optimized sanitizer USB transcript | All 143 steps and cold replays agree | Actual native helper with ASan/UBSan versus production WASM |
| Existing firmware/control probes | 13 comparisons/replays pass | Disconnected USB; all old strict controls and new post-initialization stops |
| Additional optimized sanitizer firmware probes | 39g+ and 48gII AIN7=512 pass | Complete native/WASM comparisons and cold replays, not all 13 instrumented |
| Clang static analysis | 22 translation units, zero diagnostics | Production native code, four test suites, two research helpers |
| JS syntax and production WASM build | Pass | No real-browser lifecycle or UI interaction claim |
| Documentation navigation/local targets | 18 pages pass | Not a strict Zensical render |
| Local Zensical strict render | Not run | Installation of pinned 0.0.67 failed: no available matching package |
| Remote CI / updated Pages | See issue #1 for the resulting commit | Must be observed independently after pushing |

Static-analysis output now preserves source-relative paths. The new
`src/usb.c` and `tests/usb.c` would otherwise collide under the prior basename
naming scheme and hide a report. The prepared workflow checks the exact
source/report path sets; all 22 separate local reports are present.

The assertion count includes byte-by-byte boundary checks and is not a count
of supported instructions, unique tests, physical keys, or stock boots.
No earlier assertion count is re-used as new evidence. CPU and existing
peripheral C tests are unchanged; the new suite tests only original USB logic.

## USB tests and negative controls

`tests/usb.c` tests byte/word registers, reset masks, indexed endpoint isolation,
pure diagnostics, independent pending/acknowledgment, address staging,
EP0 multi-packet data/status/preemption, packet toggles, delayed IN ACK,
insufficient output capacity, control writes, duplicate OUT suppression,
STALL, FIFO ownership, AUTO_SET/AUTO_CLR, flush and every payload length
0 through 64 on all four bulk endpoints. Invalid widths/index, empty FIFO,
unsupported ISO/DMA/small-MAXP buffering and malformed API arguments are
explicit failures. No empty FIFO is converted to invented data.

The original generated ARM guest uses its own IRQ vector and MMIO operations.
It configures the controller, handles a bus reset, reads SETUP from FIFO,
returns a synthetic three-byte control response, and echoes five bulk packets
of lengths 1/7/63/64/0. Host retries without IN ACK retain ownership and data;
duplicate OUTs do not reach the guest twice. All 49 commands are replayed on
both native and production WASM with exposed state/payload comparisons.

Two deliberate out-of-tree mutations are rejected by the USB C suite:
consuming IN data without an ACK, and committing FUNC_ADDR immediately rather
than after status acknowledgment. The test failures were observed; neither
mutation entered the production source. This is an edge-condition test of
the implemented contract, not independent silicon conformance.

This synthetic bulk test is separate from the original HP50g bootloader
experiment in [USB evidence](usb.md). In that experiment, GET_CONFIGURATION
still returns NAK during the specified 16,000-quanta window. Success of
other descriptor/status requests must not be reported as success of this
request. A fresh SETUP and USB reset recover. No stock file, firmware update,
Conn3x session or host-OS virtual device is verified.

## Original firmware probes

[Boot research](boot-research.md) gives current source identities, conditions,
budgets, instruction/exception counts, and stops. All thirteen ordinary
probes compare CPU, LCD/ADC, pure USB state, event counts, pixels, UART and
cold replay. They do not attach a host. The two full NORs pass the prior
USB initialization address and next store to physical NOR base in startup;
neither has a usable stock UI. The explicit LCD +0x68 hypothesis is unchanged.

`probe-usb.mjs` separately uses only the hash-pinned HP50g native 16 KiB boot
region, pads/weak bias, key-1 schedule and an explicitly reset logical bus.
It preserves the erased-OS construction and records source/binary hashes.
The 143-step transcript compares every exposed CPU/USB word and every returned
packet; it is not a comparison against an independent hardware/CPU oracle.
The optimized sanitizer-native transcript is a separate observed run, not
inferred from the Release result.

## Reproduce

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

For the optimized instrumented transcript, build with
`-DCMAKE_BUILD_TYPE=RelWithDebInfo -DORCHARD_SANITIZE=ON` into
`build-sanitize-opt`, then select it with `ORCHARD_BUILD_DIR`:

```sh
node tools/probe-usb.mjs /private/boot-50g.bin /new/path/usb.json
ORCHARD_BUILD_DIR=build-sanitize-opt \
  node tools/probe-usb.mjs /private/boot-50g.bin /new/path/usb-sanitized.json
```

The maintained source/tests and workflow changes are included in the continuation.
`dist/` and CMake install contain no test helper, synthetic image, real firmware,
manual or report. Distribution verification is separate from an actual browser
E2E run. The existing documentation workflow must still be observed after
publication: a local link check does not substitute for strict rendering or
live deployed-revision verification.

## Open gates

GET_CONFIGURATION, wire-level USB timing/error handling, DMA and alternate
buffer modes, stock protocol transfer, NOR/cache startup behavior, LCD +0x68,
physical panel/pad/analog behavior, independent CPU conformance, native ARM
payload return, persistence and real-browser lifecycle remain open. M0 stays
historically accepted; this local continuation does not close M1/M3/M6.

## Reconciliation acceptance

The unchanged original remote control guest also passes descriptor, address,
configuration and GET_CONFIGURATION requests with the new packet API on both
hosts and independent cold replays. This preserves a positive control next
to the original HP50g GET_CONFIGURATION counterexample. Provisional C/WASM
USB names changed; no released ABI compatibility is promised at version 0.1.
No remote source history is removed. Ordinary CI stays ROM-free.
