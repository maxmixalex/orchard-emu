# Browser calculator file transfer

## Scope

The browser has an original, bounded Kermit client in `web/kermit.js`, with
UART and virtual USB adapters in `web/file-transfer.js`. It transfers through
the existing hardware input/output APIs and the calculator's own protocol
implementation. It does not inject an object into calculator memory or install
a replacement calculator-side server.

The HP48/49 client supports the admitted HP48gII and HP49g+ USB HOME setups.
HP48gII also supports UART0 serial; HP49g+ has no equivalent external wired
serial connector. The HP39/40 disk-drive server is described below. Capabilities are checked per transport and operation:

| Model and connection | Upload | GET | Receive | Directory | FINISH |
| --- | --- | --- | --- | --- | --- |
| HP48gII / HP49g+ internal USB | Yes | Yes | Yes | Yes | Yes |
| HP48gII internal UART0 serial | Yes | Yes | Yes | Yes | Yes |

The [serial validation record](stock-serial-validation.md) retains the original
zero-reply counterexample, the successful round trip after the UART0 TX-empty
level interrupt repair, and the subsequent production-browser witness for all
five operations and same-connection reuse. Raw serial diagnostics remain separate.
HP39 typed files and catalogs use the separate calculator-client workflow
implemented by `web/hp39-transfer.js`; they never pass through the HP48/49
object client. Physical USB, host OS enumeration, Conn3x/Conn4x
interoperability, HP48/49 XMODEM, flash installation and complete remote file management
remain separate gates.

## Protocol and limits

The engine uses short packets, stop-and-wait operation and the one-character
checksum. It negotiates an 80-character short-packet limit, quotes all control
characters, supports negotiated eighth-bit quoting and decodes repeat prefixes.
Long packets, sliding windows and attribute packets are not advertised. The
small packet limit follows the Kermit Project's HP50g USB compatibility advice.

An active transaction handles packet fragmentation, checksum failure, NAK,
retransmission, duplicate DATA, sequence wrap, EOF, end-of-transaction, remote
error and cancellation. Four retries and a five-minute virtual-time transaction
limit bound a stalled peer. Timers follow the emulator's existing functional
clock; these limits are not physical calculator timing measurements.

The generic packet reader uses length and checksum framing. The HP USB profile
also consumes the requested CR terminator and holds its first OUT until a valid
initial NAK, Send-Init or Init packet has arrived in full. It then allows one
ordinary guest slice before writing. All received packets still reach the
protocol engine; an incoming Send-Init is never thrown away by readiness logic.
A 30-second virtual-time limit bounds that initial wait. Subsequent operations
on the same connection retain readiness. Cancellation, failure and reconnection
clear it. This does not add a timer, change the core execution budget, or impose
an arbitrary fixed delay on every packet.

Transfer and upload-batch limits are:

| Boundary | Limit |
| --- | --- |
| One upload or received file | 2 MiB |
| One selected upload batch | 16 files / 8 MiB total |
| Received files in one transaction | 16 |
| Aggregate received content | 8 MiB |
| Filename | 1–64 single-byte characters |
| Output packet queue | 8 packets |

Filenames cannot contain path separators, a drive separator, control characters,
leading/trailing whitespace, or Unicode code points above 255. Their character
values become single wire bytes; no UTF-8 conversion or promise about HP display
glyphs is made. The calculator remains responsible for its variable-name and
available-memory rules. The host's 2 MiB bound does not imply that a calculator
has that much free object memory.

Directory output has a separate 64 KiB limit for the entire transaction. Multiple
screen segments are combined only after the final ACK is accepted. Oversize
output fails rather than being silently truncated, and no partial listing is
published. Display text maps each received byte to one character; full HP glyph
or UTF-8 conversion is not claimed.

Uploads must begin with an HP48/49 binary-object header or an HP text-file
`%%HP:` header. This is a family/container check, not a complete parser or a
guarantee that the calculator can execute every uploaded program. ROMs, ZIP
archives and HP39 typed files are not accepted as HP48/49 uploads.
The chooser does not filter filename extensions. These checks inspect the
selected file's content; an unfamiliar suffix does not bypass or fail them.

### Optional transfer speed

