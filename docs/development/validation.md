# Current frontend and host continuation

The interrupted React work was not present in main `2889f90`. This continuation
recovered hash-checked source fragments, rebuilt the missing frontend and
revalidated the result locally. Exact publication revision and observed CI/
Pages outcomes belong to issue #1, not this pre-publication record.

## Implemented

React/Mantine user controls, bundled English/Chinese translation resources,
clickable PC key mapping, traditional modifier legends, PNG capture and a
separate frame subscription now replace the vanilla calculator page. Existing
Worker, session/envelope and lifecycle tests remain. The developer workbench
uses the same unchanged core. See [React UI](react-ui.md).

The standalone loopback [host prototype](host-mode.md) exposes USB/IP and raw
serial. Generated ARM guest/TCP tests run both from source and the assembled
package. They do not prove kernel driver or Conn3x compatibility.

## Tests and scope

Eleven native and test-WASM suites now contain **443,311 assertions per host**.
The extra 6,912 assertions exercise 1,152 ARM single-transfer variants against
the retained reference: different addressing flags, alignment, aliasing,
PC destinations, memory bounds and MMIO. The attempted narrow rollback
optimization did not show a reliable full-workload improvement and was removed;
the extra tests remain. The shipped production C core is byte-for-byte the
accepted `2889f90` source; no CPU/peripheral timing semantics change here.

Local Release/reference/sanitizer suites, unchanged generated guests, Worker,
preferences/session/RTC, frontend/controller, skin and publication contracts
all passed. The independent Unicorn subset passed 17,075 cases with no
mismatches or skips. Both original-NOR cold-start arithmetic probes completed
two native and two production-WASM runs per model; frames and exposed states
agree. The checkpoint probe resumed each after 1+2=3, completed 7*8=56 and
matched uninterrupted serialized state; native continuation also matched.
These ROM-dependent runs are local, ordinary builds, not CI/sanitizer startup.
Strict Zensical rendered all 30 pages locally without issues. Remote run IDs
and deployed-asset verification are recorded after observation in issue #1.

Offline Chromium component tests use real React/Mantine but a fake Worker and
explicit in-memory artwork, not an HTTP origin. They caught a genuine sizing
regression: SkinView's inline aspect ratio incorrectly made the traditional
screen container as tall as an entire case. Traditional mode now overrides
that ratio, and a key-position assertion prevents its return. They also cover
language Apply/Cancel, PC selection, printed legends, PNG download and four
viewport widths. They are not original-firmware/browser-storage E2E.

## Measured display investigation

A local Node/V8 investigation at generated original-system states measures
only the production LCD accessor, annunciator accessor and copied pixels.
Median decode/copy cost was about **0.049 ms/frame on HP39g+ and 0.047 ms/frame
on HP48gII**. At 30 calls/s this is about 1.5 ms of CPU time per second.
Checkpoint bytes before/after sampling are equal. This does not include browser
canvas drawing, CSS scaling, compositor work, messages or real time calibration.
It does not support the decoder itself as the dominant observed slowdown.

The initial new RGBA helper allocated a subarray per pixel; typed-array palette
lookup removes that avoidable allocation. Its local 131x64 conversion dropped
from roughly 0.34–0.36 ms to 0.019 ms. This is a rendering-helper microbenchmark,
not a corresponding increase in calculator execution speed. The frontend also avoids unchanged
canvas updates and any per-frame React state subscription. Core profiling
instead shows interpretation/address translation as large CPU consumers.
Increasing translation-cache capacity alone and the narrow-rollback prototype
did not provide a reliable improvement, so neither is shipped. No headline
CPU speedup is claimed. Normal's functional timebase and its unverified
relationship to physical clocks are unchanged. See [performance](performance.md).

## Reproduce

```sh
npm ci --ignore-scripts
npm run build
npm run test:wasm
npm run test:web
npm run test:calculator
npm run test:skins
npm run test:pages
npm run test:host
npm run build:host
ORCHARD_HOST_ROOT=build/host-package npm run test:host
```

Native/reference/sanitizer and the independent Unicorn corpus retain their
existing commands. `python3 tests/browser-components.py` is an optional local
component test requiring Playwright and Chromium, not an unproven browser gate
in normal CI. `tools/profile-display.mjs` needs private local ROM inputs and
never acquires or publishes them.

## Accepted history


## Settings release follow-up on c3e8a36

