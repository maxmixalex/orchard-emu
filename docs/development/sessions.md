# Saved sessions

## Calculator use

**Save** pauses the calculator, releases queued/held host keys and
exports `<model>-<yyyymmdd-hhmmss>.ord`, using local wall time for the filename
only. Legacy `.orchard` files are still accepted: the validated format is
backwards compatible. Keep the exported backup. To resume later, open the same original
ROM and choose **Restore**. A successful restore automatically resumes when
the current focus/visibility policy permits it. A saved compatibility stop
remains stopped; a visible paused bar provides **Resume simulation** whenever
execution is paused. Optional automatic local saves are described below.
Remembering a local ROM is a separate storage setting.
Restoring a saved HOME session avoids repeating cold boot and its prompts.
If a session was saved after the firmware powered off, Resume continues that
powered-off state; use the calculator's ON key to wake it.
Restart still clears the current RAM and preserves an inserted SD card; it
does not delete exported files. Restore replaces the current RAM and card.

Restoring also preserves the board conditions stored in the checkpoint. In
particular, an older HP49g+ session keeps its former exact-range SRAM decode;
the r19 FILES mirror condition is applied at a fresh ROM startup or Restart.
Back up wanted objects before restarting. See [SD cards and FILES](sd-cards.md)
for this compatibility boundary.

The file records RAM, internal SRAM, CPU register banks and CP15 state,
peripheral registers, pending interrupts, clock phases, ADC sample-and-hold,
all three UARTs and their queues, USB queues, SDI state, the complete inserted
SD card, pending NOR operations and changed 4 KiB flash sectors.
It does not include a complete immutable ROM image, UI timers, pointers or
execution caches. Changed flash sectors can include bytes derived from the
original ROM, so a session is private and must not be committed or published.
Like a calculator backup,
it contains the user's calculations and any data in calculator memory; treat
it as private. Nothing is uploaded. A snapshot is not native warm reset,
battery-backed storage or continuation of an external USB host connection.

## Portable format and validation

The C API is `orchard_checkpoint_size/save/load`. The core format uses an
explicit little-endian field stream, not `memcpy` of a C struct. Native and
WASM share the schema. A 32-byte header contains `ORCHST01`, version 7, exact
length, model, ROM CRC32, physical SRAM size and a payload CRC32. The body
contains explicitly enumerated architectural scalars, active SRAM and the
4 KiB internal SRAM. Without a card or modified flash sectors, 256 KiB machines
produce **277,644 bytes** before the small browser envelope; 512 KiB machines
produce **539,788 bytes**. An inserted card adds its complete image length.
Each modified flash sector adds 4,100 bytes: its 4-byte aligned offset followed
by 4,096 bytes of data. Version 2 added 52 bytes of
SDI state; version 3 added 709 bytes for media metadata and controller/FIFO/
partial-transfer state, followed by the card image. Version 4 appends 64 scalar
bytes for fractional PCLK phase, MPLL setup history, active PWM compares and
pending reload values. Version 5 appends **76 bytes**: two 36-byte SPI channel
states and a 4-byte watchdog reset-pulse countdown. Its RAM began at byte 4971.
Version 6 appends **4,377 scalar bytes**: 204 bytes of UART holding/FIFO, event and modem state,
4,128 bytes for UART1/2 host queues, one canonical IrDA board-attachment boolean,
40 bytes of NOR operation state and a 4-byte modified-sector count.
Version 6 RAM began at byte **9348**; the changed-sector records follow RAM, internal
SRAM and the optional SD image. Records are strictly ordered, unique and bounded
by the loaded model's NOR capacity.
Version 7 appends **2,056 bytes** for the architectural ARM920T TLBs: each bank
has its 4-byte CP15 c10 register and 64 explicit 16-byte entries (virtual/physical
bases, coverage mask, AP, domain, valid and preserved bits). RAM now begins at
byte **11404**. Lookup hints are host-only and are not serialized.
Exports always use version 7; the browser envelope remains version 1. The loader
continues to accept exact version-1/2/3/4/5/6 files. Legacy length, checksum, model
and field validation still apply.

