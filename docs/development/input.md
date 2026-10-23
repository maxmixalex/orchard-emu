# Electrical input and NOR identification

This is an **opt-in functional circuit model**, not a completed six-model
board preset. The default machine still stops on unresolved GPIO inputs.
The new components are independently implemented in `src/keyboard.c` and
`src/nor.c`; no firmware variables or instruction addresses are intercepted.

## Keyboard evidence and API

Two independently maintained guest drivers describe the same wiring:
[newRPL's target_50g scan](https://github.com/c3d/db48x-from-newrpl/blob/063bd8e1ee9b641701a11488cd2a02dd540d87cf/firmware/sys/target_50g/keyboard.c)
and [hpclang's six-model raw scan](https://github.com/zyf722/hpclang/blob/8cdaf1304d8f0fa058ee573873631ebcbf92a6af/runtime/core/keyboard.c).
They establish GPG8..15 as eight matrix columns, GPG1..7 as seven active-low
rows, and GPF0/4/5/6 as four active-high dedicated inputs. GPF0 is ON; the
other printed labels differ by family. These sources are behavioral/wiring
references, not transplanted implementations.

`orchard_keyboard_attach(machine, true)` attaches the circuit with all keys
released. `orchard_keyboard_matrix(machine, column, row, down)` changes a raw
switch, and `orchard_keyboard_dedicated(machine, gpf_pin, down)` changes a
dedicated key. Columns/rows are zero-based. The 56 addressable switch positions
are **not 56 populated physical keys**, nor a complete printed-key map.
The corresponding WASM exports use the same names without `orchard_`.

Closed switches connect pads bidirectionally. GPIO outputs drive their guest
latch value; input pads may have explicit external drives and enabled weak
internal pull-ups. A strong drive dominates a pull-up; opposing strong drives
produce `ORCHARD_GPIO_CONTENTION`. Unknown alternate-function producers and
floating nets remain unresolved. The simple passive-network ghosting model
has directed tests, but no six-board diode/analog-timing survey is claimed.

Register-controlled internal pull-ups also apply to unconnected input pads on
ports B–H, using each port's actual pin width. They are weak contributions:
an external strong drive wins, while opposing weak biases remain unresolved.
This resolves the original-ROM shutdown reads of E14/E15 when the guest has
enabled those pull-ups; no new strong drive is added to a model preset. See
[the inactivity failure and fix](power-management.md).

GPG0 is not supplied by the keyboard. Some columns have their internal pull-up
disabled at reset. The model does not invent external bias resistors for them.
Explicit `gpio_inputs` are **strong test drives**, not weak pull-ups. Their use
in a no-key boot experiment must not be promoted to a physical-board preset:
a later switch closure may connect that drive against a guest-driven output.

Cold reset detaches the keyboard and releases switches and external inputs.
A caller must reattach/reapply conditions for an identical replay. Host events
occur only between bounded run calls; they do not resume a diagnostic stop.
The browser workbench now exposes an explicit HP48-only keypad; see [web](web.md).

## External interrupts

While the keyboard is attached, the shared scheduler samples unfiltered
EINT0..23 at virtual-quantum boundaries. GPF0..7 map to EINT0..7 and GPG0..15
to EINT8..23 when the guest selects their EINT alternate function.
Low/high level, falling/rising and both-edge encodings follow Samsung's
[S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
chapter 9, pages 9-22 through 9-27. Pending bits, mask/group routing, W1C and
IRQ delivery use the existing interrupt controller; a pressed key is not a
host-injected IRQ exception.

Unknown pads do not fabricate edges. Function changes invalidate affected
pads' edge history, not another port's history. Active level sources reassert
after acknowledgment. Enabled EXTINT2 digital filters stop explicitly; filter
clocking, debounce and subcycle electrical transitions remain open. Sampled
edge history is reset on attachment and cold reset. In Power_OFF, EINT0–15
can trigger the retained reset-vector wake path even when their interrupt
mask is set; EINT16–23 do not wake this domain. Physical key positions and
external board drives survive that wake reset. RTC calendar-alarm wakeup is
separate from these sampled GPIO events; see [power management](power-management.md).

The ROM-free circuit guest in `tests/circuit-wasm.mjs` executes from SRAM,
programs GPIO/EINT itself, waits in WFI, and handles press/release interrupts
through the ARM IRQ vector and `SUBS PC,LR,#4`. Production WASM records four
IRQ entries for matrix press/release and ON press/release, then sleeps again.
Native and WASM compare the initial released-key state; the **dynamic event
sequence is a production-WASM test**, not a dynamic native CLI test.

## SST39VF1601 software ID

Selection is explicit through `orchard_nor_select`, WASM `nor_select`, or
`--nor-device sst39vf1601`. It is valid only with a 2 MiB physical profile,
but capacity alone does not select it. The component survives a cold reset;
its command/ID state returns to array-read mode. Raw NOR bytes never change.

Primary component source: **SST S71223-05-000, June 2008**, tables 3 and 6,
[manufacturer-hosted data sheet](https://ww1.microchip.com/downloads/en/devicedoc/s71223_.pdf).
The part identity is manufacturer `0x00bf`, device `0x234b`. The author's
[HP39gs-to-48gII hardware experiment](https://blog.lyc8503.net/en/post/hp39gs-modify/)
uses SST39VF1601 and supplies the same pinned NOR used here. This supports
that explicit experimental configuration, not a default part for all Apples
machines or every 48gII hardware revision.

Guest halfword writes of AA, 55, 90 at word addresses 5555, 2AAA, 5555 enter
software-ID mode; on the byte-addressed ARM bus these are AAAA, 5554, AAAA.
Higher command address/data bits are ignored as specified. F0 exits to array
read. Invalid software-data-protection sequences abort to array read. The
implemented ID reads expose only the manufacturer/device words; other ID
locations stop. Recognized program/erase/CFI/security commands also stop.
There is no flash programming, erase, status polling, protection, bus timing
or installed-updater conversion in this slice.

## Explicit boot conditions

```sh
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 10000000 --keyboard apples --nor-device sst39vf1601 \
  --gpio-input D:cc7f:0,G:f801:f800 --output /new/path/48-input.json
```

Probe v4 additionally records weak bias, key schedules and LCD research settings; it records keyboard attachment, NOR part, strong external drives and
source/backing hashes separately. It reattaches conditions after cold reset.
The full dump is unchanged. This configuration reaches the original OS flash
region and its LCD `+0x68` read, **not a responsive stock UI**. Results and
remaining electrical assumptions are in [boot research](boot-research.md).

## Weak bias and deterministic key events

`orchard_gpio_bias(machine, port, mask, levels)` models an explicit weak
external bias: known high bits are pull-ups and known low bits are pull-downs.
It is separate from `orchard_gpio_inputs()`, whose values are strong drives.
Strong high/low wins over a weak opposite bias. Opposing weak biases with no
strong driver leave a net unresolved; contradictory strong drives remain a
contention stop. Connected keyboard pads share these contributions, and cold
reset removes both kinds of external stimulus. Bias values and resistance
ratios have not been measured on the target boards: this is a digital,
functional circuit model, not an analog solver or default motherboard preset.

CLI `--gpio-bias G:f800:f800` attaches weak column bias without forcing those
pads high against the guest's outputs. With `--gpio-input D:cc7f:0,G:1:0` and
an attached keyboard, this removes the earlier artificial HP50g key-1 short.
Do not describe those conditions as measured idle levels.

The native CLI now supports up to 64 chronological events:

```sh
# Append to an explicit run using --keyboard apples:
--key-at 2000000:3:5:1 --key-at 2400000:3:5:0
```

Fields are decimal virtual tick, raw column, raw row and down=1/up=0. An event
at tick N applies after N quanta, before the next quantum. Tick-zero events
are valid; same-tick events execute in argument order. All events must be
below the run budget. Execution slices end at event boundaries, including
while the CPU waits for an interrupt. An early diagnostic stop never applies
later events. The CLI reports both the schedule and the actual applied count.

The probe accepts a comma-separated `--key-at` list and applies the identical
schedule to production WASM, replaying both hosts from cold reset. A ROM-free
circuit guest now verifies two matrix-triggered IRQ entries, guest exception
return and WFI on **both native CLI and production WASM**, in addition to the
previous WASM-only four-event matrix/ON test. The browser HP48 keypad now uses a separate bounded tap queue; see [web](web.md).

The real HP50g boot-only guest interprets raw (3,5) as recovery selection 1
and (2,5) as selection 2 under these conditions. Press/release selects USB and
card initialization respectively, stopping on their unimplemented MMIO.
No event leaves it polling recovery input. This is bootloader input evidence,
not all-model printed-key or complete transfer acceptance. See [boot research](boot-research.md).
