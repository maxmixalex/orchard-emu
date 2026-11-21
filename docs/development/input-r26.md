# Held input and Arkalite continuation

This continuation fixes a reproducible interaction between held physical keys
and queued character macros. The separate original Arkalite short-DEL issue
remains open. [Sanitized evidence](evidence/input-r26.json) records the contact
sequence, browser observations and distinct runtime identities without original
ROMs, programs, LCD pixels or checkpoints.

## Fixed: queued macros blocking another held key

On main revision `53a10ecbff7206ff3126ecd95b9b23f13fb8a352`, holding Left,
typing a character and then holding Right produces only the Left contact.
The character's finite Alpha/key macro waits for the first held key to end.
`TapQueue.press` also required the pending queue to be empty before admitting
an overlapping physical contact, so Right waited behind that same macro.
It could remain blocked for as long as Left was held.

The queue now admits another physical contact whenever an existing physical
hold remains down, including while a macro is waiting. Macros retain their
order and run after the physical holds end. Minimum dwell, release gaps,
shared ownership of one key, immediate cancellation and bounded queue capacity
remain unchanged. This follows the [held-key contract](keyboard-settings.md#held-physical-keys).

The same independently specified input sequence was executed against the
original revision's actual module and the candidate module:

| Action | Original contacts | Corrected contacts |
| --- | --- | --- |
| Left down at tick 0 | Left down | Left down |
| Queue Alpha + A | Macro waits | Macro waits |
| Right down at tick 10 | Right remains blocked | Right down at tick 10 |
| Keep both held through tick 1000 | Only Left is down | Left and Right are down |

`tests/system-keys.mjs` verifies the contact timeline, two owners of Right,
ordered macro completion and cancellation. `tests/worker-pacing.mjs` sends
actual Worker commands at Half, Normal, Double and Unlimited speeds and checks
the exact physical contact ticks and unchanged dwell/gap boundaries.
`tests/browser-held-keys.py` exercises real Chromium keyboard and pointer
events through the production React/controller and TapQueue using an explicit
synthetic guest clock. It also retains simultaneous touch, capture loss,
pause/modal/view teardown and eight background/paired-tab lifecycle cases.
This component fixture is separate from the original-ROM browser runs below.

## Original Arkalite short-click observations

Six runs used the unchanged published Arkalite package, original HP39g+ and
HP39gs ROMs, stock-installed game checkpoints and the ordinary production UI,
Worker and WASM. Each run held Left on the keyboard and Right by touch, checked
paddle movement from 65.5 to 5.5 and 124.5, released those contacts, clicked DEL,
returned to HOME and calculated `1+1=2`. Each input retained its normal down/up
path. No ROM, application or guest RAM was patched.

The six runs used WASM SHA-256
`8149548168ca58d3060cdf4a470f65cc3c3f05816add3b30173fc2bbc6631a80`
and official Chromium headless shell `150.0.7871.181`. The evidence retains all
served runtime hashes and each private report's hash.

| Original machine | Requested additional wait before DEL | Observed result |
| --- | --- | --- |
| HP39g+ | 0 / 1,340,472 / 1,922,205 guest ticks | All three return to the exact HOME `1+1=2` image |
| HP39gs | 0 / 1,340,472 / 1,922,205 guest ticks | All three return to the exact HOME `1+1=2` image |

The two nonzero offsets come from LCG seed `0x39a11`, multiplier `1664525`,
increment `1013904223`, modulus `2^32`, then reduction modulo `2000001`.
`tools/verify-held-keys-browser.py --exit-phase-ticks N` waits for the observed
guest clock before making the real DOM click and records requested and observed
ticks. Browser scheduling can overshoot that target; these are bounded phase
variations, not exact-contact deterministic replay. The complete result image
hash is `82cb43f44987c6388c3d41cb8f2944e60e9da50a6ddb47c8ff185e7e63c791d0`
in all six runs. The source records retain empty error lists and released final
contacts.

These successful observations do not explain the retained
[r25 short-DEL failures](compatibility-r25.md#browser-input-and-presentation),
establish their frequency or prove them repaired. The isolated mixed-macro bug
does not occur in this Arkalite exit sequence, so its fix is not offered as
the cause of the new passes. HP39g+ retains its 1.5-million-tick minimum dwell;
HP39gs retains 600,000 ticks. No dwell was lengthened to obtain these results.

## Earlier native-program regression identity

An earlier r26 core, SHA-256
`13bc6cb48b0877eadcdd3d6a904a219a0deef58957c0fa981708783ec3317143`,
passes Arkalite and Hanoi on both original HP39 models and Tetris+ on its
declared HP39g+ target. All five cases exercise program input/animation,
return, known HOME arithmetic and byte-identical complete warm continuation.
Tetris+ and Hanoi cold-install on this binary. Arkalite uses separately
recorded stock installations: its HP39g+ install and exact reverse export use
this binary; the HP39gs installation was first recorded on the earlier
`0f6815e7c42451423ee35109851cce2c1d74828a05a716bcd3abf6ae52dd1932`
binary. These native records are not relabelled as later-binary cold installs
or browser evidence. Source URLs and program hashes are retained in the JSON.

## HP40gs hardware-mod Arkalite manual baseline

The separately labelled `hp40gs-mod-home` profile uses the supplied 2 MiB
hardware-mod image, SHA-256
`9041a8c187667833b220281bee1311c97cf2a0297d483882684ebd166a85c311`.
It does not establish stock HP40gs hardware coverage. On the earlier r26 WASM
`209bce3c0cc3b7940d921aed8730dfb096ed7cb5600714e0eacc62ae3621239f`,
the unchanged published Arkalite library and aplet cold-install through the
production USB Wire sender. Each object uses an explicit physical RECV
sequence. The installed aplet is then exported through the firmware's USB
Disk SEND menu: its complete bytes and the library's complete payload match
the original inputs.

The menu navigation is model-specific. Independently viewed captures show
this image's RECEIVE choices, in order, as `HP39/40 (USB)`, `HP39/40 (Ser)`,
`USB Disk drive…` and `Ser. Disk drive…`. Selecting USB requires no Down
press; selecting USB Disk requires two. Reusing the original HP39gs verifier's
Down press would select Serial. An initial exploratory run was stopped after
that mismatch was observed; it is not an emulator failure or a passing test.
The final verifier records the correct menu contacts and completes the full
round trip. There is no infrared choice in the observed menu, so merely
adding model 3 to the existing HP39 infrared peer verifier would select USB
and would not demonstrate infrared operation.

After installation, physical Left/Right contacts change the running game,
DEL returns, and HOME calculates `1+1=2`. The existing independently viewed
arithmetic-area oracle remains unchanged:
`59a6894b2f4bd4cad5e07a5310e3cbb5a46ccaf521c4b25b3dbe08012ee13015`.
The complete 40gs image includes its CAS softkey and hashes to
`6e23de5c0516c316f6ac4b71a08e55dcdfcc118b3736546301c7d6555d9eed8a`.
Game and final arithmetic images were viewed independently. Restoring the
running-game checkpoint and repeating the same physical input produces an
identical complete v8 checkpoint. ROM and application bytes remain unchanged.
This native WASM record does not exercise browser short-click timing.

Reproduction uses caller-supplied private files and new output directories:

```sh
node tools/verify-hp39-wire-batch.mjs "$ROM40" "$LIBRARY" "$ARKALITE" "$INSTALL_OUT" --wasm "$WASM" --manual-receive
node tools/verify-hp39-programs.mjs "$ROM40" "$ARKALITE" "$PROGRAM_OUT" arkalite --wasm "$WASM" --checkpoint "$INSTALL_OUT/installed.checkpoint"
```

Normal UI admission is exact-hash-only for the labelled 40gs/50gm
modifications. Their saved sessions, remembered ROMs, key bindings and
binary autosaves retain separate identities. The original four model labels
remain unchanged and stock HP50g is not admitted by the 50gm image.
`tests/browser-components.py` now verifies both modifications' visible
provenance, 64-row geometry, connector controls and overflow at 320, 390,
720 and 1360 pixels. Model 3 exposes Wire upload and Disk serving;
its subsequent USB automatic continuation is described below. Continuous
Wire reception retains its original-model gate. Model 7 exposes USB object transfer and the shared SD
sidebar. Both modifications hide unverified infrared controls. These DOM
checks and the real IndexedDB autosave transaction test passed; they do not
substitute for the separate production-browser ROM matrix.

All six `held-Escape-F4-exit-arithmetic.png` images from the complete
`209bce3c…` production-browser matrix were independently viewed. Each shows
the entered `1+1` and result `2` after leaving self-test. The original four
titles agree with their cases; HP49g+ uses the taller 80-row display and the
others use 64 rows. Both modification labels and their persistent provenance
are visible. The 50gm case remains visibly HP48gII-derived, with the separate
50gm label and 512 KiB/64-row explanation. No LCD content is cropped or
obscured. The visual-review record keeps screenshot and original-report
hashes separately; it does not alter those earlier reports or relabel them
as stage4 runs.

The six-model landscape fixture also passes its four viewport sizes and
50–180% zoom checks. Its assertions now specify firmware identity, artwork
identity and LCD rows separately: the prior assumption that a labelled
modification must have the same name as its donor artwork was invalid, as
was treating every model ID above 4 as an 80-row display. Exact geometry,
51 unique keys, pointer/focus input and model/provenance assertions remain.

## HP40gs USB automatic RECV

The later stage4 build adds optional automatic continuation to the exact
40gs-mod profile. Its USB choice is the first entry. The observed four-item
dialog can shrink to USB and Serial after connecting; the two known complete
dialog fingerprints are `0x5291d6d5` and `0x4f4f761b`, over the existing
`[17,4,95,48]` menu region. Both mean USB is selected. The driver presses
RECV, waits for the stable recognized menu, and presses Enter directly.
It never sends the Down contact used by the original 39g+/39gs menus.
Those original menu fingerprints remain unchanged.

UI visibility, controller opt-in and the driver share one USB-only model gate.
Only acknowledged library/aplet boundaries qualify. The existing repeated
stable-screen requirement, idle-key-queue check, 30-second guest-time limit,
unknown-screen fallback and manual-input cancellation remain in force. A
changed dialog, transfer progress dialog or another model's menu is not
treated as a matching 40gs menu. `tests/hp39-wire-auto.mjs` checks 230 state
and controller assertions across all three models. Actual retained ROM
frames additionally verify both 40gs menu variants, unchanged original-model
recognition, cross-model rejection and rejection after a dialog pixel changes.

`tools/verify-hp39-wire-auto-browser.py` passes the complete cold workflow on
stage4 WASM
`bb53704a128319df23a0340da4bf7e8767d1a98ae8337a3b4d8572750d4ec7a3`:

1. Open the exact ROM through the ordinary file input and cold-boot the firmware.
2. Select the unchanged aplet before its library through the real file chooser,
   opt into automatic continuation and arm the first RECV manually.
3. Start the batch. Production preflight orders the dependency first; both
   original objects receive protocol completion and the UI reports `2 / 2`.
   The read-only command observer records exactly `[39]`, then `[6]`, for
   automatic continuation, with no additional physical key events or Down.
4. Download the firmware's reverse USB Disk SEND outputs and compare the
   complete aplet and complete library payload to the inputs.
5. Run Arkalite, exercise Left/Right, use an ordinary DEL click, return to HOME,
   and match the existing full `1+1=2` frame and arithmetic-area oracle.

The final game and HOME screenshots were viewed independently. The observer
does not inject Worker commands, protocol replies, keys or guest memory.
All 29 requested production responses match their recorded asset hashes; the
complete 51-file distribution and input files remain unchanged. There are no
page or Worker errors. This is browser evidence from a cold installation,
separate from the earlier native warm-replay baseline.

Two preliminary harness failures are retained separately: the switch's exact
accessible name included its help description, and the root document response
`/` needed to be recorded as `index.html`. The latter run had already passed
the full functional flow before its asset-name assertion failed. Only those
verifier assumptions changed; production assets were not rebuilt. The final
complete run satisfies both the functional and asset assertions.

```sh
python3 tools/verify-hp39-wire-auto-browser.py --rom "$ROM40" --library "$LIBRARY" --aplet "$ARKALITE" --dist "$FROZEN_DIST" --expected-wasm "$WASM_SHA256" --output "$BROWSER_OUT"
```

This extension does not admit 40gs infrared, serial automatic continuation,
continuous Wire reception, other ROM revisions or stock HP40gs hardware.

The initial desktop Chromium launch failed before loading a page because this
execution environment denied its process-singleton socket. The successful
browser records use the official headless-shell runtime; the launcher failure
is separate from emulator regressions. No physical timing, all-browser or
unbounded-session compatibility claim follows from this continuation.
