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

CLKVAL below 2, unsupported display modes, reserved timing fields and live
mode/timing reprogramming while video stays enabled stop explicitly. Valid
clock settings were added to the old synthetic guests; their CLKVAL=0 had
only worked because the prior implementation did not run a scan clock.

There is **no FIFO occupancy, fetch arbitration, underflow or analog panel**
model. FIFO interrupts must remain masked; attempts to unmask them stop.
Enabling LPC3600, a TFT temporary palette or nonzero dithering also stops.
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
inspection. They are not a latched panel image. In particular, the firmware
can clear and redraw part of its RAM while the LCD's current scan is still in
progress. Previously the Worker decoded that RAM whenever a wall-time refresh,
key queue update or link-status request happened. Two UI updates could therefore
publish different partial redraws during the same scan.

The calculator Worker now uses `web/lcd-frames.js`. After each existing bounded
`core.run` call, it checks the LCD frame serial. A changed serial samples one
independent image and its annunciators; UI publications reuse that image until
the next observed scan boundary. Link polling and exact key-contact scheduling
run first and never wait for a display deadline. The maximum observation offset
is the existing 1,024-reference-tick run quantum (about 85 microseconds at the
functional 12 MHz timebase). Multiple completed scans in one quantum use the
latest observed state. The calculator still publishes at roughly 30 Hz and its
Canvas paints only the latest update in a `requestAnimationFrame` callback.

This is a bounded **host presentation policy**, not a new hardware DMA, FIFO,
row-fetch or analog response model. Sampling RAM just after a frame boundary
does not reconstruct every pixel that the physical panel received during the
preceding scan. Firmware redraws that span complete scans remain visible. No
ROM hash, pixel count, content recognition, arbitrary white-frame delay or
guest modification is used. Valid entirely white images are published normally.
Disabling the LCD resamples immediately. Paused/stopped and debugger inspection
bypass the cache, so unsupported frames and real power-off are not concealed.
Reset, model/view changes, restore and virtual-time rewind invalidate the old
image. None of this host cache is serialized in a checkpoint.

The live display, PNG capture and recording use the same published pixels and
the same empty-screen fallback when the LCD decoder reports unavailable data.
The original error status remains in the controller/workbench. Recording no
longer keeps obsolete good pixels while the live display has already cleared.

Maintained verification:

- `tests/lcd-publication.mjs` supplies partial rewrites within one synthetic
  scan, a completed white frame, video disable, invalid data, forced observation,
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

[r22 evidence](evidence/lcd-publication-r22.json) records 278 requests per original
ROM, without publishing the ROM, RAM, checkpoints or pixels:

| Original firmware | Same-scan image changes before | After | Final guest checkpoint |
| --- | ---: | ---: | --- |
| HP39g+ | 6 | 0 | Byte-identical |
| HP39gs | 4 | 0 | Byte-identical |
| HP48gII | 11 | 0 | Byte-identical |
| HP49g+ | 7 | 0 | Byte-identical |

Three warmed, alternating CPU measurements per path found candidate/baseline
ratios of 0.962, 0.905, 1.003 and 0.992 respectively. This rules out a large
observer overhead in these workloads; it is not a statistically established
speedup. The longest retained-frame age was 76.5 virtual milliseconds, following
the guest's variable scan period rather than a fixed debounce timer.

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
