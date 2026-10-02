# Native ROM preservation research

Research snapshot: **2026-10-02**. Names, equal file sizes and emulator support
labels are not evidence that an image contains a physical ARM boot region.
The local inspector distinguishes admitted full NORs, native boot regions,
updaters and the archived Emu48+ image using exact hashes.

## Updated acquisition priority

The user will later provide full HP39gs and HP49g+ NOR dumps from their own
hardware. These remain **pending**, not acquired or verified. Work continues
with the existing HP39g+/HP48gII full inputs and HP49g+/HP50g native boot regions;
no new original firmware was admitted in this continuation. Do not spend the
current work cycle repeating the blocked HP39gs attachment retrieval.

## Six-model inventory

| Model | Verified material available locally | Remaining native input |
| --- | --- | --- |
| HP39g+ | Hardware-acquired 1 MiB D1.55 full NOR | No acquisition blocker for this fixture |
| HP39gs | Official 2.22 updater; original 2019 boot-region contribution located | The attachment has not been obtained; no verified complete NOR |
| HP40gs | Official 2.22 updater, for a 2 MiB NOR machine | No independently verified native boot region or complete NOR found in this search |
| HP48gII USB revision | Hardware-modification author's 2 MiB full-NOR mirror | No acquisition blocker for this fixture |
| HP49g+ | Archived original 16 KiB boot region; official 2.15 updater | Not yet a complete native acquisition |
| HP50g | Archived original 16 KiB boot region; official 2.15 updater | Not yet a complete native acquisition |

Original full-dump identities and updater hashes remain in [ROM inputs](roms.md).
This inventory is acquisition evidence, not an all-model boot/support matrix.

## HP49g+ and HP50g: native boot regions acquired

Source: [HP Calculator Archive item 9335](https://www.hpcalc.org/details/9335),
[original archive](https://www.hpcalc.org/hp49/pc/rom/hp-arm-models-bootloader.zip).
The preservation listing attributes the ARM code to Hewlett-Packard. Its
readme explicitly distinguishes the two calculators and retains HP copyright.

| File | Bytes | SHA-256 | Embedded version string |
| --- | ---: | --- | --- |
| `boot-49g+.bin` | 16,384 | `f46fbfbbd6442bf76bd412e89fc6d3c64850f742f35eca732e3e5b01cf3393c8` | `boot version:3.15.04` |
| `boot-50g.bin` | 16,384 | `dfa544617039e1bff0f62b9f51a943e57ff756d12bb81478de7aec41a5b73a28` | `boot V4.01.03.03` |

The downloaded ZIP is 19,364 bytes, SHA-256
`d0f6784ee97e1cf9570767f66de1dec5ed88e310bda08aa6ecb663ac87456f54`.
Both files begin with an ARM reset branch. The archive's **2.15** label must
not be mistaken for the embedded bootloader version. They are separate inputs,
not one generic bootloader with interchangeable model names.

`probe-rom.mjs --bootloader` accepts only the matching hash-pinned region.
It preserves its 16 KiB exactly, places erased `0xff` bytes in the remaining
physical NOR backing, and marks the report
`boot-region-with-erased-remainder`, with `operating_system_supplied=false`.
This is an intentionally incomplete research flash state, **not a recovered
2 MiB dump or a tested updater-to-installed-NOR conversion**. No guest OS is
supplied, so a recovery/update path is expected rather than calculator startup.

```sh
node tools/rom-info.mjs /private/boot-50g.bin
node tools/probe-rom.mjs --model hp50g --bootloader /private/boot-50g.bin
```

The core's raw NOR loader remains unchanged; preparation is explicit and local
to the probe. Wrong-model boot regions, arbitrary 16 KiB files and updaters are
rejected. No mixed-model bootloader or firmware header patch is performed.

## HP39gs: original contribution located, attachment unavailable

In [post 117443](https://www.hpmuseum.org/forum/post-117443.html), Bernd Grubert
contributed `bootldr.txt` on 2019-06-07, describing it as generated on an HP39GS.
The preceding extraction instructions enumerate 4,096 words covering physical
addresses `0x0000` through `0x3ffc`: a 16 KiB boot region, not the whole NOR.
The indexed post lists a 43.58 KiB text attachment. The thread's repair reports
also discuss replacement HP50g boot code; those replacements must not be
confused with Grubert's original contribution.

The original page/attachment acquisition returned HTTP 403 in this environment.
No text list was decoded and no binary hash is available. Finding the indexed
post does not mean the bytes have been recovered. A future recovered copy must
validate word count/order, little-endian reconstruction, vectors and provenance
before admission. Do not substitute the already acquired HP50g bootloader.

## Rejected lookalikes

**HP39GS-Explorer's `raw` file.** The repository's
[`rom/hp39gs_v2.22_raw.bin`](https://github.com/Yanye0xFF/HP39GS-Explorer/blob/master/rom/hp39gs_v2.22_raw.bin)
has 995,328 bytes and Git blob SHA-1
`4d2eeb6e6d227a38f4d1c10fc2672a555f8e9dcf`. Independently hashing the uploaded
official updater as a Git blob yields that exact identity. It is the same
updater, including the transport header, not an additional native dump.

**The 2 MiB Emu48+ image.** [Archive item 6744](https://www.hpcalc.org/details/6744)
explicitly describes a ROM for Emu48+. The archive was downloaded and inspected,
not excluded merely on its name. `rom.49g` is 2,097,152 bytes, SHA-256
`b01c13e24a692f35e6087106d58ec205b4696d5b5e35d57f8f94015f8bb1f1ca`.
Its first little-endian word is `0x108001e6`, not a native ARM reset vector.
The current loader rejects it; the inspector reports `emulator-rom`.
ZIP SHA-256: `67dee0c3ae5ec79dc4aa5933e15d5d026e39b66a2ce10d8cf2da5230c669fd9f`.
Equal physical capacity is therefore insufficient to establish format.

**Update and modified-ROM archives.** The official 39gs/40gs and 49g+/50g
packages remain updaters. A padded updater, another model's boot area or a
community cross-flashed/custom-ROM image is not automatically an original
full dump. No HP40gs boot region was admitted from these alternatives.

## Reproducibility and publication

[`tools/rom-inputs.mjs`](https://github.com/zyf722/orchard-emu/blob/main/tools/rom-inputs.mjs)
is the shared local identity/format layer used by inspection and probing.
Reports keep source-file size/hash separate from the constructed backing image.
Both hosts consume the same temporary byte snapshot, preventing a source-file
change between hashing and a native run from invalidating the comparison.

Acquisition-only runs on the private research branch fetched public material
for offline inspection; they did not debug or run the emulator. Artifacts have
one-day retention. None of the firmware, manuals, signed download URLs or
private traces is committed or published on Pages. MIT covers Orchard's
original implementation, not HP's firmware. See [boot research](boot-research.md)
for actual execution results and the explicit GPIO conditions.

## Continuation search and chip provenance

The follow-up search found no newly verified original 39gs/40gs native bytes
or complete 49g+/50g dump. The located 39gs text attachment still could not be
retrieved; the inventory above is unchanged. Searches for 40gs bootloader/dump
and the shared LCD offset did not produce an admissible new binary or a
register definition.

The original 48gII mirror author's hardware article identifies the replacement
part as SST39VF1601. Its manufacturer's software-ID specification now supports
an **explicit** probe component, separate from the NOR-file identity. The
component and electrical-input evidence is recorded in [electrical input](input.md);
no new or modified firmware was required for the OS-region progression.
