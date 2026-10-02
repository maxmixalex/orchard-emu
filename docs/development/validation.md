# Validation

## Current local acceptance: LCD scan/IRQ and normal ADC

Base revision `5f93b3f`. The exact imported source tree was verified before
editing. Current commit-specific CI and Pages acceptance is recorded in
[issue #1](https://github.com/zyf722/orchard-emu/issues/1). M0 remains closed;
these functional peripheral results do not close CPU, board or stock-boot gates.

| Check | Observed local result | Scope |
| --- | --- | --- |
| GCC 14.2 Release CTest | Pass | Three Release-active test executables |
| Clang 17 Debug ASan/UBSan CTest | Pass | ROM-free regression |
| Clang 17 RelWithDebInfo ASan/UBSan CTest | Pass | Optimized instrumentation |
| Native/test-WASM assertions | **120,118 each**, zero failures | Not independent CPU differential |
| Existing ROM tool checks | 60 pass | Existing formats/events/pad syntax |
| New ADC parser/CLI rejection cases | 14 CLI cases pass; parser checks pass | Reject before output creation |
| Six production synthetic integrations | Pass | State/UART/pixels and reset/replay |
| Existing circuit and LCD-policy guests | Pass | Scheduled keys, IRQ/WFI, strict/idle-zero boundaries |
| New ADC/LCD guest | Pass, both hosts and cold replay | Two distinct peripheral IRQs, valid samples 0/1023 and unresolved-input control |
| Real firmware/control probes | 13 host comparisons and cold replays pass | Exact conditions in boot research, not stock boot |
| Static analysis | 19 translation units, zero diagnostics | Source, CLI, three C tests and research helper |
| JS syntax / WASM build | Pass | Not actual browser lifecycle E2E |
| Documentation navigation/targets | 17 pages | Strict site rendering is a separately observed gate |

The current counts are 102,530 core + 13,017 prior LCD/input + 4,571 new
LCD/ADC assertions. Two extra core assertions disable video before a decoder
mode-change check; this is a test precondition adjustment, not a claimed CPU
fix. Previous synthetic guests also now program valid CLKVAL=2 instead of the
old zero-clock placeholder. The prior raw-frame parity test remains intact.

## What the new tests exercise

The C suite checks all eight ADC mux channels across nine clock divisions,
sample hold versus later input changes, exact pre/post-completion boundaries,
RO completion flags, data validity, subsource and main masking, acknowledgment,
standby pause/resume, read-start, reset/release, atomic rejection of unresolved
inputs and busy reconfiguration, bounds, widths and unsupported touch modes.

LCD cases cover both single-scan modes, every WDLY/WLH table combination,
read-only LINECNT, unchanged state across repeated reads, masked sources,
newly unmasked pending delivery, independent W1C latches, both acknowledgment
orders with elapsed ticks between writes, new-frame retriggering, enable/reset
phase and explicit unsupported-mode/FIFO/LPC/TFT checks.

The generated production guest configures ADC and LCD itself. Its first ADC
conversion produces an actual guest IRQ 31; its handler reads DAT0 and clears
the sub/main requests, then returns using SPSR. A later frame generates IRQ
16; the handler stops video and acknowledges LCD pending **before** source,
then returns to WFI. Both endpoints 0/1023 produce the expected sample, one
ADC IRQ and one LCD IRQ. The no-input control stops at sampling with no fake
result. All exposed architecture and LCD/ADC diagnostics match across hosts
and independent cold replays. No test module or synthetic image is packaged.

Two deliberate external mutations were rejected by the new regression: a
four-clock ADC conversion and relatching an already acknowledged LCD source
every tick. The latter adds an elapsed-tick acknowledgment-order counterexample;
these mutations never entered the production source or Git tree.

## Firmware probes and instrumentation

[Boot research](boot-research.md) lists thirteen current scenarios. They compare
registers, CPSR, CP15/fault state, counters, exact stops, source/backing hashes,
explicit component/pad/ADC conditions, scheduled events, pixels and UART. Probe
v5 adds pure LCD/ADC diagnostic comparison without triggering READ_START or
acknowledging interrupts. `adc_valid=false` distinguishes uninitialized backing
storage from a valid zero sample.

The progressed 39g+ USB, HP48gII AIN7=512 USB and HP50g key-1 cases were also
repeated with the optimized Clang ASan/UBSan native CLI against production
WASM, including cold replay. Only these selected firmware scenarios, not all
thirteen, constitute instrumented full-probe evidence. Short CTest suites run
with Debug instrumentation separately. Local orchestration timeouts do not
count as passes; only complete JSON comparisons were admitted.

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

Use `RelWithDebInfo` plus sanitizers for long instrumented firmware probes;
`ORCHARD_BUILD_DIR` selects the native build. Firmware input examples are in
[ADC](adc.md) and [boot research](boot-research.md). Ordinary CI remains ROM-free.

## Remote gates and limits

The preceding `5f93b3f`/Build #8 used 115,545 assertions and 16 pages. Its green
result does not automatically accept this revision. The same workflow runs
the new tests before packaging, and Documentation performs strict Zensical
rendering, Pages deployment and exact deployed-revision verification. Local
installation of pinned Zensical 0.0.67 failed because the package was not
available from this environment; no local strict-render pass is claimed.

No firmware, manuals, private reports or reference implementation enters Git
or Pages. ADC codes are not a measured battery circuit, functional LCD ticks
are not physical timing, and the idle-zero option is still an unverified
hypothesis. Stock UI, correct panel/annunciators, independent CPU conformance,
USB/SD transfer, native payload return and actual browser E2E remain open.
