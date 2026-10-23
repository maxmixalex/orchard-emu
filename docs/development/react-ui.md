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
[landscape appearance](landscape.md) clips the original skin below the six FN
keys, keeping the screen and those keys in the left piece. The remaining
keyboard is on the right, with one live canvas and one set of physical hotspots.
Settings also controls [firmware sound](buzzer.md) and volume; global gesture
listeners unlock Web Audio and have matching unmount cleanup.

**Settings → Transfer** contains the optional Unlimited-during-transfers
switch. It shares the settings draft's Apply/Cancel behavior and may be changed
during a transfer. The selected normal speed still applies while the protocol
waits for a new stock RECV selection and after completion, cancellation or error.
Transfer failures retain stable error codes and interpolation values through
the Worker, controller and per-file queue. The UI translates known errors;
unknown diagnostics use a translated summary with collapsed technical details.

Connections and SD use two tabs in one persistent sidebar, with the calculator
still available for physical input. Hiding the panel or changing tabs preserves
file selections and unmounted SD drafts. It stacks below the calculator on
narrow screens. The sidebar and its connection subtabs explicitly use Mantine
`keepMountedMode="display-none"`; Activity-based retention would clean up effects
while hidden and rerun the SD generation reset on reopening. The original-ROM
SD probe caught that draft-loss regression and now covers hide/reopen followed
by exact-byte reinsertion. Confirmations and Settings remain modal dialogs.

The mapping editor uses the in-house `PCKeyboardView` full-size geometry and
the existing `TraditionalKeypad` calculator geometry. It highlights mapped
PC keys, shows bindings on the calculator, and lets a calculator-key click
select a target or find its existing bindings. The wider settings dialog fits
the complete numpad beside the calculator; narrow screens stack the panels
and move the navigation/numpad groups below the main PC keys.

`KeyboardSettings.jsx` edits one explicitly named model at a time. Custom
bindings retain physical `KeyboardEvent.code` identities; default letters,
digits and arithmetic symbols follow the OS-resolved `KeyboardEvent.key`.
`navigator.keyboard.getLayoutMap()` supplies visible labels when available.
Unavailable/denied layout access shows physical codes and allows individual
keys to be identified in the capture field. Modifier selection and capture
identify the binding; up to eight ordered calculator taps define its action.
Existing physical-code preferences remain compatible. A sequence does not
inspect or normalize an already-active guest Alpha state. See
[keyboard settings](keyboard-settings.md) for exact defaults, layout limits,
model isolation, fallbacks and browser verification.

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

The Worker now samples pixels and annunciators at an observed completed LCD
scan and reuses that image for other publications during the same scan.
Paused/stopped inspection, disable and reset/restore have explicit invalidation
paths. This addresses partial RAM redraws being published repeatedly within
one scan; it does not hide genuine blank frames or emulate physical panel
response. Capture and recording use the same published image as the live LCD.
See [LCD presentation](lcd.md#host-presentation-synchronized-to-the-scan-counter)
for original-ROM checkpoint comparisons and bounded browser checks.

Manual save/restore, the old `.orchard` envelope, timestamped `.ord`, opt-in
binary IndexedDB autosave with legacy localStorage migration, conflict/quota reporting and configurable lifecycle
policies remain. Confirmation and error dialogs use Mantine Modal, not alert.
The independent **Remember local ROMs** setting is enabled by default. It stores
one original-file handle per model where supported, or an explicitly labelled
browser-local copy for the standard file input. Disabling automatic recall does
not delete existing records; **Forget saved ROM locations and copies** removes them. Original
files are read only, startup does not request permission, exported sessions
omit ROMs, and no ROM is uploaded. See [local ROM storage](rom-storage.md).
The [SD sidebar](sd-cards.md) creates/imports/exports/ejects a card image
for the supported HP49g+ system, with write protection and guest block counters.
Both manual and automatic sessions retain its entire contents.
Its file-preparation mode operates on a separate unmounted image with explicit
8.3 destination names. It supports file/folder rename and confirmed deletion
of files or empty folders. Filesystem edits return a new image only after the
full operation succeeds; a mounted card remains exclusively owned by the Worker.
The [directory workflow](directory-sd.md) adds recursive 16/32 MiB import with a
reviewable 8.3 mapping and page-session directory associations. An atomic
copy/validation/eject operation returns the mounted card as a draft before
explicit re-read or conflict-aware additive write-back becomes available.
An active local-device bridge disables only the live-card controls, with an
SD-specific translated explanation. The unmounted editor and its directory
operations remain available. Both controller and Worker enforce this ownership
boundary, including delayed insertion reads and dirty-card confirmation.

## Verification boundaries

`test:frontend` checks resource/placeholder parity, physical-key layouts,
printed legends, capture pixels and controller lifecycle/storage logic.
`tests/browser-components.py` runs real React/Mantine components and actual
PNG encoding/download in Chromium with an explicitly injected fake Worker
and in-memory assets. It exercises language Apply/Cancel, PC key/modifier
selection, traditional legends, modal interactions and viewport bounds.
The separate `tests/browser-landscape.py`, `tests/buzzer-browser.py` and
`tests/browser-sd-files.py` cover geometry/input, actual Web Audio lifecycle and
SD draft file-picker/download flows. `tests/browser-keyboard.py` checks
model-isolated editing, actual event routing and layout-access fallbacks;
`tests/browser-lcd.py` checks publication bursts, capture and recording against
the live Canvas. `tests/browser-sd-directory.py` uses real origin-private
directory handles and the directory input fallback, with explicit Worker
acknowledgement fixtures. `tests/rom-storage-browser.py` checks actual IndexedDB
and origin-private file handles across reloads; it does not automate the native
file-picker permission prompt. The production Worker/stock-ROM witnesses
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
