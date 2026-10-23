# SD cards and FILES

The r22 [local-directory workflow](directory-sd.md) adds recursive folder import,
reviewed 8.3 name mapping, 16/32 MiB drafts, and explicit directory write-back.
The SD tools now remain in a sidebar. A mounted card can be copied and ejected
into the editor in one Worker turn before any host filesystem edit.

The [r21 SD file record](evidence/sd-files-r21.json) covers draft rename/delete,
namespace validation, independent FAT tools and final-production original-ROM
workflows. HP49g+ reads the edited root and nested objects, writes its own object,
and resumes an in-flight v4 card checkpoint identically on native and WASM.
The [r20 record](evidence/sd-files-r20.json) retains its earlier, separately
identified original-system observations.

The calculator page provides an emulated SD card for HP49g+. The original
firmware handles the filesystem through the modeled S3C2410 SDI controller.
Orchard does not insert files into guest RAM or replace the calculator's file
manager with a host implementation.

## Using a card

1. Open the admitted full HP49g+ ROM and finish the usual startup prompts.
2. Open **SD card** in the toolbar. **Create 16 MiB card** inserts a new MBR /
   FAT16 image. **Import card image** accepts a complete raw image of 1, 2, 4,
   8, 16 or 32 MiB, regardless of its filename extension. Select **Read only** before insertion
   to assert the card's write-protect input.
3. Open the calculator's **FILES** with left shift, then APPS. The card is
   port **3:SD**. Use the stock COPY, STO and RCL operations to manage objects.
4. Finish guest file operations before **Export card image** or **Eject card**.
   Export downloads the entire current image. A modified card prompts before
   ejection; hiding the SD sidebar leaves it inserted.

The generated empty card has one FAT16 partition, starting at sector 1, two
FATs, 512-byte sectors and two sectors per cluster. It has no volume label:
the BPB contains FAT's `NO NAME    ` text and the optional root-directory label
entry is absent. The tested HP49g+ Filer displays a root-directory volume label
as if it were a user file. Keeping the BPB consistent with the empty root also
allows independent filesystem checks to finish without a label warning.
Imported images are not reformatted or repaired by the host.

