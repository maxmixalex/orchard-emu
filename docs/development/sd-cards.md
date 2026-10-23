# SD cards and FILES

The calculator page provides an emulated SD card for HP49g+. The original
firmware handles the filesystem through the modeled S3C2410 SDI controller.
Orchard does not insert files into guest RAM or replace the calculator's file
manager with a host implementation.

## Using a card

1. Open the admitted full HP49g+ ROM and finish the usual startup prompts.
2. Open **SD card** in the toolbar. **Create 16 MiB card** inserts a new MBR /
   FAT16 image. **Import card image** accepts a complete raw `.img`, `.bin` or
   `.sd` file of 1, 2, 4, 8, 16 or 32 MiB. Select **Read only** before insertion
   to assert the card's write-protect input.
3. Open the calculator's **FILES** with left shift, then APPS. The card is
   port **3:SD**. Use the stock COPY, STO and RCL operations to manage objects.
4. Finish guest file operations before **Export card image** or **Eject card**.
   Export downloads the entire current image. A modified card prompts before
   ejection; closing the card dialog leaves it inserted.

The generated empty card has one FAT16 partition, starting at sector 1, two
FATs, 512-byte sectors and two sectors per cluster. Its volume label is in the
BPB only: the tested HP49g+ Filer displays an optional root-directory volume
label as if it were a user file, so Orchard leaves that optional entry absent.
Imported images are not reformatted or repaired by the host.

