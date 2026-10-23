# Remembering local ROMs

**Settings → Storage → Remember local ROMs** remembers one admitted ROM per
calculator model and automatically reopens the most recently used one when
access is available. The setting is enabled by default. It is independent of
the optional automatic calculator saves, which remain disabled by default.

ROMs stay on this device. They are not uploaded, bundled with Orchard, or
included in exported `.ord` sessions. The application only reads the original
ROM file; it does not request write access to it.

## Original file or local copy

| Selection method | Stored record | What the next open reads |
| --- | --- | --- |
| Supported `showOpenFilePicker()` | A `FileSystemFileHandle`, model/hash identity and display name | The original file through `getFile()`, subject to browser permission |
| Standard file input | The selected `File` in browser IndexedDB, model/hash identity and display name | The saved browser-local copy |

The UI labels these as **Original local file** and **Copy stored in
this browser**. The fallback does not claim to remember a live filesystem path:
later changes to the source file do not change the saved copy. To replace it,
open the updated original again. A handle is also a browser-managed reference,
not a stored absolute path that can be used outside its permission boundary.

The picker is feature-detected. If it is unavailable, or the current browser
context rejects it, Open ROM uses the standard file input. Filename extensions
are unrestricted. Both loading paths still require the complete supported ROM
size and SHA-256 identity. A remembered handle is re-read and revalidated each
time; an edited, missing or inaccessible file produces a translated notice
instead of being silently accepted as the previous ROM.

## Permission and startup

At startup, a stored handle uses `queryPermission({mode: 'read'})`. Orchard does
not call `requestPermission()` automatically. If access is no longer granted,
the page displays a notice with **Continue reading**. That explicit user action, or the
record's **Open** button in Storage settings, may request read permission and
then open the original file. Browser permission persistence is not guaranteed.

Loading another ROM or selecting another model cancels an older automatic
request. Turning off **Remember local ROMs** also invalidates automatic reads
already waiting for file access, bytes or hashing. Turning it on again does not
revive those canceled requests. Explicit **Open** remains usable while automatic
recall is disabled. All of these paths preserve the normal replacement-memory
confirmation when a calculator is already loaded.

If an automatic calculator save exists for the reopened ROM, its separate
**Restore local save?** prompt follows normal ROM loading. Merely remembering a
ROM does not preserve its calculator RAM. Use a manual session or enable
automatic calculator saves when that state should survive a page reload.

## Controls and storage ownership

Disabling the switch stops automatic recall and new remembering. Existing
records remain visible for explicit Open. **Forget saved ROM locations and copies** removes
the saved references and browser-local copies for all models; it does not
delete original files, close the running calculator or delete calculator saves.
Future authorized opens can be remembered again while the setting is enabled.
The Forget action applies immediately; the switch follows Settings' normal
Apply/Cancel draft behavior.

`web/rom-storage.js` owns a separate `orchard-roms` IndexedDB database. Each model
has one versioned record and a shared last-model key. A read/write transaction
updates the model and last selection together. The controller supplies a current
selection/storage-generation check before a delayed database open can write.
Forgetting invalidates pending reads and earlier remembering operations before
clearing the store. Storage failure leaves an already loaded calculator usable
and reports that remembering failed.

ROM records are distinct from `orchard-sessions` calculator-state records and
from the SD directory association. The latter currently lasts only for the
page session; it is not persisted by the ROM switch. Browser data clearing,
private browsing and quota policy can remove or prevent local records, so the
original ROM remains the source for reopening them.

## Verification boundaries

`tests/rom-storage.mjs` exercises handle/copy identity, read-only permission,
startup without permission prompts, missing files, model selection cancellation,
disabled recall, Forget during a pending read, switch-off during pending file
and byte reads, explicit Open independence, and nonblocking storage failure.
The controller routing fixtures are distinguished from actual ROM admission;
they do not turn synthetic bytes into a supported ROM.

`tests/rom-storage-browser.py` uses actual Chromium IndexedDB and origin-private
`FileSystemFileHandle` objects across reloads. It verifies per-model records,
exact copy bytes, stale-write rejection, and re-reading updated handle contents.
Its origin-private handle is not evidence that a native picker permission
dialog was automated.

`tools/probe-local-workflows-browser.py` is the separate original-ROM production
probe. It uses the standard file input, actual Worker and local ROM copy,
reload/automatic reopen, the preference switch and Forget. Its reports retain
the exact build identity; component/storage tests do not substitute for that
stock-firmware result. `tools/probe-sd-browser.py` additionally exercises ROM
recall followed by a full-card automatic-session restore.

The Chromium [File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
describes storing file handles in IndexedDB and querying/requesting permission.
The [File System Access specification](https://wicg.github.io/file-system-access/)
defines the picker and permission boundary. Orchard detects capabilities rather
than promising identical permission behavior in every browser.
