# Settings, input and time pacing

The user calculator remains separate from `debug.html`. Settings are edited
in a native modal dialog; Cancel discards the draft. Routine compatibility
settings, registers and research counters stay off the user page.

## View and keys

Immersive shows the outlined calculator case and its geometric hit regions.
Traditional shows the same LCD/annunciators with HTML calculator buttons;
only one keypad is visible and keyboard-focusable at a time. The app occupies
the viewport with an internally scrolling workspace. Size ranges from 50–180%.
The traditional LCD snaps its scale to whole physical-device pixels; outlined
skin paths remain vectors. User zoom can deliberately exceed the workspace.
Help is available on focus/hover/click at the question button. License notices
wrap rather than forcing horizontal page scrolling.

Key bindings use physical browser `KeyboardEvent.code` with explicit modifiers,
are stored separately for HP39g+ and HP48gII, and may contain up to eight
sequential physical calculator taps. Mapping changes are atomic; an invalid or
full input queue never accepts half of a macro. Repeated keydown/IME events and
input in modal/form controls do not enter the calculator. Browser-reserved
shortcuts may not be delivered to a page.

HP39g+ letter defaults follow the pinned artwork's printed alpha legends:
`KeyA` sends ALPHA then VARS. The original D1.55 guest was observed drawing A
in its command line from this sequence. These are literal switches, not text
injection: an already-active guest Alpha/Shift state can change their meaning.
The HP48 letter layout is not silently assumed identical; custom sequences
can be configured for it. No guest memory is edited to enter text.

Shortening taps without testing caused a real regression: HP39g+ read `7*8`
as `78` at 600,000 down / 360,000 released ticks. Several other short pairs
also failed when their start phase changed. The retained user timings are
**1,500,000 / 900,000** for HP39g+ and **600,000 / 360,000** for HP48gII.
Both retained pairs passed the two arithmetic sequences at eight different
start phases per model. Both models reproduce the established final calculation-frame hashes
in the cold-start short-key witness. This is not an all-key debounce survey.
The debug page retains its historical 2M/2M schedule for old probes.

## Pace is not execution throughput

Before this revision the user Worker ran as fast as the host allowed. CPU
optimizations therefore also accelerated virtual time, including timer-driven
cursor activity. This was a genuine missing wall-time governor, not evidence
that the earlier instruction/state differentials were wrong.

The core already defines `O_FUNCTIONAL_TIMEBASE_HZ = 12,000,000`; its RTC maps
that timebase rationally to 32,768 Hz. The new WASM export reports that value.
Normal gives the Worker that many quanta per monotonic wall second. Half,
Double and Unlimited are explicit settings; the debug workbench stays unlimited.
Host speed now controls spare capacity instead of automatically increasing
Normal's time rate. A slow host can still run behind; this is not a claim that
one instruction equals one physical ARM920T cycle or that PLL/PCLK is calibrated.
No host clock value is written into guest RTC registers.

Credit/backlog is capped at 50 ms and reset on resume, rate change and restore.
Returning from a suspended/background tab cannot replay minutes of accumulated
work in a fast burst. Frames, inputs, serial drainage and USB host polling stay
bounded between core calls. Browsers can still throttle background Workers.
The public Normal rate is a functional reference, **not a measured real-machine
speed**. Physical clock domains and the absolute cursor period remain open.

The calculator's current `run_clocked()` runner follows the guest CPU/peripheral
ratio, including ARM920T bus mode, within that functional timebase. The tested
HP39 HOME state issues four CPU slots per peripheral quantum and HP48 issues
two; the legacy workbench remains one. This reduces arithmetic and Aplet view
latency without multiplying RTC time or shortening physical key contacts.
See the [scene comparison](performance.md#calculator-clock-ratios-and-visible-latency-2026-10-20)
for its evidence and the remaining physical-clock limits.

A local HP39g+ editing probe observes most editing-frame changes about
1.56M quanta apart, sometimes split across adjacent samples while the framebuffer
is being redrawn. No change was seen in the empty-HOME 24M-quanta window.
Whole-frame differences are not a physical cursor timing certificate, and
this record does not claim a corrected hardware blink frequency.

## Lifecycle and local storage

Pause on blur and pause on hidden tab are independent preferences, both initially
enabled. Input is released on either departure even when continued execution is
selected. Page departure always pauses for safe back/forward-cache restoration;
returning does not silently resume. It does not destroy the Worker.

Autosave is opt-in localStorage, every 15/30/60/120 seconds and best effort on
visibility/departure. It copies a core checkpoint at a run boundary without
pausing a running guest, then hashes/encodes the copy. Queued/held taps and an
active USB control transaction defer the copy. See [sessions](sessions.md) for
privacy, restore identity checks and cross-tab/quota limitations.

## Evidence boundary

Pure pacing tests execute equivalent virtual budgets using 256/1024/4096-sized
host chunks, including faster/slower hosts, rate changes and suspension. Model
mapping, atomic macros, storage validation/quota/conflict, lifecycle dispatch
and native modal markup have ROM-free tests. Production Worker tests verify
serial echo and snapshots while continuing execution.

Offline Chromium rendering checked 16 combinations of 320/390/720/1440 px,
both views and 100/180% zoom, plus 12 modal bounds checks. It executed the
shipped HTML/CSS with inert skin assets, not the application's module graph.
Actual origin navigation is blocked by this environment's browser policy.
No file-picker, real download/localStorage, touch or whole-browser E2E pass
is implied; no administrative policy was changed.

References: [HTML dialogs](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element),
[Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html),
[Storage model](https://storage.spec.whatwg.org/), and Samsung's
[S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
chapter 17. The latter describes a distinct RTC oscillator; it does not specify
Orchard's provisional instruction-to-quantum timing.


The current [React frontend](react-ui.md) adds English/Chinese selection and a
clickable PC-keyboard editor; existing physical sequences and session settings
remain compatible. Frames do not trigger React control-panel renders.
