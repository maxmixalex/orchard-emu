# Immersive landscape appearance

The `immersive-landscape` preference adds **Immersive (landscape)** / **沉浸式-横屏**
to Settings → Appearance. It cuts the existing outlined skin horizontally at the
lowest painted edge of the display cover, places the display piece on the left,
and places the keyboard piece on the right. Both pieces retain the same scale.

## Geometry and rendering

`tools/build-skins.py` derives `splitY` from the pinned `resolved_design.json`
bezel path, half its stroke width, and the existing bezel/display transforms.
The 39-family cut is `506.575` in the native `665 × 1340` view box. The 48/49/50
family also applies the upstream vertical scale `1.086 × 0.901749664`; its
slightly different stroke widths are retained. All seven distributed SVG files
remain byte-for-byte identical to their locked upstream assets.

The React display uses two overflow-clipped containers referencing the same SVG.
The keyboard container translates the full original artwork and its SVG hot
regions upward by `splitY`. The one LCD canvas stays in the display container;
the one set of 51 interactive keys stays in the keyboard container. A layout
change moves neither node between parents and does not recreate either of them.
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
owned by the file-transfer panel, with the Chinese label **传输时不限速**.

## Verification

`python3 tests/browser-landscape.py` builds the production React components in
an offline fixture and runs real Chromium. It derives its model list from the
current admitted catalog, rather than hard-coding the number of models. It
checks:

- The latest appearance wins when the manifest request resolves late.
- Both pieces have equal, uniform scale and the expected source cut; every key
  remains inside the keyboard crop and the LCD remains inside the display crop.
- Desktop, short desktop, landscape phone, and portrait phone viewports
  (`1360×940`, `1360×500`, `844×390`, `390×844`) fit at 100%.
- 50% and 180% zoom retain all coordinates and the far edges remain reachable.
- Pointer and focused Enter input each issue exactly one correct scan sequence.
- The canvas and key nodes survive appearance changes; LCD pixel output remains
  byte-identical through layout and zoom changes.
- Applying the appearance/audio settings persists them, muting disables the
  volume control, and audio gesture listeners are removed on unmount.

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
