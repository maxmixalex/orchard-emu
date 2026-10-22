# ARM instruction-block diagnostic

The first bounded diagnostic finds **short eligible streams, rather than broad
long blocks**: the average block contains 1.84–1.96 pure data-processing
instructions after public-run and scheduled-event boundaries. This is an
instruction-structure result, not a speed measurement or a production change.
The complete aggregate [report](evidence/arm-block-profile-r13.json) contains
the length histograms, ALU adjacency matrices, working sets, cache simulations
and source/input hashes. It contains no firmware, raw opcode/PC trace, session
bytes or LCD pixels.

## Reproducible tool

`tools/build-arm-block-profile.mjs` creates a new output directory, hashes every
core input, and inserts an observer into a generated copy of `src/cpu.c`
immediately after the original successful instruction fetch. The original
fetch, interpreter, scheduler, checkpoint, MMU and bus implementations remain
unchanged. The five diagnostic exports are absent from the production build.
Duplicate/missing source anchors and changed source files fail the build.

```sh
CLANG=clang node tools/build-arm-block-profile.mjs build-block-profile
node tests/arm-block-profile.mjs
node tools/profile-arm-blocks.mjs \
  /local/baseline.wasm build-block-profile/arm-block-profile.wasm \
  /local/roms /local/fixtures.json /local/frozen-endpoints.json \
  /local/new-block-report.json
```

The replay accepts the existing hash-bound fixture and fixed-result endpoint
formats. It profiles HP39g+ `1+1`, `APLET library`, and `APLET Function START`
in that order, with the existing `run` entry point, 1024-quanta maximum calls,
12,000-quanta sampling boundaries, 1,500,000-quanta key holds, and
600,000-quanta gaps. It does not locate a new endpoint or alter input timing.
Each scene executes once without instrumentation and once with it. Both must
match the previously frozen final checkpoint, full LCD hash, UART hash,
instruction count and exact key contact sequence; complete checkpoint/LCD
bytes and final state are also compared directly between these two runs.

Reports do not contain elapsed times. The observer adds substantial work and
changes generated code layout, so its speed is intentionally not measured.
This diagnostic does not rerun or change any held optimization's acceptance
gate.

The C collector test covers all 16 ALU kinds, Thumb/failed conditions, memory
and branch exclusions, PC inputs/outputs, exception returns, invalid shifts,
public calls, quiet countdowns, exception/tick/PC/mode discontinuities,
zero-valued opcode tags, reset/finish, and unchanged complete machine bytes.
It runs in CTest, including Release and sanitizer configurations. The JS test
checks instrumentation anchors, command arguments and counter conservation.

## Eligibility and boundaries

The narrow candidate class is a condition-passed ARM instruction admitted by
the existing no-checkpoint data-processing path, with no live PC input or
output. Tests such as CMP have no destination and may use the otherwise ignored
Rd field; ignored Rn=PC fields in MOV/MVN are nevertheless excluded here.
Memory operations, branches, PSR/mode changes, Thumb and failed conditions are
excluded. This estimates one conservative implementation scope, not every
possible future block executor.

A natural stream requires adjacent instruction addresses, exactly one guest
tick, unchanged exception count and unchanged CPSR low byte between its
members. The bounded stream also ends at every original public `run` call and
whenever a positive quiet countdown does not decrease by exactly one. A change
in NZCV alone does not break a stream: each condition was evaluated using the
live flags at its own fetch. These observations do not establish permission
to skip instruction fetches, interrupt checks or fault behavior.

The collector records complete opcode tags only in private diagnostic memory.
Its exact set has 65,536 entries and fails the report on overflow. The four
preselected cache capacities use a direct-mapped multiplicative hash and
complete opcode tags, for eligible instructions only. Persistent and cleared
per-run simulations are both reported. No capacity was selected after looking
at the results; no simulated hit is treated as a runtime saving.

## Observed fixed-result workloads

