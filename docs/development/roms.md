# ROM inputs and provenance

## Accepted input in 0.1.0

The loader accepts a raw, little-endian, **complete physical NOR** file of the
selected profile's exact capacity. Offset zero must contain a plausible ARM
reset branch or PC-relative vector load. The loader then copies the bytes
without padding, patching, mirroring, decompression or bootloader replacement.

This is deliberately narrow. A valid-size file with a plausible vector is not
thereby authenticated as HP firmware, identified as the selected model, or
proven bootable. The UI and native JSON continue to say `boot_verified=false`.
Other genuine reset-vector instruction forms may need an explicitly reviewed
loader extension; rejection is safer than treating any equal-sized file as a
known model.

Updater packages, archives, ELF files, Git LFS pointer text, Saturn/nibble ROMs
and partial bootloader dumps are not interchangeable with a full physical NOR.
The current loader has no converter. Never fill a missing native bootloader
with another model's image merely to make the file pass its size check.

## Existing research, not redistributed fixtures

The hpclang [fixture record](https://github.com/zyf722/hpclang/blob/main/docs/development/fixtures.md)
identifies these useful future inputs:

| Model | Input lineage | Important restriction |
| --- | --- | --- |
| HP39g+ | Real-hardware complete 1 MiB D1.55 NOR | Preserve exactly; do not copy x50ng's fixed-size backing workaround into the physical model |
| HP39gs/40gs | Archived official 2.22 updater files | Updaters alone do not establish genuine full-NOR cold boot |
| HP48gII USB revision | Complete 2 MiB dump, distinct native boot area | Do not replace with HP49/50 or generic boot code |
| HP49g+/50g | Shared 2.15 OS research, distinct native ARM bootloaders | Record whether input is a real dump or an explicitly assembled research image |

The already documented HP39g+ full dump has SHA-256
`95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67`.
The referenced HP48gII complete dump has SHA-256
`4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937`.
These are provenance references only: neither binary is bundled or claimed to
have been executed in Orchard during this handoff.

## Manifest contract for future boot evidence

Each admitted fixture needs model/revision, source and acquisition authority,
input format, original size/hash, bootloader identity, OS identity, documented
transformations (normally none), and the expected reset address. Bind run
results to the hash, not merely a friendly filename. Keep private firmware
storage and downloadable source/build artifacts separate.

A first stock run should archive a bounded trace, first unresolved dependency,
registers and raw framebuffer without modifying the input. The CLI refuses to
overwrite an existing trace, framebuffer or UART output, including filesystem
aliases that already exist.

```sh
node tools/rom-info.mjs /path/to/full-nor.bin
./build/orchard run --model hp39gplus --rom /path/to/full-nor.bin \
  --ticks 100000 --trace /new/path/boot.jsonl
```

The inspection command calculates SHA-256 and reports format plausibility.
It does not upload firmware, establish legal rights, determine the exact model
or certify bootability.
