# Firmware buzzer

The [r20 validation record](evidence/buzzer-r20.json) pins the production core,
original-ROM BEEP witness, browser playback and independent noninterference checks.

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
Timer2 counter transitions. A Timer2 manual update or automatic reload latches
the audio compare value. Writing TCMPB2 alone does not cut the current pulse
short. Inversion and stopped output level are retained. A disabled PWM clock
holds the observed PWM output; direct GPIO remains separate.

The queue contains at most 4,096 `(uint64 tick, level)` edges. Draining is
read-only with respect to the guest. It cannot acknowledge interrupts, advance
the CPU, alter GPIO readback, or stall execution. When full, the queue discards
its incomplete history, increments the overflow count and starts a new epoch
with the current level. The host must discard audio from the previous epoch.

Reset, explicit queue clear and successful checkpoint restore start a new
epoch. Reset and restore retain the host's enabled policy. Failed checkpoint
validation leaves both guest state and queued host audio unchanged. Sound data
is not serialized: checkpoint version 3 and the existing guest-state bytes are
unchanged. The public state getter exposes ticks, epoch, queue depth, overflow
count, current observed level and functional timebase. The WASM interface uses
an explicit word layout rather than depending on C structure padding:

| Part | 32-bit words |
| --- | --- |
| Header | count, tick low, tick high, epoch, overflows, level, enabled, timebase Hz |
| Each edge | tick low, tick high, level |

`buzzer_snapshot` is a read-only diagnostic of GPBCON/GPBDAT and Timer2
registers for private firmware witnesses. It does not execute a tone.

## Functional time, rather than calibrated physical sound

Audio follows Orchard's **existing 12 MHz functional tick timebase**. It does
not introduce a new CPU/PCLK model. In particular, the current timer reloads
when its counter reaches zero in the same functional transition; it does not
model the manual's separate zero/reload interval. The resulting functional
period is `TCNTB2 × prescaler × divider` for the tested nondegenerate case.
Zero compare and zero-count corner cases inherit that existing timer model.

Consequently, selecting 440 Hz for 0.2 seconds in the original OS does **not**
yet guarantee a measured 440 Hz, 0.2-second browser tone. In the verified
HP49g+ run, the firmware produced 88 complete PWM cycles, with a period of
42,480 functional ticks: approximately **282.486 Hz**, with a first-to-last
edge span of **0.30972 seconds**. This is recorded as a known clock calibration
limit, not claimed as accurate physical pitch or elapsed duration. Fixing it
requires an independently validated peripheral-clock model shared by the
other timers and devices.

There are two further phase limits. The audio-only active compare is rebuilt
from the saved TCMPB2 on restore or on enabling observation halfway through a
cycle. If firmware had staged a different next compare, the first resumed
audio cycle can differ. Also, the existing guest timer continues to advance
while its clock gate is clear; the observer holds its output during that
interval, then follows the existing counter on subsequent enabled transitions.
Neither approximation changes guest counter or interrupt behavior. The core
does not claim an electrical transducer, amplifier response or measured
speaker loudness model.

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

The native and WASM buzzer suite executes **4,261 assertions on each host**:
direct GPIO and pin direction, PWM compare buffering, manual update, reload,
inversion, stopped output, clock gate, prescaler/divider, queue overflow,
64-bit timestamps, successful/failed restore and guest checkpoint equality
with observation disabled. Release CTest passes **17/17** including the prior
emulator tests. JavaScript coverage includes electrical frequency, identical
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

```sh
ORCHARD_WASM=build-r20/audio.wasm node tools/verify-buzzer-stock.mjs \
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