HP's [49g+ user's manual](https://h10032.www1.hp.com/ctg/Manual/bpia5323.pdf),
chapter 18, documents SD storage as port 3 and its stock file operations.

## Which models have a slot?

| Orchard model | SD controller/media contract | Original-system acceptance |
| --- | --- | --- |
| HP39g+, HP39gs, HP40gs | No SD slot | No emulated card offered |
| HP48gII | No SD slot | FILES navigation is tested without a card |
| HP49g+ | SD slot; bounded SDSC card and image lifecycle | Tested using the user's unchanged complete NOR |
| HP50g | SD-capable profile shares the controller and core media API | Its own complete original NOR and independent stock workflow are still required |

This does not add a card slot to older HP48 or HP49 models outside Orchard's
supported ARM model profiles. A 50g controller test does not admit a complete
50g system to the calculator catalog.

## Why FILES failed

Two independent problems were found beyond the previous boot, CAS and USB
tests. First, the stock firmware writes zero to `SDIDAT` (`0x5a00003c`) when
opening FILES even if no card is inserted. The earlier empty-slot controller
stopped at this ordinary FIFO access. The controller now models its FIFO and
data/status behavior instead of treating every data-register access as an
unsupported operation.

After that stop was removed, navigation exposed a guest data abort. At PC
`0x0003f814`, `LDR r1,[r3,#4]` reads `0x08080000` with
`r3=0x0807fffc`: one word beyond the physical 512 KiB SRAM. This also occurs
with no SD card. The same checkpoint and physical keys continue into the
directory and back to HOME when the existing bank-1 mirror decode is selected.

The `hp49-home` preset therefore selects the explicit bank-1 mirror condition,
as the HP48gII preset already does. Physical storage remains exactly 512 KiB;
addresses in the SRAM chip-select bank wrap through those address bits. No
extra RAM, zero-filled memory or guest instruction patch is added. Strict
core initialization retains its exact-bounds decode, and alias counters remain
observable. This is a declared board-decode assumption supported by the
original-firmware counterexample, not a claim that physical wiring has been
measured on every HP49g+ board revision.

Earlier sessions retain the SRAM decode saved in that checkpoint. Restoring
an r17/r18 HP49g+ session therefore does not silently add the new mirror
condition, and FILES may still reach the old boundary. A fresh ROM startup or
Restart applies the current `hp49-home` preset. Export any wanted session or
objects before restarting; a saved checkpoint is not automatically migrated
to different board assumptions.

The [firsthand HP49g+ teardown](https://pc.watch.impress.co.jp/docs/2004/0405/pda33.htm)
identifies a BS616LV4010 256K×16 SRAM, supporting the 512 KiB physical capacity.
The teardown alone does not prove the high-address wiring. Historical r17/r18
HOME and arithmetic runs with zero alias accesses remain valid for those
scenes; they never established working FILES navigation.

## Controller and card scope

The implementation uses Samsung's [*S3C2410A User's Manual*](https://pdfstore-manualsonline.prod.a.ki/pdfres_02/af/4c/af4c636f-a045-4652-865a-9643aaa6c16d.pdf), chapter 19,
and the SD Association's
[Physical Layer Simplified Specification 2.00](https://users.ece.utexas.edu/~valvano/EE345M/SD_Physical_Layer_Spec.pdf).
The modeled subset includes native SD command/response states, CID/CSD/SCR,
512-byte sector reads and writes, card status and erase operations, a 64-byte
PIO FIFO, clocked transfer progress, interrupts, card removal, bounds and
write protection. Commands and data transfers respect the existing functional
clock and clock gating; register polling does not itself advance time. FIFO
full/empty conditions provide functional backpressure; they do not establish
bit-accurate or cycle-accurate physical SD signaling.

SDSC capacities are deliberately limited to 1–32 MiB. SDHC/SDXC, SDI DMA,
electrical timing calibration and arbitrary filesystem compatibility are not
implemented. Unsupported DMA remains an explicit diagnostic condition.

The browser board adapter uses card-detect GPF3 high for inserted and GPD3 low
for write-protected, preserving the other declared pad inputs. These electrical
facts are documented in the pinned
[newRPL 50g SD driver](https://github.com/c3d/db48x-from-newrpl/blob/063bd8e1ee9b641701a11488cd2a02dd540d87cf/firmware/sys/target_50g/sddriver.c).
The Orchard implementation is original MIT code; no driver implementation is
copied. The core media API itself does not impose these board GPIO inputs.

## Sessions and automatic saves

Checkpoint version 3 serializes the complete inserted card together with its
controller/FIFO/partial-transfer state. Version 1 and 2 inputs remain accepted
with their newly introduced media fields reset. CRC, ROM identity, model,
length, protocol-state and storage-capacity validation complete before an
import mutates the running machine. Reset preserves inserted media and its
write-protect state, then reconnects the declared card-detect inputs.

Manual `.ord` exports and automatic saves include the whole card. A session
restore replaces both calculator memory and the inserted card; it is not a
merge. The UI states this before replacement. Initial WASM memory remains
16 MiB; media and large checkpoint buffers grow lazily, within a 96 MiB WASM
limit, and never overlap the machine or ROM input buffer.

Automatic saves use binary IndexedDB records. Existing small localStorage
saves remain readable and are removed only after successful replacement.
The prior writer token is checked in the same IndexedDB transaction as the
replacement, including when Web Locks are unavailable. A stale writer or
cancelled generation preserves the last complete record. If IndexedDB is
unavailable, the legacy fallback keeps its old size bound and asks for an
export rather than overwriting a valid save with an oversized card session.

## Reproduction and evidence

The [r19 stock SD evidence](evidence/sd-workflows-r19.json) records the exact
final WASM/native identities, the original FILES failures, all stock file
operations and a byte-exact native/WASM continuation of a partial-sector write.

`tests/sdi.c` exercises controller/card behavior and `tests/checkpoint.c`
checks serialization and atomic rejection. `tests/sd-card.mjs` independently
checks FAT16 geometry, model/size bounds, lazy WASM allocation, complete media
restore and write protection. `tests/sd-storage-browser.py` runs real Chromium
and IndexedDB for legacy migration, a complete 16 MiB card-sized record,
competing writers, generation cancellation, reload and deletion.

Original-ROM workflows are separate from those ROM-free regressions:
`tools/verify-sd-workflows.mjs` covers stock FILES and file operations;
`tools/probe-sd-browser.py` uses the production page, Worker, file pickers and
downloads. Private ROMs, raw LCDs, checkpoints and card images remain outside
the repository and published application. The per-revision validation record
identifies accepted runs and their precise limits.
