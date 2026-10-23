# Local directories and SD card drafts

Orchard can create a FAT16 SD card from a local directory and its subdirectories.
The browser copies file contents into an independent 16 or 32 MiB image; the
original calculator accesses that image through the emulated SD controller.
No files or directory structures are inserted into calculator RAM, and no ROM
bytes are changed.

## User workflow

1. Open the **SD card** sidebar with an admitted SD-capable calculator. Finish
   any guest file operation before removing an existing card.
2. With no card inserted, select **Prepare card files**, then **Choose local
   folder**. In browsers with direct directory access, the native picker grants
   read access to the selected directory. Other browsers use a directory file
   input instead.
3. Review the local-path / card-path table. The contents of the selected folder
   become the card root; the folder itself is not added as a wrapper. File
   contents are copied byte for byte, regardless of extension. Empty files are
   supported; direct directory access also preserves empty subdirectories.
4. Select **16 MiB** or **32 MiB**. The prepared image must fit both the data
   area and the fixed FAT16 root directory. A failed import preserves the
   existing draft. If 16 MiB is too small, selecting 32 MiB rebuilds the already
   read snapshot without requiring another directory selection. Grouping many
   root files into subdirectories can resolve a root-directory capacity limit.
5. Choose **Use this folder as the draft**, then **Insert prepared card**.
   Applying the preview replaces only the draft. Insertion gives the Worker
   exclusive ownership of the mounted image. Original HP49g+ FILES sees it as
   port **3:SD**.
6. After guest operations finish, use **Eject to edit / sync**. The Worker
   validates and copies the image, then ejects it synchronously before returning
   the draft. The editor is unavailable while the image is mounted.
7. **Re-read folder** builds a new preview of current host contents. **Preview
   write-back** compares the ejected draft with the associated local directory.
   Review the listed additions, updates and conflicts, then press the concrete
   **Write … entries to folder** button to request write access and apply them.

Hiding the sidebar or switching its tabs preserves the draft. A directory handle
and its original-name mapping are retained for this page session, including an
insert/eject cycle. They are not stored in a checkpoint or IndexedDB. Reloading
the page, opening another ROM or creating another calculator generation clears
the association. Download an unmounted draft or insert it into a saved session
to retain its card bytes.

An active **Local device** connection owns the live machine. Disconnect it
before inserting, exporting, ejecting or returning the mounted card for
editing. The sidebar explains this in both languages, and controller/Worker
guards enforce it even if connection state changes during a file read or
ejection confirmation. Separate unmounted drafts and their explicit directory
operations remain available.

## Names, limits and performance

New card entries use uppercase ASCII 8.3 names. Valid names retain their short
spelling where possible. Other names receive deterministic aliases such as
`LONGFI~1.ANY`; an existing real `LONGFI~1.ANY` is reserved before synthetic aliases
are assigned. Case-only duplicates and names that normalize to the same stem
receive separate aliases within their parent directory. Entirely non-ASCII
stems use `FILE~1` or `FOLDER~1`. The preview shows every mapping before it replaces
the draft. This release does not create FAT long-name records.

The session association retains the original local paths. A calculator update
to a mapped alias writes back to that original path, including its Unicode name
and original extension. New guest files use their card names, placed under the
original host path of any mapped parent directory. A card rename is treated as
an additional host path; the original local file is retained.

Directory reads are bounded to 32 folder levels, 16,000 source entries, and
32 MiB of file bytes. FAT metadata, cluster rounding and the filesystem editor's
16,384 on-disk-entry limit can lower practical capacity; each subdirectory also
requires dot entries. The FAT16 root has 512 slots. These limits are reported
without replacing the current draft.

`addSDTree()` creates the complete tree in one image copy and validates the
result once. It does not copy and parse a 16/32 MiB image separately for every
file. `readSDTree()` likewise validates the card once for a directory export.
File reads yield to the browser; progress updates show entries and bytes read.

## Explicit write-back and conflicts

Write-back is additive. It never invokes `removeEntry()`, never deletes a local
file or folder, and does not propagate card deletion to the host directory.
The preview reports imported entries that were removed from the card and will
remain locally. Empty directories can be created as well as files.

For a mapped file, the editor compares the current local bytes with the original
imported bytes. It updates the target only if those bytes are unchanged. If the
destination already equals the card, no write is necessary. An external edit,
external deletion, type mismatch, or unrelated existing target is a conflict;
the local entry is preserved. The user can review/download the card copy or
re-read the directory before deciding how to reconcile it.

The destination is read again immediately before each write. A new or changed
target after preview is also preserved and reported. A directory conflict or
failed directory creation prevents writes below that path. Other independent
files can still finish. The result reports saved entries, preserved conflicts
and failed paths; the draft remains available throughout.

Browser filesystem writes do not provide an atomic whole-directory transaction.
Each writable file stream is closed separately, so a later failure does not undo
earlier completed files. A failed creation can leave a newly created empty file;
the app does not delete it as cleanup. Nor can the browser lock out all native
applications between the final comparison and the file commit. Finish external
edits before an explicit synchronization. This operation is a point-in-time
copy; there is no filesystem watcher or background bidirectional synchronization.