**Use Unlimited during transfers** is off by default. When enabled, the Worker
temporarily selects Unlimited only while sending, receiving or processing an
active data operation. Waiting for a calculator RECV command, choosing from an
HP39 disk directory and waiting between Wire files retain the selected speed.
Completion, failure, cancellation, pause and machine replacement end the
override synchronously in the Worker. Changing the speed preference during a
transfer changes the value used afterward; switching this option off restores
that selected speed immediately. Normal's default and the emulated CPU clock
are unchanged. Protocol deadlines still use guest time.

The preference is independent of a transfer request. Request/generation checks
prevent an old error or completion from changing the pacing of a new transfer.
The actual effective speed and override status accompany Worker progress and
snapshots, so the UI does not have to infer completion to restore pacing.

### Uploading several files

The file chooser accepts multiple local objects. Each selected object has its
own editable calculator name; duplicate target names are rejected before
starting. The controller checks every name, declared size, total size, actual
byte length and file header before sending the first object. An invalid later
file therefore cannot leave an earlier file uploaded during preflight.

The batch reuses the existing single-file Kermit transaction for each object,
on either admitted transport. It waits for the preceding transaction's final
ACK before starting the next request. It does not add a multi-file wire protocol
or assume that enumeration means the original server is ready. Every object
gets a distinct request identifier, and late replies cannot advance a later
object. The UI retains per-file completion, failure, cancellation and not-sent
states, including the receiver's chosen replacement name when available.

If an object fails or the user cancels, the queue stops. Previously acknowledged
objects remain on the calculator; no automatic retry or rollback is attempted.
Later objects are marked not sent. Pause, a disconnect of the selected transport,
Worker failure and machine/session replacement invalidate pending work, including
local file reads still in progress. A different transport disconnect does not
cancel the active batch. ROM replacement clears its old result list.

Controller regressions cover both transports, complete-batch rejection,
16-file/8-MiB bounds, final-ACK ordering, stale requests, partial completion and
these cancellation boundaries. The offline browser component test exercises
multiple selection, editable names, acknowledgement-driven advancement and a
failed second object with a not-sent third. Those tests are not a stock-firmware
batch or physical-cable interoperability witness.

Separate original-HP48gII production-browser runs now cover both transports.
Each run uses the real multiple-file chooser to select two independently named
copies of the original 45-byte probe, edits their targets to `OR22A` and `OR22B`,
waits for both complete transactions, and obtains both objects through GET and
actual browser downloads. All four downloads contain the same 37 object bytes;
the only whole-file difference is the documented `HPHP49-C` to `HPHP49-B` header
revision. Each directory contains both target names, FINISH succeeds, and the
same connection is retained. The serial run never connects USB. Both runs have
no page/Worker error or diagnostic stop, and their six production asset hashes
agree. The [workflow evidence](evidence/file-workflows-r16.json) records report
and asset hashes, terminal operations and downloaded-object comparisons.
This establishes a two-object batch on the admitted firmware, not a
maximum-capacity or physical Conn3x acceptance claim.

The reusable `tools/probe-file-batch-browser.py` requires local private ROM,
session and object files, an explicit production WASM SHA-256 and a new output
directory. It also accepts a different second object via `--second-upload`.
Raw downloaded objects, sessions, screenshots and full reports remain local;
neither run changes instruction budgets or supplies a fabricated protocol ACK.

Receive results are withheld until every file has a valid EOF and the final
transaction packet has been acknowledged through the transport. An incomplete,
discarded, cancelled or failed transaction does not publish a partial download.
The controller passes the remaining received-file count and byte capacity into
the protocol before starting. Files retained from earlier operations therefore
reduce the current receive budget; an oversize transaction is rejected before
EOF ACK instead of succeeding on the calculator and being discarded by the UI.
The receiver retains the final ACK for twice the negotiated packet timeout to
answer a repeated end packet without redelivering files. HP39 FINISH replies
use the same bounded recovery for repeated G commands. This recovery deadline
does not slide forward with retries. Starting another explicit transaction replaces that
recovery window; callers should start a new operation only after completion.

## Using the calculator's original server

Keep the calculator running while transferring. On the HP48gII, select the
wired path, the intended transport and binary files before entering the server:

| Setting | RPN input | ALG input |
| --- | --- | --- |
| Wired connection | `-33 CF` | `CF(-33)` |
| USB connection | `-78 CF` | `CF(-78)` |
| Serial connection | `-78 SF` | `SF(-78)` |
| Binary objects | `-35 SF` | `SF(-35)` |

