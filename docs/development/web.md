# Browser calculator and developer workbench

**[Open calculator](https://zyf722.github.io/orchard-emu/emulator/)** ·
[Developer workbench](https://zyf722.github.io/orchard-emu/emulator/debug.html)

The ordinary page is for calculator use. Click **Open ROM** and select a
supported complete ROM file. Its identity selects HP39g+ D1.55 or HP48gII and
the corresponding compatibility settings automatically; there is no separate
boot-setup question. The page starts the calculator when visible and focused.
Unknown ROM versions and partial update files are rejected rather than being
assigned an inappropriate profile. Files stay in the browser; none is bundled
or uploaded. Other four target models are not presented as working calculators.

For HP39g+, press the top-right soft key (OK) at **Memory Clear**. HP48gII first
asks **Try To Recover Memory?**: the top-right key selects NO, then selects OK
at Memory Clear. Wait for HOME, then use the physical skin or computer numbers,
operators, arrows, F1–F6, Backspace and Enter. The page does not recognize screens
or automatically dismiss firmware prompts. A text-keypad fallback is available.

**Pause/Resume** keeps the current machine in this tab. **Restart** and changing
models clear the calculator memory and ask for confirmation when appropriate.
There is no save/restore yet. Blur/hidden/pagehide pause and release queued
keys, and returning does not automatically resume. A cached page retains its
Worker instead of returning with a terminated core. These are not warm reset
or battery-backed persistence.

## Developer interface

`debug.html` is a separate entrypoint using the same core, skins and key input.
It retains all six models, seven finishes, strict mode and the two experimental
HOME configurations, CPU state, internal counters, LCD interpretation, UART
bytes and paused diagnostic export. See [performance](performance.md) for the
shared execution and separate Worker payload contracts. No research selector
or register table is merely CSS-hidden in the user page.

The supported HOME configurations still carry exactly the documented
[NOR/SRAM/LCD assumptions](startup.md) and the separate
[HP39g+ configuration](hp39-startup.md). Their promotion to an automatically
selected user configuration is a UX change, not physical-board certification.
The user page says Beta; the detailed uncertainty remains in this workbench
and the documentation, not repeated beside every key press.

## Build and offline use

Source builds need Python 3, Node.js 22+, Clang and wasm-ld. No npm dependency
installation is required:

```sh
npm run build
npm run dev
```

Extracted production ZIPs only need Node 22+: run `node serve.mjs` and open the
printed loopback URL (default port 8123). `debug.html` opens the workbench at
the same origin. Do not use `file://`. All skins, scripts and WASM are local
or same-origin; artwork retains its separate Apache-2.0 attribution.

## Timing, input and display

One Worker owns the ARM machine. Short 256-tick core calls are batched into
bounded tasks; UART is drained after each call and frame updates are throttled
independently. The optimized Worker no longer copies a debugger snapshot on
every call. All successful budget counters remain exact; stopping reads back
actual state. Physical taps still use 2 million guest ticks down and a
2-million-tick release gap, with a maximum of 32 queued taps. No host text-paste
or calculator shortcut substitutes for guest input.

The separate annunciator strip reads guest display samples. Shift/Alpha
changes are independently observed on the two original systems; remaining
physical routing is provisional. The LCD is inset inside the rounded glass.
Details are in [skins and segments](skins-segments.md).

## Validation and publication

Existing `test:web` exercises the unchanged production Worker through a Node
browser-global adapter. `test:calculator` checks entrypoint separation, the
compatibility catalog and minimal user payload; skin and lifecycle suites are
separate. They do not imply an actual browser file-picker/focus/touch pass.
The current environment's Chromium navigation still returns
`ERR_BLOCKED_BY_ADMINISTRATOR`; no policy was changed. Desktop/mobile layout
was inspected with application scripts removed and local art inlined. That
is static layout verification, not interactive browser E2E.

Build tests and strictly renders the complete site once, then produces
`orchard-pages`. Pages accepts only that successful, same-repository current-
main Build, verifies source stamps and all allowlisted asset hashes, deploys,
and checks published HTTPS assets. Both frontends use the identical WASM
in the downloaded ZIP and the website. A changed UI does not acquire a different
interpreter or silently weaker correctness settings.
