# HP39gs original full-NOR acceptance

The user's complete **HP39gs 2.22** capture is now admitted to the calculator
catalog as model 2. Its own bootloader and OS execute from cold reset without
ROM modification, SRAM injection or a host-side Saturn implementation.
[r20 evidence](evidence/hp39gs-startup-r20.json) keeps acquisition integrity,
native/WASM execution, browser interaction and native-reader return separate.
This is conditional functional acceptance; the board assumptions below remain
explicit.

## Received image and integrity

| Region or input | Bytes | SHA-256 |
| --- | ---: | --- |
| Complete NOR | 1,048,576 | `a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff` |
| Native boot region, offsets 0–16,383 | 16,384 | `fb4a3862a2ba9cf57746f6275e1c56c23719874a323784ff758240de342554d3` |
| Original acquisition JSON | — | `15c16b09ed89be0ee892bcf7b227d51bcb43f92003358667a9383b4e8d8102b6` |

Every supplied block index, offset, length and SHA-256 agrees with the image:
64 consecutive 16 KiB blocks cover the entire NOR. The metadata records two
equal reads per block, zero retries and sum32 `0x05ff4453`.

The user reports completing the physical capture with the V2 reader. The local
checks establish file/sidecar consistency and original-byte execution; they
are not an independent observation of the physical calculator, cable or
Windows driver. The original sidecar remains unchanged, including its
acquisition-time false boot/admission/mapping flags. New execution and catalog
decisions are recorded in separate evidence rather than rewriting that file.

## Earlier derived fixture

The earlier r19 fixture was an OS execution experiment. It combined the
official HP39gs 2.22 updater's OS payload with a publicly archived 50g/generic
16 KiB boot region and constructed tail backing. The updater transport header
was converted to an installed-NOR header. It was never the user's physical
full dump and was never admitted as an HP39gs calculator ROM.

Comparing that exact retained fixture with the new original image gives:

| Range | Bytes | Different bytes | Meaning |
| --- | ---: | ---: | --- |
| Boot, `0x000000–0x003fff` | 16,384 | 9,221 | The former generic boot area is different from the captured HP39gs bootloader. |
| OS, `0x004000–0x0f6fff` | 995,328 | 0 | The installed 2.22 OS bytes are identical. |
| Tail, `0x0f7000–0x0fffff` | 36,864 | 36,835 | Constructed backing is different from the captured contents. |

The identical OS region has SHA-256
`e9f4f8058f5d3c7649f7f000882316f1cd1b704d14ac8439b43f49948264bd20`.
That supports the old witness's narrow OS/aplet execution scope. It does not
turn the old fixture into native bootloader or complete-ROM evidence. All
current HP39gs admission checks use the newly received original full image.

## Current compatibility setup

| Setting | Value and boundary |
| --- | --- |
| Model memory | 1 MiB NOR and 256 KiB physical SRAM; current HOME preset explicitly selects the bounded nGCS1 mirror hypothesis |
| NOR component selection | `sst39vf800a`, an explicit part-identification hypothesis |
| Keyboard | Apples physical matrix and dedicated modifier switches |
| External inputs | GPD mask `0xcc7f` low; GPF mask `0x8e` low while disconnected; GPG0 low |
| Bias | GPG mask `0xf800` high |
| Analog inputs | ADC0 = 1023; ADC7 = 512 |
| LCD compatibility | Counted idle-zero read at LCD `+0x68`; packed-LSB memory interpretation |
| Browser preset | `hp39gs-home`, allowed only for this exact model/full-ROM hash |

The historical r20 startup witness used exact SRAM decoding and
198,000,000 virtual ticks. At 50 million ticks
it presses F6/OK at Memory Clear, then enters `1+1`, opens APLET and returns
HOME. Two independent native runs and two WASM runs agree on complete reported
state, peripheral hashes and the final frame. The result has stop 0, DFSR/FAR
0, zero SRAM-alias accesses and 12 counted unverified LCD reads. Its final
131×64 framebuffer SHA-256 is
`15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759`.

Separate physical modifier presses observe SHIFT at segment 1 and ALPHA at
segment 3, including release/toggle repetitions. This supports the model's UI
segment mapping, not an independent physical-panel wiring measurement.

