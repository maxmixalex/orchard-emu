# Model profiles

These are physical configurations, starting from the existing hpclang
platform/fixture research. They are not claims that Orchard currently boots
these machines. The 48gII target is explicitly the **second-generation USB
revision**, not every product carrying that name.

| ID | Slug | Model | NOR | SRAM | Visible LCD | SD slot in target hardware | Orchard stock boot |
| ---: | --- | --- | ---: | ---: | --- | --- | --- |
| 1 | `hp39gplus` | HP 39g+ | 1 MiB | 256 KiB | 131 × 64 | No | Unverified |
| 2 | `hp39gs` | HP 39gs | 1 MiB | 256 KiB | 131 × 64 | No | Unverified |
| 3 | `hp40gs` | HP 40gs | 2 MiB | 256 KiB | 131 × 64 | No | Unverified |
| 4 | `hp48gii` | HP 48gII, USB revision | 2 MiB | 256 KiB | 131 × 64 | No | Conditional HOME; hardware gate open |
| 5 | `hp49gplus` | HP 49g+ | 2 MiB | 512 KiB | 131 × 80 | Yes | Unverified |
| 6 | `hp50g` | HP 50g | 2 MiB | 512 KiB | 131 × 80 | Yes | Unverified |

The shared CPU target is ARM920T/ARMv4T. IDs intentionally match hpclang's
six-model IDs, but this is metadata alignment, not an ABI dependency on
hpclang or a copy of its runtime.

## Evidence and remaining uncertainties

The hpclang [platform](https://github.com/zyf722/hpclang/blob/main/docs/development/platforms.md),
[roadmap](https://github.com/zyf722/hpclang/blob/main/docs/development/roadmap.md)
and [fixture](https://github.com/zyf722/hpclang/blob/main/docs/development/fixtures.md)
records establish useful starting facts: HP39g+ has a verified 1 MiB dump;
48gII has a distinct 256 KiB/64-line USB-revision profile and full NOR; 49g+
and 50g have different native bootloaders even when using a common OS update.

Exact flash JEDEC IDs/command families, board straps, GPIO matrix, crystal and
clock setup, LCD wiring, peripheral availability and behavior must be pinned
per hardware revision. The current table deliberately does not invent those
values. All six profiles use the same provisional peripheral implementation.
A SoC UART channel is not proof that the calculator exposes a physical serial
connector. Likewise `sd_slot=true` does not mean SD emulation exists.

## Promotion rule

A model can move from **configured** to **stock-boot verified** only when its
own immutable ROM fixture reaches an interactive stock UI from a cold reset,
with the actual bootloader, declared physical memory, responsive physical-key
input and a repeatable witness. Sharing a family or an LCD size is insufficient.

Every revision exception belongs in a profile/wiring description with a
source, not a model-specific patch to the ARM instruction interpreter.

## Full-NOR bring-up update

The HP48gII full image now reaches stock HOME and performs two calculations
with the explicit conditions in [startup](startup.md). Canonical hardware
acceptance remains open; its physical SRAM capacity is still 256 KiB. HP39g+
keeps its separate startup blockers. See [boot research](boot-research.md).
HP40gs NOR capacity is corrected to 2 MiB using HP's 2007 specification sheet,
not inherited from the HP39gs sibling. All other stock/UI promotion gates
remain open; supplied update packages are not full physical dumps.
