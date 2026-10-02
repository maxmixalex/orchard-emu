# Browser workbench

The current UI is a development tool, not a calculator facade. It provides
model and full-NOR selection, run/pause/step/reset, CPU/CP15 state, raw LCD
preview, a separate reserved annunciator region, bounded UART hex I/O and
JSON debug-state export. There are no physical calculator keys or skins yet.

## Build

```sh
npm run check
npm run build
npm run dev
```

Requirements: Node.js 22+, Clang's `wasm32` backend, and `wasm-ld`. The same
C17 core is compiled with freestanding/no-libc flags. `CLANG` may select a
specific compiler executable. No `npm install` or fetched frontend dependency
is required. `dist/` can be served as static files, including from a subpath.
Use HTTP for local development or HTTPS for deployment, not `file://`.

The Node development server binds `127.0.0.1`, defaults to port 8080, accepts
GET/HEAD and sets the WASM MIME type. `PORT` selects a different port. It is a
local development server, not a hardened public server or a virtual USB bridge.

## State and scheduling

A module Worker owns all mutable core state. Runs execute at most 256 virtual
ticks per slice and yield through the worker event loop. Display snapshots
are throttled separately from UART draining. Pause cancels the next slice.
ROM/model generation IDs reject stale async messages; no old-ROM reply may
populate a newly selected machine. The core itself does not read wall time.

WASM uses a fixed 16 MiB linear-memory allocation and no shared-memory threads.
This avoids a cross-origin-isolation requirement for SharedArrayBuffer. UI
state is copied from the core, not live-mutated by two threads. This is an
architectural choice, not evidence that the UI has passed sustained interaction
or every browser's Worker behavior.

## Privacy and output

The source loads only local static assets. Selected ROM bytes are read with
the File API, hashed locally and transferred to the Worker; there is no upload
endpoint, analytics service or external font. No persistent browser storage is
used in this baseline. Debug JSON includes the input hash and CPU state, not
the full ROM. State export is diagnostic only; there is no snapshot-import API.

The display is a provisional raw STN framebuffer. Visual dimensions do not
prove panel bit order, display polarity, hardware grayscale or annunciator
correctness. The separate annunciator area is explicitly marked unimplemented.

## Verification boundary

The production static build and JavaScript syntax checks pass locally. The
compiled WASM module executes the checked-in regression suite and generated
integration guest through `npm run test:wasm`, with matching native state,
UART and pixels. This remains Node execution, not browser E2E.

Full production browser E2E **did not run** in this session: browser navigation
to both the local server and an intercepted test origin was denied with
`ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was changed. Consequently
pause responsiveness, upload control races, export/download behavior, mobile
layout and long-session UI stability remain verification tasks, not passes.

The next browser gate must use the unmodified `dist/` assets on a permitted
local origin and cover actual file selection, generation changes during load,
run/pause, step/reset, invalid ROM/hex input, addressed MMIO stops, UART pressure,
no outbound ROM requests, screenshots and console errors on desktop/mobile.

## Documentation publishing

The [documentation site](https://zyf722.github.io/orchard-emu/) is deployed by
`.github/workflows/docs.yml` on documentation/configuration changes. It builds
Zensical strictly, uploads **only** `site/`, uses Pages/OIDC permissions only
in the deploy job, and checks published HTML. The first deployment succeeded
in [Documentation #1](https://github.com/zyf722/orchard-emu/actions/runs/36984188560).
The diagnostic emulator's `dist/` and private NOR inputs are not Pages content.
This is publication evidence, not production browser-calculator E2E.

## New core input exports

Production WASM exports `keyboard_attach`, `keyboard_matrix`,
`keyboard_dedicated` and `nor_select`. The test harness exercises these exports
with a generated SRAM guest through actual emulated IRQ entry and WFI return.
The workbench UI does not call them automatically and has no interactive
calculator keyboard yet. This core test under Node is not browser UI E2E.

The new weak-bias, LCD-policy, packed-memory and scheduled-key experiments are
available through the shared core/WASM exports and native/probe tools. The
production page does not expose these controls yet; no browser interaction
or page-level keyboard acceptance is implied by the Node WASM tests. Default
page rendering remains the controller view and default LCD handling is strict.
