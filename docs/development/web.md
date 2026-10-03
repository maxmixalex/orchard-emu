# Browser emulator

**[Launch on GitHub Pages](https://zyf722.github.io/orchard-emu/emulator/)**

The online app and downloadable build use the same production files. All assets
are same-origin; selected ROM bytes stay in the browser and are not uploaded.
The seven outlined skins and separate state symbols are documented in
[skins and segments](skins-segments.md). The controls remain usable without
a skin through the accessible text-keypad fallback.

**HP39g+ D1.55:** select the corresponding machine and `HP39g+ HOME · experimental`,
load the exact documented full NOR, Run, then F6/OK at Memory Clear. This uses
SST39VF800A as an explicit component hypothesis, exact SRAM, F inputs, AIN0=1023
and counted LCD idle-zero. It does not select the HP48 mirroring policy.

The remaining text describes the existing HP48 setup and shared lifecycle.

## Earlier shared browser calculator workbench

## Use the experimental HP48gII setup

Build with Node.js 22+, Clang and wasm-ld:

```sh
npm run build
npm run dev
```

Or extract a production ZIP and run `node serve.mjs` from that folder; no npm
installation or compiler is needed. Open the printed localhost URL, normally
port 8123. The server binds only loopback; `PORT` overrides the port. Serve the
files over HTTP on localhost or HTTPS, not `file://`.

Select HP48gII and explicitly choose **HP48gII HOME · experimental**. Select
an owned, complete 2 MiB NOR matching the documented SHA-256. Both the main
thread and Worker hash the local file; the research setup rejects a different
hash rather than silently applying board assumptions to an unknown ROM.
Strict mode remains the initial selection and accepts the core's normal input
formats without this experiment-specific identity restriction.

Press Run. The original OS first asks `Try To Recover Memory?`: F6 selects NO.
Wait for `Memory Clear`, then tap F6 (OK). Wait for HOME before entering an
expression and ENTER. Boot execution may take time; ticks are functional
quanta, not a real-time clock or a progress percentage. The page does not
recognize screens and does not press either confirmation automatically.

The setup explicitly applies SST39VF1601, 256 KiB SRAM with `bank1-mirror`,
strong D/F/G inputs, weak G-column pull-ups, ADC0=1023 and ADC7=512, counted
LCD idle-zero and the packed-LSB memory view. See [startup](startup.md).
None has silently become a canonical model default. Counters for alias reads,
alias writes and unverified LCD reads remain visible.

## Keys and lifecycle

The original functional keypad exposes 51 HP48 primary-key positions; it is
also available as an accessible fallback below the calculator-case skin. Label/scan facts are cross-checked against the
[hpclang physical key map](https://github.com/zyf722/hpclang/blob/d1dd4688cc850bff1bf4c290c0d26a5e0619f55c/runtime/core/keyboard-key-map.c).
No driver implementation is copied. All labels being mapped is not evidence
that every key has passed stock-OS functional acceptance. Current live-ROM
coverage is F6, 1, 2, 7, 8, +, multiply and ENTER.

Each activation queues a physical press for 2 million virtual ticks, followed
by release and a 2-million-tick gap. These declared tap semantics prevent a
quick browser click from disappearing between guest scans. The 32-tap queue
is bounded. Dedicated ON/Alpha/shift inputs use the separate GPF pins. Digits,
arithmetic, Enter, Backspace, arrows and F1–F6 have computer-keyboard shortcuts;
editable controls keep normal typing. OS repeat keydown events are ignored.
There is no text-paste or host-side calculation shortcut.

Pause, cold reset, a model/setup change, blur and a hidden page clear queued
keys and release an active switch. Switching back does not silently resume.
Cold reset clears SRAM and reattaches the selected setup; it is not a retained
calculator warm reset. The UI has no save/restore yet. Generation IDs reject
old ROM reads, hashes, frames and Worker replies after setup changes.

The Worker batches short 256-tick core calls into approximately 8 ms tasks,
with a timer yield between tasks. UART drains after every core call; frame
snapshots have a separate 50 ms cadence. This avoids the former one-timer-per-
256-ticks bottleneck without putting emulation on the UI thread. Wall time
controls yielding only, never guest peripheral timing. Exact pause latency
across actual browsers remains an E2E acceptance item.

## Display and exports

The default HOME setup shows packed LSB **memory inspection**, not verified
controller-to-panel wiring. The other view remains selectable. The separate
annunciator region now shows packed guest segments, with modifier evidence on 39g+/48gII; the rectangular LCD has margins
and is not clipped into rounded corners.

Pause before exporting diagnostics. The JSON contains the input hash, exact
exposed CPU state, frame hash, setup, actual applied key-transition ticks and
assumption counters. It is not a resumable snapshot and contains no ROM.
The event log is capped at 512 transitions and explicitly marks truncation.
UART text is capped independently. ROM bytes remain transient in the tab.

## Observed verification and limits

`npm run test:web` executes the unchanged production Worker module through a
Node `worker_threads` adapter for browser globals and local asset reads. It
checks run/pause/step/reset, setup ABI, queue bounds/cancellation, stale
messages, wrong-ROM rejection and map uniqueness. This is **not browser E2E**.

The optional local `tools/probe-web-worker.mjs` loads the exact original NOR
through that production module, sends physical taps, reaches HOME and obtains
the same visually established frame hash for `1+2=3` and `7*8=56`. The host
arrival times differ from the fixed CLI witness; applied ticks are recorded.

Actual Chromium navigation to the local production server returned
`ERR_BLOCKED_BY_ADMINISTRATOR`. The policy was not changed. Offline static
HTML/CSS inspections at 1360 and 390 pixels showed no horizontal overflow,
but are layout-only evidence. HTTP origin loading, file-picker interactions,
keyboard focus, background lifecycle and browser long-run E2E remain open.
The available `agent-browser` executable was absent; Playwright/Chromium was
used for those limited checks. See [validation](validation.md).
