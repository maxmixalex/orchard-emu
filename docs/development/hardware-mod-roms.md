# Hardware-modification ROM support

This work adds two usable, explicitly experimental calculator configurations from the user-supplied `ROM-for-HW-mod-39gs.zip`: HP40gs software on a modified HP39gs donor board, and the 64-line HP50gm conversion. They appear in the ordinary calculator picker only for their exact full-NOR identities. They do not establish coverage of an original physical HP40gs or an original HP50g.

Model IDs 1–6 retain their meanings. New model ID **7** is `hp50gm`: 2 MiB NOR, **512 KiB SRAM**, a **131×64 LCD**, and an optional SD slot that starts empty. ID 6 remains the stock HP50g profile; the new ROM is never admitted as ID 6. The 50gm calculator uses the donor's 64-line layout with an explicit hardware-modification label.

The private source archive has SHA-256 `1a07055a43027d388a4a6a6431744b3943ca67241a3af308c4a09da231eb6991`. It contains six raw-image members (five unique images) and seven USB updater members. The repository contains identities and reproducible verification tools, not these ROM bytes, guest checkpoints, card images, or screenshots. The sanitized results are in [hardware-mod-r26.json](evidence/hardware-mod-r26.json).

## Full-NOR identities and provenance

| Archive member | Bytes | SHA-256 | Configuration and admission |
| --- | ---: | --- | --- |
| `dump39gs.bin` | 1,048,576 | `1d0f323c289c67ee197e6f7983e771eec1ef70c8a174422fd5257f79fb3b80f3` | Model 2, research preset `hp39gs-archive-home`; archive provenance, separate from the earlier physical double-read capture |
| `dump39gs（字库）.bin` | 1,048,576 | `a6abaa2ce5a257886691ca3aac3fb10aa43c5d29fc6bf57121b880906b2b5b1b` | Model 2, research preset `hp39gs-font-home`; alternate-font variant |
| `dump40gs.bin` | 2,097,152 | `9041a8c187667833b220281bee1311c97cf2a0297d483882684ebd166a85c311` | Model 3, `hp40gs-mod-home`; ordinary experimental picker entry |
| `dump48gii.bin` and `48gii rom.bin` | 2,097,152 each | `4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937` | Existing model 4 admitted image, duplicated in this archive; no new model claim |
| `50gm_CNA0000000_JTAG.raw` | 2,097,152 | `b30a9ffb90996f0291b10a902a72d3a122db9c87fa5a55aa6ffdf07276b82db5` | Model 7, `hp50gm-home`; ordinary experimental picker entry |

The 39gs and 40gs images share the same 16 KiB donor bootloader. Relative to the previously captured original 39gs boot region, only six serial-identity bytes differ; its executable boot code is unchanged. The 40gs installed image agrees byte-for-byte after the 16-byte installed marker with both archive conversion updaters. Their only mutual differences are three bytes of target marker. This supports HP40gs operating-system coverage with the donor bootloader, not an independent stock-40gs hardware acquisition.

The 50gm image contains an HP48gII-target bootloader and modified HP49g+/HP50g software that keeps the 64-line display. The modification author's [original 50gm description](https://www.cncalc.org/thread-24766-1-1.html) requires replacement **512 KiB SRAM**, 2 MiB NOR, and optionally an SD connector. Merely assigning this image to the existing 256 KiB HP48gII profile produced an exception loop and blank LCD. The dedicated profile fixes the physical capacity rather than masking its addresses into smaller RAM. The earlier [HP39gs modification instructions](https://blog.lyc8503.net/post/hp39gs-modify/) describe replacing NOR with SST39VF1601.

## USB updater recognition and local assembly

Updaters start with a 16-byte target marker, followed by a little-endian native-region byte count at offset `0x10` and byte-sum checksum at `0x14`. The checksum covers exactly that native region starting at `0x18`. It does **not** authenticate trailing Saturn code, resources, or fonts. All seven archive updaters pass this bounded checksum check; that is a format result, not seven completed boot tests.

