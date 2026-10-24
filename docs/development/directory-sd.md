# Local directories and two-way SD synchronization

Orchard maps a selected local directory to an independent FAT16 SD image. The
calculator reads and writes that image through its emulated SD controller. A
browser directory handle, the original-name mapping and the last agreed file
bytes are retained in IndexedDB, separately from ROM records and portable
calculator checkpoints. No guest objects or directory structures are injected
into calculator RAM.

## Workflow

1. Open **Connections → SD card** with an SD-capable calculator. With no card
   inserted, choose **Prepare card files → Choose local folder**.
2. Review the local/card path mapping and select 16 or 32 MiB. File contents are
   copied exactly, without extension filtering. Native directory handles also
   preserve empty folders. **Use this folder as the draft** saves the association;
   **Insert prepared card** transfers the image to the Worker.
3. Finish the calculator's current file operation before choosing **Sync folder**.
   The calculator is paused, and the Worker validates, copies and ejects the card
   within one synchronous operation. Only then is its filesystem edited.
4. The preview compares the last agreed version, current card and current local
   directory. Independent changes in either direction are selected automatically.
   Conflicts default to **Keep both unchanged**; choose **Use local version** or
   **Use card version** for individual conflicts. A directory choice includes
   its subtree. The preview explicitly counts deletions.
5. **Apply and insert card** performs the reviewed work. If every change succeeds
   and every conflict is resolved, the card is inserted and the previous running
   state is restored. An originally paused calculator stays paused. Failed or
   unresolved work leaves the ejected draft available for review, retry, download
   or manual insertion.

Before applying a mounted synchronization, **Cancel** or **Back** restores the
original card bytes, file name, write protection and in-memory directory
association. The Worker must acknowledge insertion before a previously running
calculator resumes; a previously paused calculator stays paused. Reset, model
replacement and session restore invalidate the old transaction.

Cancellation first restores the original card as the visible, downloadable
draft, including when a different folder has since been selected. A failure to
save the original association in IndexedDB is reported but does not prevent
reinsertion of that card. If insertion also fails, the original bytes remain
available for download and retry. Persistence errors can still require selecting
the original folder again after a later page reload.

The ordinary **Eject to edit / sync** path still permits file editing and
**Preview synchronization** without automatic reinsertion. Hiding the sidebar or
changing its tabs preserves the draft. The retained tabs use display-none
retention so that hidden React effects do not clear the draft.

On reload, a saved directory handle is read from IndexedDB without prompting or
reading its files. A restored/imported card is reattached only when its FAT volume
serial matches the remembered association for the same ROM hash. The correlation
serial is not a security signature. **Sync folder** explicitly requests permission
again if required. **Open <folder>** can prepare a fresh card from the remembered
directory. **Forget folder** removes the handle and baseline record.

Permission revocation, a moved directory, cleared browser storage, or failed
IndexedDB writes do not imply continued access. Errors are localized. A storage
failure during **Apply** leaves the current draft accessible and prevents the
automatic insert step from hiding the error. The cancellation recovery above
separately prioritizes restoring the original card. The fallback directory file picker imports a
snapshot only; it cannot write back or persist a writable handle.

## Three-way rules

| Change since the last agreed baseline | Result after review |
| --- | --- |
| Local side changed, card unchanged | Update the card |
| Card changed, local side unchanged | Update the local directory |
| Both sides now equal | Advance the baseline without a write |
| Both sides differ | Keep both or explicitly select one side |
| One side deleted an unchanged entry | Delete it from the other side |
| Directory deletion/type change versus an opposite-side child edit | Resolve the whole subtree as one conflict |

Renames are represented as reviewed creation and deletion. This avoids relying
on browser rename support outside origin-private storage. Selecting one side of
a conflict can overwrite or delete the other side; the default preserves both.
A successful path advances the common baseline. Unresolved or failed paths retain
the older baseline, so retries do not silently reinterpret one side as authoritative.
Matching folder deletions, or identical replacements of a folder by a file on
both sides, advance without a false subtree conflict. Completed folder-to-file
replacements remove obsolete child entries from the baseline, including paths
which are now unreachable beneath the file. A second preview is then empty.

Before any local mutation, the complete directory is reread and compared with
the preview. A changed preview is rejected. Each individual destination is then
checked again just before its write or removal. Removals are children-first and
always use `removeEntry(name, {recursive:false})`: a new external child prevents
its directory from being removed. A conflict or failed directory operation blocks
writes beneath it; independent paths can still finish.

The browser does not supply a whole-directory transaction or a lock against
native applications. Writes commit per file; a later failure does not roll back
already completed files. A failed creation may leave a new empty file. External
applications can still change a file between the last comparison and commit.
Finish external edits before applying a plan. Interrupted partial work is visible
in the next three-way preview and is never reported as an all-or-nothing success.
Cancellation is rechecked after asynchronous reads and before each new filesystem
mutation. An acquired but uncommitted write stream is aborted when cancelled;
a close or deletion which already completed is not rolled back.

## Media boundary and automatic policy

