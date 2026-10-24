# Landscape appearances

The `immersive-landscape` preference adds **Immersive (landscape)** / **沉浸式-横屏**
to Settings → Appearance. It cuts the existing outlined skin horizontally below
the F1–F6 soft-key row. The display and its six soft keys stay on the left; the
remaining keyboard is on the right. Both pieces retain the same scale.

## Geometry and rendering

`tools/build-skins.py` derives `splitY` from the pinned SVG's six soft-key
rectangles, half their stroke widths, and their complete ancestor scale chains.
It leaves 12 native units of shell below their painted edge. The 39-family cut
is `581.25` in the native `665 × 1340` view box. The 48/49/50 family applies the
keys' upstream vertical scales `0.901749664 × 1.108955223881` and retains each
model's slightly different stroke width. All seven distributed SVG files remain
byte-for-byte identical to their locked upstream assets.

The React display uses two overflow-clipped containers referencing the same SVG.
The keyboard container translates the full original artwork and its SVG hot
regions upward by `splitY`. The one LCD canvas and six interactive soft keys
stay in the display container; the other 45 interactive keys stay in the keyboard
container. Every scan has exactly one interactive node. A layout change moves
no canvas or key between parents and does not recreate them.
The portrait appearance stacks both pieces with no gap to restore the full
original machine. Traditional appearance continues to use the measured SVG
keyboard and the same LCD canvas.

Landscape bounds use `2 × nativeWidth + 24` native units horizontally and the
taller piece vertically. The pieces are vertically centered with a 24-unit
scaled gap. The display fits the actual workspace content box, including its
responsive padding, before applying the saved 50–180% zoom. At larger zoom,
the workspace scrolls from the left edge through the full width of both pieces.
Window orientation does not silently replace the user's selected appearance.

The developer workbench keeps its original single-image markup. `SkinView`
supports that markup and only enables the split arrangement when the additional
keyboard image is present.

## Preferences and adjacent controls

The v1 preferences format now accepts `immersive-landscape`. Older v1 settings
also receive defaults for `transferUnlimited: false`, `sound: true`, and
`volume: 0.35`. Supplied values are validated; malformed booleans and non-finite
or out-of-range volume values are rejected. HP39gs receives its own keyboard
mapping and legacy automatic-save identity while sharing the verified 39-family
physical key legends and Alpha/Space sequences.

The firmware buzzer and volume controls are in General settings. Pointer and
keyboard gestures call the controller's audio-unlock hook in the capture phase;
the listeners are removed when the app unmounts. The transfer speed switch is
in the dedicated **Settings → Transfer** / **设置 → 传输** tab, with the Chinese
label **传输时不限速**. It follows the same draft/Apply/Cancel behavior as the
other settings and can be changed while a transfer is running. The Connections
sidebar shows the resulting active boost without duplicating the switch.

## Verification

`python3 tests/browser-landscape.py` builds the production React components in
an offline fixture and runs real Chromium. It derives its model list from the
current admitted catalog, rather than hard-coding the number of models. It
checks:

- The latest appearance wins when the manifest request resolves late.
- Both pieces have equal, uniform scale and the expected source cut. All six
  soft keys and the LCD remain inside the display crop; all 45 remaining keys
  remain inside the keyboard crop.
- Desktop, short desktop, landscape phone, and portrait phone viewports
  (`1360×940`, `1360×500`, `844×390`, `390×844`) fit at 100%.
- 50% and 180% zoom retain all coordinates and the far edges remain reachable.
- Clicking each of the six soft keys and a main keyboard key issues exactly one
  correct scan sequence. Focused Enter also works on both sides of the split.
- The canvas and key nodes survive appearance changes; LCD pixel output remains
  byte-identical through layout and zoom changes.
- Applying the appearance, audio, and transfer settings persists them; Cancel
  leaves the saved transfer preference unchanged. Muting disables the volume
  control, and audio gesture listeners are removed on unmount.

The fixture writes screenshots and `results.json` under `build/landscape/`.
Its LCD grid is synthetic. These layout/input results do not establish ROM
boot, transfer, storage, or acoustic correctness; those have separate tests.
`tests/skins.mjs` verifies all seven artwork hashes and independent cut values.
`tests/preferences.mjs` covers legacy defaults, invalid fields, and HP39gs
mapping/save identity. `tests/frontend.mjs` checks bilingual key parity.

React review: the display effect still depends only on controller/model identity;
appearance changes update layout and enabled states through the existing refs.
The new settings are controlled inputs, there are no conditional hooks or new
dependencies, all global listeners have matching cleanup, and artwork duplication
adds no duplicate interactive elements or accessible image description.

## Traditional landscape and narrow phones (r23)

`traditional-landscape` adds **Traditional (landscape)** / **传统-横屏**. It uses
the measured outlined-key geometry already used by the traditional portrait
view. The six F1–F6 nodes move into a second SVG immediately below the LCD;
the remaining 45 nodes occupy the right-hand keyboard. The same Canvas and
all 51 key nodes survive every appearance change. The keyboard-mapping editor
keeps its normal whole-keyboard view and does not receive a duplicate split.

For available widths below 600 CSS pixels in a portrait-shaped workspace or
portrait phone, the two traditional panes stack vertically. The calculator uses
the available width so keys remain usable, and scrolling stays inside the
workspace. The LCD/soft-key pane remains sticky while the lower keyboard
scrolls. Rotating to a wide viewport restores two columns. The selected
appearance and zoom remain saved. This responsive adaptation is specific to
traditional landscape; the immersive artwork still uses its exact split.

Phone toolbars group Save, Restore, captures and self-test actions into one
Mantine menu. Recording remains an explicit action with its full accessible
label. Settings use a fullscreen scrollable body and fixed Apply/Cancel actions
on phones, two aligned columns for General settings on wider screens, and the
wider existing keyboard editor. Theme defaults come from `createTheme`;
application chrome uses Mantine variables and CSS Modules. A visible pause bar
provides a direct Resume simulation action. Connections remains a persistent
sidebar with SD in its own tab; there is no duplicate toolbar SD control or
Local device entry. Its Files and Raw data tabs keep the wired Serial/USB
controls, while Infrared shows its pairing controls without unrelated wired
connection buttons. Switching tabs preserves the selected wired transport.

`tests/browser-display.py` exercises all four admitted models at 1360×940,
844×390, 390×844 and 360×640. It checks the split, unique key scans, node identity,
physical click routing, sticky LCD visibility when scrolling to the bottom
keyboard row, noninteger display scaling, unchanged native PNG dimensions,
Apply/Cancel, paused-state action and mobile Connections. The former
`browser-host-bridge.py` UI gate now verifies that the cancelled local-device
feature is absent in both languages; historical transport tests remain separate.

Screenshots were inspected from the real Chromium fixtures, including desktop
settings and traditional landscape, portrait phone settings/sidebar, and pause
state. These are browser layout and interaction witnesses using synthetic LCD
pixels, not a claim of physical touch-hardware or original-ROM correctness.
The separate [GBP production-page witness](lcd.md#gbp-redraw-and-publication-measurement-r23)
also exercises the traditional landscape view with real game pixels, the
production Worker and restored original-ROM execution.
