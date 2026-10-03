# Orchard development

An original MIT ARM hardware emulator for the six HP Apples calculators.
The C17 machine core is shared by native and WASM hosts, and executes the
ROM's own ARM Saturn interpreter without a firmware patch.

**The original HP48gII system now reaches HOME and evaluates `1+2=3` and
`7*8=56` under explicit research conditions.** See [startup](development/startup.md)
for the immutable input, physical-key schedule and remaining SRAM/LCD/pad
assumptions. This is not canonical physical-board or all-six-model acceptance.

The [browser workbench](development/web.md) now exposes the setup and a
functional keypad. Production Worker tests run locally; real browser-origin
navigation is environment-blocked and remains an open acceptance item.
[Validation](development/validation.md) separates these evidence classes.

[Roadmap](development/roadmap.md) defines long-term gates;
[board](development/board.md) and issue #1 track immediate accepted work.
[Architecture](development/architecture.md), [models](development/models.md),
[firmware inputs](development/native-roms.md) and [licensing](development/licensing.md)
record the implementation and provenance boundaries. Pages contains documents,
not firmware or production calculator binaries.

## Current browser and 39g+ continuation

[Open the emulator](https://zyf722.github.io/orchard-emu/emulator/) uses the
pinned hp-calcs-svg artwork and local full-NOR selection.
[HP39g+ D1.55](development/hp39-startup.md) now has its own conditional HOME
and arithmetic witness without SRAM mirroring.
[Skins and status segments](development/skins-segments.md) describes the
separate guest-driven annunciator strip and the remaining mapping limits.