| Archive updater | SHA-256 | Declared target/model |
| --- | --- | --- |
| `39gsUSB升40gs固件[需要换ROM芯片].bin` | `790d4bd26bcda98333920808bc927d142774b89409382fa4b8957653995aad4e` | HP39 donor marker; model 3 conversion, 2 MiB NOR |
| `48giiUSB降40gs固件.bin` | `52cd4ed0c83adb80510a3bb066ba0b7b7c1291afdffa36afdd1885d30bc32829` | HP48gII donor marker; model 4 research conversion |
| `48gII_208_92_2M_USB.bin` | `dc85d74bf101413d86a9aab3e5359be6f150f9ff0cfbc0205b96fde861d2dcef` | Model 4 |
| `48gII_210_92_USB.bin` | `55783a684753e7f87f2091047ae86f2465b0dfb260aff6bc75c2c77495ae8b0f` | Model 4 |
| `50gm_210_menu_fix_beta.bin` | `cf5c6875db0b8f74bd1c9ebb2bcae0bd139debceaf1f18b7f2a987e166e021fe` | Model 7, menu-fix beta |
| `hp39gs_v2.22_update.bin` | `492817eb13b7d54a82be2f69a43b21eb089c3741aa504d68da9d4bcec9de715a` | Model 2 |
| `hp39gs_v2.23_with_8px_font.bin` | `93ad03907dffeba958ef3083a2b6bdd95de67cfcd74e0ba4ad14be161af46da4` | Model 2, alternate fonts |

`tools/install-firmware-update.mjs` creates a separate local research image from a complete donor NOR and a matching updater. It verifies known model identity, the native checksum, bootloader target marker, installed-region marker, and physical capacity. It preserves the donor bootloader and untouched tail, copies the **entire** update at `0x4000`, and changes only its installed marker to `Kinposhcopyright`. It never invents a bootloader or silently changes a target marker. Both output files must be new paths; failures writing the report remove the newly created image.

Example with a privately held 2 MiB 40gs-conversion base:

```sh
node tools/install-firmware-update.mjs hp40gs \
  /private/dump40gs.bin \
  '/private/39gsUSB升40gs固件[需要换ROM芯片].bin' \
  /private/reinstalled40.bin /private/reinstalled40.json
```

This exact archive pair reconstructs SHA-256 `9041a8c187667833b220281bee1311c97cf2a0297d483882684ebd166a85c311`. The helper reports local assembly provenance; this is neither a physical acquisition nor an emulation of the USB flash-programming sequence. Other assembled hashes remain outside the ordinary exact-hash picker. The 50gm menu-fix beta remains a separate updater, not a tested replacement for the admitted raw image.

## Reproducing functional acceptance

Build the production WASM and native checkpoint oracle first. Supply privately held full NOR images; these commands do not download firmware. Each output path must be new because successes and failures are retained separately.

```sh
node tools/verify-hardware-mod-startup.mjs hp40gs-mod-home \
  /private/dump40gs.bin /private/40gs-cold-replay.json
node tools/verify-hp39gs-wire.mjs /private/dump40gs.bin \
  /private/romstream-v2-calculator /private/40gs-native --hp40gs-mod --roundtrip
node tools/verify-hp49-workflows.mjs /private/50gm.raw \
  /private/50gm-cas --hp50gm
node tools/verify-hp48-native.mjs /private/50gm.raw \
  /private/pinned-hpgcc-sdk /private/50gm-native --hp50gm
node tools/verify-hp50gm-sd.mjs /private/50gm.raw /private/50gm-sd
```

The two archive 39gs variants use `verify-hardware-mod-startup.mjs` with presets `hp39gs-archive-home` and `hp39gs-font-home`. These witnesses compare a fixed, independently viewed arithmetic frame on native and production WASM and repeat both cold runs. The normal calculator's import, persistence, controller and Worker checks are recorded separately in the combined compatibility report.

The unchanged external native example comes from the [pinned HP-GCC SDK revision](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2). **50gm requires `LIB275.LIB`**, the 49g+/50g ARMToolbox variant, despite the firmware retaining HP48gII identity for its display. Installing `L275_48.LIB` uploaded successfully but did not execute the program: execution reached a `0xDEADBEEF` sentinel and stopped. That failed trial is retained and does not count as native coverage. The correct library launches unchanged `template/main.hp`, displays “Hello From Lobakkang,” returns with ON, computes `1+1=2`, and survives a subsequent USB GET. For 50gm the entire exported library, including its `HPHP49-C` header, is byte-identical.