Synchronization runs only after an explicit action and only on an ejected image.
There is no live FAT rewriting, filesystem watcher, or background host write-back.
The automatic part is the mounted-card pause/eject/preview workflow and, after
successful review, insertion and restoration of the previous running state.
Guest filesystem caches cannot safely coexist with host-side FAT mutations.

The browser feature does not register an operating-system block device or mount
an OS drive at the chosen path. Native virtual-device integration is no longer
part of the product plan. Browser directory mapping uses the selected handle and
the controlled SD media boundary above.

## Names, limits and metadata

New card names use uppercase ASCII 8.3 aliases. Initially, direct short names
reserve their spelling before generated aliases such as `LONGFI~1.ANY`. Later
synchronizations reserve existing mappings first: a new local short filename
cannot steal a previously published long-name alias. Case/name collisions get
distinct aliases. Non-ASCII-only stems use `FILE~1` or `FOLDER~1`. Original local
Unicode names and extensions remain associated with their card aliases. New
card entries use their card names under the original local path of any mapped
parent directory. FAT long-name records are not created.

Reads are bounded to 32 directory levels, 16,000 source entries and 32 MiB of file
bytes. FAT16 metadata, cluster rounding, the 512-entry fixed root, and the editor's
16,384 on-disk-entry limit can reduce usable capacity. An import that does not fit
preserves the current draft; selecting 32 MiB rebuilds the already-read snapshot.

`reconcileSDTree()` validates and updates the desired complete tree in one private
image copy. It retains unchanged entries and their names, attributes and DOS
timestamps; rewritten files retain their entry metadata. Removed and changed
file chains are freed before new allocation, allowing same-size replacement on
a full card. Read-only entries are enforced. A capacity or format error leaves
the source image unchanged and occurs before any host writes.

## Browser APIs

The native picker runs on **Choose local folder** with read permission. Read/write
permission is requested on the explicit apply action only when the plan writes to
the local directory. Handles are structured-cloned into IndexedDB. The official
[Chromium File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
documents these handles, permission checks, persistence and writable streams;
the [File System Access specification](https://wicg.github.io/file-system-access/)
defines secure-context and activation requirements. Capability is detected at
runtime, never inferred from a stored pathname.

The fallback is `<input type="file" webkitdirectory multiple>` without an `accept`
filter. It preserves relative file paths but receives no writable handles and
cannot represent empty directories. It still supports full-card downloads and
insertion.

## Verification

- `node tests/sd-directory.mjs`: existing 68 import, alias, capacity, fallback,
  original-name and additive-API regressions.
- `node tests/directory-sync.mjs`: 102 focused checks for independent changes,
  bilateral deletion/rename, explicit conflict choices, subtree replacement,
  stale previews, late file edits, late arriving children, asynchronous cancellation before deletion/open/write/commit, partial failures,
  retryable baselines, matching subtree deletion/replacement, obsolete-child
  baseline cleanup, alias stability, metadata and transactional FAT rollback.
- `python3 tests/browser-sd-directory.py`: real Chromium OPFS directory handles,
  file streams and IndexedDB structured cloning. The production React controls
  and controller exercise import, original-name mapping, paused media handoff,
  two-way edits/deletion/conflict resolution, reinsertion, running/paused state,
  matching directory deletion/replacement with persisted obsolete-child cleanup,
  reload/reassociation, wrong-card rejection, forgetting, fallback input, capacity
  recovery and a 390px Chinese layout. Only the directory picker and Worker media
  acknowledgements are adapted; the native permission dialog is not automated.
- `tests/sd-files-controller.mjs` and `tests/sd-worker.mjs` retain their live-media,
  stale-generation, failed-handoff and exact-byte checks. The Worker test uses
  the real WASM SD controller with a synthetic loop ROM.
- `python3 tests/browser-sd-sync-cancel.py`: eight real-browser cancellation and
  recovery cases, including replacement folders, IndexedDB failure, simultaneous
  insertion failure and same-model reset/restore invalidation.

The [final r24 original-ROM browser witness](evidence/sd-directory-final-r24.json)
uses the frozen production Worker and unchanged HP49g+ ROM. The original FILES
reads host-created ANSWER as 42 and writes TEST to the card. A two-way preview
and apply copies LOCAL to the card and TEST to the real OPFS directory. A v7
full-card save/reload reattaches the original IndexedDB handle; AFTER then appears
in the exported media and original Filer. Cancel/Back preserve exact media,
protection and running intent. Only the directory chooser is adapted, so this
does not automate native operating-system permission dialogs. The separate
[v6-to-v7 browser migration](evidence/sd-session-migration-r24.json) retains its
earlier frontend identity and preserves all 16 MiB of the old card.

Earlier component/sync evidence is [r23](evidence/sd-directory-r23.json). It is
separate from the earlier [r22 original-ROM witness](evidence/sd-directory-r22.json):
the unchanged HP49g+ accepted a prepared 32 MiB card, recalled objects from root
and nested directories, wrote a new object in stock FILES, and round-tripped it
through a v5 checkpoint. Independent mtools extraction matched the expected bytes;
`fsck.fat -n` returned zero for generated and stock-written volumes. Those historical
results do not by themselves certify newly synchronized images or other firmware.
