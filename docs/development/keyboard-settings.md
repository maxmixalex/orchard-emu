# Keyboard settings and system layouts

The calculator page's **Settings → Keyboard** editor supports the four admitted
models independently: HP39g+, HP39gs, HP48gII and HP49g+. The model selector in
this editor changes which mapping is edited; it does not switch or restart the
running calculator. **Apply** saves the complete draft, including edits made
to several models. **Cancel** discards those edits.

## Physical overrides and character defaults

Preferences retain the version-1 `mappings[modelId][physicalCode] = scans`
schema. For example, these are three independent overrides:

```json
{
  "1": {"KeyQ": [58, 28]},
  "2": {"KeyQ": [6]},
  "5": {"KeyQ": []}
}
```

`KeyQ` is a physical position, not a promise that its keycap reads Q. An
explicit override takes precedence over the default, including `[]`, which
disables that binding for that model. Resetting a binding removes only that
model's override. Preference validation copies both each model's dictionary
and each sequence, so edits cannot mutate a sibling model's mapping.

Without an override, `resolveKeyBinding()` uses the browser's resolved
`KeyboardEvent.key` for letters, digits, a decimal point, space and arithmetic
symbols. This fixes the previous behavior where a French A key at physical
`KeyQ` invoked the calculator's Q sequence. The French Shift+1 character and
German Y/Z positions work through the same path; the Layout Map API is not
required for this dispatch. ASCII letter case chooses the same calculator
Alpha sequence. The emulator still presses guest keys; it does not directly
insert text or normalize the guest's current Alpha/Shift state.

HP39g+/HP39gs use their family-specific Alpha key and printed letter positions.
HP48gII/HP49g+ use Alpha plus their shared A–Z positions, including F1–F6 for
A–F. The latter HP48gII defaults were missing previously. Number keys follow
the selected model's numeric key labels. Enter, Backspace, Escape/ON, arrows,
F1–F6 and numpad operations retain their dedicated defaults.

Ctrl, Alt and Meta combinations have no implicit character default, preserving
browser shortcuts. An explicit custom combination can still be assigned.
AltGraph-resolved printable characters are accepted. IME composition, dead
keys and unidentified events do not trigger default calculator taps. A numpad
digit with Num Lock off does not type a number; a locale decimal comma from
`NumpadDecimal` still invokes the calculator's decimal-point key.

## Reading and displaying the layout

`navigator.keyboard.getLayoutMap()` is requested when the editor opens and
again on browser focus or a `layoutchange` event. **Read layout again** is also
available. A generation token prevents stale asynchronous responses from
replacing a newer layout, and listeners are removed when the editor closes.

The API returns unmodified character labels, not a full map of Shift/AltGraph
combinations or the physical shape of the keyboard. The display therefore uses
a clearly described standard full-size outline while replacing writing-key
labels with the returned glyphs. Additional supported codes such as
`IntlBackslash`, `IntlYen` and `IntlRo` appear as supplemental buttons when
reported, captured or explicitly mapped. No claim is made to detect ANSI,
ISO, JIS or laptop hardware geometry.

Unknown writing keys display their physical codes rather than guessed US
characters. If the API is unavailable or rejected, a translated explanation
describes this fallback. Focusing the capture field and pressing a key records
the actual `key`/`code` pair for that editor session, providing its label and
default sequence. Captured Shift/AltGraph combinations also fill gaps that the
API cannot report. Tab moves focus out of the capture field. Captures are
discarded after a layout change; they are not saved as user bindings.

Layout-aware preview calls pass an explicit map (possibly empty) to
`defaultBindings()`. They do not guess a US number or punctuation row.
`defaultBindings(model)` without that argument retains the legacy physical
table for callers and old serialized expectations; live character dispatch
always uses `resolveKeyBinding()` with the event's actual character.

Primary API definitions:

