# Validation

## Final recovered implementation and ZIP/native workflows (2026-10-23)

The [r18 release record](evidence/release-validation-r18.json) pins the final
37 production assets and the fresh checks below. The production WASM is
102,147 bytes, SHA-256
`5fb9626e86eed337fd4371ebf3e6ea27f5fa7af12bcee40e84d09e009121d48f`.
It is byte-identical to the recovered r17 final core: both new performance
candidates were withdrawn after their Chrome gates failed. The new ZIP UI,
native workflow tool, stronger regression tests and documentation remain.
GitHub Build, merge and Pages results are recorded separately for the published
revision; a local pass is not a deployment claim.

Fresh native Release, GCC reference and ASan/UBSan checks each pass 16 suites.
The native/test-WASM comparison passes **1,139,510 assertions per host** and
**32,949 functional-clock checks per host**, including the expanded
48,561-check scheduler suite. The compiler-portability fixes affect only the
checkpoint test's invalid-size guard and two unambiguously unconditional
returns in the replay tool. The [independent review](evidence/core-review-r18.json)
verifies that production core/include files are unchanged from the recovered
implementation. The [performance record](evidence/performance-r18.json)
separately identifies the 17,075-case fresh candidate/Unicorn differential;
it is not relabeled as a second final-core run.

| Fresh original-ROM check | Result and scope |
| --- | --- |
| HP49g+ cold startup | Two native and two WASM cold runs agree on all outputs, original HOME, `1+2=3` and `7*8=56`; no SRAM aliases. |
| HP49g+ CAS, menus and graph | Original `VERSION`, factorization, APPS/MODE, parabola and return pass through physical keys. Save/reset/restore and native/WASM continuation preserve the entire checkpoint. |
| HP49g+ production browser | Real ROM/session pickers, PC input, visually reviewed `1+1=2` and `7*8=56`, 524×320 PNG capture, exact displayed-LCD restore and narrow layouts pass on the final assets. |
| HP49g+ USB | Upload, named GET, directory, FINISH, active calculator SEND, subsequent GET and a two-file batch complete in the production browser; complete downloaded objects are byte-identical. |
| HP49g+ native ARM | A fresh cold boot installs the unchanged SDK library and example over USB, runs through ARMToolbox, returns with ON, calculates `2`, reconnects and retrieves the exact 4,474-byte library. [Evidence](evidence/hp49-native-r18.json). |
| HP39g+ full reader | Final WASM runs the actual installed ARM reader and Go receiver: all 64 blocks are read twice, the full 1 MiB equals the input NOR, and FINISH/disconnect/HOME/`1+1=2` succeed. This replay uses the prior USB-installed checkpoint. [Evidence](evidence/hp39-romstream-revalidation-r18.json). |
| HP39g+ ZIP round trip | A separately identified intermediate core completed user ZIP → stock RECV → stock SEND → real ZIP download → another fresh cold boot and RECV. Its frontend runtime modules are unchanged in the final build; its recorded WASM identity is retained. [Evidence](evidence/hp39-archive-r18.json). |

Final-asset [frontend checks](evidence/frontend-validation-r18.json) cover the
calculator/controller/Kermit/Worker chains, actual ZIP file selection/download,
component layouts and both normal and diagnostic stop recovery. Diagnostic
active-timeout replay agrees on every call and the complete stopped checkpoint.
Independent ZIP fixtures include Python-produced stored, DEFLATE and descriptor
archives, malformed CRC/length/paths, expansion limits and lifecycle cancellation.
The complete HP39gs download was independently rebuilt from its own included
sources plus external compilers and matched every archive byte.

HP39gs physical extraction, its own full-NOR acceptance and HP40gs/HP50g images
remain outstanding. Internal USB does not establish desktop device attachment
or complete Conn3x interoperability. SD media, UART2/IrDA and NOR programming
remain outside the current implementation. No firmware, private checkpoint or
raw guest picture is included in these public evidence records.

## HP49g+ and HP39/40 file-transfer continuation (2026-10-22)

The [release validation record](evidence/release-validation-r17.json) identifies
the frozen production assets and separates generated fixtures, original-ROM
workflows, package checks and publication checks. These are local acceptance
results for the continuation from `d199afd`; remote Build, Pages and deployed
revision acceptance must be observed separately after publication.

