# LCD evidence, inspection and bounded hypotheses

## What is established, and what is not

The [Samsung S3C2410A manual](references.md) defines the STN data formats,
LCDCON5 byte/halfword controls and BLUELUT. It does **not** identify LCD
address `0x4d000068`. Original HP39g+ and HP48gII firmware poll this location
with video disabled and then enable video when the read becomes zero.
That code path alone does not establish the register's hardware function.

A comparative read of [x49gp's LCD implementation](https://github.com/claudiobsd/x49gp/blob/master/s3c2410_lcd.c)
(blob `3c7745863fabb8da5cfac974daae92ea76a50967`) found an explicitly unnamed
`__unknown_68` register initialized to zero. This is an older emulator's
approximation, **not independent silicon evidence**. Its register-storage,
read-driven scan counter and fixed-width rendering implementation were not
imported. Selected MAME LCD DMA code was also consulted for comparison;
see the provenance record in [references](references.md).

The project therefore retains two separate modes rather than declaring the
missing register solved. `src/lcd.c` is original code implementing the bounded
experiment and the documented inspection rules below.

## Explicit idle-zero experiment

The default remains strict: unsupported `+0x68` reads stop the machine.
`orchard_lcd_probe68(machine, true)` or CLI `--lcd-probe68 idle-zero` changes
**only aligned 32-bit reads of this exact address while ENVID is clear** to
return zero. Byte/halfword accesses, writes, neighboring addresses and reads
with video enabled remain unsupported. It neither patches NOR nor skips an
instruction. The guest executes the LDR and subsequent control flow itself.

This is a compatibility hypothesis intended to reveal later dependencies, not
an implementation of FIFO occupancy, drain completion or a measured reset
value. ENVID clear is the eligibility condition; it is not proof that the
physical LCD bus is idle. Do not enable it automatically by model or ROM hash.

`orchard_lcd_probe68_reads()` counts every unverified read. CLI/probe output
contains both `lcd_probe68` and `lcd_unverified_reads`. Disabling the option
does not erase the count; cold reset clears the policy and counter. Probe v4
reapplies the requested policy after reset. An experiment with a nonzero count
cannot close the canonical hardware or stock-boot gate. `boot_verified` remains
false even when a run budget finishes successfully.

The previous `5f93b3f` baseline exposed LCDSRCPND and ADC configuration as
subsequent dependencies. The current implementation passes those accesses.
With explicit ADC samples, the conditioned 39g+ and 48gII runs now stop at
USB initialization; see [boot research](boot-research.md). Without idle-zero,
both established LCD `+0x68` stops remain unchanged.

## Documented register and functional scan model

LCDINTPND, LCDSRCPND and LCDINTMSK are separate state, with reset values
0, 0 and 3. Frame events latch the source even while masked. Unmasking an
already-pending source can request service; remasking does not erase an
already-latched request. Pending and source have W1C acknowledgment. Both
acknowledgment orders work: clearing INTPND first must not recreate the same
old event every scheduling quantum. IRQ 16 is routed through the existing
main interrupt controller. The vendor register definitions are supplemented
by the Linux s3c2410fb hardware driver's acknowledgment sequence; no driver
implementation was imported (see [references](references.md)).

The read-only LINECNT now advances with virtual time rather than reads.
Single-scan monochrome/2-bpp/4-bpp modes count from LINEVAL down to zero,
reload, count a completed frame and generate frame synchronization events.
The line period uses guest CLKVAL, HOZVAL, WDLY, WLH and LINEBLANK. Repeated
register reads and diagnostic snapshots do not advance it. Enabling starts
from LINEVAL and phase zero; disabling freezes the current count. The first
frame event occurs after a full frame. These startup/freeze conventions and
one functional HCLK per scheduler quantum are explicit approximations, not
verified physical edge timing or PLL/clock-gating behavior.

The manual is internally inconsistent: the formula on page 15-4 gives powers
of two for WDLY/WLH, while register tables 15-28/15-29 specify 16/32/48/64 HCLK.
The functional model follows the explicit tables. This discrepancy remains a
physical-timing verification item, rather than being silently hidden.

A valid LCDCON1 write confined to CLKVAL is accepted while video stays enabled.
The current line and elapsed phase are preserved; the next scheduler tick uses
the new line period. If the shortened period has already elapsed, one line
completes at that tick. This functional convention supports native software
that adjusts the divider, but is not measured physical divider-edge timing.
CLKVAL below 2, unsupported display modes, reserved timing fields and live
mode or geometry reprogramming still stop explicitly. Valid clock settings
were added to the old synthetic guests; their CLKVAL=0 had only worked because
the prior implementation did not run a scan clock.

There is **no FIFO occupancy, fetch arbitration, underflow or analog panel**
model. FIFO interrupts must remain masked; attempts to unmask them stop.
Enabling LPC3600, a TFT temporary palette or an undocumented dither pattern also stops.
LCD `+0x68` remains separate, unidentified and strict by default. A working
scan counter/frame IRQ is not evidence of correct physical panel pixels.

## Controller stream versus packed-memory inspection

`orchard_framebuffer()` retains the controller-stream view. The new
`orchard_framebuffer_view()` accepts these explicitly distinct interpretations:

| View | Meaning | Selection |
| --- | --- | --- |
| Controller | STN MSB-first stream with LCDCON5 BSWP/HWSWP | Default / `ORCHARD_FRAME_CONTROLLER` |
| Packed LSB | Logical guest framebuffer memory, least-significant pixel group first within each byte, without controller byte swaps | `ORCHARD_FRAME_PACKED_LSB` / `--frame-view packed-lsb` |

Both use guest-programmed source, line count and stride, profile-visible
cropping, physical memory bounds and the implemented STN 1/2/4-bpp subset.
The 2-bpp intensity comes from the four BLUELUT nibbles, not an assumed linear
palette. Capturing either view has no guest-state side effects. Native PGM
output and WASM `frame_view()` use the same decoder.

The packed-memory view makes the known HP50g recovery text readable. It is a
**diagnostic interpretation, not a validated controller-to-panel wiring map**.
No register or guest buffer is modified to obtain it. It does not infer bits
per pixel from a convenient bootloader convention or hardcode a 160-pixel
stride. Physical line wiring, temporal grayscale, contrast and annunciators
remain separate work. The calculator's admitted HOME setups select packed LSB;
the workbench and CLI retain the explicit controller/packed-memory choice.

## Host presentation synchronized to the scan counter

The raw framebuffer APIs above remain instantaneous, side-effect-free memory
inspection. They are not a latched panel image. In r22, the Worker sampled live
RAM after a run slice noticed a changed scan serial. That bounded repeated UI
reads, but the first observation could still fall after the guest had begun
clearing or redrawing the next image.

The r23 optional native observer copies the framebuffer and annunciators in
`o_lcd_tick`, exactly when the existing completed-frame event increments the
serial. `orchard_lcd_observe` is disabled by default; the calculator's
`LCDFrames` enables it with its explicit inspection view. Published accessors
return the last completed-boundary copy. Raw debug access remains independent.
The observer cannot advance time, change IRQ scheduling, write guest RAM or
turn an unsuccessful inspection into a CPU stop. Its buffer and enable/view
policy are host state, excluded from checkpoints. Reset, restore, view changes
and ENVID transitions invalidate it.

The Worker still checks after each bounded run call, after servicing links.
It reuses the latest native publication until the serial changes. The UI still
publishes around 30 Hz and coalesces incoming messages in `requestAnimationFrame`.
This removes the after-slice sampling offset; it does not reconstruct row DMA,
FIFO/bus arbitration or the individual pixels received during the preceding
scan. A program that clears and redraws the same live buffer across complete
scans can still show intermediate content. The r23 GBP diagnostic measurement
below measures this new path separately; historical r22 timings do not.

**Settings → General → LCD response** offers Instant (the default) and Smooth
(35 ms). Smooth applies an explicit exponential response to intensities in guest
time, with a 35 ms time constant. It processes the completed-scan samples
observed by the existing Worker pump; it does not interpolate missing guest
execution. This is a presentation choice, not an HP panel measurement. It
reduces the contrast of rapid transitions at the cost of visible persistence.
Every valid white image participates normally and converges to white. There is
no text recognition, frame rejection, guessed black-pixel threshold or delay
that waits for a preferred picture. Power-off, unavailable frames and reset
clear history immediately; annunciators retain their actual published levels.
The debugger always uses immediate raw pixels without the response filter.

The self-test's briefly visible old **LCD TURNED OFF** text after ENVID becomes
one is valid guest content. The original-ROM measurement below establishes that
firmware enables the LCD before updating that text. The UI does not rewrite it.
The observer explicitly invalidates on both power transitions; it cannot retain
an obsolete cached disabled image over a newly enabled display.

Live display, PNG capture and recording share the published native-size pixels,
including a selected response mode, and the same empty-screen fallback when
inspection is unavailable. The original error status remains in the controller
and workbench. Spatial scaling described below affects only display rendering.

Maintained verification:

- `tests/lcd-input.c` checks capture at the native scan event, subsequent live
  RAM rewrites, the next publication, off/on invalidation and observer reset.
- `tests/lcd-publication.mjs` checks published exports and raw debugger access,
  the explicit 35 ms response, power transitions and partial rewrites within one
  synthetic scan, a completed white frame, video disable, invalid data, forced observation,
  model/view/reset/rewind changes, 64-bit serial carry and WASM memory growth.
- `tests/browser-lcd.py` sends 300 synthetic messages before one real browser
  animation frame: one Canvas paint and no resize/clear. Legitimate white frames
  remain visible; decoded PNG and the actual recording canvas match every live
  pixel for healthy, unavailable and recovered images. Real MediaRecorder also
  produces a nonempty video. These synthetic pixels contain no firmware artwork.
- `tools/probe-lcd-publication.mjs` uses only original ROMs and physical keys to
  compare raw/synchronized publication requests during menu navigation and
  arithmetic. It verifies byte-for-byte final checkpoint equality, measures
  alternating warmed execution/CPU samples, and emits only hashes and metadata.
  Its 33-virtual-ms publication schedule is deterministic; it does not substitute
  for a browser wall-time benchmark or physical-panel calibration.
  r23 recreates a fresh core for every trial: a host observer deliberately
  survives checkpoint restoration, so reusing an enabled core would contaminate
  a supposedly unobserved baseline.

Historical [r22 evidence](evidence/lcd-publication-r22.json) records 278 requests per original
ROM, without publishing the ROM, RAM, checkpoints or pixels:

| Original firmware | Same-scan image changes before | After | Final guest checkpoint |
| --- | ---: | ---: | --- |
| HP39g+ | 6 | 0 | Byte-identical |
| HP39gs | 4 | 0 | Byte-identical |
| HP48gII | 11 | 0 | Byte-identical |
| HP49g+ | 7 | 0 | Byte-identical |

Three warmed, alternating CPU measurements per path found candidate/baseline
ratios of 0.962, 0.905, 1.003 and 0.992 respectively. This ruled out a large
r22 cache overhead in those workloads; it is not a statistically established
speedup. The longest retained-frame age was 76.5 virtual milliseconds, following
the guest's variable scan period rather than a fixed debounce timer.

## Original self-test power/text ordering (r23)

Both admitted original HP39gs and HP49g+ ROMs were taken through the physical
factory LCD test, the contrast screen and ENTER. The native display observer
was disabled. Coarse runs first bracketed the ENVID edge, then an unchanged
checkpoint was replayed with one-reference-tick runs around that edge. The
measurements read the real LCD control register and raw framebuffer; they do
not rely on the browser retaining a picture.

| Model | Exact observed ENVID 0→1 tick | First enabled raw image | At +4096 ticks | At +65536 ticks |
| --- | ---: | --- | --- | --- |
| HP39gs | 333,687,425 | LCD TURNED OFF | LCD TURNED OFF | LCD TURNED ON |
| HP49g+ | 404,156,521 | LCD TURNED OFF | LCD TURNED OFF | LCD TURNED ON |

For both models, the first enabled framebuffer is byte-identical to the
previously visible OFF text. At the functional 12 MHz reference, the two later
observations are about 0.34 ms and 5.46 ms after enabling. They bracket content
updates; they do not measure the exact first changed byte or physical panel
settling. Both raw updates precede the next completed scan in this trace.

The firmware therefore enables scanning while the old string remains in RAM,
then writes the new string. That explains why the emulator can briefly show
OFF after enabling. There is no physical optical capture here, so whether the
original calculator makes this interval perceptible remains unverified. The
frontend does not suppress the valid old image or insert an invented blank.

[Sanitized power-sequence evidence](evidence/lcd-power-r23.json) records both
ROM identities, physical keys, registers, exact enable ticks and frame hashes.
The repeatable witness takes the ordinary factory-menu checkpoints produced by
`tools/verify-flash-selftests.mjs`:

```sh
node tools/verify-lcd-power-sequence.mjs WASM ROM-DIRECTORY FACTORY-CHECKPOINT-DIRECTORY NEW-PRIVATE-OUTPUT
```

## GBP redraw and publication measurement (r23)

The exact GBP39 Player 0.3 package has a separate loader alignment problem; its
unchanged executable did not reach the game in this test. A private diagnostic
rebuild aligns the `.data`/BSS boundary to four bytes and uses the distinguishing
title `GBP39 ALIGN4`. Its `main.c` gameplay/drawing code is unchanged. It was
installed through stock HP39gs Wire and started with physical keys, with the
original ROM and no host RAM patch. **The following results apply to that
diagnostic rebuild, not to successful execution of the original package.**

Inspection of the supplied source shows `draw_play()` calling `clear()` on the
visible framebuffer, then drawing text, lanes, notes and soft-key boxes directly
into the same buffer. It does not wait for vertical synchronization or swap a
completed offscreen frame. Capturing at the actual LCD boundary removes the
host's run-slice offset but can still capture a genuine intermediate redraw.

The same running-game checkpoint was replayed in real Chromium for 48,000,000
reference ticks (four reference seconds), with 1024-tick run slices and 60 Hz
output samples. Each variant used a fresh WASM instance. All three ended with
byte-identical guest checkpoints.

| Publication | Output samples | Mean absolute pixel change | Largest pixel-change step | Fully white samples |
| --- | ---: | ---: | ---: | ---: |
| r22-style live RAM after each run slice | 241 | 1.425 | 26.218 | 0 |
| Actual completed boundary, Instant | 241 | 1.310 | 21.960 | 0 |
| Actual completed boundary, Smooth (35 ms) | 241 | 0.986 | 14.640 | 0 |

Pixel change is the mean absolute 0–255 intensity difference between successive
60 Hz output samples. Eight samples differed between after-slice and actual
boundary publication. The smooth option reduces transition contrast and adds
persistence; the metric is not a calibrated measure of perceived flicker.
Instant still shows intermediate redraw content. This does not justify claiming
that all GBP flicker has been eliminated.

Three warmed, alternating measurements per variant gave these elapsed times:

| Publication | Median | Observed range |
| --- | ---: | ---: |
| After-slice | 1892 ms | 1699–2215 ms |
| Completed boundary, Instant | 1795 ms | 1731–1923 ms |
| Completed boundary, Smooth | 1874 ms | 1681–1921 ms |

Other development processes were active on this host. These samples check for
a large new overhead in this workload; the overlap and variation do not support
a speedup claim. This measurement includes production WASM and `LCDFrames`,
but excludes Worker messaging, Canvas and the browser compositor.

A separate real production-page test restored the same diagnostic session
through the file picker, with the default nearest-neighbor display and normal
speed. Both response modes resumed automatically, advanced about 48 million
guest ticks in four wall seconds, and completed without a stop or page error.
The Instant run received 112 snapshots and painted the Canvas 100 times; Smooth
received 110 and painted 102 times. The displayed lane/notes and pause action
were inspected in screenshots. These are real Worker/Canvas runs, unlike the
synthetic browser burst test; they still do not establish physical panel timing.

[Sanitized GBP/LCD evidence](evidence/gbp-lcd-r23.json) retains the input hashes,
variant label, all timing samples and production-page counts. To repeat the
controlled publication measurement with a supplied private checkpoint:

```sh
node tools/probe-lcd-game.mjs FULL-NOR PRIVATE-GAME-CHECKPOINT 2 hp39gs-home NEW-REPORT.json 48000000
python3 tools/probe-lcd-game-browser.py --rom FULL-NOR --checkpoint PRIVATE-GAME-CHECKPOINT --model 2 --preset hp39gs-home --program-variant DESCRIPTION --ticks 48000000 --output NEW-PRIVATE-OUTPUT
```

The three issues are consequently separate: original firmware power/text order,
the game's direct clear/redraw behavior, and redundant or mistimed host
publication. Only the latter belongs to the host presentation pipeline.

## Documented STN dither patterns

The downloaded original HP49g+ 2048 executable exposed a real missing register
case: its native Thumb code writes `0x12210` to DITHMODE (`0x4d00004c`). The
Samsung manual, page 15-35, explicitly specifies reset `0x00000`, writable bits
18:0 and the two valid patterns `0x00000` and `0x12210`. r23 stores and reads back
both documented field values, masks reserved upper bits, resets the field to
zero and preserves it in the existing LCD checkpoint register array. Other
field values continue to stop explicitly; unsupported display modes still do
not gain acceptance from a dither write.

The pre-dither inspection APIs retain their defined ideal gray intensity and
BLUELUT behavior for either pattern. The manual describes FRC duty-cycle intent
on pages 15-7 and 15-41 but does not disclose each pattern's per-pixel phase
sequence. The register support therefore does not claim an analog panel or
invent a temporal switching schedule. `tests/lcd-input.c` checks both patterns,
readback/reset/reserved bits, live STN programming, unchanged pre-dither levels
and rejection of other values. Actual unchanged application execution provides
separate evidence for the newly reachable path.

## Spatial scaling and status symbols

**Settings → General → Screen scaling** persists one of four implemented
intensity resamplers. Nearest neighbor remains the default, preserving the
native-size Canvas and explicit sharp pixel presentation. Bilinear smooths
between neighboring samples; bicubic uses the Catmull–Rom cubic kernel;
Lanczos uses a three-lobe sinc window. The latter two retain more edge contrast
and can introduce ringing near high-contrast edges. All use pixel-center
coordinates, normalized edge weights and widened support when downsampling.
Outputs clamp to the valid 0–255 intensity range. These are actual separable
kernels, not names attached to browser smoothing-quality hints.

The coefficients and scratch buffers are reused while dimensions and algorithm
stay constant. Smooth modes render to the displayed pixel size and DPR, bounded
at six times native width; the compositor can scale that result further. This
bounds filtering cost at large zoom/DPR without changing the guest frame or
native PNG/recording dimensions. Resize, zoom, orientation and algorithm changes
repaint without replacing the Canvas node. Unchanged frames do not repaint.
`tests/screen-scaling.mjs` covers known interpolation values, constant images,
axis symmetry, antialiased reduction and independent reusable buffers.

The annunciator strip now uses original vector geometry instead of a generic
battery box and font-dependent alpha. Its low-battery waves/dot, hourglass and
transfer symbol follow the [HP 39gs User's Guide, section 1-3](https://literature.hpcalc.org/official/hp39gs-ug-en.pdf).
Shift arrows are recurved and alpha is a vector stroke. No manual bitmap or
third-party emulator icon was copied into the build. The six levels continue
to come from the decoded guest segment bits. Exact model-specific etched
positions, physical wiring and optical contrast remain separate evidence work;
this is not a claim of pixel-exact photographs for every family.

[Display UI evidence](evidence/display-r23.json) records real Chromium checks
for all four admitted models, traditional landscape with soft keys beside the
LCD, narrow-phone adaptation, all four spatial filters, settings Apply/Cancel,
paused-state resume and the native PNG dimensions. Synthetic input pixels are
clearly distinguished from original-ROM compatibility evidence.

## Corrected inspection behavior

The previous decoder applied byte-lane permutations to buffer-relative offsets.
The address register can describe a halfword-aligned base, so the permutation
must instead refer to the absolute fetched 32-bit word. Tests now cover bases
at word and halfword alignment, a line stride that changes alignment, all four
swap settings, and all three supported pixel depths. The logical source range
is checked before the permutation; the selected bus lane is independently
checked against an implemented physical memory bank. This is functional fetch
inspection, not burst-timing validation.

The previous 2-bpp path also ignored BLUELUT. Directed tests use an asymmetric,
nonlinear palette so a linear substitute fails. Temporarily restoring each
old rule makes the maintained regression fail; restoring the corrections makes
it pass. Correcting these two issues does **not** by itself resolve the known
HP50g per-byte pixel-order difference between raw stream and packed memory.

## Required next evidence

The functional scan/IRQ and [normal ADC](adc.md) paths now have maintained
regressions. The subsequent [USB continuation](usb.md) now models that
initialization dependency and exposes the next full-NOR stop, while
separately recovering stronger independent evidence for `+0x68` and actual
controller-to-panel bit wiring.
Keep strict and hypothesis-enabled firmware records side by side. A rendered
recovery menu, successful budget or comparison between two builds of the same
core is not a stock operating-system or independent ARM-conformance pass.