## Browser API boundary

The implementation uses `showDirectoryPicker({mode: 'read'})` on the user's
**Choose local folder** click. Subsequent read/write permission requests occur
inside the corresponding user action. It uses native `FileSystemDirectoryHandle`
enumeration, `getFile()`, `getDirectoryHandle()` and `createWritable()`; file
contents commit when the stream closes. Access failures use localized UI text.

The official Chromium [File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
describes directory handles, permission requests and write-stream completion.
The [File System Access specification](https://wicg.github.io/file-system-access/)
defines secure-context and transient-user-activation requirements. The feature
is detected at runtime; direct directory access is not assumed from the browser
name or a stored pathname.

The fallback is `<input type="file" webkitdirectory multiple>`, without an
extension filter. It imports the `webkitRelativePath` hierarchy but does not
receive writable handles and cannot represent empty directories. The preview
explains these limits and offers the same full-card download/insertion workflow.

This browser feature does not register an operating-system virtual drive or
mount an SD block device onto a host path. Such a mount requires a native helper
and exclusive block-device ownership; it is a separate host integration from
the explicit browser directory snapshot.

## Verification

- `node tests/sd-directory.mjs` covers recursive reads, empty directories,
  arbitrary extensions and bytes, deterministic collision-free aliases,
  fallback paths, bounded capacity, a 440-entry batch tree, rollback, 32 MiB
  geometry, original-name write-back, external edits/deletions, changes after
  preview, directory conflicts, permission denial and partial failures.
- `node tests/sd-files-controller.mjs` checks that the mounted card stays in the
  Worker until successful edit handoff and that stale/failed handoffs cannot
  replace a successor draft or lose an existing card. Its 86 checks also cover
  local-device ownership during connection/attachment, asynchronous read and
  confirmation races, translated rejection and retry after disconnect.
- `node tests/sd-worker.mjs` executes the production Worker handler with the
  actual WASM SD controller and a synthetic loop ROM. It checks exact 32 MiB
  export/eject handoff without advancing guest ticks, independent output bytes,
  malformed-card retention, internal-transfer and local-device exclusion,
  exact-media preservation, retry after disconnect and stale-generation rejection.
- `python3 tests/browser-sd-directory.py` uses Chromium's actual origin-private
  `FileSystemDirectoryHandle` and file streams. Only the native directory picker
  is adapted to return a test-owned handle; the native permission dialog is not
  automated. The second import uses the actual `webkitdirectory` input. The
  production React components and controller exercise import, mapping preview,
  insertion, ejection, explicit write-back with a preserved external conflict,
  re-read, narrow Chinese layout and 16-to-32 MiB capacity recovery. Worker
  acknowledgements are explicit fixtures; they do not count as stock-ROM proof.
- `python3 tests/browser-sd-files.py` passes 14 browser workflows, retaining the
  existing file editor flows and adding live-card exclusion while a local
  device connects/is attached. Draft editing stays enabled, the dedicated
  notice is translated, and disconnect restores all mounted-card controls.
- `tools/probe-sd-browser.py` drives the production page and Worker with the
  original HP49g+ ROM. It creates a card, writes and recalls an object in stock
  FILES, exports/restores the complete card in a v5 session, ejects it for
  editing, hides/reopens the sidebar draft and reinserts identical bytes. Its
  reload path lets remembered-ROM loading finish before accepting the separate
  automatic calculator-save restore.

The production probe exposed a sidebar retention issue that the simple component
fixture did not cover. Mantine's default Activity-based tab retention kept React
state but cleaned up effects while a panel was hidden, then reran the generation
reset effect when it became visible. This cleared the ejected draft. The real
Connections/SD tabs now use `keepMountedMode="display-none"`, preserving their
effects as well as state. The production regression explicitly checks the draft
after hide/reopen and verifies exact image bytes after reinsertion.

Private images, screenshots, browser results and original-ROM traces are kept
under ignored `build-r22/directory-sd/`. Original firmware validation is recorded
separately from browser API and UI fixtures in the
[r22 directory SD record](evidence/sd-directory-r22.json).

The 32 MiB image produced by `createDirectoryCard()` was accepted by the user's
unchanged HP49g+ NOR. Fresh original-system boots recalled both root `ANSWER`
and nested `PROGRAMS/NESTED` as 42; the stock Filer wrote `TEST` without changing
the prepared files. On the final r22 WASM, a version-5 checkpoint containing
34,087,787 bytes and 32 bytes of a sector staged
continued byte-identically on native and WASM. The same run exercised original
HP48gII FILES, return to HOME, and subsequent arithmetic, with no SD slot offered.
This uses the previously documented explicit SRAM decode profile and does not
claim a newly canonical hardware boot sequence.

mtools 4.0.43 independently listed and extracted both prepared objects and the
stock-created `TEST`. All three extracted byte sequences matched. dosfstools
4.2 `fsck.fat -n` returned 0 for both the generated 32 MiB volume and the volume
exported after the original firmware wrote to it, without repair requests.
The final v5 gate produced the same prepared and stock-written image hashes,
so those independent filesystem results apply to the identical final bytes.
