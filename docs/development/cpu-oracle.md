# Independent CPU differential with Unicorn

## Why this is separate from native/WASM equivalence

Native and WASM previously compared two builds of Orchard's own interpreter.
They can agree on the same semantic mistake. This optional developer check
executes identical isolated instruction/state records in a separately installed
Unicorn engine and in both Orchard hosts. It adds an independent implementation,
not independent physical hardware or a second specification.

Pinned reference: [Unicorn 2.1.4](https://github.com/unicorn-engine/unicorn/tree/2.1.4).
Its [README](https://github.com/unicorn-engine/unicorn/blob/2.1.4/README.md)
describes a QEMU-based CPU framework, not a model of the HP calculator board.
The [ARM model list](https://github.com/unicorn-engine/unicorn/blob/2.1.4/include/unicorn/arm.h)
contains TI925T but no explicit ARM920T selection. The harness explicitly
selects **TI925T before engine initialization** rather than relying on the
newer default ARM926. It compares a defined common ARMv4T subset only.
This is not a claim that TI925T and ARM920T have identical CP15, MMU, cache,
exception or implementation-defined behavior.

## Runtime and licensing boundary

Unicorn's core is GPLv2; upstream bindings/headers have their own stated terms.
It is not copied, linked into or distributed with Orchard's MIT C17 core,
production WASM, native application, Pages site or downloadable web artifact.
It is installed separately in a developer/CI virtual environment. The Python
driver loads Unicorn; separate native and Node processes run Orchard through
a fixed binary test protocol. No external emulator implementation is imported.
This architecture describes the actual dependency boundary, not a formal
clean-room or legal certification.

The normal CMake/native/web build needs no Unicorn installation. CI runs the
optional comparison in an additional developer-only step using
`tools/requirements-oracle.txt`. It still contains no ROM dependency.

## Accepted local cases

Three deterministic seeds were run at the default sample count. Each produces
**17,075 cases**, totaling **51,225 executed case instances**. The 75 directed
PC/branch-exchange cases repeat across seeds; the total is not a count of
unique opcodes or of supported instructions. Every accepted case compared
successfully on native Orchard, test-WASM Orchard and Unicorn, with **zero
mismatches and zero skipped cases**.

| Seed | Cases | Corpus SHA-256 |
| --- | ---: | --- |
| `0x09202410` | 17,075 | `85710d4d9963872cb74fa052ae982ecccb6f31611e3b16e1ed854ee94bb4c81f` |
| `0x12345678` | 17,075 | `bee0c80c0b00e127035164b1e5badb1cffdfaa1e738c857db139179ec1f2d0c2` |
| `0xdeadbeef` | 17,075 | `d5aca1783d1635e659c94b781dbe53a1bcc8ef4af18355c59b43de2628e214e5` |

The default seed additionally passed with the optimized Clang ASan/UBSan
native runner. These are isolated instruction comparisons, not long randomized
programs. The pre-existing **174,166 assertions per native/test-WASM host**
remain a separate regression count; do not add unlike metrics together.

Families cover ARM data processing/immediate/register shifts, condition codes,
unsigned/signed multiplication, aligned byte/word/halfword and signed memory
accesses, single and multiple transfers/writeback, SWP, branches; Thumb ALU,
immediate/shift, load/store, block and stack operations, conditional branches;
and directed ARM/Thumb BX and ordinary PC-relative immediate reads.

The comparison checks all sixteen registers, defined CPSR bits, absence of
an Orchard diagnostic stop, and a **256-byte data window**. It does not inspect
all physical memory or certify access ordering. Thumb MUL conservatively
excludes C/V from the oracle mask for pre-v5 portability; its register result,
NZ and remaining CPSR bits still compare. ARM multiplies here do not set flags.
The mask is part of the hash-pinned corpus, not a response to a failed result.

## Generation and replay discipline

`tools/cpu-oracle.c` is a test-only adapter around the same `o_cpu_step` used
by production. Input/output records are fixed 328-byte little-endian blocks.
They contain an opcode, CPSR, sixteen registers and the bounded data window.
The CPU is reset for each case; code starts at SRAM base, or its second
halfword in Thumb state. There is no scheduler/peripheral tick or ROM input.
Only user/system initial modes are accepted. The adapter is not installed.

`tools/build-oracle.mjs` produces a **separate test module** under `build/`,
not `dist/`. The Node transport enforces the same record boundaries and a
100,000-case limit. The default run also checks twelve malformed-record
rejections across the two transports. The Python driver records native/WASM
binary hashes and a corpus hash including the initial state, comparison mask
and family label. Optional reports are created exclusively; existing files
are never overwritten.

Unicorn CPU context and the relevant memory are restored on each case. Its
translated code cache is explicitly invalidated when installing another
opcode at the same address, as required by its
[FAQ](https://github.com/unicorn-engine/unicorn/blob/2.1.4/docs/FAQ.md).
Thumb start addresses carry the state bit. Oracle exceptions or unsupported
encodings fail the run and require review; no catch-and-skip success path exists.

Exploratory generation exposed nonzero reserved MOV/MVN/MUL fields and
register-controlled shifts involving PC. These were corrected/excluded from
the defined common subset, not used to change the production CPU to match a
different implementation. Post-indexed halfword W encodings and overlapping
legacy multiply operands are likewise constrained. See the ARM/Samsung
specifications linked in [references](references.md); Arm's
[LDRH encoding description](https://support.arm.com/documentation/ddi0406/c/Application-Level-Architecture/Instruction-Details/Alphabetical-list-of-instructions/LDRH--immediate--ARM-)
separates P=0/W=1 from the ordinary post-indexed form.

Two out-of-tree negative controls intentionally corrupted the **same output
on both Orchard hosts**: one register bit and one data byte. Native and WASM
still agreed, but the independent comparison failed on case zero for each.
These mutations were removed and never committed. This demonstrates the new
check can detect a shared error missed by same-core host equivalence; it is
not a report that either mutation existed in the production CPU.

## Reproduction

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
npm run build:oracle
python3 -m venv build/oracle-venv
build/oracle-venv/bin/pip install -r tools/requirements-oracle.txt
build/oracle-venv/bin/python tools/check-unicorn.py
build/oracle-venv/bin/python tools/check-unicorn.py --seed 0x12345678
build/oracle-venv/bin/python tools/check-unicorn.py --seed 0xdeadbeef
```

On Windows use the corresponding virtual-environment `Scripts` executables.
The native transport switches standard input/output to binary mode there, but
Windows execution itself has not been validated in this slice. Use
`--native build-sanitize-opt/orchard-cpu-oracle` to compare an instrumented
native runner with the separately built test-WASM. `--output NEW.json` records
identities without overwriting existing data. No tool downloads firmware.

## Remaining M1 and startup work

This slice found **no production CPU mismatch within the admitted corpus**.
It does not close M1. Privileged banking/exception return, MMU permissions,
precise abort/writeback, cache/TLB, unaligned and implementation-defined
behavior, Thumb long-BL sequencing, long stateful runs and silicon comparison
need separate witnesses. QEMU-derived Unicorn is useful evidence, not an
infallible hardware specification.

The existing real-NOR startup store at physical zero and the original HP50g
GET_CONFIGURATION NAK are unchanged. Passing arithmetic/load/store cases does
not identify their causes or justify ignoring NOR writes. The next useful
extension is a minimized boot-trace witness plus an independently checked
privileged/MMU contract, while preserving the strict LCD/probe distinction.