Then execute `SERVER` on the calculator, open the browser's file-transfer panel
and connect the matching transport. Wait for the connected status. Initial USB negotiation can
wait for the calculator's first server response; an enumerated USB endpoint
alone does not establish that the original server is ready for an upload.

- **Upload:** choose an HP48/49 object or a `%%HP:` text file and enter the
  calculator variable name, for example `OR49P`. A host extension such as `.hp`
  does not have to become part of the calculator's variable name. Completion
  means the calculator acknowledged the whole Kermit transaction.
- **Get:** enter the exact variable name that exists on the calculator. The
  complete received file becomes available for an explicit browser download.
- **Directory (USB):** ask the running server for its current directory. This helps
  locate a variable after an upload, including a name chosen by the calculator
  to avoid overwriting an existing variable. Directory navigation and deletion
  are not implemented by this client.
- **Receive (USB):** the browser can receive a file transaction initiated with the
  calculator's `SEND` command. With an established USB connection, end SERVER,
  select Receive in the browser, then send a named variable on the calculator
  (for example `'OR49P' SEND` in RPN). In ALG, prepare `SEND('OR49P')` before
  selecting Receive, then press ENTER on the calculator. This avoids spending
  the initial receiver deadline typing the command. An independent original-OS
  [active SEND witness](#calculator-initiated-send-and-same-connection-reuse)
  now covers the Receive button, real download and subsequent GET.
- **Finish (USB):** ask the calculator to leave SERVER. Readiness is cleared so a
  later upload cannot immediately write into the calculator's ordinary HOME
  input path. Enter `SERVER` again before starting another server operation.

The calculator's flag `-36` controls overwriting. With the flag clear, it can
preserve an existing variable and choose a numbered name for a received file.
The host reports a replacement name when the file-header ACK supplies it;
otherwise use Directory to confirm the stored name. This client does not change
that flag automatically.

Pausing, restoring a session or disconnecting cancels an active transfer. If a
cancelled operation leaves the calculator in a transfer screen, return to HOME,
enter `SERVER` again and reconnect USB before retrying. A completed binary
round trip may change only the HP binary-header revision, as shown below;
compare object content separately from the whole-file hash.

## Worker boundary

`file-transfer-start` carries `generation`, an increasing integer `request`,
`transport` (`serial` or `usb`), `mode`, and any `name`/`bytes` inputs.
`file-transfer-cancel` carries the same request and generation. Supported modes
come from `transferCapabilities(model)` rather than a UI assumption.

The Worker reports `file-transfer-status`, `file-transfer-received` and
`file-transfer-listing`. Status phases are stable translation keys:
`negotiating`, `sending`, `receiving`, `listing`, `finishing`, `complete`,
`cancelled`, and `error`; the persistent HP39 host additionally uses `serving`.
Every terminal result has `active: false`. Events carry
both request and generation, so old events cannot replace a later session.

The selected transport is exclusive while the session owns it. Protocol bytes
do not also enter the raw serial log, and raw UART/USB writes cannot interleave
with an active file. Invalid transfer input reports an operation error without
pausing the calculator. Pause, ROM replacement, reset, checkpoint restore and
disconnect cancel the session. Automatic checkpoint capture skips an active
transfer. No protocol state is stored in an ordinary calculator session file.

The existing Worker core-call budget, Pacer implementation and frame cadence are
unchanged. The optional transfer setting selects its existing Unlimited mode
for active data phases; otherwise it uses the persistent user speed.
The transfer adapter is polled only while a session or its final-ACK
recovery work is pending. There is no timer-driven guest-memory mutation.

## Original HP48gII observations

The local functional experiment uses the admitted full NOR with SHA-256
`4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937`,
model 4 and the existing conditional `hp48-home` setup. The baseline production
WASM SHA-256 is
`76db5cb395cca4fffec807a76d3e969bf4cd73842662e39e81e38de4110527d0`.
These are input identities, not redistributable fixtures or proof of all
physical board assumptions.

All setup commands were entered through physical-key APIs. `CF(-33)` and
`CF(-78)` select the wired USB path; `SF(-35)` selects binary transfer.
`SERVER` enters the original Kermit server. The guest supplies device,
configuration and string descriptors: VID/PID `03f0:0121`, bulk IN `0x81`,
bulk OUT `0x03`, with 64-byte packets. Descriptor strings are preserved as the
guest reports them. No descriptor is invented by the host.

A diagnostic sequence waited for the first complete server NAK, including its
terminating CR, and then advanced another 120,000 guest ticks before sending.
It successfully uploaded `OR13T` and obtained it with GET. This start condition
was a diagnostic sufficient condition; it did not establish a required 10 ms
hardware delay. The production `FileTransfer` subsequently completed the same
upload and GET from the freshly enumerated checkpoint, with no manual pre-wait:
it held the first OUT until the complete server NAK and used the next ordinary
1024-tick guest slice. No additional 120,000-tick delay was required. This run
advanced from tick 216344320 to 350434624 and both operations reached `complete`.

The payload is the independently generated read-only `OR49P` UserRPL probe:
45 bytes with source hash
`0c0eb8d3aa56744ec2b72597356b190fad2b7d5e8387c79c7fccf8351028562b`.
The returned file is also 45 bytes, with SHA-256
`abc9ff805e99b417f6f50116c212a8ec6ac592b9cff355408a7e0d63989d5389`.
The only differing byte is the binary-header revision: the uploaded
`HPHP49-C` becomes the calculator's `HPHP49-B`. The remaining **37 object bytes
are exactly equal**, with SHA-256
`0d389dbe9dfc2acd65a429a68090dc267e0d5700508407200170f4d8e8d05642`.
This is object-content equality, not whole-file hash equality. The original
strict whole-file diagnostic retains its `passed: false` result; a separate
summary records the successful object round trip and the precise difference.

A longer independently generated binary string contains 4,121 bytes following
the pattern `(index * 73) & 255`, covering every byte value. The complete input
file is 4,134 bytes, SHA-256
`bc94b817852d37deed39afa01b580fa6a93ddaa73e4ddda608ddd3c36f95fc48`.
It was uploaded and obtained with GET on the same established connection. All
4,126 bytes after the file header are identical, SHA-256
`0cee9ebe0baee175b4e8f16645fbed252d703397e1e58b819d443996f29c4897`;
again, only header offset 7 changes from C to B. The upload contains 96 DATA
packets, includes an observed sequence wrap from 63 to 0, and ends with a complete
64-byte DATA frame. That frame completes without a bulk OUT zero-length packet.
This establishes that boundary for this firmware and adapter; it is not a claim
about every HP USB product or arbitrary maximum-size object.
The preserved long-run report identifies protocol source SHA-256
`c073f8fe42f7008245c6518eac5ed567282ed782ebe27f3cc755ce8cb9ec53da`
and adapter source SHA-256
`eef17ccefe13f2732228ab826a05a3f6710e40f8e9bf5b0b9b72ab6b6bd643cf`.
Later directory-limit and FINISH-readiness changes have separate directed tests;
the earlier report is not relabelled as a run of their changed source.

The same stock server answered a directory request with 98 bytes of text that
included the uploaded test variable. FINISH received its complete ACK and the
calculator returned to HOME. A subsequent physical-key `1+1` input produced `2`;
this is an interaction recovery check, not a performance measurement.

Earlier diagnostic failures are retained locally. The first keyboard sequence
did not enter SERVER; another repeated-key sequence entered `-3` instead of
`-33`. Correcting those preparation steps did not alone fix initial negotiation.
The stock USB handler consumed all 16 bytes of the Send-Init packet, and the
server later returned a valid NAK in six one-byte bulk IN packets. This excludes
the specific hypothesis that the OUT FIFO stopped after half the packet. An
early-send run exhausted all four normal retries and ended in `error` after
about 24.8 virtual seconds. Waiting for CR, or CR plus one guest slice, did not
recover runs that had already sent the early initialization packets. Restoring
the same first-NAK boundary and host DATA PID state, then adding 120,000 ticks,
also failed to negotiate in its shorter observation window. In contrast, the
successful production run never sent those early packets. The evidence supports
the initial write gate, not a general 10 ms pacing rule or an unproven USB core
register change. The precise internal firmware cause remains unestablished.

Raw packets, calculator checkpoints and ROM bytes remain private local research
inputs. Successful transfer of the probe does not by itself prove its execution,
PEEKARM nibble order, 49g+ hardware behavior, or a complete flash extraction.

## Production browser and read-only probe witnesses

The [aggregate acceptance report](evidence/file-transfer-r13.json) records the
exact final production assets and separates each functional witness. A real
Chrome run used the production page and Worker, the original ROM file chooser,
a prepared HOME session, and physical on-screen keys to enter SERVER. It then
uploaded the 45-byte object, obtained it with GET, downloaded the actual browser
file, read a 99-character directory containing the uploaded variable, and
completed FINISH. All four operations reached `complete`; there were no page
or Worker errors and no diagnostic stop. The 37 object bytes match exactly,
with only the documented C-to-B transport-header change.

The final browser's immediate post-FINISH screenshot shows the subsequent `1+1`
input. It is not labelled as a completed arithmetic result. The separate
final-source stock continuation above supplies the settled HOME/result-2 witness.
Neither run measures input latency or physical clock speed.

In a further final-source stock continuation, the calculator executed the
uploaded `OR49P` through ordinary physical input, stored its result as a variable,
re-entered SERVER after disconnect, and returned the variable with GET. Both the
package decoder and an independent decoder recovered 16 bytes from its 32-character
hex string. They match the local HP48gII NOR prefix exactly; the opposite nibble
order does not. This verifies this program's object/command encoding and the short
read on this admitted firmware. Physical HP49g+ execution, SD storage and full-range
ARM-to-physical mapping still require the user's separate probe results.

Reproduce the browser witness with local private inputs using
`tools/probe-file-transfer-browser.py --start-server --server-commands` and its
required ROM/session/upload/output arguments. Output directories are new-only;
earlier failures and successes remain intact. The [serial validation](stock-serial-validation.md)
separately records its original counterexample and UART0 interrupt repair.

## Calculator-initiated SEND and same-connection reuse

A second production-browser witness uses the same six production assets recorded
above, including the unchanged `76db…` WASM, `84f8…` Kermit and `1fc2…` adapter.
The [active SEND acceptance report](evidence/usb-active-send-r14.json) preserves
their full identities and the private report hash. It starts from the same prepared
HOME session, uploads the original 45-byte object as `OR14R`, completes GET,
directory and FINISH, then enters `SEND('OR14R')` with ordinary physical UI keys.
The browser Receive button is selected before the command's final ENTER.

Receive completes and its actual browser download contains all 37 unchanged object
bytes. The physical keyboard then re-enters SERVER, and another GET and actual
download complete on the same USB connection. Both returned files are 45 bytes;
only the documented binary-header C-to-B revision differs from the original.
There is one successful USB enumeration and no later disconnect or reconnect,
no raw USB action, no page/Worker error and no diagnostic stop. No production
source or guest state was patched for this witness. The preceding direct-core
diagnostic independently completed the same single-file SEND/Receive/GET path.

This establishes single-file calculator-initiated SEND and connection reuse.
The later two-object host upload batch is covered above; calculator-initiated
multi-file SEND remains a separate end-to-end case. Run the browser probe with
`--start-server --server-commands --active-send` and a short uppercase alphanumeric
`--name` to reproduce it with private inputs. This is a functional check, not a
throughput or latency result.

## Verification

`node tests/kermit.mjs` checks an independently published packet/checksum vector,
all-byte encoding, fragmentation, negotiation defaults, corrupt checksums,
dropped ACK, duplicate DATA, sequence wrap, GET, final-ACK retry, cancellation,
discarded EOF, bounds and request isolation. Independent USB-peer cases cover
fragmented initial responses, S/I arriving first, no early OUT, readiness timeout,
cancellation and an initial NAK that has already been partly written. Pairing two local engines is useful
fault testing, but is not substituted for stock firmware interoperability.

`node tests/file-transfer-worker.mjs` executes the actual Worker handlers with
a deterministic core double. It checks invalid input without machine pause,
exclusive streams, stale request/generation isolation, cancellation at every
lifecycle boundary, and publication only after a complete transaction. Existing
Worker timing and pacing tests still verify unchanged no-transfer scheduling.

## Primary references

- [Kermit protocol manual](https://www.kermitproject.org/kproto.pdf): framing,
  checksum, negotiation, packet types, retries, turn-taking and optional pacing.
  Section 4.2 permits ignoring EOL when framing by length; consuming EOL for an
  HP USB implementation must not be described as a universal Kermit requirement.
- [Kermit packet reference](https://www.kermitproject.org/kpackets.html): the
  independent `test.txt` packet vector and field/transaction definitions.
- [Kermit Project HP transfer notes](https://www.kermitproject.org/hp48filetransfer.html)
  and [HP48 Kermit notes](https://www.columbia.edu/kermit/hp48.html): control
  quoting, binary objects, server operations and HP USB packet-size limits.
- [HP 50g / 49g+ / 48gII Advanced User's Reference](https://literature.hpcalc.org/official/hp50g-aur-en.pdf):
  SERVER, SEND, KGET, FINISH, PKT and the I/O flags. The native XMODEM server is
  a separate command and is not implemented by this Kermit client.
- [Samsung S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
  chapter 13: USB FIFO, endpoint ownership and interrupt semantics. No other
  emulator or GPL link-client implementation was copied into the MIT modules.

## HP39/40 disk-drive server

For HP39-family objects, the Files panel offers **Host selected files** and
**Receive from calculator**. Start the host service, then use the calculator's
RECV or SEND menu and **Disk drive…**. The calculator requests HP39DIR.CUR and
the selected directory, then individual objects and dependencies. No SERVER
command or HP48 object conversion is involved.

Select loose HP39 typed files to generate an in-memory directory, select a
complete package with its original directory files, or choose its ZIP directly. Directory aliases are
preserved independently of object titles, including `LIB275L` pointing to
`ARMToolbox39`. Every explicit reference, type, filename, size and complete
file is checked before publishing the catalog. Up to 16 objects plus two directory
files and 8 MiB are accepted; filenames are safe ASCII basenames of up to 64 bytes.
No host filesystem path is requested or opened by the calculator.

**Download package** creates a standard ZIP containing the received typed files
and catalogs. Original SEND exports omit `HP39DIR.CUR`; it is reconstructed when
`HP39DIR.000` is present, preserving the original directory aliases and object
bytes. The ZIP can be selected again in Orchard or extracted for Conn3x. When a
filename was received more than once, its latest version is included; earlier
versions remain individually downloadable. Missing referenced files are reported.

ZIP imports support stored and DEFLATE entries, verify CRC and declared/actual
lengths, and enforce the 2 MiB per-file and 8 MiB decompressed package limits.
The archive itself is limited to 32 MiB and 1024 directory entries. Selection
prefers `calculator/`, then the archive root or a unique HP39 catalog. With an
explicit catalog, only the catalog and its referenced calculator files are
decompressed. Without a catalog, bounded regular files in the selected directory
are inspected for HP39 typed headers; their suffix is irrelevant. No executable,
source tree or test folder is imported as a calculator object from a full release
package. ZIP identification also uses content, so a renamed archive is accepted
and a typed file whose name ends in `.zip` remains a typed object.
Cancelled reads cannot start a
later transfer. `tests/hp39-archive.mjs` independently checks ZIP interoperability
against Python's standard library, plus stock exports and controller lifecycle.

The server handles I/R requests, both Kermit transfer directions, repeated
packets, backpressure, missing files and FINISH. It remains active between
objects so that selecting an aplet can trigger its later library requests.
Received objects and all session/catalog limits are validated before EOF ACK,
including earlier files in the same uncommitted transaction. Files are published
only after final ACK.
Complete downloads remain available after Stop; interrupted files do not.
Pause, reconnect and model/session replacement invalidate the running server.

The real HP39gs 2.22 ROM exposed an additional Init-Info boundary: its USB IRQ
can consume the initial Y reply before the application enables its receive
notification. Repeating only the calculator's I request can reproduce the same
loss at each ordinary 8192-tick poll slice. The server now retains this initial
ACK and schedules a retry one guest second after the entire frame has been
written, backing off up to the negotiated timeout with at most four retries.
The following R/S/G command removes an unsent retry. A partly transmitted frame
finishes before the child transaction writes; cancel, failure and a fresh server
clear the state. This adds no sleep, extra core execution or per-packet delay to
a successful exchange. The [independent 39gs startup witness](hp39gs-startup.md)
covers cold-boot Disk installation of the V2 aplet and library, full native ROM
reading, return to HOME and reuse of stock USB. It does not claim a physical
serial or external Conn3x connection.

HP39 child transactions inherit the outer server's remaining 15-minute guest
time budget. They do not each obtain a fresh 15 minutes. The original five-minute
default remains in effect for HP48/49. This resolves the observed case in which
stock 39gs SEND was still making progress at 8,381 of 10,344 aplet bytes when the
old child default ended it. The subsequent independent cold-boot 39gs witness
completed that reverse transfer: all 10,344 aplet bytes match, the 1,484-byte
library export retains its original object body and `LIB275L` alias, and the
returned directory contains 65 bytes. Packet retry bounds remain unchanged;
the longer shared budget does not promise a particular wall-clock transfer speed.

Actual original HP39g+ USB evidence includes both directory files and the
7,373-byte `H39 ROM USB` aplet followed by its 1,489-byte library, installed
by the original OS with the package's distinct directory aliases intact.
Stock SEND then returns the complete aplet with identical bytes, the library
with its 1,468-byte object body intact under the stock-selected `LIB275L` title,
and the new directory. All three exports also equal the user's earlier stock
exports. For HP39, USB IN completion is given the next ordinary guest slice
before the dependent host OUT. This turn separation was sufficient in that
39g+ witness; the independent r20 39gs case above additionally needs bounded
initial-ACK recovery. Neither mechanism adds guest execution.
The [ZIP round-trip witness](evidence/hp39-archive-r18.json) also imports the
original full source ZIP, downloads the returned files as one ZIP, and installs
that downloaded package through stock RECV after a fresh cold boot in a separate
browser context. The restored aplet and library total 8,857 bytes; their object
bytes are preserved, and the APLET list shows `H39 ROM USB` again.
See [HP39 files](hp39-files.md) for exact scope and the separate 39gs/40gs
model-validation boundary.

## HP39/40 native Wire upload and visible progress

The Files panel now also offers **HP39/40 (Wire) — fast upload**. Select the same
complete ZIP, choose **Upload through Wire**, and select **RECV → HP39/40 (Wire)**
on the calculator for each displayed file. Libraries are sent first. The next
file waits for a fresh receiver handshake, and an item is complete only after
the final EOT ACK. This path uploads all selected binary objects; Disk drive
remains the choice for calculator-side catalog selection and all downloads.
Original catalog preflight, dependency references and input bytes are preserved.

The exact receiver menu is model-specific: HP39g+ shows **HP39/40 (Wire)**;
HP39gs shows **HP39/40 (USB)** on USB and **HP39/40 (Ser)** on serial. The UI's
mode, current-file hint and recovery instructions follow that selection. A menu
label alone is not a firmware/transport acceptance witness.
An independent complete HP39gs 2.22 ROM has now accepted its 1,489-byte library
and 10,344-byte V2 aplet through **HP39/40 (USB)**, recovered both through stock
Disk SEND with the equality checks above, then started the native aplet and
returned to HOME for `1+1=2`. The [39gs record](hp39gs-startup.md) keeps that
identity and scope separate from the original HP39g+ round trip below. HP39gs
serial, HP40gs and physical calculators are not covered by that emulated USB run.

A failed Wire file retains its original bytes and remaining queue. **Retry this
file** starts a new request for that file; **Skip this file** advances to a later
pending object. Neither action resends an already acknowledged object. The
failed filename and RECV/ON instructions stay visible with Connections closed.
After ON, wait for the receive screen to close before reopening RECV for the
current item; sending menu keys while the old receive screen is exiting can
leave the calculator in a different mode.
Unsupported loose files or local read errors can be retried or skipped during
preflight; explicit catalog/ZIP structural errors still reject the package.
Skipping a library does not satisfy the aplet's dependency on that library.

The original-ROM interruption test exposed old CAN bytes remaining in the
transport after ON cancellation. A new attempt now waits for its own D/C/NAK
handshake before treating CAN as a cancellation. It ignores earlier CAN/ACK/EOT
tail bytes without flushing the transport, so a new handshake in the same packet
is preserved. CAN after that handshake still fails immediately, and stale input
cannot extend the two-minute initial deadline. Protocol tests cover all three
handshakes, fragmented USB tail packets and the fixed deadline.

The [r20 recovery witness](evidence/hp39-transfer-r20.json) cold-boots the original
HP39g+ D1.55 ROM and imports the unchanged original ZIP renamed `.data`. A real
ON interruption after data sending begins produces CAN. The same library then
retries successfully with transfer-only Unlimited enabled. The next aplet is
also interrupted; skipping it preserves the completed library. Reselecting the
original aplet as `APLET.unlisted-suffix` installs it successfully, and cancelling
a later waiting request clears that queue. Stock Disk SEND then returns the
7,373-byte aplet unchanged, the library with its 1,468-byte body and `LIB275L`
alias preserved, and a 66-byte directory. The calculator returns to HOME and
displays `1+1=2`. Waiting, both errors, final ACKs and cancellation restore the
selected Normal speed; observed data stages use Unlimited only when enabled.

This functional browser run records WASM `1cffba4f…`, Wire `21b7151d…`, and
calculator bundle `648d8d65…`. Its Worker has a conditional stop diagnostic that
publishes the state already read by the normal snapshot path, without extra core
execution or reads; no stop occurs in the successful run. The later bilingual
ON/wait wording is a separate UI change, not retroactively part of that bundle.
The public record preserves the exact hashes and earlier failed attempts without
shipping ROM, session or screenshot contents. Worker/controller regressions also
cover user speed changes, disabling the option during data transfer, cancel while
boosted, pause, reset, model changes, local read/format failures and stale events.
Those fixture-based cases are distinct from the original-ROM actions above.

The new bounded `hp39-wire.js` sender accepts binary B/C/D/H typed files; actual
stock-ROM acceptance here covers the original B aplet and H library. Original
HP39g+ RECV requests HP CRC with `D` and acknowledges 128/1024-byte blocks.
The full browser witness cold-boots the admitted D1.55 ROM, selects the original
ZIP and runs at Normal (1×). From confirming RECV for the first library to both
objects being acknowledged took **13.1376 seconds**, including selecting the
second RECV. Other agents paused their heavy tasks for that window; this is a
single host/UI timing sample, not a dedicated-host or physical-speed guarantee.

The same stock calculator then returned its aplet, library and catalog through
**SEND → Disk drive…**. The whole aplet is equal to the input; the library's
1,468-byte body is equal and its stock `LIB275L` alias is preserved. An actual
downloaded ZIP was checked independently for CRC and exact files. That reverse
SEND/download/verification window still took **184.7162 seconds**: native Wire
improves the upload path, not every transfer direction. APLET listing and the
subsequent HOME `1+1=2` were visually checked. The full round trip is pinned to
the intermediate `25ceecb4…` production WASM in the [r19 evidence](evidence/hp39-transfer-r19.json),
with any final-build validation recorded separately.

Current Wire cancellation stops host output. If the calculator remains in RECV,
the UI tells the user to press calculator **ON** before retrying; already complete
files remain installed. No unverified remote CAN cancellation is implied.
Stock **SEND → Wire** begins a separate HP39BinI negotiation and reverses roles;
that session is not implemented as a native download. This is therefore a useful
internal upload workflow, not full Conn3x or desktop USB-device interoperability.

Progress remains visible above the calculator while Connections is closed:
current file, exact bytes, elapsed time and an idle hint. Updates are limited to
one per 250 ms while bytes change; completion is immediate. Unknown receive
totals still show received bytes. The previous 4 KiB-only threshold concealed
40 seconds of progress in the reproduced old Normal upload and every intermediate
update for its small library. HP39's Kermit sender additionally starts with a
one-guest-second adaptive reply timeout, measures only clean ACK round trips and
backs off on loss up to the negotiated timeout. HP48/49 defaults, HP39 receive
timeouts and core execution budget are unchanged. The evidence keeps the old
108.147-second Normal Disk drive upload, exact-state timeout experiments and
rejected pacing candidates separate from actual final-source browser validation.

The final `eb79a3bc…` production build then passed a separate cold original-ROM
Normal Disk drive upload of the same ZIP. From selecting the aplet to both
original objects being acknowledged took **49.8874 seconds**. The first aplet
progress update arrived after **0.3884 seconds**, with 96 intermediate updates
for the aplet and 17 for its small library. Screenshots confirm visible progress
outside Connections, `H39 ROM USB` in the installed APLET list and HOME `1+1=2`.
All recorded speed configurations are 1, no page/Worker errors or diagnostic stop
occurred, and the recorded assets were unchanged during the run. This was another
coordinated quiet window and a single interaction sample. Its final-build identity
does not replace the earlier complete Wire/SEND/ZIP round-trip identity.
