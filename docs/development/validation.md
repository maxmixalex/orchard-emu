# Validation

## Current local acceptance — full-NOR bring-up, 2026-10-02

| Check | Observed result | Scope / limit |
| --- | --- | --- |
| Native Release / CTest | Pass | GCC 14.2 C17 core and CLI |
| Native ASan/UBSan / CTest | Pass | Clang 17 Debug, same regression |
| Shared native/WASM regression | **88,023 assertions each, zero failures** | Reference-derived, not exhaustive or independent CPU conformance |
| Six-profile synthetic integration / replay | Pass | Production CLI/WASM; generated guest, not HP firmware |
| HP39g+ original full NOR | 514,293 instructions to explicit LCD stop | All-register/end-state equality and cold replay on both hosts |
| HP48gII original full NOR | 94,497 instructions to explicit GPIO stop | All-register/end-state equality and cold replay on both hosts |
| Both real NOR probes with sanitizer CLI | Pass, same stops/state | Local ASan/UBSan; not working stock UI |
| Clang static analysis | 12 translation units, zero diagnostics | Core, CLI and maintained regression |
| JavaScript syntax / production WASM build | Pass | Node 22.16, Clang 17 |
| Documentation navigation / local links | 13 pages, pass | Local strict rendering still unavailable |

New directed tests cover internal boot SRAM bounds/reset/endian access, reset
status W1C, GPIO masks/latches/unknown inputs, leaf/top IRQ selection and
rotation, RTC write enable/calendar/leap years/tick/alarm/clock division,
asymmetric STN byte/halfword ordering, and the corrected HP40gs NOR capacity.
Assertions stay active under Release/NDEBUG. Test modules and generated
inputs do not enter production web or native install artifacts.

The [real boot record](boot-research.md) explains progression, assumptions and
remaining stops. Both real displays are blank/disabled; no keyboard, stock
ARM payload return or USB transfer is accepted. The local probe compares
original ROM bytes unchanged. An input hash identifies a fixture, not legal
rights or complete emulator support.

## Reproduce

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
./build/orchard-regression
npm run check
npm run build
npm run test:wasm

cmake -S . -B build-sanitize -DCMAKE_C_COMPILER=clang \
  -DCMAKE_BUILD_TYPE=Debug -DORCHARD_SANITIZE=ON
cmake --build build-sanitize --parallel
ctest --test-dir build-sanitize --output-on-failure
python3 tools/check-docs.py

node tools/probe-rom.mjs --model hp39gplus --rom /private/39g+.bin
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin
# Use ORCHARD_BUILD_DIR=build-sanitize for the sanitizer-native comparison.
```

The probe takes a bounded tick budget, records native/WASM executable hashes,
checks both cold replays and compares all exposed architectural state. It
creates temporary UART/frame files locally, removes them after success or
failure and refuses to overwrite an existing report. It never fetches, patches
or uploads firmware. Ordinary CI remains ROM-free.

## Earlier remote acceptance

[Build #2](https://github.com/zyf722/orchard-emu/actions/runs/36981413547) on
`ecc0470` and [Build #3](https://github.com/zyf722/orchard-emu/actions/runs/36982058473)
on `456942e` accepted the previous 83,297-assertion baseline and twelve-page
strict Zensical build. These are historical results, not evidence for the
newer source above. Build #1 failed before checkout because a nested job
container required an unavailable Docker socket; the workflow now executes
directly in the existing `home-docker` runner. No host service was changed.

[Documentation #1](https://github.com/zyf722/orchard-emu/actions/runs/36984188560),
commit `351a0da`, successfully built and deployed the site to
[GitHub Pages](https://zyf722.github.io/orchard-emu/). Only the site directory
was published; repository privacy, firmware exclusion and separate workbench
artifacts were preserved. The follow-up workflow also checks live HTML.
Actual acceptance of subsequent pushes is recorded in issue #1 and Actions,
not presumed from local success.

The first downloadable handoff's 74,970 assertions / 200,000 isolated
dispatches are not current acceptance counts. Shared native/WASM execution
is not an independent ARM implementation differential. CPU exception/abort
precision, physical clocks, board inputs and real browser lifecycle testing
remain open.
