# Performance and the two frontends

## Fixed-scene execution comparison (2026-10-21)

`tools/benchmark-scenes.mjs` compares two production WASM builds using private
browser/APLET fixtures. It restores each scene's exact session, locates the
baseline's first complete expected LCD at 12,000-quantum resolution, and
finishes all key releases and the final gap. Both builds then execute the same
fixed guest interval with current calculator contacts: HP39 125/50 ms and
HP48 50/30 ms. The fixture's historical reference contact schedule is not
silently substituted for those production contacts.

Every replay must match the complete final checkpoint, UART digest, LCD,
physical contact transcript and CPU counters. Each build executes the complete
workload twice before alternating timed replays. Loading, explicit WASM
compilation, restore, LCD sampling and final checkpoint hashing are outside
the measured interval; JavaScript scheduling, UART draining and incremental
UART hashing remain inside it. Reports retain every wall-time and process
CPU-time sample, binary/fixture/tool identities, engine arguments and Linux
CPU affinity. Process CPU time can include VM background work.

```sh
node tools/benchmark-scenes.mjs baseline/orchard.wasm dist/orchard.wasm /private/nors /private/fixtures.json build/new-scene-throughput.json
node --no-liftoff tools/benchmark-scenes.mjs baseline/orchard.wasm dist/orchard.wasm /private/nors /private/fixtures.json build/new-optimized-scene-throughput.json
```

The second command requests optimizing WASM compilation up front in Node/V8.
It is a separate steady-state execution experiment. Neither command measures
browser input latency, painting or physical-calculator speed. A faster fixed
guest replay need not reduce Normal-mode latency when the browser already
keeps up with the functional clock. Use the existing uninstrumented production
browser probe for that acceptance decision, preserve outliers, and serialize
performance runs across workers. An identical-build A/A control helps assess
host variability before interpreting small candidate differences.

## HP39 release-gap follow-up (2026-10-20)

