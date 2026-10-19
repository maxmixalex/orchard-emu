# Input, physical keyboards, recording and native USB/IP continuation

Baseline: `5bc222f7178a1a8f6cf9ce5bed98cfd98602b258` (public mirror).
No ROM, font or new third-party dependency is added. The C ARM/MMU core is
unchanged in this continuation; this is not a claim of instruction-dispatch
or address-translation speedup or completed hardware clock calibration.

## Implemented

Worker input clocks now start a new epoch after machine creation, ROM loading,
reset and checkpoint rewind. Previously the TapQueue could retain a 240M-tick
ready time when the core had already returned to zero. The first post-reset
key then waited for the previous uptime to elapse again.

Backlogged Worker execution uses cancellable MessageChannel tasks instead of
nested zero-delay timers. Tasks still have the existing 6 ms budget and UART
calls remain bounded to 1024 ticks. Idle periods still sleep. The 50 ms debt
cap, functional timebase and physical key hold/gap values are unchanged.
No instructions or peripheral events are skipped to catch up.

The mapping editor uses a 104-key ANSI layout with real unit widths, row
stagger, separate navigation and numpad blocks, inverted-T arrows and tall
numpad +/Enter keys. Left/right modifiers retain the existing normalized
mapping semantics. PrintScreen, ScrollLock, Pause, NumLock and ContextMenu
are now valid binding codes. Existing saved settings remain compatible.

Traditional mode uses the pinned hp-calcs-svg key paths, transforms, positions
and Shift/Alpha legends instead of an equal-width row grid. The independent
geometry renderer accepts all six existing model manifests; this alone does
not certify four additional firmware models. Artwork remains covered by its
existing Apache-2.0 license and NOTICE. No artwork/font is regenerated.

The calculator toolbar now records only its LCD, with start/stop and an elapsed
time indicator. It uses 4x nearest-neighbour output at 30 fps, prefers VP8/WebM,
and selects an MP4 filename only when an MP4 encoder is actually available.
A paused screen remains in the recording with wall-clock duration. Model/ROM
changes finalize the previous recording. Encoder failure, unmount, repeated
stop and the 64 MiB collection limit release the capture tracks. The limit is
checked at encoder chunk boundaries, not an exact maximum final file size.
No microphone or desktop capture is requested.

## Native USB/IP entry point

Start the existing local host and put the guest into USB transfer mode as
before. `python3 host/attach.py` discovers the loopback export on port 3240;
`--port N` selects another local port. Discovery does not mount anything.

`python3 host/attach.py --attach` explicitly hands the imported socket to
Linux vhci_hcd through its sysfs attach ABI. It requires an already installed,
exposed controller and write permission. It does not install/load a driver,
invoke sudo, expose a network listener or modify firmware. It checks the
Orchard export identity before handoff, then waits for a matching kernel port
and actual idVendor/idProduct attributes. Only that readback sets
`osAttachmentVerified` to true. A successful IMPORT or sysfs write alone is
not reported as successful OS enumeration. If enumeration times out, the
error identifies the allocated port for inspection/detach with a USB/IP client.

This implementation is a Linux native attach path, not a Windows client driver.
Windows Conn3x integration and actual stock file roundtrips remain unverified.

## Validation performed

`npm run test:continuation` runs four regression suites, also included in the
existing frontend test target. It covers pacing/cancellation, all four Worker
clock-epoch transitions, 104-key geometry/non-overlap and binding validation,
recording lifecycle/format/cleanup, and Python discovery against the actual
Node TCP USB/IP server with synthetic descriptor fixtures.

The Worker lifecycle fixture executes the actual message handlers with a core
double. Running it against the original Worker fails on the post-reset first
key assertion; the modified Worker passes all four transitions. This is not
real-ROM input-to-LCD latency calibration.

Chromium component validation rendered the new keyboard classes, checked
click-to-scan behavior and disabled keys, and encoded a changing synthetic
131x64 LCD to 524x256 VP8/WebM. FFmpeg decoded the recording and its changed
frames. Captured tracks ended after stop and model-size change. These are
synthetic component witnesses, not stock-calculator video or a full React
application/firmware acceptance test.

An actual `--attach` attempt in the development container failed at preflight:
`vhci_hcd is unavailable: no virtual USB host controller is exposed`.
Therefore OS mounting and Conn3x file transfer are NOT accepted here.

## Remaining acceptance work

Profile/optimize ARM dispatch and live MMU translation with native and WASM
parity tests; compare stock workloads and input-to-LCD delay to real hardware.
Exercise kernel enumeration, driver binding, reconnect/cancel and byte-checked
stock file upload/download, then Windows Conn3x. Obtain and validate the
appropriate native NORs for 39gs/40gs/49g+/50g and test stock startup/calculation.
The normal calculator catalog still accepts the two previously verified ROMs.
