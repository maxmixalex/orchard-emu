# Licensing and implementation independence

Orchard's original source and documentation are offered under the MIT license
in the repository root. No external emulator implementation, calculator ROM, bootloader, KML or font
file is bundled. The web build now includes pinned **outlined calculator art**
from hp-calcs-svg, separately Apache-2.0. Its LICENSE and NOTICE accompany the
assets; the original MIT license does not relicense artwork or HP trademarks.
See [asset provenance](skins-segments.md).

## What was studied

The webemu48 `web-port` README and repository structure were used to understand
its native/browser split, ROM handling and inherited-license boundary. hpclang's
roadmap, development board, platform/fixture documents, Zensical configuration
and workflow conventions were used as project-management and hardware-research
references. ARM and Samsung technical manuals supplied instruction/register
semantics for the new C implementation.

Emu48/x50ng/QEMU are comparative research projects. This is not a fork,
transpilation, line-by-line rewrite or relicensing of their implementations.
No implementation source from those emulators was copied into this baseline.
The project does not claim a formally audited, two-team clean-room process;
"independent" describes the actual original implementation and provenance
boundary, not a legal certification.

## Contribution policy

For each hardware behavior, cite the manual section, independently observed
trace, or hardware experiment. Record uncertainty and reproduce behavior before
promoting it to a compatibility claim. A trace is evidence of behavior, not an
instruction to transplant the other emulator's data structures or algorithm.

Do not add GPL emulator implementation to the MIT core, even through generated
code, translation or a copied helper function. A proposed external dependency
needs an explicit license/provenance review and separate documentation before
integration. Out-of-process comparison tools remain external and are not
bundled with Orchard releases.

MIT source licensing does not automatically cover HP firmware, artwork,
trademarks, third-party skins or reference manuals. Keep firmware acquisition
and storage separate from source/build publication. Record fixture hashes and
provenance without assuming possession grants redistribution rights.

## Build-time dependencies

C compiler/linker, CMake, Node and optional Zensical are external build tools,
not vendored project source. The current browser uses platform fonts and no
npm libraries. The freestanding WASM core has no linked third-party emulator
or libc implementation. Native builds use the host standard C library.

Native-region follow-up also inspects original HP firmware bytes and published
newRPL hardware-pin descriptions as behavioral evidence. It does not copy
firmware routines or another emulator's implementation into Orchard. The
native-region inspector stores identities, not the firmware. Research reports
keep genuine dumps, boot-only constructed backing and explicit GPIO conditions
separate; the preservation archive's distribution notice is not an MIT license.

During the LCD follow-up, selected MAME S3C24xx DMA and x49gp LCD implementation
snippets were **read for comparative research**. They expose existing modeling
choices, not authoritative silicon semantics. The new source was written from
vendor register/data-format facts, original test expectations and explicit
hypothesis boundaries; no foreign implementation, translated routine or data
structure was imported. This history is not described as a formal clean-room
process. The exact inspected references are recorded in [references](references.md) and in LCD evidence.

## Optional independent CPU oracle

Unicorn 2.1.4 is an externally installed developer/CI dependency, not linked
into Orchard's native or WASM core. Its upstream core is GPLv2; binding and
header terms are separately stated upstream. The original Python comparison
driver uses its public API while separate processes execute Orchard test
records. No Unicorn source or binary is copied into Git, Pages, `dist/` or
native install outputs. See [CPU oracle](cpu-oracle.md) for the exact process,
model and evidence boundary. This does not assert formal clean-room review.