Versions 1–3 did not record the clock/PWM state. Their migration preserves
existing registers, counters and RAM, initializes PCLK phase and pending
reloads to zero, takes active compares from the old TCMPB buffers, and infers
MPLL configuration only when the saved word differs from its reset value.
The old first partial timer cycle can therefore differ; old files remain
usable without a claim of cycle-for-cycle equivalence to the old timer model.
Version 4 and later preserve those states exactly. The complete clock layout and the
same-reset-value PLL ambiguity are documented in [runtime clocks](clock-ratios.md).

Versions 1–4 have no SPI or held-reset fields. Their imports initialize both
SPI channels to the documented idle register values and set the new countdown
to zero. Existing WDT registers/count/phase are preserved: a live older timer
can expire and execute the real reset-vector path. An older saved diagnostic
`status=14` remains stopped; import does not erase the historical failure.
Version 5 can resume a partly shifted SPI byte or any of the 128 reset-hold
edges exactly. See [SPI](spi.md) and [watchdog reset](watchdog-reset.md).

Versions 1–5 have no new UART hardware-buffer/event or flash-delta fields. Migration
starts those state machines idle, preserves the already represented UART0
host queues, and restores the immutable flash image. The host-selected IrDA
board attachment is retained because the older formats did not record it.
Version 6 preserves UART hardware buffers, interrupt events, modem state and queued UART1/2 data, an in-flight word program or erase, and suspended erase/program state. UART transport remains atomic decoded bytes; serial bit timing and FIFO receive timeout are not implemented. The ROM CRC remains bound to the immutable original input, independently
of subsequent flash programming. A load validates every record before restoring
the original array and applying its sector deltas. See [NOR writes](nor-write.md).

Versions 1–6 contain no architectural TLB state. Their migration initializes both
banks and CP15 c10 registers to zero; it does not invent mappings by walking the
saved tables. Subsequent accesses refill normally. Version 7 preserves a warm
translation even when the backing descriptor has changed or become invalid,
as well as replacement and preservation state. This can affect subsequent guest
execution, so comparisons must not discard these fields as a host optimization.
See [ARM920T translation state](arm920t-tlb.md).

The browser envelope (`ORCHARD1`) adds versioned JSON metadata with the exact
ROM SHA-256, model, compatibility configuration, display mode and state SHA-256.
Its metadata and payload lengths are bounded before decoding. These checks
provide integrity and identity, **not a signature or authentication**. Input
is still untrusted: core import stages small scalar state, checks booleans,
enums, queue cursors/counts, ADC/sample bounds, endpoint indices and other
index-bearing fields, card geometry, protocol state, bound media capacity,
PCLK phase, PWM reload invariants, SPI register/shift ranges and READY/busy
consistency, the reset-pulse bound, UART queues/shift counters and NOR operation
geometry/timing, and only then mutates the machine. Malformed data is
rejected without partial replacement. Buffers overlapping the machine and
incorrect/truncated/extra lengths are refused. The matched original ROM must
already be loaded.

No raw host pointers, padding bytes, translation memo, EINT memo or deferred
scheduler state is restored. Public execution boundaries materialize phases;
import invalidates the disposable host caches. Schema or incompatible
architectural changes must bump the format version or supply an explicit
migration. Do not silently accept a different layout. Legacy migration is explicit and is
covered on all six model capacities. Unknown versions remain errors.

For manual save and every import the Worker pauses first, binds asynchronous results to a
machine generation and operation token. Once import succeeds, the controller
resumes an unstopped machine under the current focus/visibility policy.
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
The suite includes independent bitwise verification of both CRC fields on all
six models, all five legacy-version imports, in-flight SDI/SPI/UART/NOR continuation,
nonzero PCLK phase, buffered PWM reload, held WDT reset and Power_OFF save/wake.
The v4 migration independently checks that nonzero phases and active/pending
PWM latches survive without the older reconstruction. Browser-envelope and
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

