# Settings, input and time pacing

The user calculator remains separate from `debug.html`. Settings are edited
in a Mantine modal dialog; Cancel discards the draft. Routine compatibility
settings, registers and research counters stay off the user page.

## View and keys

Immersive shows the outlined calculator case and its geometric hit regions.
Immersive landscape splits that artwork below the six FN keys, keeping the
LCD and soft keys on the left and the remaining keyboard on the right.
Traditional shows the same LCD/annunciators with HTML calculator buttons;
only one keypad is visible and keyboard-focusable at a time. The app occupies
the viewport with an internally scrolling workspace. Size ranges from 50–180%.
The traditional LCD snaps its scale to whole physical-device pixels; outlined
skin paths remain vectors. User zoom can deliberately exceed the workspace.
Help is available on focus/hover/click at the question button. License notices
wrap rather than forcing horizontal page scrolling.

Key bindings use physical browser `KeyboardEvent.code` with explicit modifiers,
are stored separately by calculator model, and may contain up to eight
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
also failed when their start phase changed. The previous default timings were
**1,500,000 / 900,000** for HP39g+ and **600,000 / 360,000** for HP48gII.
Both pairs passed the two arithmetic sequences at eight different
start phases per model. Both models reproduce the established final calculation-frame hashes
in the cold-start short-key witness. This is not an all-key debounce survey.
The debug page retains its historical 2M/2M schedule for old probes.

### HP39 release gap

The calculator keeps the HP39g+ press at **1,500,000 ticks (125 ms)**
and reduces the released interval from 900,000 to **600,000 ticks (50 ms)**.
HP48gII remains at 600,000 / 360,000 ticks, and the workbench remains at
2M/2M. This input-only change kept the `run()` execution policy, Normal pacing
and research execution APIs unchanged. The later r21 shared-PCLK model is a
separate peripheral correction, documented below.

A 360,000-tick (30 ms) gap was rejected on the first `1+1` case at phase zero:
the ROM accepted `1+`, missed the second `1`, and displayed Invalid Syntax,
although every requested physical contact occurred. The 50 ms candidate
passed all 16 cases in the existing eight-phase arithmetic set and all 64
cases in a 32-phase extension. The extension samples a 200 ms start-phase window
every 75,000 ticks (6.25 ms); the 2.4M-tick endpoint also passed in the initial
set. Every accepted case matches the complete known LCD and all eight
down/up events for `1+1` or `7*8`, without a guest stop. These 80 executions
cover 74 distinct expression/phase combinations. Independent adjacent-repeat
(`11+1`) and default ALPHA/`KeyA` macro checks also pass all 32 executions:
16 with the old gap and 16 with the new gap, from matching pre-key states.
They match the independently prepared old-timing LCD after all contacts have
been delivered and the final release gap is complete. This remains a finite
input witness.

For a four-key expression, the three gaps before ENTER total 150 ms instead
of 225 ms, placing ENTER at 525 ms rather than 600 ms in functional-reference
time. This is **75 ms less input queue time**, not a measured browser response
gain. An isolated APLET click has no preceding queued key, so this change
does not shorten its initial press or establish faster Aplet Library display.

The Worker regression fixture exercises the actual `create` handler and
checks exact contacts at Half, Normal, Double and Unlimited speeds. A new tap
must still wait for the previous release gap even when the pending count has
already reached zero. `tools/probe-interaction.mjs` deliberately retains its
historical HP39 125/75 ms witness; it does not read production defaults.
Use explicit `--hold 1500000 --gap 600000 --runner run` with
`tools/probe-input-dwell.mjs` for the current HP39 timing.

## Pace is not execution throughput

Before the wall-time pacing milestone, the user Worker ran as fast as the host allowed. CPU
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
speed**. The r21 core now derives a shared fractional PCLK for PWM, watchdog,
ADC and SDI from the guest's clock configuration. RTC keeps its independent
timebase; the change does not add CPU issue slots. Measured board input
frequencies, PLL lock duration and the absolute cursor period remain open.
See [runtime clocks](clock-ratios.md).

The production Worker retains `run()` for continuous execution and single-step,
with one CPU slot per reference quantum and the same RTC timing. Key contacts
use the model-specific intervals above. `run_idle()` and `run_clocked()` are explicit research APIs; neither is
selected by the UI. Both implement guest CLKCON.IDLE sleep and interrupt wakeup;
the latter also models CPU/peripheral issue ratios. Browser arithmetic regressed
under the ratio policy, and the one-slot IDLE candidate retained unexplained
slow Aplet Library samples despite passing its guest-state checks.
See the [scene comparison](performance.md#calculator-clock-ratios-and-visible-latency-2026-10-20)
for its evidence and the remaining physical-clock limits.

Firmware Power_OFF is supported by the production runner and is distinct
from the experimental CLKCON.IDLE issue policy. It stops CPU issue while the
retained RTC and eligible wake sources continue. Four admitted original ROMs
time out after about five functional minutes, save/restore the off state,
and resume through ON with their prior calculation intact; see
[power management](power-management.md).

The optional **Settings → Transfer → Unlimited during transfers** override
removes host pacing only while an active protocol transaction is working.
Waiting for the next stock RECV selection, pause, cancellation, error and
completion restore the user's selected speed. Applying a changed setting
during a transfer updates that policy; Cancel leaves the previous setting.
This pacing override does not change the guest's clock-register values.

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

Autosave is opt-in binary IndexedDB, every 15/30/60/120 seconds and best effort on
visibility/departure. It copies a core checkpoint at a run boundary without
pausing a running guest, then hashes/encodes the copy. Queued/held taps and an
active USB control transaction defer the copy. Earlier localStorage records
are migrated after successful replacement; the limited fallback remains
available when IndexedDB is unavailable. See [sessions](sessions.md) for
privacy, restore identity checks and cross-tab/quota limitations.

## Evidence boundary

Pure pacing tests execute equivalent virtual budgets using 256/1024/4096-sized
host chunks, including faster/slower hosts, rate changes and suspension. Model
mapping, atomic macros, storage validation/quota/conflict, lifecycle dispatch
and modal interactions have ROM-free tests. Production Worker tests verify
serial echo and snapshots while continuing execution.

The historical offline Chromium rendering checked 16 combinations of 320/390/720/1440 px,
both views and 100/180% zoom, plus 12 modal bounds checks. It executed the
shipped HTML/CSS with inert skin assets, not the application's module graph.
At that stage, origin navigation was blocked by the environment's browser
policy; no administrative policy was changed. Those screenshots remain
offline-layout evidence. Later production-origin Chrome witnesses exercise
original-ROM file pickers, downloads, arithmetic and session restore, while
separate component tests cover all three views, languages and storage behavior.
Their exact scope is in [browser verification](web.md#publication-and-verification).
Broad touch, background and multi-browser acceptance remain open.

References: [HTML dialogs](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element),
[Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html),
[Storage model](https://storage.spec.whatwg.org/), and Samsung's
[S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
chapter 17. The latter describes a distinct RTC oscillator; it does not specify
Orchard's provisional instruction-to-quantum timing.


The current [React frontend](react-ui.md) adds English/Chinese selection and a
clickable PC-keyboard editor; existing physical sequences and session settings
remain compatible. Frames do not trigger React control-panel renders.
