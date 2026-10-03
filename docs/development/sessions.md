# Saved sessions

## Calculator use

**Save session** pauses the calculator, releases queued/held host keys and
exports a local `.orchard` file. Keep the file downloaded by the browser.
The page does not autosave, and it does not persist the ROM. To resume later,
open the same original ROM and choose **Load session**, then **Resume**.
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

The Worker pauses before encoding/import, binds asynchronous results to a
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
The current suite has **757 assertions per host**. Browser-envelope and
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
