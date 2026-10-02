# Licensing and implementation independence

Orchard's original source and documentation are offered under the MIT license
in the repository root. This baseline contains no vendored emulator core,
calculator ROM, bootloader, KML, bitmap skin, HP logo or font file.

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
