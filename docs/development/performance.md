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

## First optimization round: 2042ad8

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
`-DORCHARD_REFERENCE=ON` for a native build without the host EINT/execution
optimizations. This option does not change the guest hardware configuration.

## Execution hot paths: continuation from 2042ad8

A new Clang `-pg` profile of 30M HP39g+ ticks on exact `2042ad8`
puts physical reads, CPU dispatch/checkpoints and translation at roughly
14.2%, 13.9% and 11.7% of sampled self time. These instrumented percentages
identify candidates; they are not the timed before/after measurements.

The second round retains all guest instructions and the same peripheral/input
timeline. It changes host work in three places:

* Exact-width byte-span reads avoid the intermediate SRAM copy. Constant-size
  `__builtin_memcpy` on little-endian GCC/Clang is unaligned/alias-safe; the
  portable/reference byte assembly remains available. Mirrored accesses that
  wrap around the chip still use the bounded wrap path and retain counters.
* Condition-failed ARM instructions, B/BL, and conservatively classified ALU
  operations need no full CPU rollback copy. The ALU is the original helper.
  Loads/stores, Thumb, PSR operations, exception returns, multiply, CP15 and
  every class that may stop retain the original complete checkpoint path.
  `o_cpu_step_reference` retains unconditional checkpoints for comparison.
* A 64-entry host translation memo reuses successful 1 KiB mappings only after
  checking the effective virtual page, translation base, domain/control words,
  access privilege/direction and **both live page-table descriptor words**.
  Unmapped/side-effecting or aliased table storage is never cached. NOR ID
  mode bypasses hits. No failed translation is cached. Entries contain offsets,
  not host pointers, and reset clears them.

This is not an ARM TLB model. Page-table changes remain visible immediately,
even without maintenance, exactly as in the original walking implementation.
Physical data/code bytes are still fetched each time: there is no decoded-code
cache, self-modifying-code shortcut, guest-time scaling, or ROM patch.

### Same-input full-workload measurement

Both binaries were built with Clang 17, identical `-O3 -flto -mbulk-memory`
flags, and run on the same Linux x64 / Node 22.16.0 host. Unlike the first-round
table, the baseline here is the **already optimized 2042ad8**, not 78ef22f.
Each full workload ran once per binary; short 20M-tick checks alternated order
across three cold starts per binary/model. Timing excludes load/compilation and
browser scheduling. No real calculator was timed.

| System / workload | 2042ad8 | This continuation | Throughput ratio |
| --- | ---: | ---: | ---: |
| HP39g+ / 230M ticks, HOME + two calculations | 14.382 s | 11.012 s | 1.31x |
| HP48gII / 300M ticks, HOME + two calculations | 18.274 s | 14.099 s | 1.30x |

The short-check median ratios were 1.39x and 1.35x respectively. Full-workload
registers, exposed peripheral/USB state, pixels, segments, UART, input events
and assumption counters matched the baseline exactly. Treat the full table as
an observed pair, not a confidence interval or a first-screen latency claim.
Do not multiply speed ratios measured in separate sessions into a purported
hardware speed rating.

Baseline WASM SHA-256:
`93c434278f7c4dfe4bca2685d7ccfab0c9c84239d5e4f7dece7aec96a84f9f42`.
Candidate WASM SHA-256:
`40625515c6475b5ff97a35a4e85b51517d878da92d234e6d26fb97a479b3bc62`.
These identify local builds, not the separately verified CI compiler output.

### Direct cumulative check against the user-feedback version

The exact `78ef22f` source was also rebuilt with its original flags on this
same host. Three alternating 20M-tick cold runs per binary/model directly
compared that version with this candidate; every compared output matched.
This is a measured cumulative ratio, not the product of historical ratios.

| System / 20M-tick startup segment | 78ef22f median | Current median | Ratio |
| --- | ---: | ---: | ---: |
| HP39g+ | 6.612 s | 0.920 s | 7.19x |
| HP48gII | 6.507 s | 0.887 s | 7.33x |

The old binary hash is
`36df5cab5972e0ae026a028a68d2b91bf860df7f249de2444e2ee4c1e367c567`.
These short startup segments are neither full HOME latency nor a real-machine
speed comparison. The separate full-workload table above compares against
2042ad8 and includes both original-OS calculations.

