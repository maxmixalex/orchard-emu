# Orchard development

An original MIT ARM hardware emulator for the six HP Apples calculators.
The C17 machine core is shared by native and WASM hosts, and executes the
ROM's own ARM Saturn interpreter without a firmware patch.

**Four original systems—HP39g+, HP39gs, HP48gII and HP49g+—reach HOME and
perform arithmetic under explicit compatibility conditions.** The user's
[complete HP39gs image](development/hp39gs-startup.md) now runs its own native
bootloader, computes `1+1=2` and `7*8=56`, and completes native-reader return.
See [startup](development/startup.md)
for the immutable input, physical-key schedule and remaining SRAM/LCD/pad
assumptions. This is not canonical physical-board or all-six-model acceptance.

[HP49g+ support](development/hp49-startup.md) uses the user's complete 2 MiB
capture, fixed 512 KiB SRAM with an explicit bank-1 mirror condition, and an
[SD controller with card images](development/sd-cards.md). Its original OS
also performs symbolic algebra and USB object workflows, and an existing
[native ARM example](development/hp49-native.md) runs through stock ARMToolbox
and returns to HOME for another calculation. The
[HP39/40 disk-drive server](development/file-transfer.md) serves applet bundles
and receives typed files. The [complete ROM dump package](development/hp39gs-rom-dump.md)
has produced the user's 1 MiB HP39gs capture, checked against all 64 supplied
block hashes. Its original acquisition metadata is preserved separately.

The latest browser adds [immersive landscape](development/landscape.md),
[firmware-driven sound](development/buzzer.md), optional transfer-only Unlimited,
per-file Retry/Skip and file selection without extension filters. The SD dialog
can prepare files and directories in an unmounted FAT16 image before insertion.

The [browser workbench](development/web.md) now exposes the setup and a
functional keypad. Production Window/Worker tests and original-ROM
file/restore/keyboard observations now run locally in Chrome. Broader browser
coverage and a rare HP48 Unlimited post-result stop remain open.
[Validation](development/validation.md) separates these evidence classes.

[Roadmap](development/roadmap.md) defines long-term gates;
[board](development/board.md) tracks immediate work and current CI evidence.
[Architecture](development/architecture.md), [models](development/models.md),
[firmware inputs](development/native-roms.md) and [licensing](development/licensing.md)
record the implementation and provenance boundaries. Pages packages the
documentation and browser calculator; firmware remains user-supplied and local.

## Current browser and 39g+ continuation

[Open the emulator](https://maxmixalex.github.io/orchard-emu/emulator/) uses the
pinned hp-calcs-svg artwork and local full-NOR selection.
[HP39g+ D1.55](development/hp39-startup.md) now has its own conditional HOME
and arithmetic witness without SRAM mirroring.
[Skins and status segments](development/skins-segments.md) describes the
separate guest-driven annunciator strip and the remaining mapping limits.

The current [user interaction guide](development/interaction.md) covers settings,
physical macros, pacing and lifecycle. [Sessions](development/sessions.md)
covers manual and opt-in automatic saves; [connections](development/virtual-link.md)
separates byte/packet exchange from stock protocols and OS device bridging.
