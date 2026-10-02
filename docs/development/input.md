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

GPG0 is not supplied by the keyboard. Some columns have their internal pull-up
disabled at reset. The model does not invent external bias resistors for them.
Explicit `gpio_inputs` are **strong test drives**, not weak pull-ups. Their use
in a no-key boot experiment must not be promoted to a physical-board preset:
a later switch closure may connect that drive against a guest-driven output.

Cold reset detaches the keyboard and releases switches and external inputs.
A caller must reattach/reapply conditions for an identical replay. Host events
occur only between bounded run calls; they do not resume a diagnostic stop.
The current browser workbench has no interactive key controls yet.

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
clocking, debounce, power-off wakeup and subcycle electrical transitions remain
open. Sampled edge history is reset on attachment and cold reset.

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

Probe v3 records keyboard attachment, NOR part, strong external drives and
source/backing hashes separately. It reattaches conditions after cold reset.
The full dump is unchanged. This configuration reaches the original OS flash
region and its LCD `+0x68` read, **not a responsive stock UI**. Results and
remaining electrical assumptions are in [boot research](boot-research.md).