### Regression boundaries

`tests/execution.c` adds 84,365 assertions against the full-checkpoint decoder
and uncached walker. Cases cover ARM decode restrictions/flags/PC destinations,
Thumb and exceptional instructions; all page types/AP/domain/S/R combinations;
1 KiB permission boundaries; both descriptor levels; FCSE, TTBR and control
changes; alias writes into table storage; side-effecting UART table reads;
NOR software-ID state; arena relocation and reset. Existing SRAM boundary,
wrap, NOR command and guest peripheral tests remain active. The CPU comparison
checks full architectural state, stop details, peripherals and all SRAM bytes.

A deliberately broken local memo accepted an updated first-level descriptor
without recomputing its mapping. The new suite failed ten assertions. That
mutant and its reports are outside the repository and release artifacts.
The default independent Unicorn 17,075-case ARMv4T subset also passes; it is
not an oracle for ARM920T MMU/cache or physical-board fidelity.

Both original-system witnesses then passed two native and two production-WASM
cold runs each. This preserves the conditional HOME/arithmetic evidence without
promoting SRAM, LCD, NOR identity or analog assumptions to verified hardware.

## Next optimization targets

Reprofile this version before adding further complexity. At that revision event-driven peripheral scheduling and decoded blocks were
candidates. The scheduler continuation below now implements the former; decoded
execution blocks remain future work. Preserve exception precision, self-modifying code,
MMIO side effects and key/interrupt ordering. The reference build and original
ROM replay are correctness gates; wall-time improvements alone are not.


## Next-event phase accounting (continuation from 980e1ec)

A new 30M-tick native `-pg` sample identifies about 13.4% self time in the SoC
poll loop, 9.3% in EINT and additional time in per-peripheral tick calls. Each
peripheral entry was called 30 million times even though most quanta produced
no external transition. Instrumentation identifies a target, not a benchmark.

The new scheduler computes the earliest RTC oscillator tick, ADC completion,
LCD line transition, watchdog divider expiry or PWM divider expiry after a
normal full peripheral step. Until **strictly before** that boundary, it
retains every ARM instruction and CPU IRQ/FIQ acceptance check but aggregates
only phase increments. No new interrupt arbitration is needed while the
unchanged request state and latches remain stable. The exact old full step
handles the event, in its original EINT/RTC/USB/ADC/LCD/watchdog/PWM/UART order.

Every MMIO read/write first materializes deferred phases and invalidates the
plan. Every public run return does the same, including stops. Thus reads see
the right count, W1C can reassert on the next tick, and CPU/host changes cannot
reuse a stale deadline. Host input enters only between bounded run calls.
The retained `o_run_reference` uses per-tick peripherals; ORCHARD_REFERENCE
builds select that path along with prior execution references. The scheduler
is host optimization state, never checkpoint or hardware clock state.

The 21,882-assertion scheduling suite compares full CPU state, peripheral state,
stop details and RAM against that reference under 1,600 randomized states,
partitioned budgets, mid-window MMIO, ADC start, main USB W1C with a live child
latch, timer reload, invalid LCD, watchdog stop and WFI. Removing MMIO
synchronization in an external mutant fails **eight assertions**. The original
core and new session checks remain independent of this suite.

### Same-host, same-input full workload

Clang 17 / Node 22.16.0, identical O3/LTO/bulk-memory flags, fresh machines,
exact unchanged NORs and the same physical-key schedule. One timed full pair
per model, excluding load/compilation and browser timer policy:

| Original system / HOME + two calculations | 980e1ec | This continuation | Throughput |
| --- | ---: | ---: | ---: |
| HP39g+ / 230M quanta | 10.695 s | 7.534 s | 1.42x |
| HP48gII / 300M quanta | 14.096 s | 10.046 s | 1.40x |

All compared registers, peripheral/USB state, pixels, segments, UART, events
and assumption counters match exactly. Separate full startup tools replay both
machines twice natively and twice in production WASM. These times are not
early-HOME latency, a confidence interval, browser FPS or a real-device ratio.
The new session feature separately avoids repeating startup; it is not counted
as an execution speedup. Reprofile CPU decode/dispatch before the next change.
