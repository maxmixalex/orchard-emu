# Browser calculator

[Open calculator](https://maxmixalex.github.io/orchard-emu/emulator/) ·
[Developer workbench](https://maxmixalex.github.io/orchard-emu/emulator/debug.html)

The user page identifies the two supported complete ROMs automatically. It
shows Open ROM, Pause/Resume, Restart, Save/Restore, Connections and Settings;
CPU registers, boot presets and implementation counters stay in the workbench.
The viewport-filling workspace switches between immersive outlined skin and
traditional LCD/HTML keys in Settings, not a duplicate text keypad. Help is a
question-button tooltip; confirmations and errors use native modal dialogs.

Settings configure scale, blur/background policies, speed, model-specific
physical-key sequences and optional localStorage autosave. See
[interaction and clock boundaries](interaction.md) and [sessions](sessions.md).
Normal is paced to the existing functional timebase; it is not a measured
ARM920T instruction/clock calibration. Other rates are explicit.

Connections now exposes virtual UART bytes and a bounded USB host that reads
actual guest descriptors. It is not a physical PC device or a completed HP
file/object-transfer client; see [virtual links](virtual-link.md). IR is
[evaluated separately](infrared.md), not advertised as implemented.

## Build and use

Build with Python 3, Node.js 22+, Clang and wasm-ld using `npm run build`;
`npm run dev` serves the result on loopback, normally port 8123. The compiled
ZIP needs only Node.js: extract and run `node serve.mjs`. No npm packages or
ROMs are included. Use HTTP on localhost or HTTPS, not file URLs.

Open the original full NOR. On HP39g+, acknowledge Memory Clear with F6/OK;
on HP48gII first choose F6/NO at Try To Recover Memory, then F6/OK. These are
guest screens, not host-detected states. Restart clears memory; a saved HOME
session can be restored instead. Both main thread and Worker bind the image
to the documented hash. The displayed Beta is not an all-model support claim.

## Ownership, rendering and lifecycle

One Worker owns CPU and peripheral state. Its user pump runs bounded 1024-tick
calls in tasks capped around 6 ms, independently draining UART and polling the
USB host; user frame delivery is limited to about 30 Hz. Unchanged LCD pixels
reuse their ImageData and do not repaint. Unchanged key/annunciator attributes
are not rewritten. Debug snapshots retain their existing state layout.

Key macros are atomic bounded queues of switch transitions. Blur/hidden always
release keys even when pause is disabled. Pagehide pauses for safe cache return;
persisted pageshow does not automatically resume. Generation IDs reject old
ROM reads, snapshots, saves and restores. Private ROMs are never uploaded.

Seven skins retain Apache-2.0 attribution separately from the original MIT
core. Both matrix and guest-driven annunciator strip share the same data in
either view. Packed-LSB remains an explicit compatibility interpretation, not
an independently verified physical panel model. See [skins](skins-segments.md).

## Publication and verification

Build runs native/reference/sanitizer and production-module checks, strict
Zensical rendering and publication allowlists, then creates one tested site.
Pages promotes the exact successful current-main artifact, checks source and
hashes, and verifies all public HTTPS assets. It never recompiles during deploy.
Tests, firmware, saved sessions, reports and fonts are excluded.

Node tests use the unmodified production Worker through browser-global/asset
adapters. Preference, macro, pacing, storage and connection tests complement
those. Offline Chromium layout checks do not execute application modules.
Actual localhost-origin navigation still returns ERR_BLOCKED_BY_ADMINISTRATOR
here; no policy was modified. No real file-picker, focus/touch/background,
localStorage persistence or end-to-end browser acceptance is claimed.


## Current user frontend

The user page is now React/Mantine with bundled Chinese/English resources, a
clickable PC-keyboard mapping editor, printed modifier legends and PNG capture.
It preserves the existing model, pacing, storage and physical input contracts.
See [React UI](react-ui.md) for implementation and verification boundaries.
The old vanilla calculator controller is removed, not layered under React.
