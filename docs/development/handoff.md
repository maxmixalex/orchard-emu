# Continuation handoff

Work in private `zyf722/orchard-emu`, preserving main ancestry and existing
issue #1. M0 is closed. The baseline for this slice was `54f316d`; current
accepted revision and remote run IDs belong in the issue. Do not force-push.

## User's updated input plan

The user will later provide **HP39gs and HP49g+ full NOR dumps from their own
machines**. Defer those acquisition tasks and continue with available inputs;
do not restart the retired dumper, keep searching the blocked 39gs attachment
as the main task, or ask for a dump now. When bytes arrive, hash and classify
them before use; an updater remains different from a physical full NOR.

Available inputs remain the user's HP39g+ D1.55 full NOR, the pinned community
HP48gII full NOR, and distinct original HP49g+/HP50g 16 KiB native boot regions.
Native-region experiments declare erased OS sectors. No new original firmware
was acquired in this continuation. See [native inventory](native-roms.md).

## Current progress and next dependency

[Boot research](boot-research.md) records ten cold-probe scenarios. Weak bias
replaces only explicitly selected strong-high column stimuli. Real HP50g
boot-only matrix press/release now selects USB/card initialization without a
contention failure. USB and SD controllers then stop on their first missing
register operations. This is real guest menu control, not transfer acceptance
or a running stock OS. Native CLI/WASM schedules and cold replays agree.

Default strict full-NOR stops remain unchanged. Explicit disabled-video
`--lcd-probe68 idle-zero` admits one counted research read, after which HP39g+
with keyboard stops on LCDSRCPND and HP48gII with components stops on ADC
configuration. The read is a **hypothesis**, not established hardware semantics.
Maintain that separation while implementing the next documented dependencies.

`--frame-view packed-lsb` is diagnostic guest-memory interpretation, not the
physical panel. The default controller path now has correct absolute-word lane
addressing and BLUELUT lookup, but actual controller-to-panel bit wiring is
still open. Do not turn a readable diagnostic menu into a hardware claim.

## Reproduction and publication

Probe v4 records strong pads, weak bias, key events, component selection,
LCD policy/count and framebuffer view alongside immutable input and binary
identities. Both hosts apply events at the same virtual boundaries and replay
from cold reset. Only three selected firmware cases were also repeated under
optimized ASan/UBSan; the short maintained suite passes Debug instrumentation.
See [validation](validation.md) for the exact scope.

Build and test locally before pushing. Production distributions exclude tests,
firmware and private reports. Zensical Pages publishes documentation only and
verifies live content plus `revision.txt`; do not change repository visibility.
The separate research branch exports source only. Neither MAME nor x49gp code
was imported; their inspected LCD approximations are transparently recorded
in [licensing](licensing.md) and [references](references.md).
