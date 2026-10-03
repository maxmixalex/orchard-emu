# Saved sessions

## Calculator use

**Save** pauses the calculator, releases queued/held host keys and
exports `<model>-<yyyymmdd-hhmmss>.ord`, using local wall time for the filename
only. Legacy `.orchard` files are still accepted: the validated format is
unchanged. Keep the exported backup. To resume later, open the same original
ROM and choose **Restore**, then **Resume**. Optional automatic local saves
are described below; the ROM is never persisted.
Restoring a saved HOME session avoids repeating cold boot and its prompts.
Restart still clears the current RAM; it does not delete exported files.

The file records RAM, internal SRAM, CPU register banks and CP15 state,
peripheral registers, pending interrupts, clock phases, ADC sample-and-hold,
UART/USB queues and NOR command state. It does not include the immutable NOR
image, UI timers, pointers or execution caches. Like a calculator backup,
it contains the user's calculations and any data in calculator memory; treat
it as private. Nothing is uploaded. A snapshot is not native warm reset,
battery-backed storage or continuation of an external USB host connection.

## Portable format and validation

The C API is `orchard_checkpoint_size/save/load`. The core format uses an
explicit little-endian field stream, not `memcpy` of a C struct. Native and
WASM share the schema. A 32-byte header contains `ORCHST01`, version 1, exact
length, model, ROM CRC32, physical SRAM size and a payload CRC32. The body
contains explicitly enumerated architectural scalars, active SRAM and the
4 KiB internal SRAM. The current 256 KiB machines produce **270,310 bytes**
before the small browser envelope.

The browser envelope (`ORCHARD1`) adds versioned JSON metadata with the exact
ROM SHA-256, model, compatibility configuration, display mode and state SHA-256.
Its metadata and payload lengths are bounded before decoding. These checks
provide integrity and identity, **not a signature or authentication**. Input
is still untrusted: core import stages small scalar state, checks booleans,
enums, queue cursors/counts, ADC/sample bounds, endpoint indices and other
index-bearing fields, and only then mutates the machine. Malformed data is
rejected without partial replacement. Buffers overlapping the machine and
incorrect/truncated/extra lengths are refused. The matched original ROM must
already be loaded.

No raw host pointers, padding bytes, translation memo, EINT memo or deferred
scheduler state is restored. Public execution boundaries materialize phases;
import invalidates the disposable host caches. Schema or incompatible
architectural changes must bump the format version or supply an explicit
migration. Do not silently accept a different layout. This first format has
no old-version migration requirement.

For manual save and every import the Worker pauses first, binds asynchronous results to a
machine generation and operation token, and leaves restored machines paused.
Its host input queue is empty on import; physical inputs are released rather
than resurrecting a stuck browser key. A failed import leaves the current
calculator paused and intact. File selection and downloads belong to the UI;
CPU/research details remain absent from the ordinary calculator page.

## Validation

ROM-free native/WASM tests cover every model's format size, full round trip,
in-flight ADC completion, continued execution, banked registers, internal and
external RAM, circular UART queues and partly consumed USB FIFOs. They reject
wrong ROMs, damaged/truncated files, every changed header byte, bad versions,
noncanonical booleans and invalid queue cursors even with a repaired checksum.
The current suite has **769 assertions per host**, including independent bitwise
verification of both CRC fields on all six models. Browser-envelope and
production Worker tests cover save/import/continued execution, exact ROM
binding, corrupted payloads and stale-generation isolation.

The optional local `tools/probe-checkpoint.mjs` cold-boots each unchanged ROM,
saves after `1+2=3`, runs the rest uninterrupted, then restores that state into
a fresh machine and repeats the remaining physical-key schedule. Both original
HP39g+ and HP48gII systems show `7*8=56`; **all serialized architectural state
bytes match** the uninterrupted run. A native process then imports the same
state and advances 50,000 ticks; its complete output checkpoint equals WASM's.
No private snapshot or guest-memory patch is used to produce the initial boot.

```sh
node tools/probe-checkpoint.mjs /private/rom-directory /new/report.json
```

Observed core import times in that local Node/V8 run were 6.35 ms (39g+) and
10.10 ms (48gII). They exclude file selection, ROM loading, compilation and
browser envelope hashing; they are not end-to-end browser latency claims.
The established final frame hashes remain unchanged. All prior board/LCD
hypotheses remain explicit; saved state does not certify physical hardware.

Actual browser-origin testing remains unavailable: the installed Chromium
still rejects the local HTTP origin with `ERR_BLOCKED_BY_ADMINISTRATOR`.
Its policy was not modified. Node Worker/envelope tests are not file-picker,
real download, touch, background-tab or sustained browser E2E acceptance.

The initial added button group collided with Pause/Restart on narrow screens
because both inherited a fixed grid cell. The dedicated session row fixes
that overlap. Offline Chromium HTML/CSS checks at 320, 390 and 720 pixels
reproduced the old collision; the corrected layout at those widths and 1360
pixels has no control overlap or horizontal overflow. The shipped selector
contract is guarded in `tests/session.mjs`. This offline rendering does not
replace the still-open browser-origin/file-picker interaction gate.

## Opt-in automatic saves

Settings / Storage enables localStorage snapshots at a chosen interval. One
latest envelope per exact supported-ROM hash is stored under Orchard's own
prefix. An automatic copy is taken only between core runs with no queued/held
host keys or active EP0 job. Unlike manual export it does not pause execution
or clear an input sequence. Hashing occurs on a copied buffer, and every async
completion is guarded by model generation, operation and request identity.

The next load of that same ROM offers Restore or Start new in a modal. Escape
dismissal preserves the old save and stays paused with autosave blocked, rather
than silently overwriting it. Selecting another ROM never imports the old one.
Import validates the existing state/envelope and leaves execution paused.
Host USB links are detached and serial subscriptions cleared: a restored core
state is not restoration of another program's USB transactions.

Each complete record uses one setItem operation. Web Locks serialize saves
when supported, with a compare-token check and storage-event detection of
foreign-tab updates. Without Web Locks the token check is best effort, not a
cross-tab atomic lock. A conflict stops autosave rather than intentionally
replacing another tab's latest snapshot. Quota/access failures are visible,
leave the preceding complete record intact, and do not disable manual export.
Deleting local saves touches only Orchard's own prefix and asks confirmation.

localStorage is synchronous and capacity/eviction policies belong to the
browser. Saves are therefore infrequent, not per animation frame. Periodic
copies are the primary safety net: a pagehide-triggered asynchronous snapshot
is best effort and may not finish before the document is frozen or closed.
No claim of zero-loss shutdown is made. Private/incognito storage may be
unavailable or cleared, and saved calculator data remains private user data.

The default is off. Neither settings nor autosave records enter deployed
assets. The [Web Storage specification](https://html.spec.whatwg.org/multipage/webstorage.html)
does not guarantee locking between agents; the
[Storage standard](https://storage.spec.whatwg.org/) describes quotas and eviction.

## Checksum cost

The current implementation uses a byte-table form of the same reflected CRC32
recurrence. It still reads and validates the complete NOR and serialized payload
on every operation; no stale identity cache is introduced. The wire format is
unchanged and checkpoints compare byte-for-byte with the previous implementation.
An interleaved local benchmark reduced core save/import times by roughly a third;
see [the validation record](validation.md#faster-checkpoints-unchanged-format).
This reduces the synchronous Worker copy/checksum interval, not every source of
browser/storage latency. CRC32 and the envelope hashes are integrity checks, not
authentication.
