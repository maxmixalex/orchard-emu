# Validation

## Current local acceptance — 2026-10-02 native-input research

These are results from checked-in tests and explicit local research commands.
They do not certify a complete ARM920T, a real board's idle pin levels, or a
responsive stock calculator. Ordinary CI is ROM-free.

| Check | Observed local result | Boundary |
| --- | --- | --- |
| GCC 14.2 Release build and CTest | Pass | C17 core, CLI and test targets |
| Clang 17 Debug ASan/UBSan and CTest | Pass | Same maintained core suite |
| Shared native / test-WASM regression | **100,423 assertions each**, zero failures | Not an independent ARM emulator oracle |
| ROM tooling checks | **45 checks**, pass | Synthetic metadata, format rejection, bounded reads and GPIO syntax |
| Invalid CLI GPIO arguments | **14 cases**, pass | Fail before output creation |
| Six generated-guest integrations | All pass | Production native CLI/WASM, explicit GPIO input, UART, LCD and cold replay |
| Ten real-NOR / native-boot probe scenarios | All host comparisons and cold replays pass | Strict and explicitly conditioned cases below; no stock boot |
| HP48gII bounded input sweep | **2,048 variants**, all agree; also under ASan/UBSan | One 8,192-quantum checkpoint window, not all future execution |
| Clang static analysis | 13 translation units, no diagnostics | Includes the optional native research helper |
| JavaScript syntax and production WASM build | Pass | No actual browser lifecycle E2E in this slice |
| Documentation navigation/local targets | 14 pages, pass | Strict Zensical rendering is a separate remote gate |

The C suite's checks remain active with `NDEBUG` in Release. New cases cover
explicit GPIO inputs, output/input separation, rejected masks, release/reset,
and all 2,048 combinations in an independently constructed RMW sequence.
The test-only WASM module is not distributed; the integration uses the separately
built production module. Seed for the existing deterministic random checks:
`0x09202410`. None of these counts is a count of supported instructions or
independent stock-ROM boot scenarios.

## Reproduce the ROM-free checks

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
./build/orchard-regression
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

`npm run test:wasm` expects native binaries under `build/`;
`ORCHARD_BUILD_DIR` selects another directory. Temporary synthetic flash files
are removed on success or failure. Tests and the optional GPIO-window helper
are neither installed nor included in `dist/`.

## Explicit firmware research cases

At a 2,000,000-quantum budget, the following ten cases were run twice on each
host. They were also repeated with the sanitizer-native CLI against production
WASM. All exposed registers, CPSR, CP15 control, fault state, counters, stop
metadata, framebuffer and UART agree; cold replays agree. Every case reports
zero guest exceptions/data-fault state and `boot_verified=false`.

| Input / external condition | Retired instructions | Stop PC | Next missing device |
| --- | ---: | --- | --- |
| HP39g+ full NOR, strict | 514,293 | `000035e8` | LCD `4d000068` |
| HP48gII full NOR, strict | 94,497 | `08001820` | GPDDAT `56000034` |
| HP48gII full NOR, D input mask `cc7f`, all low / all high | 1,121,326 each | `08001b60` | GPGDAT `56000064` |
| HP49g+ original boot region, strict | 415,989 | `08001afc` | GPDDAT `56000034` |
| HP49g+ boot region, D mask `cc50`, all low / all high | 419,223 each | `08002148` | USB write `52000144` |
| HP50g original boot region, strict | 94,497 | `08001820` | GPDDAT `56000034` |
| HP50g boot region, D mask `cc7f`, all low / all high | 153,879 each | `08001b60` | GPGDAT `56000064` |

The paired rows represent two cases each. Low/high equality does not establish
all intermediate inputs or the electrical state of a physical board. The
49g+/50g cases supply only the unchanged 16 KiB native boot region with an
explicit erased remainder, **not the OS or a recovered full dump**.
See [native input provenance](native-roms.md) and [boot research](boot-research.md).

The conditioned HP50g boot-only case produces 858 nonzero raw pixels. Forensic
inspection finds a boot recovery menu in the guest buffer, but the current
controller preview has a per-byte bit-order counterexample. The readable
alternative interpretation is not accepted as a verified panel mapping.
No stock UI or validated display rendering is claimed from those pixels.

```sh
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 2000000 --gpio-input D:cc7f:0 --output /new/path/48-low.json
node tools/probe-rom.mjs --model hp50g --bootloader /private/boot-50g.bin \
  --ticks 2000000 --gpio-input D:cc7f:cc7f --output /new/path/50-high.json
node tools/probe-gpio-window.mjs /private/48gii.bin
```

Probe v2 records original input identity, backing-image construction, explicit
GPIO conditions and executable hashes separately. It snapshots input bytes
once so all runs use the same bytes. Existing output files are not overwritten.
Cold reset releases external inputs; the probe explicitly reapplies them.
The web workbench does not silently install these conditions.

The GPIO-window wrapper admits only the pinned HP48gII hash. The native helper
checks the exact stop PC, opcode, input mask and configuration before taking
an internal checkpoint. Each variant reexecutes the stopped instruction and
8,192 quanta; all inherit the same already-consumed diagnostic tick. It compares
every PC, final exposed architectural state, SRAM, LCD registers and driven
output pins. All variants end at `08002a2c`; SRAM differences are zero and NOR
is unchanged. This is a bounded sensitivity experiment, not a cold boot or
proof of unbounded equivalence. It is opt-in and never runs on normal CI.

## Remote evidence and deployment

The prior accepted implementation is `d08d349`, [Build #5](https://github.com/zyf722/orchard-emu/actions/runs/36987825036)
and [Documentation #2](https://github.com/zyf722/orchard-emu/actions/runs/36987825071).
Those runs accepted the previous 88,023-assertion/13-page baseline and published
Pages, not this slice's expanded counts. M0 was originally closed by Build
#2/#3. Current revision-specific CI conclusions and artifact links are tracked
in [issue #1](https://github.com/zyf722/orchard-emu/issues/1).

The build workflow runs the expanded ROM-free tests and static analysis. The
Documentation workflow strictly renders the site, publishes only documentation,
and checks the live homepage, provenance pages and exact `revision.txt` commit.
Local Zensical installation was unavailable; no local strict-render success is
asserted. An observed remote strict render is required for its acceptance.

Firmware and manuals acquired on the private research branch were downloaded
for local investigation, not executed there. No firmware, reports, private
traces, signed URLs or research artifacts enter Git or Pages. Repository
visibility is unchanged.

## Open correctness gates

Independent CPU conformance, undefined exceptions, precise abort/writeback,
cache/TLB semantics, keyboard wiring, the LCD `+0x68` read and panel bit mapping
remain open. Stock ARM payload return, sustained calculator usability, actual
browser lifecycle E2E, SD and USB transfers require independent witnesses.