After PR #2 (`ac16d1d`), the calculator keeps the HP39g+ press at 1,500,000
quanta (125 ms) and reduces only its released interval from 900,000 to
600,000 quanta (75 to 50 ms). The Worker still uses legacy `run()`; HP48
contacts, workbench contacts, the functional clock and research APIs do not
change. See [input behavior](interaction.md#hp39-release-gap) for the defaults
and the historical fixed-timing probe.

Holding the press constant isolates this experiment from the rejected shorter
press trials below. A 30 ms gap missed the second `1` at phase zero and produced
`1+` with Invalid Syntax despite exact physical contacts. The 50 ms gap passed
80 arithmetic executions across 74 distinct expression/phase combinations:
16 cases in the existing eight-phase set plus 64 in a 32-phase extension.
Every accepted case matched the complete known LCD and its eight contacts.
Independent `11+1` and default `KeyA` witnesses also passed all 32 executions
(16 old-gap and 16 new-gap cases), matching an old-timing reference after all
contacts and the final gap completed. No guest stop occurred.

Four queued keys now reach ENTER at 525 ms instead of 600 ms in the 12 MHz
functional reference: 75 ms less input queue time. These guest-state checks
are not host-time measurements and establish no browser response gain. An
isolated APLET click has no earlier queued key, so its initial press and
Library rendering path do not benefit from this gap change. No broader key
or firmware compatibility is inferred from this finite witness.

The clock-policy investigation below is the historical PR #2 record. Its
125/75 ms timings and negative browser observations remain unchanged evidence.

## Calculator clock ratios and visible latency (2026-10-20)

This continuation starts from `0215f19`, the merged default release of PR #1.
That release reduced caught-up Worker CPU use, but left Normal `1+1` response
essentially unchanged. PR #2 investigated arithmetic and HP39g+ Aplet Library
interaction latency directly.

The calculator retains `run()` for continuous execution and single-step.
`run_idle()` and `run_clocked()` remain explicit research APIs. Their semantic
checks pass, but browser scene measurements have not established acceptable
default interaction latency. Increasing the CPU issue ratio regressed HP39
arithmetic; the later one-slot IDLE candidate reduced guest work but retained
unexplained slow Library samples. Both observations are preserved below.

Active CPU slots still execute the interpreter, live memory translation and
interrupt checks. Peripheral time advances once per quantum. The Worker drains
UART and polls USB at most every 1,024 quanta, bounding a call to 1,024 CPU slots.
The 6 ms Worker task ceiling and earned-credit pacing remain active.
`run()` and the earlier opt-in `run_divided()` preserve their existing semantics;
the workbench and native host retain their selected legacy policy.

Both research APIs, `run_idle()` and `run_clocked()`, honor aligned word writes
to `CLKCON.IDLE` (bit 2).
The CPU sleeps after the writing instruction, while peripherals and the
functional clock continue. An interrupt source enabled by `INTMSK` wakes the
core; the CPU's IRQ/FIQ masks still govern exception entry. The register bit
is sticky, so each write requests sleep, but a retained one does not put a
woken core back to sleep. Samsung's
[S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf)
describes this in sections 7-11, 7-17 and 7-21. The CPU-wrapper acknowledgement
delay is not calibrated.
This uses the existing scheduler and serialized sleeping state; checkpoint
version 1 remains compatible. The legacy runners retain register-only writes.

The 12 MHz functional peripheral/RTC reference and existing Half/Normal/Double
settings remain. PLL/slow-mode absolute frequencies, ARM instruction cycle
costs, cache/bus waits and the separate LCD HCLK domain are still uncalibrated.
The default keeps one CPU slot per quantum and does not claim an exact
real-calculator speed. Restoring an older portable session preserves its
architectural state and continues under the unchanged legacy policy.

The separate research API `run_clocked()` reads guest `CLKDIVN` and ARM920T
CP15 bus mode to select HCLK in FastBus or FCLK in synchronous/asynchronous
mode. It includes special 1:4:4 and explicit reserved-setting stops, with mode
changes applied at the next quantum. Tested HP39 HOME uses four slots and
HP48 uses two. This relationship follows the manual's sections 7-8, 7-22 and
ARM920T clock-mode chapter, but the browser evidence does not justify making
it the default. The research `run_idle()` preserves the previous one-slot
functional rate; it does not silently cap or reinterpret `run_clocked()`.

### Fixed-state scene witnesses

The initial policy experiment compares legacy `run()` with the pre-existing
`run_divided()` while restoring the same original-ROM HOME checkpoint,
preserves every physical key contact and compares complete result pixels.
Each policy also has an unsampled execution with an identical complete final
checkpoint. The two tested HOME clock configurations have the same issue ratios
under `run_divided()` and the new `run_clocked()`; the latter additionally
handles FastBus and special/reserved encodings. These observations use the
12 MHz reference, not browser wall time:

| Model / scene | Legacy response | Clock-ratio response | Measurement start |
| --- | ---: | ---: | --- |
| HP39g+ `1+1` | 576 ms | 170 ms | Enter contact |
| HP39g+ `7*8` | 606 ms | 191 ms | Enter contact |
| HP48gII `1+1` | 235 ms | 117 ms | Enter contact |
| HP48gII `7*8` | 284 ms | 129 ms | Enter contact |
| HP39g+ Aplet Library | 1,022 ms | 281 ms | APLET contact |
| HP39g+ Function symbolic view | 1,347 ms | 366 ms | START contact |

For HP39 arithmetic, the original queued typing interval to Enter remains
600 ms: total `1+1` response is 1,176 → 770 ms in this fixed-phase experiment.
HP48 totals are 475 → 357 ms. Faster key timings were tested separately:
50 ms down / 30 ms released still loses a key in HP39 `7*8` at a shifted start
phase with the divided policy. At the PR #2 merge, the calculator retained
HP39 125/75 ms and HP48 50/30 ms contacts. The gap-only follow-up above later
changes the HP39 released interval; it does not revise this older witness.

With the one-slot IDLE research runner, a separate 100/60 ms HP39 experiment
also failed: `1+1` at a +12,000-quantum start phase never reached the expected
result in the 20M-quantum window. The guest did not stop. That sweep was
terminated at its first failing case and is not counted as complete. The
original 125/75 ms pair passed all 16 arithmetic phase cases under `run_idle()`.

The Aplet witness has two explicit actions: from empty HP39 HOME press APLET
(scan 49) to display Aplet Library; from that library press START (F6, scan 40)
to open the initially selected Function symbolic view. This is a reproducible
interpretation of the user's `39aplet` reminder; the prior exact conversation
steps were not recoverable. It does not claim to cover every downloaded aplet.

The first actual Chrome comparison of the ratio-only candidate (`beebfddc…`,
before implementing IDLE) did **not** establish an overall latency improvement.
All 12 Aplet results in three alternating Normal-speed rounds matched every
LCD pixel without a guest stop or page/Worker error. Library click-to-result
medians were 3,449 → 1,588 ms, but Function START medians regressed from
1,903 → 3,292 ms. Individual rounds varied substantially. The ratio-only
candidate was therefore held back while investigating actual guest work and
implementing the missing IDLE behavior. Do not quote the functional-reference
table above as a browser speedup. A separate arithmetic attempt timed out in
the first baseline Restore action before any measurement; the checkpoint was
actually restored and the evidence is retained as a setup failure.

A second production candidate (`6ecbcc6b…`) combined the ratio model with
IDLE. All 36 scene results in three alternating Normal-speed rounds matched
their complete LCD reference, but HP39 `1+1` regressed in every round:
1,333/1,218/1,251 ms baseline versus 2,904/2,244/2,175 ms candidate, measured
from the first actual keydown to the first matching Worker frame. The cold-HOME
instruction witness explains a material risk: typing through the first result
took 22.61M instructions with ratio plus IDLE versus 14.11M with legacy issue.
Much smaller idle-window instruction counts did not establish faster arithmetic.
This candidate was also rejected as the calculator default.

The one-slot `run_idle()` candidate (`76db5cb…` WASM, `fb284913…` Worker)
isolates sleep handling from the extra issue slots. Its original-ROM and
generated-program semantic checks pass. In three alternating uninstrumented
Chrome 155 Normal rounds, all 36 scene results matched every LCD pixel with
no guest stop or page/Worker error. First actual keydown/click to first matching
Worker frame on the main thread, before canvas paint, produced these medians:

| Scene | Baseline | One-slot IDLE candidate |
| --- | ---: | ---: |
| HP39g+ `1+1` | 1,228 ms | 1,212 ms |
| HP39g+ `7*8` | 1,279 ms | 1,337 ms |
| HP39g+ Aplet Library | 1,017 ms | 2,616 ms |
| HP39g+ Function START | 1,354 ms | 1,361 ms |
| HP48gII `1+1` | 475 ms | 492 ms |
| HP48gII `7*8` | 554 ms | 561 ms |

The Library candidate samples were 2,881/2,616/1,168 ms. Their host-time
variation remains unexplained; equal guest timing and successful instrumented
replays do not resolve those browser observations. Default activation is
withheld, and the production Worker retains its previous `run()` policy.

The same research candidate reduced first-contact-to-result guest instruction
counts by 16.77% / 16.85% for HP39 `1+1` / `7*8`, and 18.20% / 8.48% for HP48.
These are research-runner work reductions, not measured host CPU-time savings
or benefits enabled in the shipped calculator. The core APIs, independent
clock/IDLE oracle and scene tools remain available for explicit investigation.

`tools/probe-clock-latency.mjs` records the arithmetic policy comparison.
`tools/probe-aplet-latency.mjs` produces private exact-checkpoint Aplet fixtures.
`tools/probe-browser-latency.py --fixtures FILE --models 1` consumes those
fixtures through the real ROM chooser, Restore dialog and calculator key
clicks. It requires the matching restore acknowledgement, exact physical scan
transcript and every expected LCD pixel. Its endpoint is the first matching
Worker snapshot received on the main thread, before canvas paint. ROMs,
sessions, checkpoint bytes and raw pixel reports remain local.

Cold-start acceptance, exact candidate identities, actual browser timing and
remote CI/deployment acceptance are recorded with
[PR #2](https://github.com/maxmixalex/orchard-emu/pull/2).
The historical sections below retain their original baselines and release
scope; the default-off physical-read experiment stays disabled.

## User interface

`/emulator/` is the calculator. It contains model selection, Open ROM,
Pause/Resume, Restart, Save/Restore, Connections and Settings. The view is
immersive skin or traditional LCD/keys; help is a tooltip.
It has no boot-setup picker, CPU register table, tick counter, SRAM/LCD
research counters or instruction trace. Raw connection bytes are confined to
the connection dialog, not a permanent debug console. The two supported NOR
identities select the existing model-specific compatibility configuration
automatically. Other target models are marked unavailable in this interface.
Unrecognized firmware is rejected with a user-facing explanation, not silently
assigned the settings of a different ROM. The Worker verifies the hash too.

`/emulator/debug.html` retains the developer workbench, including strict mode,
experimental configurations, every model/finish, registers, counters, UART,
LCD interpretation and diagnostics. Both entrypoints share the same ARM core,
physical-key mapping, firmware data, skins and architectural state. Lifecycle and pacing policies are audience-specific. They are
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

## Pacing and bounded waiting after 0b16b6b

The unlimited user Worker coupled emulated timer speed to host throughput.
Normal now limits deterministic execution to the existing 12M-quanta reference
per wall second; faster/slower/unlimited modes are explicit. See
[interaction](interaction.md). A speed cap is not an interpreter performance
regression, nor evidence of a fully calibrated physical clock. Slow hosts may
still fall behind. No guest computation is skipped to maintain wall time.

The new core fast path skips only CPU-WFI quanta strictly within a scheduler
interval already known to contain no external transition and no pending CPU
wakeup/IRQ. It advances the same deferred peripheral phases and ticks, then
uses the existing full step at the event boundary. It never skips an ARM
instruction. 6,208 additional comparisons cover partitioned budgets, phases,
mask/pending IRQ/FIQ and sleeping state against the retained per-tick path.
The native/test-WASM scheduler suite is now 28,090 assertions.

A generated 12M-quanta WFI guest compared old/new implementations with identical
complete checkpoint bytes. Its tiny idle workload is not a useful general
HOME speed ratio; no new overall HOME acceleration percentage is claimed.
The new user renderer avoids unchanged pixel/key/segment DOM work, reuses
ImageData and drains up to 1024-quanta execution slices in bounded 6 ms tasks.

Input latency cannot safely be improved by arbitrary hold/gap cuts: the first
HP39 trial lost multiply and other candidate timings failed phase variation.
The retained per-model timings reproduce the two reference calculations at
eight start phases each. Clock-domain calibration, a broader key survey and
decoded-block/JIT work remain distinct open tasks.


## LCD investigation in the React continuation

`tools/profile-display.mjs` measures the real frame/annunciator accessors and
copy cost without browser paint. HP39/48 median measurements are approximately
0.049/0.047 ms per frame. This is small compared with available wall CPU time
and does not implicate LCD decoding as the main bottleneck. Actual canvas,
compositor and main-thread work require browser-origin measurement.

The new frontend separates frame notifications from React control state,
coalesces paints and skips unchanged pixels. RGBA palette lookup uses packed
typed-array copies, not one temporary subarray per pixel. No guest clocks or
registers are skipped. A narrow-transfer checkpoint and a larger translation
memo were tried but gave no reliable overall gain, so both were removed.
No new CPU throughput increase is claimed for this release. Normal still
uses the prior functional reference, not calibrated physical PLL/PCLK domains.

## Physical reads and Worker pacing (2026-10-20, from 83a2d38)

This continuation uses the exact accepted `83a2d38146b65b8324076fc034e0770d4cc132f1`
as its baseline. Earlier tables above describe earlier releases and different
hosts. The [machine-readable evidence summary](performance-2026-10-20.json)
contains this round's timing samples, build hashes and measurement boundaries;
it contains no firmware, saved machine state or complete guest trace.

### Release scope after stop review

The [release evidence record](performance-release-2026-10-20.json) separates
this narrowed default build from the historical fast-read measurements.

The merge scope was narrowed after independent review of the retained failure
metadata, all core stop sites, and the early/final WASM function bodies. Normal
builds retain the Worker pacing improvement and the two boot SRAM pointer
corrections. The new physical-read specialization is disabled by default and
requires the explicit `ORCHARD_EXPERIMENTAL_PHYSICAL_READS=1` build environment
setting. Native and reference builds keep the original dispatcher even when
that experiment is requested.

This is risk isolation, not a diagnosis of the old stop. The failed run lacks
the state required to establish its cause. The early and corrected fast-read
WASMs differ in only the two pointer-offset functions; their other 80 function
bodies are identical. There is no hidden CPU or stop fix. In Unlimited mode,
the new Worker threshold cannot take its yield branch because the available
budget is always 1024. Actual browser input phases can still vary with host
scheduling, so this observation alone does not identify the root cause.

The core throughput tables below describe the **opt-in fast-read candidate**,
not the default release. The Worker CPU measurements remain applicable to the
retained change: that experiment used the same baseline WASM for both Workers.
A fresh single full A/B pair per model also passed the exposed-state and output
comparisons, but its timing ratios varied markedly (1.337x HP39g+, 1.012x
HP48gII). These are a separate noisy window, not a replacement for earlier
samples or a new default-release speedup claim.

The build now runs on pull requests to `main` with read-only repository
permissions. Pages still accepts only successful current-main push/manual
builds. The default WASM identity and its targeted acceptance are recorded in
the [PR merge evidence](https://github.com/maxmixalex/orchard-emu/pull/1),
separately from the historical fast-read artifacts; merging requires the
narrowed revision's actual CI result.

### Reviewed candidate changes

The optimized WASM physical-read entry specializes complete 1/2/4-byte reads
from normal NOR array mode and physical SRAM. It reads the current bytes on
every access and checks the live NOR ID mode. The original device dispatcher
still handles NOR commands/ID, SRAM mirrors and wrapping spans, boot SRAM,
MMIO and failed reads. Translation permissions, live descriptor validation,
instruction decoding and device side effects are unchanged. Native and
`ORCHARD_REFERENCE` retain the original dispatch boundary. The read optimization
adds 599 bytes to the WASM code section; it does not introduce a decoded-instruction cache.

Review also found pre-existing undefined pointer arithmetic in the boot SRAM
slow read and public memory-copy accessor: the code formed `boot_sram + address`
before subtracting the bank base. Both now compute the checked integer offset
before adding it to the array pointer. This independent correction affects
native and WASM builds. It adds 24 WASM code bytes in two functions; the other
80 function bodies are byte-identical. There is no evidence connecting this
correction to the browser stop described below.

The calculator Worker now retains wall-time credit below 256 quanta and yields
when the next key boundary is farther away. Previously, reading a high-resolution
clock inside a caught-up pump could continually earn tiny allowances and keep
the Worker busy for the entire 6 ms task. The threshold matches `Pacer.delay()`.
A closer physical-key transition still executes at its exact tick. The existing
12M-quanta functional rate, .5/1/2/Unlimited choices, 1024-quanta UART drain
boundary, 6 ms task limit and per-model key holds/gaps remain in force. The
opt-in divided-clock runner from the baseline is not selected by the UI.

An extension of scalar CPU rollback to halfword/block/Thumb cases passed its
correctness checks but had inconsistent full-ROM timing when measurement order
was reversed. That production change was withdrawn. Its independent transaction
comparisons and generated-guest benchmark remain available for future work.

### Core throughput on identical inputs

Clang 18.1.3, Node 24.19.0, Linux x64, Intel Xeon Platinum 8573C; identical
O3/LTO/bulk-memory flags. Other compilation and performance jobs were paused
during these measurements. Each full row is one fresh-machine pair with the
unchanged original NOR, HOME and `1+2=3`, then `7*8=56`. Timing excludes file
loading, WASM compilation and browser scheduling.

| Model / workload | 83a2d38 | Candidate | Throughput ratio |
| --- | ---: | ---: | ---: |
| HP39g+ / 230M quanta | 9.606 s | 8.718 s | 1.102x |
| HP48gII / 300M quanta | 12.593 s | 11.563 s | 1.089x |

All compared registers, exposed peripheral/USB state, LCD pixels, segments,
UART, input events and assumption counters match. Three alternating 20M-quanta
startup pairs give median ratios of 1.093x and 1.100x respectively. Before the
independent pointer correction, a full pair measured 10.047 -> 9.504 s and
13.055 -> 11.957 s, or 1.057x/1.092x.
All samples remain separately identified in the evidence summary. Host timing
varies; these separate windows do not establish a timing effect from the pointer
correction. The table reports the final artifact measurement, not a
confidence interval, physical-calculator rating or Normal-mode input latency.

### Worker CPU and scheduling cost

`tools/benchmark-worker.mjs` runs the real Worker module in Node with native
timers and MessageChannel. Both variants use the **same baseline WASM** to
isolate the scheduling change. Generated ARM branch and WFI guests run at
.5/1/2 speed, in three alternating rounds: 36 samples. Each sample follows an
80 ms warm-up and reset, requests 650 ms of execution, and measures the actual
elapsed time and Worker thread CPU. An independent replay at the observed
guest tick count matches the complete serialized checkpoint in every sample.

Normal-speed medians on this host:

| Metric | 83a2d38 Worker | Candidate Worker |
| --- | ---: | ---: |
| Branch guest: Worker thread CPU / wall time | 85.31% | 21.38% |
| Branch guest: core calls per sample | 1,365,233 | 7,740 |
| Branch guest: mean quanta per call | 5.71 | 1,008.18 |
| Branch guest: quanta per wall second | 11,989,636 | 11,992,206 |
| WFI guest: Worker thread CPU / wall time | 86.85% | 5.80% |
| WFI guest: core calls per sample | 2,220,462 | 7,736 |
| WFI guest: quanta per wall second | 11,963,980 | 11,988,419 |

These are instrumented **Node Worker** CPU measurements. Browser clock
resolution and timer policy can change the effect; the percentages must not
be presented as Chrome CPU measurements or original-OS power consumption.

### Actual browser interaction and remaining latency

`tools/probe-browser-latency.py` drives the production UI and Worker in Chrome
155.0.8059.84. It opens private local ROMs through the real file chooser and
restores an exact baseline-generated HOME checkpoint before each expression.
It requires the matching restore acknowledgment, real keyboard events and
the complete physical-scan transcript, then compares every LCD pixel. Its
endpoint is the first matching Worker snapshot received on the main thread;
canvas paint and physical-device timing are outside that endpoint.
The reported `start_tick` identifies the restored checkpoint, not the first
keydown's guest tick. Browser input reaches each variant at host-dependent
guest ticks; these UI trials are not the fixed-input core benchmark above.
Whole-frame equality also includes LCD refresh and presentation state, so it
does not measure only the arithmetic operation itself.

The final pointer-corrected build completed all 24 trials: three alternating
rounds of Normal and Unlimited, both variants and models, with both `1+1` and
`7*8` after exact restores. Median first-keydown-to-`1+1` time was:

| Model / mode | Baseline | Final candidate |
| --- | ---: | ---: |
| HP39g+ / Normal | 1,199.5 ms | 1,198.1 ms |
| HP39g+ / Unlimited | 557.8 ms | 528.4 ms |
| HP48gII / Normal | 462.3 ms | 450.2 ms |
| HP48gII / Unlimited | 233.1 ms | 241.1 ms |

The prior build's Normal medians were 1,210.4 -> 1,208.3 ms on HP39g+ and
457.3 -> 481.2 ms on HP48gII. Small browser differences vary between runs; this
round does **not** demonstrate a material Normal input latency improvement.
Existing key dwell and functional-clock assumptions need
separate investigation; lowering key holds without phase coverage previously
lost inputs.

The initial 24-trial Normal/Unlimited browser sweep completed 23 trials. The
last HP48gII candidate Unlimited trial displayed the correct `56`, then entered
a core diagnostic stop before Pause. That failure is preserved, not counted
as a pass. Its initial report lacks the stop code and exact guest input ticks;
additional passing runs alone cannot establish its cause. Sixty-eight further
diagnostic browser trials did not reproduce it. A bounded native baseline
check across 266 different input start phases found no stop (that check did
not assert the result pixels). A captured successful Chrome trajectory matched
62,191 API calls and the complete checkpoint in six implementations; 41,068,575
optimized reads also matched the old dispatcher individually. The pointer-fixed
WASM separately matches that successful trace. These checks leave the original
failure **unclassified**. It blocked the full candidate and continues to block
enabling the new physical-read path by default. The narrower release scope
above removes that path from normal builds; it does not claim a stop fix.

The maintained browser probe now preserves the original failed observation,
then uses the real UI's Save download to capture a stopped session and locally
decode its stop code, PC, instruction, address/detail and full state. Recovery
occurs after measurement failure and cannot turn a failed trial into a pass.
It preserves the ordinary Worker's paused checkpoint; it cannot reconstruct
the exact preceding input-tick history. A generated-guest Chrome regression
verifies this path, including the unchanged stop and original observation.
The diagnostic session and raw guest state are private local evidence.

### Correctness coverage and reproduction

`tests/physical-read.c` adds 217,824 assertions against the original dispatch,
covering all six profiles, complete physical spans, NOR ID, SRAM alias/wrap,
boot SRAM boundaries, invalid arguments, MMIO and deferred-phase behavior.
A deliberately broken NOR-ID guard fails 456 assertions.
`tests/cpu-transactions.c` adds 456,945 comparisons, including every 16-bit Thumb
encoding from one deterministic initial state, directed ARM halfword/block
cases and partial-memory/MMIO/fault behavior. Enumerating all encodings is not
exhaustive coverage of all CPU states. `tests/worker-pacing.mjs` exercises the
actual pump with a high-resolution fake clock, slow-host backlog, all rates,
pause and a 70-quanta input boundary; the original pump fails its tiny-call
negative control.

Local Release, reference and ASan/UBSan CTest each pass 14 suites. Native and
test-WASM checks contain 1,118,080 assertions per host, plus 9,902 divided-clock
checks. The independent Unicorn ARMv4T subset passes 17,075 cases with zero
mismatches or skips. Native static analysis covers 38 sources with no diagnostics;
the WASM bus path also passes target-specific analysis. Generated-guest production
Chrome tests cover 12 model/audience cases and 104 physical keys, with no page
errors. Both original-NOR cold-start witnesses pass two native and two WASM
runs per model, eight complete runs, with equal repeated/native/WASM outputs.
These functional witnesses retain the documented SRAM/LCD/NOR/analog hypotheses.

Reproduce measurements with distinct output paths and a separately built baseline:

```sh
node tools/benchmark.mjs ../baseline/dist/orchard.wasm dist/orchard.wasm ../roms build/core-full.json --full
node tools/benchmark-worker.mjs ../baseline/web/worker.js web/worker.js ../baseline/dist/orchard.wasm build/worker.json
python tools/probe-browser-latency.py ../baseline/dist dist ../roms build/browser-input.json --repeats 3 --speeds 1,0
```

The CPU-only tool takes two builds of `tools/cpu-throughput.c`, which exports
its own generated workloads; it does not take the application WASM module.
For example, compile the same helper against the two source revisions with
identical options, then compare their outputs:

```sh
clang -std=c17 -O3 -I../baseline/include -I../baseline/src ../baseline/src/*.c tools/cpu-throughput.c -o build/cpu-before
clang -std=c17 -O3 -Iinclude -Isrc src/*.c tools/cpu-throughput.c -o build/cpu-after
node tools/benchmark-cpu.mjs build/cpu-before build/cpu-after build/cpu-loops.json
```

The browser tool requires Playwright and Chrome/Chromium. The Worker CPU tool
requires a Node release with `process.threadCpuUsage()` (24.19.0 was used here).
Use `39g+.bin` and `48gii.bin` only in the private ROM directory; the tools check
their documented identities and do not acquire or publish firmware. Raw ROM
reports, saved sessions and diagnostic traces remain outside source and Pages
packages. Synthetic timing is opt-in, with no noisy CI speed threshold.


## Physical contact input timeline

The continuation after `aba2923` adds `tools/profile-input-latency.mjs` to
separate PC events, queued physical taps and guest result pixels. The
[sanitized continuation record](performance-continuation-2026-10-20.json)
contains this experiment's identities, counters and observation boundaries.
It uses the same baseline `2e7961a6...` and candidate `87d72134...` WASM as the
preceding final sweep; no production clock or input duration changed.

All four expression keys are queued at an exact restored checkpoint. The
first physical contact occurs at that tick, and the existing TapQueue executes
the remaining contacts. A baseline run without LCD sampling supplies the
complete final checkpoint and expected frame. Baseline and candidate are then
restored to the same initial bytes and sampled every 12,000 quanta. All eight
sampled profiles match their four unsampled references in complete checkpoint
bytes, UART, exact contact events and final pixels. The virtual profiles are
also identical between builds.

At the unchanged 12M-quanta functional reference, these fixed-phase observations
are:

| Model / expression | First contact to Enter down | Enter down to sampled result | First contact to sampled result | Result to sampled segment 5 off |
| --- | ---: | ---: | ---: | ---: |
| HP39g+ / 1+1 | 600 ms | 576 ms | 1,176 ms | 55 ms |
| HP39g+ / 7*8 | 600 ms | 606 ms | 1,206 ms | 57 ms |
| HP48gII / 1+1 | 240 ms | 235 ms | 475 ms | 77 ms |
| HP48gII / 7*8 | 240 ms | 284 ms | 524 ms | 62 ms |

These are guest quanta converted to reference milliseconds, not measured wall
latency or physical-calculator time. The last sampled nonmatch and first match
are one reference millisecond apart. Earlier short-lived matches can be missed,
and segment transitions have the same sampling resolution. Segment 5 is the
raw sixth annunciator level; its physical mapping remains provisional. Its
later fall must not replace the exact result-frame condition.

For HP39g+ 1+1, the post-Enter interval contains 6,912,000 quanta,
6,911,909 counted instructions and 1,151 exception entries. The corresponding
HP48gII interval has 2,820,000 quanta, 2,819,969 instructions and 764 exception
entries. The small difference between quanta and counted instructions does not
support a long WFI interval dominating these samples. It does not establish
that all counted instructions are arithmetic: software exception instructions
and guest polling also count. Exception entries cannot simply be subtracted
from the instruction or tick counters.

The earlier Chrome reports started their Enter metric at the PC key event,
while this tool starts it at the actual matrix contact. Their first physical
contact guest phases were not recorded. In particular, subtracting these
fixed-phase profiles from the earlier browser wall times would not measure
notification overhead. The next profiling target is the post-Enter guest
execution and its clock relationship. Current clock snapshots report divisors
4 and 2, but this experiment and the production UI use `run()`, not the opt-in
`run_divided()`; those ratios alone are not a physical clock calibration.

Reproduce with the exact two recorded production WASM builds and private NORs;
the output file must not already exist:

```sh
node tools/profile-input-latency.mjs ../orchard-baseline/dist/orchard.wasm dist/orchard.wasm /private/nors build/input-timeline.json
```

`--sample-ticks` changes the observation resolution and `--phase-ticks` changes
the chosen starting phase. Such runs are separate experiments and must retain
their own report. This measurement does not justify shortening the validated
hold/gap timings or silently selecting the divided runner.

### Clock observations during input

The profiler also copies all six clock registers after each existing successful
`run()` call. Its canonical reference does not sample clocks inside the run loop.
The new eight-profile run passes the same four full-checkpoint references, and
every pre-existing measurement field matches the preceding input report
exactly. Each profile contains 20,001 clock snapshots, separated by 736 to
1,024 quanta. These are boundary observations, not an MMIO write trace; a value
changed and restored within one core call can be missed.

| Model / expression | Observed CLKCON changes | Observed CLKSLOW changes | Observed CLKSLOW values |
| --- | ---: | ---: | --- |
| HP39g+ / 1+1 | 1,849 | 8 | `0x30`, `0x0` |
| HP39g+ / 7*8 | 1,830 | 8 | `0x30`, `0x0` |
| HP48gII / 1+1 | 1,548 | 2 | `0x30`, `0x0` |
| HP48gII / 7*8 | 1,052 | 2 | `0x30`, `0x0` |

Both builds have identical clock observations. No boundary sample observes a
change to LOCKTIME, MPLLCON, UPLLCON or CLKDIVN in these windows. For HP39g+
`1+1`, CLKSLOW is first observed at zero 57,216 quanta after Enter and back at
`0x30` after 7,571,264 quanta. The result pixels first match after 6,912,000
quanta. Thus an initial or final snapshot alone misses a relevant change during
the result interval. The record includes each change's previous observation
boundary; these ticks are not exact register-write timestamps.

The [Samsung S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
sections 7-21 and 7-22, defines `0x30` as slow mode with MPLL off and notes that
the CLKCON IDLE request bit does not clear automatically. It also describes a
CLKDIVN bit-2 mode outside the current low-two-bit divider implementation.
An initial PLL register value therefore does not establish the active physical
CPU frequency, and a set IDLE bit does not establish that the CPU remains idle.
The emulator currently stores these clock MMIO values without a complete
PLL/slow-mode/IDLE model. These observations identify a hardware-modeling task;
they do not justify switching the production runner or changing the 12M
functional reference in this performance patch.

## Opt-in stop capture and replay

`tools/probe-browser-latency.py --diagnostic-trace` adds a test-server wrapper
around the production Worker's core API. The default probe and shipped Worker
remain uninstrumented. The wrapper records guest-affecting calls, their exact
arguments, return values, before/after ticks and stop state, together with
Worker generation and checkpoint epoch. It copies UART/USB input and output
bytes needed for replay. Unknown operations, traps, missing payloads and
overflow mark the trace incomplete; strict replay refuses incomplete traces.

At the first core stop, the wrapper freezes the call sequence and complete
checkpoint synchronously, before Pause can release held keys. A later Save or
cleanup cannot replace this immediate stopped state. Successful input trials
can also capture complete records at explicit diagnostic boundaries. Raw
traces and both checkpoint files stay private; only identities, counts and
acceptance results belong in public evidence.

`tools/replay-browser-trace.mjs` verifies the ROM and WASM identities, restores
the initial complete checkpoint and checks each recorded API return, tick and
stop result, plus UART/USB bytes. It then compares all final CPU state words
and the entire final checkpoint. This is not a claim that every intermediate
CPU word or LCD frame was compared. A different WASM requires the explicit
`--compare-build` option; same-build replay is the default.

Both generated-guest Chrome recovery paths passed in this execution instance:
the uninstrumented production Worker and the opt-in wrapper. The wrapped
generated stop was captured at tick 2 and replayed successfully. The generated
browser witness has no held key at its stop; its result establishes immediate
capture and recovery, while held-key immutability and malformed trace handling
also have separate Node controls.

Final review tightened two diagnostic boundaries: operation names must be
strings before API lookup, and sending a checkpoint restore immediately
invalidates the preceding trace association until a new checkpoint-load epoch
arrives. Fifteen negative trace controls and pending-restore observer controls
pass. A separate three-call generated Node witness stops with a key held, then
proves that release changes the live checkpoint while the captured checkpoint
remains immutable and strictly replays. The final instrumented generated
Chrome regression also passes after these changes; the earlier original-ROM
reports retain their own execution-source hashes.

A bounded HP48gII Unlimited diagnostic group completed two trials and four
expressions with no retries. All four private traces replayed on their own
captured WASM with identical final complete checkpoints: 105,412 API calls,
including 52,240 core run calls. These were successful executions, not a
reproduction of the original stopped trial. The browser's asynchronous key
arrival also produced different physical input phases in one trial. Do not
use this instrumented group for A/B latency or throughput claims.

The [continuation evidence](performance-continuation-2026-10-20.json) keeps
the report hashes, executed tool identities and subsequent validation changes
separate. Opt-in trace reports have `instrumented: true` and
`performance_sample: false`; the probe omits its usual expression latency
fields in this mode. The original HP48gII stop remains unclassified and keeps
the physical-read candidate out of default builds. See the release scope above
for the independently retained Worker change and the new default-build gates.

```sh
python3 tools/probe-browser-latency.py ../orchard-baseline/dist dist /private/nors build/new-stop-diagnostic.json --models 4 --speeds 0 --repeats 1 --diagnostic-trace --before-input-ms 175 --after-result-ms 100
node tools/replay-browser-trace.mjs /private/trace.json /private/48gii.bin dist/orchard.wasm build/new-replay.json
npm run test:trace
python3 tests/browser-stop-recovery.py --diagnostic-trace --new-report build/new-generated-trace.json
```

The Node trace regression requires a built `dist/orchard.wasm`; CI runs it
after the WASM build. Browser CI also exercises the generated instrumented
stop and preserves only its generated report and screenshot. Original-ROM
traces, checkpoint bytes and saved sessions are excluded from CI artifacts.

### Correlating host tasks with actual input contacts

The same explicit `--diagnostic-trace` mode also records a bounded Worker
runtime timeline. Production Worker source and ordinary latency samples do
not receive these hooks. The private core trace includes `runtime` events for
task queue/start/end, received commands, physical keyboard contacts and LCD
snapshot posting. Each event contains the actual core tick, pacing credit and
pending input state. Commands retain the main-thread observation sequence;
matching LCD results retain the Worker snapshot sequence and checkpoint epoch.
Strict replay rejects a broken association or a completion key which did not
reach the guest before the result snapshot.

`host_observation` preserves the DOM input and result-receipt timestamps in
the same private artifact. To correlate clocks, add each side's
`time_origin_ms` to its `at_ms` value. This separates command delivery, queued
input, guest progress and LCD delivery in that instrumented run. A task's
elapsed wall time includes host descheduling and instrumentation; it is not a
CPU-time measurement. DOM Enter remains distinct from the recorded physical
Enter contact. A restored checkpoint tick remains distinct from the tick of
the first physical contact.

The timeline retains at most 50,000 events and marks overflow incomplete.
Capturing a stop inside a task preserves that unfinished task explicitly;
later release/finally handlers cannot rewrite the frozen evidence. These
records are diagnostic only (`performance_sample: false`) and cannot establish
a speedup, explain a different uninstrumented outlier by themselves, or replace
the existing full-checkpoint replay. Deterministic `test:tools` regressions
cover the clock/sequence links, key ticks, event bound, epoch isolation and
stop capture without running a firmware benchmark.

An active timeout can occur before a stop capture exists. In diagnostic mode,
the failure handler first preserves the original observation and screenshot,
then attempts a bounded Pause and trace export. Export requires the same
Worker, generation and checkpoint epoch plus the matching paused snapshot;
a missing acknowledgement or changed identity is a recovery failure, not a
successful trace. Recovery errors are retained separately from the original
failure. The browser regression exercises a running timeout, missing Pause
acknowledgement and changed generation, including a complete generated-guest
checkpoint replay. Ordinary uninstrumented failure handling does not gain
these diagnostic operations.

## Continuing execution inside quiet intervals

The scheduled Legacy runner can continue at its existing CPU dispatch site
while a previously planned quiet interval remains valid. Entry requires no
unmasked interrupt source and no latched IRQ, independently of the current
CPU interrupt masks. Every instruction still executes, and each additional
instruction advances the same one functional quantum before CPU execution.

Guest MMIO reads and writes, including page-table walks through device
addresses, synchronize peripheral phases and invalidate the interval. The
inner loop also ends at sleep, a diagnostic stop, the next peripheral boundary
or the requested budget. Requiring an empty latched IRQ prevents a guest PSR
write from unmasking an interrupt inside a region that omitted its delivery
check. Reference execution and the opt-in clock policies retain their existing
outer-loop checks.

The two CPU step helpers are explicitly inlined only for non-Reference WASM.
Inspect the built module when changing this loop: the initial source change
caused LLVM to outline a step helper and introduce a call per instruction.
Source-level reductions alone do not establish a throughput improvement.
The scheduler differential matrix covers interrupt unmasking, device-backed
fetch and descriptors, MMIO synchronization, aborts, sleep and budget edges.
Use the fixed-checkpoint scene tool above and the uninstrumented browser probe
to assess throughput and user-visible latency separately.
