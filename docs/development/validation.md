# Validation record

## Historical evidence — initial 2026-10-02 local handoff

This section preserves the initial handoff report. The exploratory harness
was not included in the archive, so these counts are not rerun evidence.
The source contains an executing ARM hardware bring-up core. It does **not**
contain evidence of a genuine HP ROM cold boot, a usable stock calculator, a
host-OS virtual USB device or successful remote CI. These distinctions apply
to every model, not just an unsupported subset.

| Check | Actual result | What it does not prove |
| --- | --- | --- |
| Native CMake build, warnings as errors | Passed; GCC host build with ASan/UBSan | Stock firmware or Windows/macOS compatibility |
| Freestanding Clang WASM build | Passed; module instantiates and executes under Node | Production browser interactions |
| Directed/randomized local assertions | 74,970 passed | Exhaustive ARM920T conformance |
| Isolated random dispatches | 200,000 completed under ASan/UBSan without a report | Correct semantics for every dispatched opcode or long guest sequences |
| Synthetic six-profile native/WASM comparison | State, UART output and framebuffer match; reset/replay matches | Six real HP machines booting |
| Native CLI rejection/output-safety checks | 14 passed, including invalid budgets and output aliases | General host filesystem fuzzing |
| Clang static analysis | No diagnostics after the EOF-state handling fix | Absence of all bugs |
| JavaScript syntax checks | Passed | Browser functional correctness |
| Zensical configuration/navigation/local link targets | Checked with `tools/check-docs.py` | Rendered site or anchor correctness |
| Zensical strict render | Not run; package unavailable in the local environment | No docs build pass is claimed |
| Production browser E2E | Blocked by browser navigation policy | No screenshot, interaction or mobile-layout pass is claimed |
| GitHub publication | Initial handoff claimed read-only access; subsequent inspection found an existing LICENSE commit and issue #1 | See the import record below; no Pages publication is claimed |
| Real HP firmware/hardware comparison | Not run | No stock-boot or hardware certification |

## Local toolchain and source identity

GCC 14.2.0, Clang 17.0.0, CMake 3.31.6 and Node 22.16.0 were used locally.
The source-set SHA-256 is
`ed9ce4caea5fa25d33e57e40e5883f01837c46e89ca051206b1d6aff83a1f096`.
It is calculated over sorted C/header paths in `src/`, `app/` and `include/`,
feeding each relative POSIX path, NUL, file bytes and NUL in that order. This
binds the historical local results to the original source set.

## Directed checks

The exploratory local harness used independently calculated integer/flag
expectations, not a copy of another emulator. Its assertion counts are:

| Group | Assertions |
| --- | ---: |
| Barrel shifts and carry edge cases | 12,104 |
| All condition-code/flag combinations | 256 |
| ARM data-processing results and flags | 38,400 |
| Thumb ALU results and flags | 24,000 |
| Register banking, SWI and SPSR return | 26 |
| Physical endian/alignment behavior | 14 |
| Selected MMU tables, domains, AP/S/R and FCSE | 156 |
| Explicit stops and data abort | 4 |
| Selected timers, INTC and UART behavior | 10 |
| **Total** | **74,970** |

Arithmetic/shifter checks used deterministic seed `9202410`; the isolated
instruction dispatch sanitizer workload used xorshift seed `0x09202410`.
Counts include multiple assertions per operation and are **not** counts of
independently validated instructions, firmware scenarios or supported features.
CPU randomization was isolated rather than a long stateful fuzz campaign.

## Synthetic integration witness

A new 362-byte ARM/Thumb assembly payload was assembled for ARM920T, then padded
with erased bytes to each candidate NOR capacity. It is **not HP firmware**.
It begins at the physical reset vector, installs guest section tables, enables
the MMU, crosses ARM/Thumb boundaries, takes and returns from a software
interrupt, executes a Thumb call/stack return, emits UART text, echoes a host
byte, fills a raw LCD framebuffer and enters WFI.

| Synthetic size | SHA-256 |
| ---: | --- |
| 1,048,576 bytes | `1a99508d55f0f66a52c8b68a111e4a339c3af2c65f7ba3bca5161abcc725ada0` |
| 2,097,152 bytes | `6626e242ce8f8745c2e961a631e095e60578c59d0b1eeee382b7b9ba5fb805ea` |

For each of the six profiles, native and WASM runs consumed 10,000 virtual
ticks, dispatched 4,514 instructions, recorded one exception, ended at
`PC=0x000000c4`, `CPSR=0x600000d3`, `CP15 control=0x79`, and were asleep without
a diagnostic stop. UART bytes were `ORCHARD ARM/THUMB OK\n!`; framebuffer pixels
matched exactly at the profile's configured visible dimensions. A cold reset
and identical input replay reproduced the same state.

The WASM binary built for this handoff has SHA-256
`cbee5f45958dface655d8ce4a2416de075afd8232cab72d963ae360c3a883052`.
This digest identifies that build, not a promise that all compiler versions
produce the same bytes.

## Reproducing maintained build checks

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug -DORCHARD_SANITIZE=ON
cmake --build build --parallel
./build/orchard models
npm run check
npm run build
python3 tools/check-docs.py
```

With the pinned documentation package installed, also run
`zensical build --strict`. Local LLVM builds can run static analysis on
`src/*.c` and `app/main.c` with the include directories `include` and `src`.
The opt-in workflow provides a repeatable build/docs job, not a claimed
full instruction/ROM regression suite.

The exploratory harness, synthetic images, sanitizer executable and test
reports are kept outside the production/source handoff archive. Therefore
these counts document an observed local experiment, **not** a checked-in CI
suite that a fresh checkout can currently reproduce in one command.
Establishing a maintained regression corpus is explicitly still M0/M1 work.

## Required next witnesses

Close instruction edge cases and bounded stateful/peripheral fuzzing, admit
one model-correct full NOR, and record real stock cold-boot/physical-input/
ARM-return behavior. Separately run the production browser workflow on an
allowed origin. Preserve the distinction between a successful guest payload,
returned control flow and a responsive visible stock UI.

## Repository import verification — 2026-10-02

The existing LICENSE history and issue #1 were read before writing. The source
import uses the LICENSE commit as its parent; it does not replace main history.
The following commands were rerun against the extracted source:

```sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
./build/orchard models
npm run check
npm run build
```

All completed successfully (GCC 14.2.0, Clang 17.0.0, Node 22.16.0). This is
compile/profile evidence, not a rerun of the 74,970 historical assertions.
Zensical package installation encountered a network/DNS failure; no strict
render is claimed. A Git LFS pointer was retrieved for the existing HP39g+
fixture, but binary retrieval failed locally; no genuine ROM was executed.
Subsequent technical acceptance must record its own input and result below.
