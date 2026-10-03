# Native NOR bring-up

## Current local continuation: USB initialization and real packet exchange

Original development base `a9e03bd`; reconciled onto remote `80a1466`. The original functional USB controller removes the
previous `52000144` initialization stop. USB is still disconnected by default;
there are no host packets in the thirteen ordinary firmware/control probes
below. These local v6 probes compare all previous exposed CPU/LCD/ADC state,
conditions, pixels and UART, plus the pure USB state and cold replays.

| Case | Instructions | Exceptions | Final PC | Next access / result |
| --- | ---: | ---: | --- | --- |
| 39g+ strict | 514,293 | 0 | `000035e8` | `4d000068` / unimplemented MMIO |
| 39g+ idle-zero only | 516,679 | 0 | `00002d2c` | `56000054` / unimplemented MMIO |
| 39g+ idle-zero + keyboard/F pads | 523,027 | 10 | `00022440` | `00000000` / unimplemented NOR command |
| 48gII strict | 94,497 | 0 | `08001820` | `56000034` / unimplemented MMIO |
| 48gII components, strict LCD | 8,210,200 | 0 | `0000707c` | `4d000068` / unimplemented MMIO |
| 48gII idle-zero, AIN7 absent | 8,212,490 | 0 | `00004f58` | `58000000` / unresolved ADC input or conversion data |
| 48gII idle-zero, AIN7=0 | 8,219,124 | 11 | `00027380` | `00000000` / unimplemented NOR command |
| 48gII idle-zero, AIN7=512 | 8,219,130 | 11 | `00027380` | `00000000` / unimplemented NOR command |
| 48gII idle-zero, AIN7=1023 | 8,219,130 | 11 | `00027380` | `00000000` / unimplemented NOR command |
| 50g boot-only, no key | 3,500,000 | 0 | `0800131c` | budget completed |
| 50g boot-only, key 1 | 3,499,999 | 1 | `08002a98` | budget completed |
| 50g boot-only, key 2 | 2,634,106 | 0 | `08003334` | `5a000004` / unimplemented MMIO |
| 50g strong-drive negative control | 2,168,086 | 0 | `08001c44` | `56000064` / contradictory external GPIO drives |

Budgets are 2 million quanta for 39g+, 10 million for 48gII and 3.5 million
for the four 50g controls. The 50g budget differs from the preceding 3-million
baseline; do not treat its later polling PC as a distinct compatibility claim.
All thirteen probes retain zero data-fault status/address. The new exception
counts are reported, not hidden: a focused 39g+ trace identifies one IRQ and
nine SWIs. The 48gII eleven-exception total is not independently classified
here. An exception count is not by itself an execution error.

Both progressed full-NOR cases now configure endpoint state (64-byte EP1,
EP3 and endpoint mask `0x0b`), then execute user-mode startup. They eventually
attempt opcode `28a0500c`, a conditional multiple-word store, at physical NOR
address zero. On 39g+, the caller requests zero-fill of address zero for
`0x1000` bytes. This may involve NOR command/bus behavior or CPU/cache/MMU
semantics; the trace does not justify labeling it a null-pointer firmware
bug or silently ignoring the write. No program/erase implementation was added
to conceal this next dependency. The visible buffers remain blank and no
stock calculator UI has booted.

Strict default LCD/GPIO checkpoints and the unspecified-AIN7 control are
unchanged. The progressed full-NOR cases still use exactly one counted LCD
idle-zero hypothesis and the same explicit keyboard/pad/NOR/ADC conditions.
These remain noncanonical hardware experiments.

The released-key 50g control retains 858 nonzero inspected pixels; its key-1
USB-wait and key-2 SD paths retain 175. This does not validate panel mapping.
The positive key-1 path now reaches USB waiting without an unsupported MMIO
stop. The SD and strong-drive negative controls preserve their earlier stops.

### Separate host-attached experiment

[USB evidence](usb.md) records a different, 143-step real-bootloader experiment:
USB reset, guest device/configuration/string replies, address/configuration
status, the unresolved GET_CONFIGURATION NAK window, new-SETUP recovery and
reconnect/reset. The core supplies no descriptor bytes. The 50g boot region
is unchanged and all OS sectors are explicitly erased; it is not a full dump.

The same command stream and returned packets match on native/WASM and both
cold replays, including the complete optimized ASan/UBSan native transcript.
Two additional optimized sanitizer probes reproduce the progressed full-NOR
39g+ and 48gII AIN7=512 stops. Ordinary CI remains ROM-free; current commit-specific Build and Pages outcomes
are recorded in issue #1. Current local checks are in [validation](validation.md).

## Reproduce current conditions

Build the production native CLI and WASM, then run the local probes. These
commands do not attach a USB host; the separate USB transcript does.

```sh
node tools/probe-rom.mjs --model hp39gplus --rom /private/39g+.bin \
  --ticks 2000000 --lcd-probe68 idle-zero --keyboard apples \
  --gpio-input F:8e:0
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin \
  --ticks 10000000 --keyboard apples --nor-device sst39vf1601 \
  --gpio-input D:cc7f:0,G:1:0 --gpio-bias G:f800:f800 \
  --lcd-probe68 idle-zero --adc-input 7:512
node tools/probe-usb.mjs /private/boot-50g.bin /new/path/usb.json
```

The full input hashes and separate boot-only construction are recorded in
[ROM provenance](roms.md) and [native inputs](native-roms.md). Native and WASM
receive one immutable input snapshot and identical declared conditions. Probes
never overwrite a report. See [electrical input](input.md), [LCD](lcd.md) and
[ADC](adc.md) for the unresolved electrical/timing assumptions behind those
conditions. The source/reference/licensing boundary is unchanged.

## Historical progression records

Older tables are retained at their exact Git revisions rather than repeatedly
presented as the current result. These linked records include their original
commands, negative controls and limitations:

- [Initial genuine-NOR progression, d08d349](https://github.com/zyf722/orchard-emu/blob/d08d349f3f87d184e86815a9d7dcf3e226ab5e2e/docs/development/boot-research.md): reset status, internal boot SRAM, RTC and LCD/GPIO stops.
- [Native-region and GPIO sensitivity, d3d6528](https://github.com/zyf722/orchard-emu/blob/d3d6528e536cbe2894ade76bba0c7cfc0e85ff8e/docs/development/boot-research.md): 2,048 bounded variants, original boot regions and the pixel-order counterexample.
- [Keyboard circuit and NOR identification, 54f316d](https://github.com/zyf722/orchard-emu/blob/54f316d7c3e8e3ebc62f7d3fbb9405d09e2008f5/docs/development/boot-research.md): first OS-region initialization and the strong-drive contention case.
- [Weak bias and counted LCD hypothesis, 5f93b3f](https://github.com/zyf722/orchard-emu/blob/5f93b3f661c53aa49e2f92badc6e41fa2be5c3a0/docs/development/boot-research.md): deterministic recovery-menu choices and subsequent LCD/ADC dependencies.
- [LCD/ADC to USB initialization, a9e03bd](https://github.com/zyf722/orchard-emu/blob/a9e03bd946b6c6cc47887f937458fe158236dd20/docs/development/boot-research.md): sample-code branches, frame interrupts and unresolved analog controls.
- [Earlier EP0-only continuation, 80a1466](https://github.com/zyf722/orchard-emu/blob/80a1466c77e9c6f047e8d6b74f1d616be3bb6058/docs/development/boot-research.md): the remote baseline reconciled with the fuller packet/bulk continuation.

These historical counts are not added to present test or stock-boot coverage.
No historical commit, ROM identity or canonical strict gate was replaced.
