# Firmware buzzer

The [r21 validation record](evidence/buzzer-r21.json) records the shared PCLK,
PWM buffering and original-ROM BEEP checks. The
[r20 record](evidence/buzzer-r20.json) preserves the earlier playback milestone
and its known clock error; it is not evidence of calibrated pitch.

The calculator interface can play the **actual GPB2 output** driven by the
emulated firmware. Sound starts only after a browser user gesture. Settings
provide a firmware sound switch and volume control; older version 1 settings
files receive the defaults (`sound: true`, `volume: 0.35`). There is no keyboard
click generator or special interpretation of the calculator's `BEEP` command.

## Hardware basis and implementation boundary

The Samsung S3C2410A manual identifies **GPB2 / TOUT2**, selected by GPBCON
bits `[5:4]`. Mode `01` drives GPBDAT bit 2; mode `10` selects Timer2. Its
PWM chapters describe a down counter, a buffered compare value, inversion,
manual update and automatic reload. Without inversion the output is low above
the active compare and high at or below it. Clearing the start bit holds the
current level; changing inversion changes the output even when stopped.

Hardware sources used:

- [Samsung S3C2410A user manual](https://pdfstore-manualsonline.prod.a.ki/pdfres_02/af/4c/af4c636f-a045-4652-865a-9643aaa6c16d.pdf),
  GPIO chapter 9; timer initialization, operation and output level control in
  chapter 10, pages 10-5 through 10-8; TCON on 10-13; CLKCON in chapter 7.
  The consulted PDF SHA-256 is
  `4e3dd756e27d80d7116282a6ae062458237fc1c5b34f1b1d40529c92b2c18794`.
- [HP GCC SDK `sys_playTone.c`](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/hplib/sys/sys_playTone.c),
  revision `7fa1503912338ea0fdf1d39eb584770f4d121cd2`, identifies the calculator
  speaker on GPBDAT bit 2 using direct GPIO writes.
- [hpclang sound engine](https://github.com/maxmixalex/hpclang/blob/261dba7cc5b208828f7a907c2071d24c3b0d94ea/runtime/core/sound-engine.c),
  revision `261dba7cc5b208828f7a907c2071d24c3b0d94ea`, independently uses
  Timer2, its count/compare registers and the GPB2 alternate function.

These are register and wiring references. Orchard's MIT implementation is
independently written; no GPL SDK or emulator source was copied into the core.
The browser playback behavior follows the
[W3C Web Audio specification](https://www.w3.org/TR/webaudio/), using
`AudioContext.resume`, `AudioBuffer`, scheduled buffer sources and explicit stop.

## Core signal contract

`orchard_buzzer_enable` opts into observation; it is off by default in the
allocator-free C API. The observer follows writes to GPBCON and GPBDAT and
Timer2 counter transitions. Active compare, pending reload and counter state
belong to the guest SoC, independently of observation. Manual update copies the
count/compare buffers. Reaching zero raises the interrupt and captures the next
count/compare; the following timer edge loads those captured values without
also decrementing them. An ISR changing the buffers after the interrupt affects
the following cycle. Clearing auto-reload at that point does not cancel the
reload already captured by the zero transition.

Writing TCMPB2 alone cannot cut the current pulse short. Inversion and stopped
output level are retained. CLKCON's PWM gate freezes the actual counters,
prescaler phases and pending reloads for all five timers. Global PCLK continues
running while that gate is closed, so reopening it receives the next shared
PCLK edge. Direct GPIO remains separate.

The queue contains at most 4,096 `(uint64 tick, level)` edges. Draining is
read-only with respect to the guest. It cannot acknowledge interrupts, advance
the CPU, alter GPIO readback, or stall execution. When full, the queue discards
its incomplete history, increments the overflow count and starts a new epoch
with the current level. The host must discard audio from the previous epoch.

Reset, explicit queue clear and successful checkpoint restore start a new
epoch. Reset and restore retain the host's enabled policy. Failed checkpoint
validation leaves both guest state and queued host audio unchanged. Host sound
queues are not serialized. Checkpoint **version 4** adds the guest PCLK fraction,
MPLL setup history and PWM latches so a new session preserves a staged next
compare, pending zero/reload interval and gate state exactly. Muting or enabling
observation mid-cycle no longer reconstructs the active compare from TCMPB2.
Historical v1/v2/v3 imports remain supported with an explicit first-cycle
migration, described in [clock ratios and runtime PCLK](clock-ratios.md).
The public state getter exposes ticks, epoch, queue depth, overflow
count, current observed level and functional timebase. The WASM interface uses
an explicit word layout rather than depending on C structure padding:

| Part | 32-bit words |
| --- | --- |
| Header | count, tick low, tick high, epoch, overflows, level, enabled, timebase Hz |
| Each edge | tick low, tick high, level |

`buzzer_snapshot` is a read-only diagnostic of GPBCON/GPBDAT and Timer2
registers for private firmware witnesses. It does not execute a tone.

## Shared peripheral time and the original BEEP command

The reference timebase remains **12,000,000 ticks per second**. The functional
clock model treats this as its input `Fin`, then derives PCLK from the actual
MPLLCON, CLKSLOW and CLKDIVN writes. All five PWM timers, watchdog, ADC and SDI
consume the same PCLK edge stream. RTC oscillator time remains independent.
This changes the guest counters and interrupt deadlines, not an audio playback
multiplier. CPU instruction slots and LCD timing retain their existing
functional models; this is not a calibrated full-system clock tree.

The fixed input is supported as a software convention by the pinned
[hpclang time implementation](https://github.com/maxmixalex/hpclang/blob/261dba7cc5b208828f7a907c2071d24c3b0d94ea/runtime/core/time.c).
It is not a measurement of each supported calculator's crystal or clock straps.
PLL settling is immediate in the functional model; lock-duration and analog
startup measurements remain open. Frequency changes retain fractional edge
progress to the new denominator's resolution, and retain the peripheral
prescaler/counter phase. The two physical shared PWM prescalers' inter-channel
startup phase is not yet modeled: the existing per-channel phase remains.

For positive programmed counts, the steady timer period is now
`(TCNTBn + 1) × prescaler × divider` PCLK edges. The original HP49g+ `440 .2 BEEP`
uses count 59, compare 29, prescaler 45 and divider 16. Its configured
`MPLLCON=0x43012`, `CLKSLOW=0`, `CLKDIVN=3` selects `PCLK/Fin=25/16`. Therefore
the independently derived steady period is exactly **27,648 reference ticks**:

| Original-ROM witness | r20 | r21 |
| --- | ---: | ---: |
| Observed complete PWM cycles | 88 | 88 |
| Steady period in reference ticks | 42,480 | 27,648 |
| Frequency under the 12M reference model | 282.485876 Hz | 434.027778 Hz |
| First-to-last observed edge span | 0.30972 s | 0.201566833 s |

The requested 440 Hz is quantized by the firmware's integer timer values.
Eighty-eight ideal complete steady periods at the new rate occupy 202.752 ms;
the recorded first-to-last edge interval has different endpoints and should
not be confused with that complete-cycle duration. The stock command consumes
its operands and returns to the same empty RPN stack. These observations
demonstrate the corrected register-derived model, not microphone measurements
or a claim of exact physical 440 Hz playback.

`TCNTBn=0` is a bounded functional extension: each timer edge can generate at
most one terminal event, and reloading zero does not cause an infinite or
zero-time loop. Non-inverted output remains high. The manual's worked examples
and the pinned hpclang implementation do not establish this zero-count corner
on physical silicon, so a hardware witness remains open. The core also does
not model the transducer, amplifier response or measured speaker loudness.

## Browser playback and lifecycle

`web/buzzer-worker.js` drains the WASM queue only while sound is enabled and
the machine is running. `web/buzzer-audio.js` area-averages the electrical
waveform into PCM at the AudioContext sample rate and applies a 40 Hz DC
blocker. A constant high or low pin therefore becomes silence; it cannot leave
a continuous invented tone after the timer stops. The DC blocker is a host
presentation filter, not a measured calculator speaker response.

AudioContext is created and resumed from a pointer or keyboard gesture. No
audio captured before that unlock is replayed. Pause, a machine stop, reset,
model change, ROM replacement, manual save/restore, mute and disposal cancel
all scheduled sources. The controller's run-intent guard rejects a late first
packet after Pause; generation and core epoch checks reject older streams.
Normal automatic session saves do not interrupt playback. Setting volume back
above zero works within the same machine epoch.

Unlimited execution can generate guest time faster than the audio device can
play it. The renderer keeps at most the latest 120 ms of a long incoming
interval and bounds the scheduled lead rather than replaying seconds of stale
sound after the calculator has stopped. This can discard tones during very
fast execution. The playback policy does not slow the CPU or alter transfers.

## Validation and reproduction

The native and WASM buzzer suite executes **4,263 assertions on each host**:
direct GPIO and pin direction, PWM compare buffering, manual update, reload,
inversion, stopped output, clock gate, prescaler/divider, queue overflow,
64-bit timestamps, successful/failed restore and guest checkpoint equality
with observation disabled. The separate `pwm-clock` suite checks independently
derived clock ratios, multiple PCLK edges per reference quantum, gating,
frequency transitions, ISR buffering, zero/reload intervals, shared peripheral
deadlines, observer independence and exact v4 continuation with **2,452 assertions
on each host**. The default 17-suite C native/WASM comparison passes **1,159,939
assertions per host**, and native CTest passes **19/19** including the separate
execution-policy tests. JavaScript coverage includes electrical frequency, identical
PCM across irregular packet boundaries, DC decay, bounded accelerated output,
gesture unlock, mute/volume, stale packets and the production controller's
lifecycle hooks.

The private original-ROM witness uses the admitted HP49g+ full NOR SHA-256
`3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab`.
Physical key events select RPN and enter `440 .2 BEEP`. The actual firmware
selects GPB2/TOUT2 (`GPBCON 0x155565`) and programs Timer2 count 59, compare 29;
176 observed edges represent 88 cycles. The command consumes its operands and
returns to the empty RPN stack. A stock error prompt also exercised Timer2
count 19 / compare 9. These observations establish the original-firmware
audio path on HP49g+; other model ROMs need their own sound witnesses before
claiming equivalent stock-command coverage.

The stock `440 .2 BEEP` workflow was repeated against the frozen production
WASM SHA-256
`36fe5da8630af83946503c76eab63f8dbb64274162b22eb06fd50f5a0d222108`.
It passed with the same 88 cycles, 176 edges and 27,648-tick period. Every
recorded edge packet, Timer2 register snapshot and clock snapshot matched the
earlier `e41ae110…` PCLK preview exactly. The final metadata report has SHA-256
`fed6133d4a211df814d77f41c6c035db0f2d5cf3d651fdff613196a1e2d12cc1`;
the validation record retains both build identities.

```sh
ORCHARD_WASM=/private/orchard.wasm node tools/verify-buzzer-stock.mjs \
  /private/hp49gplus-full.bin /private/new-buzzer-evidence
ORCHARD_BUZZER_TRACE=/private/new-buzzer-evidence/report.json \
  python3 tests/buzzer-browser.py
```

The browser test uses real Chromium AudioContext and AudioBuffers. The
original-ROM trace produced 175 nonzero buffers at 44,100 samples/second;
Pause left zero scheduled sources and disposal closed the playback lifecycle.
It proves browser signal generation and cleanup, not a microphone recording
or a human listening comparison with a physical calculator. ROMs, original
LCD images and private trace outputs are not included in web artifacts.