[Build #21](https://github.com/zyf722/orchard-emu/actions/runs/37121793241)
passed Release but stopped in two unoptimized Debug ASan/UBSan tests at their
30-second CTest limits. No settings/timing deployment followed that failed
Build. The same incoming tests completed locally without assertion failures:
checkpoint 24.52 seconds, scheduler 28.25 seconds. These measurements explain
insufficient timeout margin; they are not a successful result for Build #21.

Sanitizer targets now explicitly use `-O1 -g`, retaining both sanitizers,
frame pointers, all assertions and the existing 30-second limits. This follows
[Clang's recommended sanitizer build](https://clang.llvm.org/docs/AddressSanitizer.html#usage).
With this change and the checksum optimization below, all eleven local
sanitizer suites pass in 16.70 seconds total; checkpoint takes 3.22 seconds,
scheduler 10.41 seconds. Ordinary Release and retained-reference suites also
pass. Exact remote Build/Pages acceptance remains recorded in issue #1 after
observation, not inferred from these local results.

### Faster checkpoints, unchanged format

The reflected CRC32 recurrence now advances a byte using a 1 KiB constant
table. Both the complete NOR identity checksum and payload checksum are still
recomputed on every call. No validation is removed or cached. The independent
bitwise test reference checks both fields on all six model capacities, adding
12 assertions: **769 checkpoint checks; 436,399 native/test-WASM checks per
host overall**. Version 1, file bytes and `.ord`/legacy envelope compatibility
are unchanged.

A local Clang 17 / Node 22.16.0 interleaved comparison uses the incoming
c3e8a36 production WASM and this build. Each model is loaded with its exact
owned NOR at reset; no guest execution is included in these timings. Of 16
alternating samples, the first three are discarded; medians of the remaining
13 are shown. Complete 270,310-byte checkpoints match before and after imports.

| Model | Save before / after | Import before / after |
| --- | --- | --- |
| HP39g+ | 7.383 / 4.828 ms | 7.587 / 4.806 ms |
| HP48gII | 12.980 / 8.723 ms | 13.201 / 8.499 ms |

This is approximately one-third less core snapshot blocking, **not** a CPU
throughput increase or end-to-end localStorage/file-picker benchmark. Browser
envelope hashing, base64, synchronous storage and shutdown delivery remain
separate costs and limitations.

### Clock and original-system continuation

`tests/pacing-rtc.mjs` now combines the actual production WASM with the shipped
Pacer and a generated ARM guest that disables the watchdog and enters WFI.
It does not write RTC time. At Half/Normal/Double, two synthetic monotonic wall
seconds produce exactly one/two/four guest RTC seconds. Different host arrival
intervals and 256/4096-quantum call caps produce byte-identical complete
checkpoints at each rate. Reset credit and bounded catch-up are also checked.
This integration test is part of `npm run test:calculator`; it is neither a
physical clock calibration nor actual browser scheduling acceptance.

The fixed original HP39g+ and HP48gII arithmetic witnesses were rerun twice
natively and twice on production WASM. Both preserve their established frames
for `1+2=3` and `7*8=56`, with the same explicit hardware assumptions. The
checkpoint continuation probe saves after the first calculation, restores in
a fresh machine and completes the second with byte-identical serialized state
against uninterrupted execution; a native continuation matches too. Short
physical-key arithmetic and the HP39 ALPHA/VARS input study also pass again.
Long original-firmware runs are ordinary builds, not sanitizer/CI workloads.

The default independent Unicorn corpus passes 17,075 cases without mismatches
or skips. All 34 static-analysis units are clean; 76 tool checks and the
production guest, Worker, settings, storage, connection, skin and publication
contracts pass locally. No CPU instruction, peripheral, tap or pacing semantics
were changed in this follow-up. Real browser-origin navigation remains blocked
by administrative policy; no file-picker, touch or real localStorage E2E is
claimed. New strict documentation rendering and deployed-asset verification
must still be observed on the accepted remote build.

## Reproduce and prior records

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
cmake -S . -B build-sanitize -DCMAKE_BUILD_TYPE=Debug -DORCHARD_SANITIZE=ON
cmake --build build-sanitize --parallel
ctest --test-dir build-sanitize --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run test:web
npm run test:skins
npm run test:calculator
npm run test:pages
python3 tools/check-docs.py
```

The successful remote Build must additionally run the retained-reference build,
independent Unicorn comparison, static analysis and strict Zensical render.
Local optional firmware commands (not ordinary CI) are the two fixed startup
probes, `probe-checkpoint.mjs` and `probe-interaction.mjs`. Their ROM and private
outputs stay outside the source and production archives.

[Prior validation records](validation-history.md) preserve the incoming
c3e8a36 validation page verbatim, including older revisions, counts and limits.
They are historical observations, not new acceptance. Current clock/input/
storage behavior is described in [interaction](interaction.md) and
[sessions](sessions.md); the roadmap and issue #1 keep physical fidelity,
real browser usability, virtual packets and stock file transfer separate.
