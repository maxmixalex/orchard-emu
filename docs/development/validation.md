# Validation

## Performance continuation from 83a2d38 (2026-10-20)

The current [performance record](performance.md#physical-reads-and-worker-pacing-2026-10-20-from-83a2d38)
and [sample summary](performance-2026-10-20.json) separate core throughput,
Node Worker CPU cost and actual Chrome input latency. The retained default
changes are a caught-up Worker pacing fix and two boot SRAM pointer corrections.
The checked WASM physical-read fast path is now an explicit, default-off
experiment following the stop review; its core-throughput figures are not
default-release gains. The attempted CPU transaction optimization was withdrawn
after inconsistent timing, while its regression comparisons remain.

Historical fast-read candidate validation: local Release, reference and
ASan/UBSan each pass 14 CTest suites. Native and
test-WASM checks pass 1,118,080 assertions per host plus 9,902 divided-clock
checks. Unicorn reports 17,075 cases, zero mismatches and zero skips. Static
analysis reports no diagnostics across 38 native sources or the WASM bus path.
The production Window/Worker browser gate passes 12 model/audience cases and
104 physical-key checks without page errors. Source and packaged loopback
USB/IP/UART tests also pass; OS kernel attachment and Conn3x remain separate.

The two original-NOR HOME/arithmetic witnesses each pass two native and two
WASM cold runs with identical repeated/native/WASM outputs. Real Chrome file
selection, exact checkpoint restore and keyboard/result-pixel measurement
have now run locally on an HTTP origin. The initial 24-trial stock-ROM browser
sweep nevertheless contains one HP48gII Unlimited stop after a correct `56`;
the pointer-corrected fast-read candidate's separate 24-trial sweep passes
all 48 expressions. The
earlier stop remains unclassified; later passing trials do not explain it.
It prevents enabling the new physical-read path by default. The narrowed
release restores baseline physical-read dispatch and keeps the independently
measured Worker improvement. The detailed performance record
preserves both sweeps and their exact build identities. Do not describe the
initial sweep as fully passing or the existing physical clock, SRAM,
LCD and analog hypotheses as verified hardware.

The maintained failure probe now preserves the original observation before
using the real Save/download path to recover a stopped machine. A generated
guest browser test verifies the new Save acknowledgement, exact stopped state,
and preservation of the observation even if screenshot capture fails. It is
a diagnostic recovery gate, not a reproduction or resolution of the ROM stop.

Current source and CI live in
[maxmixalex/orchard-emu](https://github.com/maxmixalex/orchard-emu).
The historical issue/run links below refer to the earlier repository owner.
Remote acceptance requires observing the exact revision's Build and Pages
runs and the deployed revision/assets; local checks alone do not establish it.
The earlier full candidate is preserved as `aba2923` on
`codex/perf-wasm-worker-20261020` in
[PR #1](https://github.com/maxmixalex/orchard-emu/pull/1).
That stage had no remote Build because automatic triggers accepted only main
pushes. Commit `f95232a` adds pull-request validation on `ubuntu-24.04`, retaining
read-only permissions and disabling persisted checkout credentials. Pages
continues to require a successful exact-current-main push/manual Build;
pull-request artifacts cannot deploy. The narrowed default release requires
its own Build acceptance, separate from prior local fast-read results.

The input-timeline continuation uses the same production WASM artifacts and
unchanged `run()`/hold/gap settings. Eight sampled profiles (two models, two
expressions, baseline and candidate) match four unsampled baseline runs in
complete final checkpoint bytes, exact physical-key events, UART and LCD pixels.
The fixed-phase virtual profiles are also identical between builds. This gate
attributes guest-time intervals; it is not a browser wall-time benchmark or
physical-clock calibration. See the [continuation evidence](performance-continuation-2026-10-20.json).

The clock-observation extension passes another eight sampled profiles and four
unsampled references. Apart from execution timestamp, profiler source identity
and added clock fields, every field equals the preceding input report. Each
profile records 20,001 boundaries without changing its guest execution or
physical input schedule. Pure tool tests cover CLI rejection, copied observations
and boundary validity without loading a WASM or ROM.

Opt-in browser traces have passed four HP48gII Unlimited same-WASM replays
(105,412 API calls, 52,240 run calls), including every call result/tick/stop,
UART/USB payload and final complete checkpoint. Actual key arrival phases vary,
so these records are diagnostic evidence, not comparable latency samples.
The original failed browser stop remains unclassified. Generated-guest Chrome
recovery and Node trace-corruption controls provide separate tool acceptance;
the evidence record distinguishes their executed source identities from later
validator hardening. CI runs the Node replay gate after building the WASM and
uploads only generated browser reports/screenshots, never private traces or
checkpoint files.

## Historical frontend and host continuation

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
