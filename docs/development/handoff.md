# Continuation handoff

Continue in private `zyf722/orchard-emu`, preserving `main` ancestry and
[issue #1](https://github.com/zyf722/orchard-emu/issues/1). M0 is accepted; M1
CPU conformance and M2/M3 board/stock-boot work remain open. The starting
revision for the electrical-input continuation was `d3d6528`.

## Available inputs and provenance

The user's HP39g+ D1.55 and the preserved HP48gII USB-revision full NOR are
available and hash-pinned. Do not repeat the old LFS-pointer access blocker or
restart the retired dumper. The user-uploaded 39gs/40gs 2.22 and 49g+/50g 2.15
archives are official updaters, not complete native captures.

This slice adds independently preserved HP49g+ and HP50g original 16 KiB boot
regions. Their exact hashes, embedded version strings and sources are in
[native ROM research](native-roms.md). A 2019 HP39gs boot-region contribution
was located, but the attachment could not be retrieved. HP40gs native boot/full
NOR acquisition remains open. Two misleading `raw`/2 MiB candidates were
inspected and excluded; do not rediscover them as full dumps on filename alone.

## Current execution boundary

Strict defaults still stop the genuine HP39g+ at LCD `4d000068` and the genuine
HP48gII at GPDDAT `56000034`. No convenient generic MMIO readback was introduced.
The new external-input API is an explicit stimulus source; unspecified pins
remain unresolved. Cold reset releases stimuli, and probes reapply their
recorded settings. By itself it supplies only strong static drives. Explicit keyboard attachment
now adds a passive switch network and unfiltered EINT sampling; see
[electrical input](input.md). Do not mistake the static inputs for weak pull-ups.

A bounded exhaustive GPDDAT experiment isolates an input-insensitive RMW window.
Separately, conditioned HP48gII cold runs advance to GPGDAT; native boot-only
49g+ advances to a USB write, and native boot-only 50g reaches GPGDAT with a
recovery-menu framebuffer. All those conditions and limits are recorded in
[boot research](boot-research.md). None is a stock OS boot.

The HP50g buffer also reveals a raw LCD bit-order counterexample. An offline
LSB-first interpretation produces readable recovery text, but that does not
authorize silently changing panel/controller semantics. Resolve controller
fetch order, pixel shift order and board mapping independently. LCD `+0x68`
remains unidentified; the firmware's drain/toggle loop is only a hypothesis
source, not a known register definition.

## Repeatable tools

`rom-info.mjs` identifies full NOR, original native boot regions, updaters and
the archived Emu48+ input. `probe-rom.mjs` takes exactly one `--rom` or
`--bootloader`, records construction/stimuli, and compares native/WASM cold
runs/replays from identical input bytes. The boot-only mode preserves the
original region and declares an erased remainder; it supplies no OS.

`probe-gpio-window.mjs` validates the exact HP48gII hash before invoking the
optional native checkpoint helper. Its 2,048 combinations and 8,192-quantum
window are deliberately bounded. It is not an automatic patch, a public
resume API or an ordinary CI test. See [validation](validation.md) for exact
commands, counts and sanitizer scope.

## Publication and next work

[GitHub Pages](https://zyf722.github.io/orchard-emu/) serves strict-built
Zensical documentation only. Deployment checks inspect content and the exact
commit in `revision.txt`; the workbench and firmware are not part of that site.
The research acquisition branch is separate from main and contains only
acquisition workflow definitions. Its private one-day artifacts are not
source assets. No reference emulator implementation was imported.

The conditioned 48gII now reaches the OS flash region, enables its MMU and
stops at the same LCD `+0x68` dependency as 39g+. Prioritize that shared LCD
question, panel ordering and the remaining external pad bias. The latest
probe adds `--keyboard apples` and `--nor-device sst39vf1601`; reports record
those assumptions explicitly. Neither strict defaults nor NOR bytes change. Continue missing native-region acquisition without rebranding
an updater or boot-only recovery experiment as a genuine full-dump gate.