## R23 serial and infrared continuation

Original RS232 and IrDA factory selftests now complete and return through
physical ENTER to the same factory menu. Their internal loopback uses the
S3C2410 UART registers; the host does not inject a PASS result.

Ordinary infrared SEND exposed an independent memory-decoding boundary:
exact-mode HP39gs reaches an ARM data abort at `0x08040000` before emitting any
UART2 byte. The same fault occurs with an HP39gs recipient, so this first fault
cannot be caused by cross-version negotiation or received packet contents.
The current `hp39gs-home` preset explicitly selects `bank1-mirror`, mapping the
same 256 KiB cells only inside nGCS1. This is a board-decoding hypothesis, not a
physical wiring certification; strict/core default decoding remains exact.

With that condition, cold startup, arithmetic, APLET editing, both factory
tests and menu returns pass. All four HP39g+/HP39gs sender/receiver combinations
transfer a named `IRTEST` aplet with `F1=12345`. Stock USB SEND exports from
source and recipient compare byte-for-byte, and the recipient's symbolic view
matches the sender. See [UART/IrDA evidence](uart-irda.md#hp39-family-sram-decoding)
and [current NOR writes](nor-write.md) for the independent flash-test work.

Existing saves retain their recorded decoder. For an older exact-mode session,
export the objects before Restart and import them after the current preset has
been applied. Restore preserves saved board configuration and diagnostic state.

## Browser and portable continuation

The production browser/Worker witness opens the original ROM through the file
picker, confirms Memory Clear, enters `1+1=2`, exports a 4× PNG and a version-3
session, computes `7×8=56`, and restores the saved LCD exactly. It also checks
traditional layout at desktop and 390-pixel width, then uses APLET and HOME
in immersive landscape. The arithmetic screenshots were visually reviewed;
a frame change alone is not treated as arithmetic correctness.

This browser run pins `calculator.js` to
`648d8d65d224e6e6f46afb16d9fbfe80bb068f96dc1c5b303b13827c570f8f5a`.
Two later recovery-help text changes produce bundle
`e01728750c5dcb210788e2f9392e7a3b484c72283b26061e5d265a3882897c93`;
the WASM, Worker and transfer-module digests remain the same. The evidence
records the actual tested bundle and does not claim this browser workflow was
replayed against that later UI bundle.

The core continuation probe saves at 160 million ticks after `1+1`, then sends
the same APLET/HOME switch events to uninterrupted and restored machines.
Their complete checkpoints are byte-identical. A further 50,000-tick native
resume also exactly matches WASM. The 271,071-byte version-3 checkpoint does
not contain a ROM and does not serialize host audio queues.

## USB installation and native-reader return

The original APLET → RECV → Disk drive client installs the unchanged V2
library and aplet through Orchard's USB/Kermit host. The admission run transfers
1,489 library bytes and 10,344 aplet bytes, then selects and starts the installed
aplet with physical keys. No entry address or guest RAM is patched.

The real full image exposed a phase-sensitive Init-Info exchange: the first
`Y` acknowledgement reached and was consumed by the device, but the original
client sometimes sent another `I` instead of proceeding to `R`. The host now
retains and retries that acknowledgement, starting its timer only after the
complete packet has been written. There are at most four active retries,
exponential backoff and the existing overall service limit. A subsequent
valid command removes an unsent retry; a partly sent frame finishes before
child-protocol data. This does not add guest ticks or wall-clock sleeps.

After a fresh cold-boot installation, the ARM reader enumerates as
`HP39 ROM Stream V2`, reads all 64 blocks twice and returns a complete image
equal to the original NOR. FINISH and cable disconnect return to the stock
OS; HOME evaluates `1+1=2`; reconnecting the original Disk client enumerates
`HPx9G+ Device` again. This is an independent original-HP39gs native entry,
full read, return and USB-reuse witness. It supplements the earlier HP39g+
and historical derived-OS checks in the [reader documentation](hp39gs-rom-dump.md).

## Direct USB upload and stock SEND round trip

A separate cold-boot witness uploads the unchanged V2 library followed by its
aplet using the production `Hp39WireSender`. On this original 39gs ROM, the
receiver is **APLET → RECV → HP39/40 (USB)**. Its label differs from the
HP39g+ `(Wire)` menu. Each object starts with a fresh RECV operation and
completes its data blocks and EOT acknowledgement. The aplet then appears as
**H39 ROM V2** in the original APLET list.

| Uploaded object | Payload bytes | USB OUT / IN bytes | Original-OS SEND result |
| --- | ---: | ---: | --- |
| `LIB275L.000` | 1,489 | 1,562 / 7 | `LIB275L0.000`, 1,484 bytes; library payload identical and `LIB275L` alias preserved. |
| `HPGCC000.000` | 10,344 | 10,424 / 13 | `H39ROMV2.000`, 10,344 bytes; entire file byte-identical. |

Both uploads negotiate `D` / CRC-16/KERMIT. Reverse verification uses the stock
**SEND → USB Disk drive…** path and also receives a 65-byte `HP39DIR.000`.
The library's exported header/title is rebuilt by the original OS, so the
whole exported library file differs while its payload and alias agree. Full
input/output hashes, physical switch events and protocol counts are retained
in the [public evidence](evidence/hp39gs-startup-r20.json).

This workflow exposed a separate duration bug: an HP39 child Kermit session
retained the generic 300-second limit even though its enclosing server allowed
900 guest seconds. The first run stopped after receiving 8,381 of 10,344 aplet
bytes while the original OS was still making progress; CPU stop and fault
status remained zero. Each child now receives only the **remaining time in
the original 900-second service budget**. Packet idle deadlines and the
four-retry limit remain active; neither a new child nor continued progress
renews that overall deadline. Generic Kermit transfers keep their default
300-second limit.

The corrected original-ROM run receives all three files in **405.407936 guest
seconds**, measured from host service start to the final file notification.
This is virtual execution time, not wall-clock throughput. The unchanged
production WASM is
`1cffba4fb7bbdf9a8b203dfd999fc5071f1bb773f665c5699725484575916db7`;
all seven host modules used by this run were also verified byte-identical to
their production `dist` copies. The evidence preserves the earlier timeout
counterexample alongside the final successful run.

After the round trip, normal START/ENTER switches launch the installed ARM
reader and enumerate `HP39 ROM Stream V2`. This test disconnects without a
ROM read, observes the expected **E03 CABLE LOST / ON CANCEL** screen, presses
physical ON to acknowledge it, returns HOME and verifies `1+1=2`. Its final
CPU stop and fault status are zero. The complete FINISH-based ROM capture
above is a separate witness. These results cover 39gs USB; serial, IrDA and
HP40gs still need their own runs. HP39g+ browser error-recovery evidence also
remains separate from this original-39gs protocol/native workflow.

## Reproduce locally

```sh
node tools/probe-hp39gs-startup.mjs /private/hp39gs-full.bin /private/new-startup.json
node tools/probe-hp39gs-checkpoint.mjs /private/hp39gs-full.bin /private/new-continuation.json
node tools/prepare-hp39gs-romstream.mjs /private/hp39gs-full.bin \
  /private/extracted-v2-calculator-files /private/new-installation
node tools/verify-hp39gs-wire.mjs /private/hp39gs-full.bin \
  /private/extracted-v2-calculator-files /private/new-wire-roundtrip --roundtrip
```

Build the native CLI/replay tool and production WASM first. `ORCHARD_BUILD_DIR`
can select a separate native build. The browser probe is
`tools/probe-hp39gs-browser.py`; the real Go receiver/ARM bridge is
`tools/test-hp39-romstream-stock.mjs` with `TestStockOSFullCapture`.
Outputs may contain private frames, RAM or card data and stay outside source
and Pages. The public record contains identities, counts, result hashes and
boundaries, not the original ROM or acquisition JSON.

The remaining model work includes broad native applications, sustained power/
keyboard behavior, independent physical clock/pad/LCD calibration and further
transfer/error cases. HP40gs and HP50g still require their own complete original
NORs and cannot inherit this model's acceptance.
