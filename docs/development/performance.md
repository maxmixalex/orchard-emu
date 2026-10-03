# Performance and the two frontends

## User interface

`/emulator/` is the calculator. It contains model selection, Open ROM,
Pause/Resume, Restart, the physical skin/keypad and a short startup guide.
It has no boot-setup picker, CPU register table, tick counter, SRAM/LCD
research counters, UART console or instruction trace. The two supported NOR
identities select the existing model-specific compatibility configuration
automatically. Other target models are marked unavailable in this interface.
Unrecognized firmware is rejected with a user-facing explanation, not silently
assigned the settings of a different ROM. The Worker verifies the hash too.

`/emulator/debug.html` retains the developer workbench, including strict mode,
experimental configurations, every model/finish, registers, counters, UART,
LCD interpretation and diagnostics. Both entrypoints share the same ARM core,
physical-key mapping, firmware data, skins and lifecycle behavior. They are
not separate emulators. The ordinary page remains a beta: hiding engineering
controls does not promote unmeasured hardware behavior to physical validation.

The calculator selects the `calculator` Worker audience. Its frame messages
omit CPU state, setup names, event logs and research counters; those data are
not simply hidden with CSS. The workbench and existing research probes retain
the full message schema. `tests/calculator.mjs` checks this boundary along with
separate entrypoints and rejection of unsupported firmware. These Node checks
are not full browser DOM or file-picker acceptance.

## Measured bottleneck and changes

A native Clang `-pg` sample of the unchanged 78ef22f HP39g+ path, 20 million
virtual ticks, attributed 51.60% of sampled self time to `o_gpio_sample` and
20.15% to `o_eint_tick`. It called the former over 40 million times: the same
passive switch network was being solved for every single ARM instruction,
including the intervals with no electrical change. Instrumented profiling is
diagnostic evidence, not the uninstrumented performance benchmark.

The new host-only EINT memoization compares **all** relevant input values
exactly: F/G direction, latch, pull-up, strong input, weak bias, external
interrupt controls, matrix/direct switches and edge-history state. No hash
collision can hide a change. Changed inputs invoke the existing solver.
Unchanged level-triggered sources still reassert after W1C, edge-triggered
sources do not synthesize new edges, and pending groups are remapped after
mask changes every quantum. Contention, floating pads, unsupported filters
and reset behavior retain the original diagnostic path. This is not an ARM
cache or a hardware debounce model.

Additional changes: no IRQ arbitration when the request set is empty;
compiler-recognizable full CPU checkpoints instead of an opaque byte-copy
call; `-O3 -flto -mbulk-memory` for production and test WASM; and no per-256-tick
allocation/copy of the 33-word debugger snapshot in the Worker. The successful
run budget advances the host counter; a stop or published snapshot still
reads the actual core counter. UART is drained after the same bounded calls,
virtual time and physical tap durations are unchanged. No CPU instructions,
peripheral ticks, fault checks or firmware computations are skipped.

The Clang [command guide](https://clang.llvm.org/docs/CommandGuide/clang.html)
and LLVM [WebAssembly linker](https://lld.llvm.org/WebAssembly.html) document
the optimization/build facilities. Production remains an independent MIT C17
interpreter, without JIT or third-party CPU implementation. Native retains
portable C17; WASM requires standard bulk-memory support.

## Reproducible comparison

`tools/benchmark.mjs` runs the same exact input and event schedule against two
WASM binaries in one Node/V8 process, with independent fresh machines. The
short mode alternates before/after order across three cold runs per binary
and model; it uses 20 million ticks. `--full` uses the existing complete
HP39g+/HP48gII startup-and-two-calculation schedules and checks the established
result-frame hashes. Outputs compare all exposed CPU/peripheral/USB state,
annunciators, pixels, UART, counters and applied events, not just whether the
run returned success. Firmware is supplied locally and never downloaded.

```sh
node tools/benchmark.mjs /private/78ef22f.wasm dist/orchard.wasm \
  /private/rom-directory /new/short.json
node tools/benchmark.mjs /private/78ef22f.wasm dist/orchard.wasm \
  /private/rom-directory /new/full.json --full
```

The directory contains the exact `39g+.bin` and `48gii.bin` identities already
used by the startup witnesses. Results measure execution after load and
WebAssembly compilation, excluding browser timer clamping, file selection and
user thinking time. They do not measure a real calculator and must not be
advertised as an exact hardware speed ratio. A fixed 230M/300M schedule is a
workload, not the earliest possible time to display HOME.

## Observed local full-workload results

Both binaries were built with the same Clang 17 toolchain, on the same Linux
x64 host and Node v22.16.0. The baseline is exact `78ef22f` with its
original `-O2` flags; the candidate includes the changes above. Each timed
full workload ran once per binary, with a fresh machine and the exact same
original ROM and physical-key schedule. This table is not a confidence
interval or a cross-device browser comparison.

| Original system | Virtual workload | Baseline | Optimized | Speedup |
| --- | ---: | ---: | ---: | ---: |
| HP39g+ D1.55 | 230M | 109.707 s | 18.197 s | 6.03× |
| HP48gII USB revision | 300M | 141.675 s | 23.641 s | 5.99× |

All compared architectural/peripheral state, segment samples, frame hashes,
UART, assumption counters and applied events matched exactly. The separate
maintained startup tools then completed **two native and two production-WASM
cold runs per model**, including the same original HOME calculations.
The unoptimized WASM SHA-256 was `36df5cab5972e0ae026a028a68d2b91bf860df7f249de2444e2ee4c1e367c567`;
the locally optimized WASM SHA-256 was `93c434278f7c4dfe4bca2685d7ccfab0c9c84239d5e4f7dece7aec96a84f9f42`.
Compiler versions can change binary hashes and wall times; production CI
artifacts need their own validation rather than inheriting these timings.

A separate 12,000-mutation differential in `tests/performance.c` compares the
memoized EINT against the retained pre-optimization algorithm. It checks warm
cache reuse, all dependency mutations, every trigger mode, W1C and masks,
detach/reattach, contention/unsupported states and reset. Existing CPU/MMU,
USB/LCD/ADC and original-firmware regressions remain mandatory. Configure
`-DORCHARD_REFERENCE=ON` for a native build without EINT memoization.

## Next optimization targets

Profile the improved version before the next change. Candidates include
bounded event-driven peripheral scheduling, decoded instruction blocks and
translation caching with correct page-table/code-write invalidation. These
are future work, not features of this revision. Retain a reference path and
compare the exact guest timeline; increasing a displayed counter, skipping
boot code or slowing virtual peripherals is not performance optimization.
