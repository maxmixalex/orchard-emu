# Skins, status segments and Pages

## Asset boundary

The original C17 emulator and this integration remain MIT. Calculator vectors
and derived hit geometry are **Apache-2.0** from `zyf722/hp-calcs-svg`; their
license, attribution and upstream NOTICE remain in `licenses/hp-calcs-svg`.
The HP marks are not covered by either project's copyright license.

The pinned artifact revision is `4c2f261ae9ded0e0010d0ed53264c574ead66213`.
`tools/skin-sources.json` fixes SHA-256 for each outlined SVG and resolved JSON.
`tools/build-skins.py` verifies every input, uses the original vector unchanged,
and extracts transparent hit regions from its own paths/rectangles/circles.
No font files, raster previews, external emulator code or editable font-dependent
SVGs are downloaded or bundled. Every asset is served from the same origin.
For offline builds, set `ORCHARD_SKIN_SOURCE` to an acquired artifact directory.

All six models plus the blue 50g finish have 51 unique scan regions. Geometry
retains upstream ancestor transforms, including the 48/49/50 artwork scale.
The LCD has an inset inside the actual glass; its square pixel corners do not
extend into the rounded glass. A separate segment strip sits above the matrix.
A skin and a mapped switch are not evidence that a model's OS is supported.

The webemu48 `web-port` page was used as a UX reference: skin-first calculator,
separate status strip, compact setup and secondary diagnostics. Neither its
Saturn core nor its frontend implementation was transplanted.

## Guest-produced status, not host key flags

The new pure `orchard_annunciators()` accessor and WASM exports inspect six
packed samples outside the 131-column matrix, at **x=131, rows 0 through 5**.
It uses the configured framebuffer base/stride and bit depth, with BLUELUT in
2-bpp mode. The accepted layout is 160 samples per line. Unsupported layouts
return an unavailable status instead of inventing segment values. The getter
does not advance time, access side-effecting MMIO, or increment alias counters.

The reference routing is I/O, left Shift, right Shift, Alpha, battery, busy.
This positional clue came from the x49gp LCD renderer, not a manufacturer panel
schematic. The implementation here was written independently; no renderer or
bitmap code was copied. Naming all six physical signals remains provisional.

Actual unchanged firmware now supplies independent behavioral checks:

| Guest | Physical taps after HOME | Observed packed segments |
| --- | --- | --- |
| HP48gII | Left Shift, then Left Shift again | Row 1: 0 → 255, retained after release, then 0 |
| HP48gII | Right Shift, then Right Shift again | Row 2: 0 → 255, retained after release, then 0 |
| HP48gII | Repeated Alpha | Row 3: 255 across the first two taps, then 0 after the third; another tap reactivates it |
| HP39g+ D1.55 | Shift, then Shift again | Row 1: 0 → 255, retained after release, then 0 |
| HP39g+ D1.55 | Alpha, then Alpha again | Row 3: 0 → 255, retained after release, then 0 |

These local production-WASM studies start at the reset vector, acknowledge
normal startup prompts by physical F6, then toggle dedicated switches. They do
not edit a guest flag or set an icon from the pressed-key queue. In particular,
the observed persistence after release and the HP48 Alpha lock cycle are guest
behavior rather than host UI state. See `tools/probe-annunciators.mjs`.

An earlier Shift/ON probe entered an unimplemented power-related MMIO path;
it is not a successful suspend/resume witness. The published segment study
uses repeated modifier taps, not ON, to leave each mode. Power management is
still open. The 39gs/40gs segment mapping is not claimed verified. The six
synthetic sample levels, lookup palette, disabled LCD, unsupported formats and
read bounds have separate ROM-free native/WASM tests.

## Deployment

The existing Pages root and development URLs remain documentation. The web
application is at **[Open emulator](https://zyf722.github.io/orchard-emu/emulator/)**.
One `Pages` workflow builds both from the same commit. `tools/build-pages.py`
allows only production asset types, writes the source revision and hashes,
and places the web bundle under `site/emulator/` without replacing documents.
Deployment checks fetch every emulator asset and compare its SHA-256 with the
build manifest. Firmware, screenshots of firmware, test files and font files
are excluded. The page loads a local ROM; it has no firmware download/upload
or analytics service.

## Browser verification limit

Production Worker logic is tested through the existing Node adapter, and the
skin geometry/assets are independently checked in `npm run test:skins`.
Chromium navigation to the local HTTP origin remains blocked by administrative
policy in the development environment; that policy was not changed. Offline
HTML/CSS rendering checked desktop/mobile bounds and visual alignment, but is
**not browser-origin E2E**, file-picker, focus or background-tab acceptance.
A successful Pages asset verification likewise is not proof of guest interaction.
