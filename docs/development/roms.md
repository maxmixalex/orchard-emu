# ROM inputs and provenance

## Full physical NOR versus updates

The loader accepts exact-capacity, little-endian **full physical NOR**, with a
plausible ARM reset vector at offset zero. It does not patch, pad, mirror,
decompress or insert a replacement bootloader. A plausible vector is not a
model-authentication or boot-completion certificate. The two admitted inputs
below have executed locally; their remaining stops are in [boot research](boot-research.md).

| Model | Size | Format / acquisition | Orchard evidence |
| --- | ---: | --- | --- |
| HP39g+ | 1,048,576 bytes | User-uploaded `39g+.bin`; real-hardware D1.55 full NOR | Native/WASM early boot, not UI |
| HP48gII USB revision | 2,097,152 bytes | Original author's public hardware-modification mirror, `48gii.bin` | Native/WASM early boot, not UI |
| HP39gs | 995,328 bytes | Uploaded 2.22 updater member | Not a native full NOR; not booted |
| HP40gs | 1,241,088 bytes | Uploaded 2.22 updater member | Not a native full NOR; not booted |
| HP49g+/50g | 1,294,336 bytes | Uploaded shared 2.15 updater member | Not a native full NOR; not booted |

HP40gs has **2 MiB NOR**, unlike HP39g+/39gs. Its earlier 1 MiB profile was
wrong. This is independently specified by HP's *40gs Specification Sheet*,
4AA1-0863ENUC, June 2007 ([archived original](https://www.manualslib.com/manual/704129/Hp-Hp-40gs.html?page=2)).
The uploaded updater exceeding 1 MiB prompted the review; simply making a file
fit the loader was not the basis for the correction.

## Verified full-NOR identities

HP39g+ D1.55 raw SHA-256:

```text
95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67
```

This matches the previously documented hpclang hardware acquisition. The user
uploaded the exact full image into this conversation, resolving the earlier
LFS-pointer/local-download blocker. It is not assembled from an updater and
an HP50g bootloader. Neither the temporary dumper nor its return issue is being
reintroduced.

HP48gII full-NOR raw SHA-256:

```text
4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937
```

Source: lyc8503's 2021 [HP39gs hardware modification write-up](https://blog.lyc8503.net/post/hp39gs-modify/),
with the author's [full-NOR file](https://blog.lyc8503.net/post/hp39gs-modify/48gii.bin).
The exact 2 MiB download matches the hash independently pinned in
[hpclang's fixture record](https://github.com/zyf722/hpclang/blob/main/docs/development/fixtures.md).
It has an ARM reset area and the `KINPOHP48GIIMAGE` marker. This is a community
full dump, not an HP-issued updater or proof of an official HP redistribution
license. It is not the distinct serial-cleared cnCalc dump mentioned in older
research. The targeted board remains the USB revision.

The private acquisition [run](https://github.com/zyf722/orchard-emu/actions/runs/36984188580)
only downloaded and checked the immutable bytes. A one-day private artifact
made them available for local work despite local DNS failures; **no emulator
debugging ran on that job**. The dump is not committed, included in the site,
or uploaded with production builds. Future acquisition is manual-only and
restricted to this private repository.

## Uploaded update identities

| Archive member | SHA-256 |
| --- | --- |
| `HP39GS_2.22/hp39gs_v2.22.bin` | `6e56e35054c06931ef8091403c1fcbde7743a7342e12aaf6082b0257dbe9d7b3` |
| `HP40GS_2.22/hp40gs_v2.22.bin` | `6fcf63b4d0cae2e59fa8b24b74052bf33812cbea960294429b1032cb98585f7b` |
| `hp4950v215/4950_215.bin` | `b08235fbf7d6ab3c5ad64b82d3ffe7004f942fafe90d0449ab3b0e5c3b0bc8a0` |

Their headers are respectively `KINPOHP39G+IMAGE`, `KINPOHP40G+IMAGE` and
`KINPOUPDATEIMAGE`. They are not full native ARM reset images. Matching HP49g+/HP50g boot regions have now been acquired separately;
their hashes and explicit boot-only probing are in [native ROM research](native-roms.md).
HP39gs/HP40gs native boot areas remain an acquisition task; replacing them with another model's
bootloader would be a noncanonical experiment, not full-dump acceptance.

## Input handling

```sh
node tools/rom-info.mjs /private/full-nor.bin
node tools/probe-rom.mjs --model hp48gii --rom /private/48gii.bin
```

Inspection and probing do not upload firmware. They report hashes and explicit
limitations. Keep acquisition authority and file storage separate from software
licensing; possession alone does not grant redistribution rights. Do not put
signed download URLs, personal filenames, extracted firmware or LFS objects
in public documentation or deployment directories.

## Explicit research inputs

`--rom` still requires a complete-size physical image. The separate
`--bootloader` option preserves a verified matching boot region and supplies
an erased remainder, with no OS or full-dump claim. `--gpio-input` supplies
known pin levels as an explicit experimental condition, not authenticated board
wiring. Both conditions appear in the version-2 probe report. Cold replays
reapply identical stimuli, and both hosts read the same local byte snapshot.