The source baseline is the `c37eeefe94f83773ceedd2682d65532acc4881c6` tree
published by [PR #24](https://github.com/maxmixalex/orchard-emu/pull/24), main
`389c403ce037a47548ea085adf25508c41edb0ea`. The uninstrumented official WASM
is `76db5cb395cca4fffec807a76d3e969bf4cd73842662e39e81e38de4110527d0`.
No held CPU candidate is included.

| HP39g+ scene | Guest quanta | Retired instructions / successful fetches | Eligible pure DP | Bounded blocks | Mean length | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `1+1` | 13,104,000 | 13,103,802 | 6,639,451 (50.67%) | 3,612,267 | 1.8380 | 25 |
| `APLET library` | 12,264,000 | 12,263,844 | 6,449,059 (52.59%) | 3,293,482 | 1.9581 | 25 |
| `APLET Function START` | 16,164,000 | 16,163,798 | 8,485,321 (52.50%) | 4,332,546 | 1.9585 | 25 |

Percentages above are instruction frequencies, not time shares. Natural mean
lengths are 1.8486, 1.9702 and 1.9704 respectively; the run/event restrictions
are not the main reason these streams are short. About 42.50–44.69% of bounded
blocks contain just one instruction.

| Scene | All fetched instructions inside blocks of length ≥2 | Inside blocks of length 2–4 | Inside blocks of length ≥4 |
| --- | ---: | ---: | ---: |
| `1+1` | 38.35% | 33.90% | 7.87% |
| `APLET library` | 40.95% | 34.41% | 10.90% |
| `APLET Function START` | 41.10% | 34.92% | 10.22% |

These columns describe coverage and overlap; they are not additive or a
speedup estimate. A two-instruction group still needs correct behavior when
its second instruction faults or an interrupt/event boundary occurs.

The most frequent natural adjacent ALU-kind pair is MOV→MOV: 828,974,
958,531 and 1,309,468 occurrences respectively. ADD→CMP is second for `1+1`
(531,772); MOV→AND is second for both APLET scenes (438,613 and 586,711).
The matrix groups by ALU kind only. It does not establish immediate/shift
forms, operand dependencies or a profitable specialized handler.

## Opcode working set and cache counterexample

| Scene | Distinct eligible opcodes | Mean distinct per public run | Maximum distinct per run |
| --- | ---: | ---: | ---: |
| `1+1` | 1,257 | 96.56 | 246 |
| `APLET library` | 1,245 | 122.56 | 233 |
| `APLET Function START` | 1,242 | 124.05 | 236 |

| Entries | `1+1`, persistent / per-run hit rate | Library, persistent / per-run | Function START, persistent / per-run |
| ---: | ---: | ---: | ---: |
| 64 | 61.66% / 56.88% | 53.58% / 48.59% | 52.47% / 47.40% |
| 256 | 89.09% / 75.97% | 87.10% / 71.52% | 87.00% / 71.04% |
| 1024 | 96.76% / 79.63% | 96.26% / 75.36% | 96.28% / 75.05% |
| 4096 | 99.26% / 80.66% | 99.12% / 76.37% | 99.09% / 76.06% |

In particular, a small 64-entry cache cleared at each run does not approach a
universal hit. Even a 4096-entry per-run cache misses about 19–24% of eligible
references. These simulations omit lookup/decode/store/initialization costs,
and cover this conservative DP scope only. They do not revive the previously
held classification-cache or validated-DP proposals.

## Decision and evidence limits

Do not implement a generic long-block executor from the prior aggregate
53–57% fast-DP frequency. This diagnostic shows why that inference was
insufficient. Small two/three-instruction specializations remain a research
possibility, but need operand-form/dependency and actual generated-code cost
evidence. Reusing a same-page fetch proof only within such a block would need
its own precise fault/interrupt/self-modification argument; this collector
does not change or authorize that mechanism.

### Relationship to the held fetch-reuse implementation

[PR #7](https://github.com/maxmixalex/orchard-emu/pull/7), local implementation
`821ce118ed6841746a5655dd633697f9021d589c`, already retains a validated 1 KiB
mapping only within one synchronous run, invalidates before peripheral work
and accepted IRQ/FIQ, and retains it only across ARM instructions without bus,
CP15 or bank changes. It still reads the current opcode through the original
physical bus on every instruction. Descriptor storage and the complete
instruction page must be ordinary NOR/SRAM/boot SRAM; MMIO, counted aliases
and NOR software-ID mode cannot seed the proof.

A stricter same-page, sequential, positive-quiet, pure-DP-only proof is a
subset of that mechanism. Pure instructions cannot write page tables or code;
host mutations cannot interleave a synchronous call; peripheral events and
instructions that could change the mapping end the proof. The existing 1 KiB
key preserves the smallest permission granularity, and a page change returns
to normal translation before the next instruction. Its preserved physical
read remains responsible for current bytes and any read failure. This is an
argument about the current functional implementation, not permission to skip
future DMA or newly asynchronous bus behavior.

The recorded reason PR #7 is held is **unfavorable performance screening, not
a demonstrated invalidation/correctness failure**. Its focused correctness
and exact-head CI gates passed. That one fixed-work screen recorded slower
HP39 `1+1`, Library and Function cases; the retained variable timings do not
prove a stable intrinsic penalty. Restricting the same proof to a smaller
class does not add a new saved operation. Before revisiting it, a distinct
generated-code/guard-placement improvement must establish a new cost case;
renaming or resampling the existing held implementation is not justified.

The three scenes passed full fixed-work consistency checks. No new CPU
optimization, throughput improvement, UI-latency measurement or all-model
result is claimed. The earlier held candidates keep their existing results.

Evidence identities:

- Aggregate report SHA-256: `51e561dc6e19d52328aac0d95842ca8200fb1d89927493cc22418b24d3177f4b`.
- Diagnostic WASM SHA-256: `a9bfd0d84572a72bfcca364e7553556a18bb4d7b57089ae5f0695da0b2f1c8c2`.
- Successful build manifest SHA-256: `eb92ca552f6114edfe87578d9644810adcb70bbfc73987e9ad85bc154f3c8412`.
- Fixtures SHA-256: `aafc4ea8275d9635b8f83b8a475e947257123e40f0e717846e54d4b7fa41993c`.
- Frozen endpoint report SHA-256: `efdf7f649877b3f1ce332cba86cbd5d175552c8b7da4bbadd72f2dd684e6f984`.

The first local build orchestration was denied at `clang --version` by the
execution sandbox (`EPERM`), before compilation or guest execution; its failed
manifest is retained locally. The permitted build and the three-scene replay
then each ran once. Native collector ASan/UBSan checks passed; LeakSanitizer
was disabled because this host cannot provide its ptrace support.

## Operand pairs: concrete specialization scope (2026-10-22)

The v2 collector separates overlapping neighbors from disjoint pairs:
positions (1,2), (3,4), and so on, restarting at every existing bounded-block
boundary. Pairing happens **before** filtering by opcode family; this is a
fixed alignment, not the maximum possible nonoverlapping match for a selected
family. Every eligible instruction belongs to one disjoint pair or one odd
block tail, and the summary verifies that conservation rule.

Each structural signature contains the two ALU kinds, twelve operand forms,
GPR RAW/WAR/WAW dependencies, conditional execution, flag writes, and flag
dependencies through conditions or carry inputs. Ignored MOV/MVN Rn and test
instruction Rd fields do not create false dependencies. RRX consumes carry
without S; logical S instructions preserve carry for unshifted operands and
register shifts whose observed low eight Rs bits are zero. Preserving a flag
is not classified as consuming or writing it. The diagnostic exposes no
opcode, PC, register number, immediate value or guest byte. Its 65,536-entry
exact signature table fails on overflow.

The complete compact [aggregate](evidence/arm-operand-pairs-r16.json) retains
all 450 / 443 / 442 observed signatures. MOV→MOV, ADD→CMP and MOV→AND were
preselected from v1's counts, before running the v2 diagnostic.

### Original-ROM result

Production core `640a229` supplied a fresh 100M-quanta HOME checkpoint. The
original HP39g+ ROM, three existing expected LCD hashes, 1,500,000/600,000-quanta
contacts and 12,000-quanta sampling produced the same workload endpoints and
instruction counts as v1. Each frozen workload then ran once on production
WASM and once on diagnostic WASM. Complete checkpoints, LCD bytes, UART hashes,
input contacts and instruction counts all matched. No host time was measured.

| HP39g+ scene | All disjoint pure-DP pairs | Paired instructions / all fetches | Simple independent MOV→MOV pairs¹ | Their instructions / all fetches |
| --- | ---: | ---: | ---: | ---: |
| `1+1` | 2,272,944 | 34.69% | 275,350 | 4.20% |
| APLET library | 2,218,484 | 36.18% | 307,596 | 5.02% |
| APLET Function START | 2,931,334 | 36.27% | 416,284 | 5.15% |

¹ Both instructions are unconditional, do not write flags, use an unrotated
immediate or unshifted register, and have no GPR RAW/WAR/WAW dependency.
These percentages count both instructions in each pair, with all successful
fetches as the denominator. They are neither CPU-time shares nor speedups.

The largest `1+1` signature is **ADD immediate → CMP immediate** with a GPR RAW
dependency: **484,027 disjoint pairs**, covering 7.39% of its fetched
instructions. Two independent unshifted-register MOVs account for **231,632 /
280,345 / 375,867** pairs across the three scenes. A separate LSR-immediate
MOV → LSL-immediate MOV form contributes **173,429 / 214,893 / 296,572** pairs.

The next concrete cost study is an independent MOV pair and the ADD→CMP
forwarding form, assessed separately. Generated code must demonstrate a
specific register access or decode saving after paying recognition guards.
The first instruction's architectural result must still be visible to an
interrupt or a fault fetching the second instruction. Reusing a mapping alone
would repeat the held fetch-reuse candidate; these observations do not supply
a new cost justification for that mechanism.

The collector passed native Release assertions, ASan/UBSan, JS signature and
counter validation, and the three original-ROM comparisons. Tests cover all
condition masks, ignored operand fields, RRX, zero/256-valued register shifts,
run/event/discontinuity boundaries, zero signatures, overflow and reset.
Production CPU execution remains unchanged.
