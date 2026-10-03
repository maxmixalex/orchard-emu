# HP39g+ original D1.55 startup

## Separate NOR component

The available full dump is the user's original, unmodified 1 MiB HP39g+ NOR,
SHA-256 `95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67`.
It must not be labeled SST39VF1601, a 2 MiB component. The new explicit selection
`sst39vf800a` models the 1 MiB x16 SST39VF800A array/software-ID subset.
The manufacturer's DS20005001 identifies manufacturer `00bf`, device `2781`,
and the protected halfword command sequence. Aligned ARM word stores are two
ordered x16 bus cycles, with invalid command sequences returning to array mode.
Ordinary zero stores do not program the NOR. Program/erase/CFI remain explicit
stops and all input bytes stay unchanged.

This is a **component hypothesis for HP39g+**, not an assertion that its physical
chip has been inspected. A teardown identifies this part on HP39gs, but that
alone does not establish HP39g+ hardware. The component is never auto-selected
from file size. The default unspecified-part behavior remains strict.

## Observed progress

With keyboard attached, F inputs `8e:0`, ideal ADC AIN0=1023 and the counted
LCD `+0x68` idle-zero hypothesis, the firmware reaches **Memory Clear**, accepts
physical F6/OK, enters HOME, and calculates **1+2=3** and **7×8=56**.
This path retains the exact **256 KiB SRAM** decode: **zero alias reads and
zero alias writes**. It does not inherit HP48gII's bank1-mirror hypothesis.

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

The webpage exposes **HP39g+ HOME · experimental**, checks the exact ROM hash
in both UI and Worker, and applies only this model's declared conditions.
At Memory Clear click F6/OK, then wait for HOME. Key labels on the skin and
accessible fallback use HP39 scan meanings, including Alpha on GPF5 and Shift
on GPF6. The keyboard drivers and calculations remain ordinary guest ARM code.

This advances functional original-system support, but physical clock/pad/analog
values, NOR identification on the actual board, LCD `+0x68` and controller-to-
panel routing remain unverified. It is not canonical hardware acceptance,
native ARM payload/return certification, or complete USB/power compatibility.