- [Keyboard Map specification](https://wicg.github.io/keyboard-map/), sections
  1, 2.3.1, 2.5, 3.1 and 4.1: `code` versus `key`, unmodified labels,
  ASCII-capable layout selection, `layoutchange` and permission-policy denial.
- [UI Events: KeyboardEvent key](https://www.w3.org/TR/uievents/#dom-keyboardevent-key)
  defines the resolved character or named key value.

## Editing in both directions

Green PC keys have an action for the currently selected modifier combination.
Purple keys have explicit custom actions. A corner dot marks an action with
another modifier combination. The selected key remains visibly distinguished.
Hover/focus labels include the physical identity and calculator sequence.

The calculator on the right reuses the same pinned SVG geometry and printed
legends as the traditional calculator view. A badge names the first PC binding
ending with that calculator key and counts additional bindings. Blue outlines
trace the selected sequence; the selected target key has its own highlight.
Clicking a calculator key selects it and lists every binding ending with that
key. Clicking a listed binding jumps to its PC key/modifiers. **Assign selected
key** replaces the selected binding with that calculator key; **Add to
sequence** appends it. These actions change only the settings draft and never
send calculator input.

The original sequence selectors remain available, including ordered repeated
keys and removal of individual steps. The eight-step bound is enforced by the
editing controls and by preference validation. At narrow widths the calculator
panel follows the PC editor; navigation and numpad keys are arranged below the
main physical-key group instead of forcing a horizontal scrollbar.

## Verification

`node tests/keyboard-geometry.mjs` checks the 104 physical positions, absence of
overlaps, special key sizes, international-code validation, AZERTY/QWERTZ
dispatch, French shifted digits, AltGraph, IME/dead-key handling, numpad lock
behavior, explicit unassignment, per-model copy isolation and denied-API
fallback. These tests import the source modules.

`tests/browser-keyboard.py` uses real headless Chrome, the production React
components/controller and the existing offline fixture. The test supplies an
explicit controlled layout source and dispatches corresponding character/code
events. It verifies mapping highlights, calculator badges/target selection,
independent model drafts and Apply/Cancel, the global application's default
character dispatch, layout-change invalidation, rejected API capture fallback,
international-key capture, the eight-step limit and desktop/mobile overflow.
The test exercises 1360×940 and 390×844 viewports and writes local diagnostic
screenshots to `build/keyboard-r22-{wide,mobile}.png`.

This is a UI and input-routing witness. It does not replace stock-ROM keyboard
and Alpha-state tests, and it does not claim that a mocked layout source is an
actual keyboard device or a complete hardware survey.

## Held physical keys

A PC binding with one calculator key now closes that contact from `keydown`
until `keyup`. OS keyboard repeat does not enqueue more taps. Mouse and touch
input use pointer capture and independent pointer owners, so directions can be
held and simultaneous contacts can overlap. Two sources holding the same scan
cannot release one another. All pressed contacts are highlighted in both views.
Multi-key bindings, keyboard activation of a focused on-screen button and
assistive clicks remain finite sequences.

Short clicks retain the model's tested minimum virtual dwell and release gap:
HP39g+ uses 1.5 million / 600,000 ticks; the other calculator presets use
600,000 / 360,000 ticks. Rapid clicks, including repeated clicks on one key,
remain ordered. A genuine hold has no timeout and does not depend on browser
repeat or the selected execution speed. Finite macros wait for current held
contacts to be released. The existing ON/F4 and ON/F3 system chords retain
their explicit overlap and timing.

Pointer cancellation or lost capture releases immediately. Blur, page hiding,
pause, a modal, reset, model/view changes and teardown clear input even when
the preference allows the calculator to keep running in the background.
The shared reset clears the displayed keys' pointer owners and DOM capture as
well as the Worker contacts. This also applies while IrDA keeps paired tabs
running; returning to the tab cannot route the next click to a previous key.
Cancelled queued pointers never execute later. The keyboard mapping editor
has no live-contact callbacks, so selecting a printed key cannot press it.

`tests/system-keys.mjs` verifies independent contact timelines, short-click
ordering, ownership, macros and cancellation. `tests/worker-pacing.mjs`
executes the production Worker down/up handlers at half, normal, double and
unlimited speed. `tests/browser-held-keys.py` uses Chromium keyboard, mouse
capture and CDP multi-touch dispatch to verify real DOM events, lifecycle
cleanup and both calculator views. Its background cases cover blur and page
hiding with pause disabled, and with pause overridden by an active IrDA pair,
then require a click on another key to reach that key. Pointer events and
capture are real; headless lifecycle events and snapshots are synthetic.

`tools/verify-held-keys-browser.py` is the separate original-ROM witness. It
opens an unchanged admitted HP39g+/HP39gs ROM and stock-installed Arkalite
game checkpoint through the production file inputs, holds keyboard left and
touch right for at least 12 million virtual ticks each, checks the paddle's
actual pixel movement and contact release, quits with DEL, and compares the
complete visible 1+1=2 frame against the independently executed native program.
It records asset/input hashes and private screenshots without changing guest
memory. This is bounded functional evidence, not a timing benchmark or a
claim of complete game, browser or physical touch-device coverage.

The same driver accepts `--scenario tetris` for the original native ARM Tetris+
on HP39g+ only. It restores the original cold-installed game's checkpoint,
holds keyboard left and touch right/Shift/Alpha for at least 12 million ticks
each, requires exactly one down/up pair per hold, checks continued display
updates, exits with ON and returns through HOME. Both the whole `1+1=2` LCD
and its arithmetic area (rows 16–55) must match the native run. The initial
Tetris piece is square, so Shift/Alpha exercise held contacts and continued
execution without claiming a visible rotation of that piece.

`--exit-hold-ticks 2000000` explicitly tests a sustained DEL/ON contact during
program return. The default remains an ordinary short click. Reports name the
exit operation and retain its actual down/up messages and observed contact
snapshots. A passing held-DEL case does not replace a failed short-click case
or change the product's click dwell; those outcomes remain separate.

Arkalite's post-DEL program return needs its own settling interval before HOME
and subsequent typing. The browser witness now allows the same 60 million
ticks used by the native program test. Native HP39gs trials at 600,000,
1.5 million and 2 million ticks across three input phase offsets all return
and calculate correctly with that interval. The initial shorter browser
settle could type before the game had returned; it did not establish a
missed physical contact and did not justify changing normal click timing.
