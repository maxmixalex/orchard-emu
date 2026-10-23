# React calculator frontend

The user calculator now uses React, Mantine, i18next/react-i18next and
react-simple-keyboard. Exact versions and transitive dependencies are locked
in `package-lock.json`. Run `npm ci --ignore-scripts` before building. The
developer workbench stays separate at `debug.html`; both use the same Worker
and C/WASM core. No host-side Saturn replacement or calculator simplification
is introduced by this UI migration.

## Interaction

Settings supports English and Simplified Chinese. Resources are bundled, not
fetched from a translation service. The language preference is independent
of the existing versioned emulator settings and saved sessions. Apply commits
a settings draft; Cancel discards changes. Browser locale supplies the initial
language when no explicit preference exists. Calculator-printed legends and
firmware strings are not translated as application UI.

The traditional keypad now includes Shift, right-Shift where applicable and
Alpha legends derived from the pinned artwork's resolved design metadata.
The outlined SVGs remain unchanged and carry separate Apache-2.0 attribution.
The immersive views do not display a duplicate HTML keypad. The new
[landscape appearance](landscape.md) clips the original skin into screen and
keyboard pieces, preserving one live canvas and one set of physical hotspots.
Settings also controls [firmware sound](buzzer.md) and volume; global gesture
listeners unlock Web Audio and have matching unmount cleanup.

The mapping editor displays a clickable PC keyboard through
react-simple-keyboard. It selects physical `KeyboardEvent.code` names rather
than inserting text into the calculator. Modifier selection and optional
physical-key capture identify the binding; up to eight ordered calculator
switch taps define its action. Existing per-model preferences, including
HP39g+ KeyA = ALPHA then VARS, remain compatible. This is a literal sequence;
it does not inspect or normalize an already-active guest Alpha state.

Screen capture exports the matrix to PNG at native size or 4x nearest-neighbor
scale. It reads the latest guest-produced frame without advancing execution,
including while paused, and excludes application chrome and separately routed
annunciators. An unavailable frame is rejected. Names use the same local-time
model/date convention as `.ord`, with a `.png` extension. No screenshot is
uploaded.

## Ownership and display cost

`CalculatorController` owns exactly one Worker and protects asynchronous ROM,
state and storage operations with generation/request identities. React uses
an external-store subscription for changing control state. Frames have a
separate subscription: repeated pixels do not rerender Settings or the PC
keyboard. The display coalesces pending frames with requestAnimationFrame,
updates the canvas only for changed pixels/palette, and changes key/indicator
DOM state independently. Typed-array palette copies avoid allocating a
subarray object for every pixel. This does not alter guest LCD timing.

Manual save/restore, the old `.orchard` envelope, timestamped `.ord`, opt-in
binary IndexedDB autosave with legacy localStorage migration, conflict/quota reporting and configurable lifecycle
policies remain. Confirmation and error dialogs use Mantine Modal, not alert.
Selected ROM bytes are never sent to a network service or saved to storage.
The [SD card dialog](sd-cards.md) creates/imports/exports/ejects a card image
for the supported HP49g+ system, with write protection and guest block counters.
Both manual and automatic sessions retain its entire contents.
Its file-preparation mode operates on a separate unmounted image with explicit
8.3 destination names. Filesystem edits return a new image only after the full
operation succeeds; a mounted card remains exclusively owned by the Worker.

## Verification boundaries

`test:frontend` checks resource/placeholder parity, physical-key layouts,
printed legends, capture pixels and controller lifecycle/storage logic.
`tests/browser-components.py` runs real React/Mantine components and actual
PNG encoding/download in Chromium with an explicitly injected fake Worker
and in-memory assets. It exercises language Apply/Cancel, PC key/modifier
selection, traditional legends, modal interactions and viewport bounds.
The separate `tests/browser-landscape.py`, `tests/buzzer-browser.py` and
`tests/browser-sd-files.py` cover geometry/input, actual Web Audio lifecycle and
SD draft file-picker/download flows. The production Worker/stock-ROM witnesses
remain distinct. These offline component fixtures are excluded from production. Their patterned
screen is synthetic and must never be presented as original-firmware evidence.

The earlier environment blocked normal HTTP navigation; the current Chrome
environment now runs production-page stock-ROM file-picker, download and
session workflows. Component fixtures remain distinct from those original-ROM
witnesses. See [browser validation](web.md#publication-and-verification) and
[HP49 startup](hp49-startup.md) for their precise scope. Sustained storage,
background, touch and multiple-browser coverage remain separate.

## Primary library references

- [Mantine](https://mantine.dev/getting-started/), [Modal](https://mantine.dev/core/modal/).
- [react-i18next useTranslation](https://react.i18next.com/latest/usetranslation-hook).
- [simple-keyboard onKeyPress](https://hodgef.com/simple-keyboard/documentation/options/onkeypress/).

The build bundles local assets and a notice for every npm package actually
included. No fonts or runtime CDN dependencies are introduced.