Actual Chrome file-picker/download tests now cover original-ROM sessions.
The historical r18 HP49g+ production-page witness saves a version-2 session, changes the guest
calculation, restores the saved session and compares every displayed RGBA byte.
It also opens the prior HP48gII ROM, imports an unchanged version-1 HOME session,
resumes execution and exports a version-2 replacement. These use normal UI
controls and do not inject guest memory. The r19 [SD card workflow](sd-cards.md)
extends the production-page test to version 3 and complete media preservation.
See [HP49 startup](hp49-startup.md).

The r21 [power witness](power-management.md) adds four original-ROM inactivity
shutdowns, exact powered-off v4 round trips and ON resume with the previous
calculation retained. A genuine r20 HP39gs v3 session also imports, completes
physical SHIFT/ON and ON resume, and accepts new arithmetic. These runtime
checks are recorded separately from the earlier browser-session witnesses.

Layout and lifecycle component tests cover narrow viewports separately. Neither
checkpoint identity nor one desktop browser run proves long-term browser-storage
reliability or physical warm-reset behavior.

## Opt-in automatic saves

Settings / Storage enables binary IndexedDB snapshots at a chosen interval.
One latest envelope per exact supported-ROM hash is stored in Orchard's
`sessions` object store. An automatic copy is taken only between core runs with no queued/held
host keys or active EP0 job. Unlike manual export it does not pause execution
or clear an input sequence. Hashing occurs on a copied buffer, and every async
completion is guarded by model generation, operation and request identity.

The next load of that same ROM offers Restore or Start new in a modal. Escape
dismissal preserves the old save and stays paused with autosave blocked, rather
than silently overwriting it. Selecting another ROM never imports the old one.
Import validates the existing state/envelope and automatically resumes when
allowed by the current policy. Host USB links and tab-to-tab infrared links are
detached and serial subscriptions cleared: a restored core state does not
restore another peer's protocol transaction.

The prior writer-token read and complete replacement share one IndexedDB
transaction, so competing writes remain atomic without Web Locks. A small
localStorage notification signals foreign-tab updates; it does not contain
the binary session. A conflict stops autosave and preserves the current
record. Quota/access failures are visible, leave the preceding complete record
intact, and do not disable manual export. Deletion clears Orchard's records
and asks confirmation.

Old localStorage saves remain readable and are removed only after a successful
binary replacement. When IndexedDB is unavailable, the legacy localStorage
fallback retains its smaller size bound and best-effort token check. It
refuses an oversized SD-card session before overwriting the previous save;
manual export remains available. The real-browser regression exercises
migration, a 16 MiB card-sized record, competing writers, cancelled generations,
reload and clearing.

Capacity and eviction policies belong to the browser. Saves remain infrequent,
not per animation frame. Periodic
copies are the primary safety net: a pagehide-triggered asynchronous snapshot
is best effort and may not finish before the document is frozen or closed.
No claim of zero-loss shutdown is made. Private/incognito storage may be
unavailable or cleared, and saved calculator data remains private user data.

The default is off. Neither settings nor autosave records enter deployed
assets. The [IndexedDB specification](https://w3c.github.io/IndexedDB/) defines
the transaction model. The legacy [Web Storage specification](https://html.spec.whatwg.org/multipage/webstorage.html)
does not guarantee locking between agents; the
[Storage standard](https://storage.spec.whatwg.org/) describes quotas and eviction.

## Checksum cost

The current implementation uses a byte-table form of the same reflected CRC32
recurrence. It still reads and validates the complete NOR and serialized payload
on every operation; no stale identity cache is introduced. That checksum optimization preserved the then-current format and compared
byte-for-byte with its predecessor. The later SDI and clock/PWM extensions
described above are explicit version changes, independent of the checksum implementation.
An interleaved local benchmark reduced core save/import times by roughly a third;
see [the validation record](validation.md#faster-checkpoints-unchanged-format).
This reduces the synchronous Worker copy/checksum interval, not every source of
browser/storage latency. CRC32 and the envelope hashes are integrity checks, not
authentication.
