# Validation

## Current local acceptance — x16 NOR / conditional OS prompt

Base `e236fcc`. The only production-core change is the selected x16 NOR
word-write adapter. No CPU instruction, MMU mapping, RAM capacity/alias,
USB readiness, panel mapping or firmware bytes are changed.

| Check | Local result | Scope |
| --- | --- | --- |
| GCC 14.2 Release CTest | 5/5 pass | Release-active assertions |
| Clang 17 Debug ASan/UBSan CTest | 5/5 pass | ROM-free suites |
| Clang 17 optimized ASan/UBSan CTest | 5/5 pass | ROM-free suites |
| Native / test-WASM assertions | **176,140 each**, zero failures | Prior 174,166 + 1,974 bus assertions |
| ROM-tool checks | **75 pass** | Added bounded budgets and canonical GPIO order |
| Six production integrations and existing circuit/LCD/ADC/USB guests | Pass | Prior controls and cold replay retained |
| New executing-NOR guest | Pass, native / production WASM and both cold replays | 4 KiB STM zero-fill, unchanged executing ROM and vector/data reads, unknown-part negative control |
| External Unicorn default corpus | **17,075 cases**, zero mismatches/skips | Same defined ARMv4T subset, not NOR or full-board proof |
| Static analysis | 24 compilation units, no diagnostics | One additional test unit |
| Documentation navigation / links | 20 pages | Remote strict render/Pages remains a separately observed gate |

The new bus suite compares an aligned word against two ordered halfword cycles
across prefix/ID states, addresses and command values. It also tests invalid
width/alignment, exact-end rejection before any cycle, explicit unimplemented
program/erase/CFI/security commands, unknown-part rejection, capacity guards,
and original ARM STM execution with byte-for-byte unchanged flash. SRAM
remains exactly 256 KiB on the HP48gII profile; a boundary read stays unmapped.
Restoring the old unconditional word rejection causes 1,579 of the 1,974 new
checks to fail; restoring the adapter returns zero failures. That external
mutation never entered the submitted tree.

A long probe exposed an existing metadata-normalization bug: the native CLI
emits GPIO conditions in port order while the JavaScript parser preserved
argument order. The parser now canonicalizes port order, with an explicit
out-of-order regression. This changes reporting/order of disjoint stimuli,
not their values or guest execution. No failed long-probe attempt is counted
as a completed comparison.

[Startup memory](startup-memory.md) records the genuine full-NOR checkpoints,
original recovery prompt and first SRAM-boundary abort. Firmware results are
separate from the ROM-free assertions. Four complete full-NOR comparisons now pass on native/production WASM and
both cold replays: the unchanged strict 39g+/48gII checkpoints, the 50M-tick
HP48gII prompt, and its exact first data-abort endpoint after NO. The original
143-step HP50g boot-only USB session also passes again, retaining its NAK
counterexample. The earlier 13-case table is historical, not a claim that all
thirteen scenarios were rerun in this slice. A separate long optimized
sanitizer prompt attempt exceeded the local execution limit and is not an
accepted instrumented firmware result; the five short sanitizer CTest suites
are accepted independently. Commit-specific CI, actual artifact verification
and Pages results are recorded in issue #1 only after completion. No screenshot, trace, firmware or oracle
binary is included in production packages. Earlier sections below are
historical and do not automatically certify this revision.


## Prior evidence by exact revision

The [e236fcc validation record](https://github.com/zyf722/orchard-emu/blob/e236fccd55947c119b4439eee85e2aa9825831de/docs/development/validation.md)
retains the complete USB publication, original 143-step transcript, thirteen
pre-adapter firmware/control probes, historical sanitizer scope, and the
three-seed Unicorn introduction. These are prior results, not additional
current-case counts. [Independent CPU evidence](cpu-oracle.md) and
[USB evidence](usb.md) retain their input and acceptance contracts.

## Repeatable commands

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run build:oracle
# In a separate environment with tools/requirements-oracle.txt installed:
python tools/check-unicorn.py
python tools/check-docs.py
```

Debug and RelWithDebInfo instrumentation use Clang with
`-DORCHARD_SANITIZE=ON` in separate build directories. Strict documentation
rendering and Pages deployment must be observed separately from the Markdown
navigation check. Ordinary CI remains ROM-free; long firmware checkpoints
use private local inputs and the explicit command in
[startup memory](startup-memory.md).