HP's [49g+ user's manual](https://h10032.www1.hp.com/ctg/Manual/bpia5323.pdf),
chapter 18, documents SD storage as port 3 and its stock file operations.

## Prepare and browse files before insertion

With no card inserted, choose **Prepare card files**. This opens an independent
16 MiB FAT16 draft. **Open image for editing** replaces the draft with a local
image after its filesystem has passed validation. The local source file is
never changed. The ordinary **Import card image** remains available for users
who already have an image ready for the calculator.

The draft browser lists folders and files, opens folders, downloads individual
files, creates folders, renames entries, deletes files and empty folders, and
adds a batch of up to 128 selected files. Every
selected file has an editable target name. File choosers accept any extension,
and the filesystem writer preserves contents exactly, including empty files.
The editor does not decide whether those bytes are a calculator object; the
original calculator system makes that decision when the user opens a file.

New names use FAT's short 8.3 format: 1–8 ASCII characters plus an optional
1–3-character extension, stored in uppercase. A longer source filename remains
visible for review and must be given a valid target name; it is never silently
truncated. Existing long-name records are retained, while the browser displays
their short aliases. Duplicate names, including case-only differences, reject
the whole operation. Short aliases and existing long names share a namespace;
a new target cannot shadow either spelling of another entry. Existing files
are not overwritten, and the editor does not create long file names.

**Rename** changes an entry to the explicitly entered short name. A folder may
contain files: its contents and parent cluster links remain intact. When an
entry has a long filename, the rename panel explains that the chosen short
name replaces it; the old long-name records are retired together. Keeping the
same short name leaves that entry unchanged. **Delete** asks for confirmation
inside the draft and accepts files or empty folders. A nonempty folder must be
emptied first. Deletion releases its complete cluster chain in both FAT copies
and retires all its name records. Read-only entries or a read-only parent folder
reject writes, and the volume root cannot be renamed or deleted.

**Download draft image** exports the entire prepared card. **Insert prepared
card** passes it through the normal controller insertion path, including the
selected read-only setting. The calculator then reads and writes it through
the emulated SD controller. Hiding the sidebar or switching its tabs preserves
the draft. Drafts are not automatic saves: download or insert it before leaving
the page, replacing the calculator session, choosing a new blank draft, or
discarding it with the back button. Once inserted, the existing session and
automatic save behavior includes the complete card.

Insertion takes an independent `File` snapshot, then the controller reads its
own bytes and sends a structured-cloned Worker message. The Worker copies that
message into its SD storage; it never takes ownership of the draft's buffer.
If reading or inserting fails, the draft remains available for download or
retry. Hiding the sidebar also keeps a pending draft-file read; replacing its
calculator generation or unmounting the editor discards that read's result.
Once **Insert prepared card** has been pressed, the controller owns that
insertion operation, and hiding the sidebar does not cancel it. A later model
generation or controller disposal invalidates an unfinished insertion read.

The host file editor is unavailable while a card is inserted. To prepare a new
version of an existing guest card, finish guest operations and choose **Eject
to edit / sync**. The Worker copies and validates the FAT16 image before ejecting
it, without a guest instruction between those operations. A validation or
ejection failure leaves the mounted card available. The returned draft preserves
its image name, write-protect choice and current-session directory association.
Ordinary export/eject/open-image remains available. Merely opening the SD sidebar
never alters inserted media.

For a local folder, choose **Choose local folder** inside the draft. Review the
recursive path-to-alias preview and select 16 or 32 MiB before **Use this folder
as the draft**. Direct-access browsers retain the directory handle for explicit
**Re-read folder** and **Preview write-back** actions. See the
[directory guide](directory-sd.md) for conflict behavior, browser fallback,
permission boundaries and the distinction from an operating-system mount.

### Filesystem bounds and atomic changes

`web/sd-filesystem.js` is original MIT code, implemented from the on-disk facts
in Microsoft's [FAT specification, version 1.03](https://www.cs.fsu.edu/~cop4610t/assignments/project3/spec/fatspec.pdf).
It supports one primary FAT16 partition or an unpartitioned FAT16 volume within
the supported 1–32 MiB card sizes. The editor requires 512-byte sectors,
power-of-two clusters up to 32 KiB, and the FAT16 data-cluster count range
4,085–65,524. FAT12, FAT32, extended partitions and multiple partitions are
outside this editor's scope; ordinary complete-image import remains independent
of this filesystem browser.

Validation checks partition and BPB bounds, FAT capacity and mirror agreement,
directory entry layout, long-name alias checksums, NUL/`0xffff` padding and the
255-character bound, the shared short/long-name namespace, directory parent links,
file length and cluster-chain length. Cycles, cross-linked files/directories,
out-of-range targets, truncated chains and unreferenced allocated clusters are
rejected. Traversal stops beyond 32 folder levels or 16,384 live directory
entries. The editor refuses inconsistent images rather than trying to repair
or salvage them. Deleted entries remain available for allocation, and marked
bad clusters are never allocated.

Every write uses an independent `Uint8Array` work copy, including when a Node
caller supplies a `Buffer`. The whole result is validated before it is returned.
A full card, full fixed-size root directory, duplicate target, invalid name or
later error in a batch leaves the source bytes unchanged. A subdirectory can
grow by allocating another cluster; the FAT16 root directory has fixed capacity.
Filesystem and local file-read failures appear in the draft without discarding
the current image.

### Offline editor verification

`node tests/sd-filesystem.mjs` checks both successful and rejected operations,
including fragmented files, nested-directory growth, FAT mirrors, malformed
geometry, cycles, cross-links, long-name preservation, the directory-depth bound
and byte-exact rollback after a later file exhausts capacity. Its second raw
parser computes offsets independently to extract the written files. It also
checks Buffer-backed input, where `Buffer.slice()` would otherwise share and
mutate the source image. Rename/delete coverage includes nonempty-folder rename,
empty-file and empty-folder deletion, fragmented-chain release, reuse of a full
root slot, read-only rejection, and long-name records spanning directory clusters.
Imported short/long-name collisions are rejected before any edit. Collision keys
use non-expanding uppercase Unicode characters for long names, without Unicode
normalization or rewriting preserved name bytes; the tests distinguish dotless
`ı` matching `I` from `ß` remaining distinct from `SS`.

`python3 tests/browser-sd-files.py` runs a real Chromium file chooser and download
flow with the production React components and controller. The fixture uses no
ROM and explicitly acknowledges insertion in place of a Worker. It checks
arbitrary extensions, target-name review, exact single-file and whole-image
downloads, duplicate-batch rollback, corrupt-image and local-read failures,
file/folder rename with exact collision rollback, delete confirmation/cancel,
nonempty-folder rejection, opening a prepared image, failed-insertion retry,
read-only insertion parameters, sidebar hiding during a pending read,
generation cancellation, both languages and a 390-pixel viewport. The local-device
guard also disables live-card actions during connection and attachment without
disabling a separate draft, then restores the controls on disconnect. Original-system SD
acceptance remains a separate test.

`node tests/sd-files-controller.mjs` checks the production controller's ownership
boundary using real `File` instances and structured-cloned outgoing messages:
the source image and immutable File survive edits to the sender or receiver's
buffer; read-only state survives retry; an old generation, disposed controller,
or model without an SD slot cannot send a late insertion. These tests do not
pretend that a mocked Worker acknowledgement is original-system acceptance.
The r22 extension also checks directory-association ownership, successful
eject-to-edit handoff, rejection without losing the mounted card, and cancellation
on a new generation, controller disposal or Worker failure.
Local-device guards reject insertion before reading its source, retain mounted
media through rejected export/edit/eject commands, recheck delayed file reads
and dirty-card confirmation, and release pending state for a successful retry.
The actual-WASM Worker test independently verifies that rejected commands
leave media bytes and card status unchanged.

For independent r20 checking, Ubuntu's mtools 4.0.43 listed the prepared card's
root and subdirectory and extracted all three generated test files byte for
byte. dosfstools `fsck.fat` 4.2 completed a read-only check of that card's FAT16
partition with exit status 0 and no repair requests. Generated images and tool
logs stay in the ignored `build-r20/sd-files` directory. A second image written
by mtools, including a three-record long filename and another subdirectory, was
opened and extended by the editor without changing the input image or existing
long name; `fsck.fat -n` also returned 0 for that result.

The r21 independent review repeats the checks with mtools-created files: a
three-record long filename in the root and another long filename in a
subdirectory. Orchard renames the root file and directory, deletes both files
and the emptied directory, then adds a new file into the released space. All
four images pass dosfstools 4.2 `fsck.fat -n` without repair requests; mtools
4.0.43 extracts the renamed root and preserved nested files byte for byte.
The original image remains unchanged. The tools are Ubuntu's pinned packages,
locally extracted; private images and logs are under `build-r21/sd-review`.

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
