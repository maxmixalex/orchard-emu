# HP39g+ original D1.55 startup

## Separate NOR component

The available full dump is the user's original, unmodified 1 MiB HP39g+ NOR,
SHA-256 `95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67`.
It must not be labeled SST39VF1601, a 2 MiB component. The new explicit selection
`sst39vf800a` models the 1 MiB x16 SST39VF800A component.
The manufacturer's DS20005001 identifies manufacturer `00bf`, device `2781`,
and the protected halfword command sequence. Aligned ARM word stores are two
ordered x16 bus cycles, with invalid command sequences returning to array mode.
Ordinary zero stores do not program the NOR. The initial startup witness used
the array/software-ID subset. Current r23 support adds bounded word programming
and erase operations; see [NOR programming](nor-write.md). CFI remains
unsupported, and the original input file is never rewritten.

This is a **component hypothesis for HP39g+**, not an assertion that its physical
chip has been inspected. A teardown identifies this part on HP39gs, but that
alone does not establish HP39g+ hardware. The component is never auto-selected
from file size. The default unspecified-part behavior remains strict.

## Observed progress

With keyboard attached, F inputs `8e:0`, ideal ADC AIN0=1023 and the counted
LCD `+0x68` idle-zero hypothesis, the firmware reaches **Memory Clear**, accepts
physical F6/OK, enters HOME, and calculates **1+2=3** and **7×8=56**.
This initial startup witness used exact **256 KiB SRAM** decoding: **zero alias
reads and zero alias writes**. Those historical measurements remain valid.

The fixed schedule acknowledges at ticks 50M/53M, enters the first expression
at 120M–152M, then the second at 180M–212M. At 230M quanta the native result is
229,986,448 instructions, 465,832 exceptions, no diagnostic stop and no data-fault
state. There are 18 physical transitions and 22 counted LCD hypothesis reads.
The visually inspected packed-LSB frame hash is
`efec8205f401a7189f3cd77eeaac6947165d480b383033c9796c86e95e9f6968`.

Use the local-only repeatable witness:

```sh
node tools/probe-hp39-startup.mjs /private/39g+.bin /new/hp39.json
node tools/probe-annunciators.mjs hp39-home /private/39g+.bin /new/segments.json
```

The startup command checks two independent cold native and two cold production
WASM runs, exposed CPU/peripheral state, raw pixels, UART and input identity.
It is not run in ordinary CI, and a timed-out or failed run must not be promoted
to acceptance. Current observed outcomes are in [validation](validation.md).

The webpage exposes the experimental HP39g+ HOME setup, checks the exact ROM
hash in both UI and Worker, and applies only this model's declared conditions.
At Memory Clear click F6/OK, then wait for HOME. Key labels on the skin and
accessible fallback use HP39 scan meanings, including Alpha on GPF5 and Shift
on GPF6. The keyboard drivers and calculations remain ordinary guest ARM code.

## Current r23 transfer setup

The admitted `hp39-home` preset now additionally selects the existing
`bank1-mirror` SRAM decoder. Exact-mode SEND reaches a data abort at
`0x08040000`, just beyond the physical 256 KiB array, before any UART2 traffic;
the same-model control excludes cross-version packet handling as its cause.
The bounded hypothesis aliases the same cells only within nGCS1. It allocates
no extra RAM, changes no ROM byte, and does not change strict/core defaults.
Independent confirmation of the actual HP board's high-address decoding is
still pending.

Cold startup, arithmetic, APLET editing, the original IrDA selftest and menu
return, and actual aplet transfer in both directions pass under this condition.
All four HP39g+/HP39gs sender/receiver combinations export the same 620-byte
`IRTEST` aplet through stock USB SEND, including its `F1=12345` expression.
See [UART/IrDA evidence and reproduction](uart-irda.md#hp39-family-sram-decoding).

An older session retains its recorded exact decoder when restored. To use the
new transfer preset with those objects, export them first, use Restart, and
import them into the new session. Restore does not silently alter saved board
settings or repair a historical stopped state.

This advances functional original-system support, but physical clock/pad/analog
values, NOR identification on the actual board, LCD `+0x68` and controller-to-
panel routing remain unverified. It is not canonical hardware acceptance,
native ARM payload/return certification, or complete USB/power compatibility.