The 40gs conversion has no IR item in its receive menu. USB is its first item and USB Disk is its third item. The original 39gs witness keeps its original menu offsets; the `--hp40gs-mod` branch follows the conversion firmware's actual menu. Guest program bytes are never patched to adapt the witness.

## Recorded application results

The detailed hardware-modification application suite passed on the r26 stage-3 production WASM, SHA-256 `209bce3c0cc3b7940d921aed8730dfb096ed7cb5600714e0eacc62ae3621239f`. Subsequent UART-pulse and HP40gs USB auto-RECV work has its own targeted and normal-browser acceptance in the combined r26 report; these stage-3 results are not relabelled as later-build runs.

| Configuration | Passed workflow | Evidence boundary |
| --- | --- | --- |
| Both archive HP39gs variants | Cold HOME `1+1=2`; native/WASM agreement; independent repeated cold runs on both hosts | Four exact-hash runs per variant; no new physical capture claim |
| HP40gs conversion | Cold HOME arithmetic and exact CAS `1/3+1/6=1/2`; native/WASM and both cold replays agree | HP39gs donor bootloader, HP40gs operating system |
| HP40gs conversion | Unchanged ROMstream V2 library/aplet installed by Wire; Disk SEND preserves the aplet file and library body; START/ENTER reaches its native USB descriptor; cable-loss E03, ON acknowledgement, HOME and `1+1=2` | An actual native launch/return witness; it does not claim a new complete physical ROM read |
| HP50gm | Cold arithmetic `1+2=3` and `7×8=56`, native/WASM and both cold replays | 512 KiB SRAM and 64-line screen |
| HP50gm | VERSION, `FACTOR(X²−1)=(X−1)(X+1)`, APPS/MODE navigation and return, `X²` plot and exit | Nine fixed, independently viewed LCD hashes; full v8 checkpoint continuation agrees on native and WASM |
| HP50gm | Unchanged external HP-GCC application installed over USB, native greeting, ON return, `1+1=2`, subsequent USB GET | Correct unchanged `LIB275.LIB`; all 4,474 returned library bytes match |
| HP50gm | Filer writes integer 42 to a fresh 16 MiB SD card; export, fresh cold boot, card reimport and recall | Both FAT16 copies agree, exact 15-byte object, seven guest-written blocks, fixed visible 42 frame |
| HP50gm | Resume during a partially written SD sector | 112 bytes of a sector pending; complete 17,317,028-byte v8 checkpoint including the whole card continues byte-identically on native and WASM |

The normal React calculator is tested through the production Worker separately. A failed earlier developer-workbench browser attempt is retained privately and contributes no passing UI claim. The public evidence includes result hashes and provenance only.

On the later stage-4 build, SHA-256 `bb53704a128319df23a0340da4bf7e8767d1a98ae8337a3b4d8572750d4ec7a3`, the real HTTP-loaded Worker passed all **14 model/audience combinations**: seven profiles, each in calculator and developer views. Generated ARM fixtures exercised running, rate changes, pause, one-step execution, reset and checkpoint save/restore with browser timers. This confirms host integration, including model 7, without treating the generated model-6 fixture as stock HP50g firmware coverage. Unknown 1 MiB/2 MiB ROM hashes remain rejected by the ordinary picker; its source and built modules agree.

## Scope and remaining limits

The setup still explicitly selects the compatibility conditions already used by orchard-emu: bank-1 SRAM mirror decoding, GPIO input/bias and ADC codes, packed-LSB LCD interpretation, and the idle-zero LCD `+0x68` probe. These are named emulator conditions, not measurements of the user's donor-board wiring. Normal picker labels remain experimental.

USB transfer is enabled for 50gm only after an actual application upload/run/return/GET witness. Its serial and IR interfaces are not admitted by this work. The optional SD slot uses the existing SDSC block model. The modification author's known menu/FORMAT limitations in the raw firmware are not silently fixed by importing the beta updater.

Original HP50g model 6 still lacks an admitted complete stock ROM and end-to-end stock-device coverage. Neither 50gm's 512 KiB memory nor its successful native and CAS workflows changes that boundary. No overall “99%” compatibility percentage is inferred from these finite tests.