The core validation passes 16 Release, 16 retained-reference and 16 ASan/UBSan
suites. Native and test-WASM runs pass **1,119,781 assertions per host**, plus
**32,949 functional-clock checks per host**. The independent Unicorn corpus
passes 17,075 cases with zero mismatches and zero skips; Clang static analysis
reports no diagnostics across 41 native C sources. The
[independent core review](evidence/core-review-r17.json) additionally checks
256 scheduler/reference partitions and rejects a correct-CRC checkpoint that
tries to import an unsupported active SDI data mode before changing the
machine. Its 937 checkpoint assertions pass on native, reference, sanitizer
and test-WASM builds.

The final browser and host checks use the production WASM with SHA-256
`5fb9626e86eed337fd4371ebf3e6ea27f5fa7af12bcee40e84d09e009121d48f`.
Chrome is version 156.0.8078.47. The final asset manifest in the evidence record
also identifies the calculator bundle, Worker and transfer modules.

| Validation layer | Executed scope and result |
| --- | --- |
| React components | Lazy keypad/view/model races, exact full-canvas pixels and PNG capture, English/Chinese settings, upload batches, HP39 catalog/serve/download controls and four viewport widths pass. This fixture supplies explicit Worker events. |
| Production browser Worker | All 12 model/audience cases pass run, speed, pause, step, reset and checkpoint checks using generated ARM guests. The production UI passes 104 physical-key checks; page errors are empty. |
| Stop recovery | Ordinary and diagnostic browser runs preserve the original observation, wait for Save acknowledgement and recover the exact stopped checkpoint. The diagnostic run also replays an active timeout through the same WASM with every call result and the complete checkpoint equal. These generated guests do not reproduce the historical unclassified original-ROM stop. |
| Timer receiver | Delayed dispatch, cancellation, immediate-task fallback and shutdown pass. |
| Standalone host | Source and rebuilt package tests pass real loopback TCP, USB/IP split headers, guest EP0 transactions, cancellation, limits and binary-safe ARM UART echo. The package contains the same frozen WASM. Kernel attachment, COM/PTY devices and Conn3x remain separate acceptance tasks. |
| Documentation and Pages | Repository-pinned Zensical 0.0.67 strictly renders all 41 documentation pages without issues. Nine publication-contract tests and local assembly of all 36 emulator assets pass; assembled runtime bytes equal the frozen input. |

Original-ROM evidence is maintained in the
[HP49g+ support record](evidence/hp49-support-r17.json) and
[HP39 file-transfer record](evidence/hp39-file-transfer-r17.json).
HP49g+ has a fixed immutable-ROM startup, arithmetic, CAS, menus, graphing,
native/WASM continuation and production-browser USB file workflows. Its
browser lifecycle checks also cover exact LCD restore, PNG download, narrow
viewports and import of an earlier HP48gII session. The HP39g+ Disk drive path
uses the calculator as a Kermit client: the browser serves the original aplet
and library, receives the calculator's SEND output and returns to HOME for
arithmetic. Uploaded aliases and typed object bodies are checked independently
of the calculator's rewritten file-header title. The
[transfer review](evidence/transfer-review-r17.json) covers retained-download
capacity before EOF acknowledgement, atomic batch preflight and bounded
duplicate-final-ACK handling after actual timeout retransmissions.

The [complete ROM-reader record](evidence/hp39-romstream-r17.json) and
[independent package review](evidence/package-review-r17.json) cover reuse of
the existing hpclang reader, the complete 1 MiB stream, independent reads,
full archive rebuild and receiver failure handling. The new download includes
the Windows receiver and corresponding calculator sources. The calculator
aplet/SDK GPL sources stay in their independent download and notices; they are
absent from the MIT core, WASM, frontend bundle and standalone host build.

The Pages audit found and fixed two omitted runtime dependencies:
`hp39-files.js` and `hp39-transfer.js`. All 36 production assets now match the
strict allowlist; the nine Pages contract tests pass. The audited release
inputs contain no calculator ROM, private checkpoint or font files. The
release record retains download sizes/hashes and verifies final assembly
without publishing private screenshots, object contents or bus traces.

The functional support boundaries remain explicit: the HP49g+ SDI path models
an empty slot, and its stock file route is USB; SD media and UART2/IrDA are not
implemented. HP39gs and HP40gs share the implemented Disk drive host path but
still need their own complete-ROM original-system acceptance. The 39gs reader
has a complete original-HP39g+ emulator workflow; physical 39gs extraction and
Windows HID hardware operation remain to be observed. None of these local
results establishes physical clock timing or canonical board equivalence.
The dated sections below retain the scope and counts of their earlier builds.

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
