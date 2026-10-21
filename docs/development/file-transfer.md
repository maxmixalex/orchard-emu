# Browser calculator file transfer

## Scope

The browser has an original, bounded Kermit client in `web/kermit.js`, with
UART and virtual USB adapters in `web/file-transfer.js`. It transfers through
the existing hardware input/output APIs and the calculator's own protocol
implementation. It does not inject an object into calculator memory or install
a replacement calculator-side server.

The current application boundary is the HP48/49 object family on the admitted
HP48gII model and HOME setup. Capabilities are checked per transport and operation:

| Connection | Upload | GET | Receive | Directory | FINISH |
| --- | --- | --- | --- | --- | --- |
| Internal USB | Yes | Yes | Yes | Yes | Yes |
| Internal UART0 serial | Yes | Yes | Not exposed | Not exposed | Not exposed |

The [serial validation record](stock-serial-validation.md) retains the original
zero-reply counterexample and the successful round trip after the UART0 TX-empty
level interrupt was implemented. Raw serial diagnostics remain separate.
HP39 typed files, catalogs and client/server
workflow are a separate application protocol. A Kermit ACK alone does not prove
HP39 object compatibility. Physical USB, host OS enumeration, Conn3x/Conn4x
interoperability, XMODEM, flash installation and complete remote file management
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

Limits are shared by the UI, controller and Worker:

| Boundary | Limit |
| --- | --- |
| One upload or received file | 2 MiB |
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

Receive results are withheld until every file has a valid EOF and the final
transaction packet has been acknowledged through the transport. An incomplete,
discarded, cancelled or failed transaction does not publish a partial download.
The receiver briefly retains the final ACK to answer a repeated end packet
without redelivering files. Starting another explicit transaction replaces that
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
`cancelled`, and `error`. Every terminal result has `active: false`. Events carry
both request and generation, so old events cannot replace a later session.

The selected transport is exclusive while the session owns it. Protocol bytes
do not also enter the raw serial log, and raw UART/USB writes cannot interleave
with an active file. Invalid transfer input reports an operation error without
pausing the calculator. Pause, ROM replacement, reset, checkpoint restore and
disconnect cancel the session. Automatic checkpoint capture skips an active
transfer. No protocol state is stored in an ordinary calculator session file.

The existing Worker core-call budget, scheduling policy and frame cadence are
unchanged. The transfer adapter is polled only while a session or its final-ACK
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
Multiple-file SEND remains a separate end-to-end case. Run the browser probe with
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
