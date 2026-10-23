# Local USB/IP host and live browser bridge

The standalone host package has two entry points, both using Node.js 22+ built-in
modules. It includes no drivers or firmware.

| Entry point | Calculator it serves | Local interfaces |
| --- | --- | --- |
| `node host/bridge.mjs` | The existing browser Worker, ROM, memory and SD card | Authenticated HTTP at `127.0.0.1:8125`; USB/IP at `127.0.0.1:3240` |
| `node host/run.mjs --rom /private/calculator.bin` | A separate WASM calculator | USB/IP and raw TCP serial |

The live bridge implements the connection to the current browser calculator.
Generated ARM programs and real HTTP/TCP tests exercise the transport and
guest-device boundary. OS attachment, HP driver binding and unchanged Conn3x
object transfers still require acceptance on a supported host computer.

## Connect the browser instance

Build with `npm run build` and `npm run build:host`, or unpack a matching host
artifact. From the package root, run:

```sh
node host/bridge.mjs
```

Keep the process running. Enter USB transfer mode on the calculator, open
**Connections → Local device**, copy the printed address/token and connect.
Once ready, attach a USB/IP client to bus `1-1` at `127.0.0.1:3240`.
The Node relay loads no ROM or WASM. All USB requests reach the running
browser core.

The default exact allowed origins are `https://maxmixalex.github.io`,
`http://127.0.0.1:8123` and `http://localhost:8123`. To serve another frontend,
supply its origin, including the port:

```sh
node host/bridge.mjs --origin http://127.0.0.1:9000 --origin https://my-calculator.example
```

Repeated `--origin` options replace the defaults. Paths, credentials, wildcard
and opaque/null origins are rejected. `--http` and `--usbip` choose the two
ports. The UI requires literal `127.0.0.1` with an explicit HTTP port and
rejects remote hosts, paths, credentials and redirects.

Chrome's [Local Network Access documentation](https://developer.chrome.com/blog/local-network-access)
describes the permission prompt introduced in Chrome 142 for public-site
requests to local and loopback addresses. Allow that permission for the
calculator page and retry when prompted. Other browsers or managed policies
can prevent the request. The translated error describes the process, address,
origin and permission checks; browser security policy remains enabled.
An explicitly allowed local frontend is another supported entry point.

## Ownership and reset behavior

`web/usb-device.js` contains the shared `GuestUSBDevice`; the earlier
`host/device.mjs` path re-exports it. The adapter uses actual guest FIFO/interrupt
APIs and `VirtualUSB` enumeration. It never executes CPU instructions: the
browser's normal Worker pump advances the same core and polls external USB
after each bounded CPU quantum.

Starting the bridge cancels internal transfer, clears the old USB host and
releases serial. Internal connect/raw bytes/file transfers, self-test chords
and autosave are excluded while the external connection is active. Calculator
keys and display remain usable. `hostBridge.active` temporarily suspends the
optional blur/hidden pause policy, so focus can move to the desktop client.
Explicit Pause still disconnects the device.

Pause, restart, ROM/model replacement, session save/restore, core stop and page
departure tear down the bridge. Closing the sidebar alone preserves it. Each
connection owns a fresh client object; callbacks retain their original
calculator generation. Tokens stay in page/Worker memory and are never saved
in preferences, sessions or URLs.

Rapid reconnect waits for the previous connection's HTTP cleanup. Session
creation has its own eight-second deadline: Stop can cancel USB immediately
while still receiving a newly allocated session identity and deleting it.
The next connection remains in its exclusive connecting state until that
cleanup finishes. An abruptly terminated Worker still relies on poll closure
or the bounded lease when it cannot receive the handshake reply at all.
The same lease fallback applies if a creation reply is permanently lost or
exceeds its eight-second deadline: without that identity, a retry may remain
busy until the 35-second session lease expires.

Natural USB/IP detach cancels pending requests and resets/re-enumerates the
guest bus. A forced browser/session drop closes its import immediately. An
aborted event poll also drops the session; a lease covers a page that disappears
before opening its first poll.

A guest watchdog reset clears USB diagnostic counters while retaining the
physical connected input. The live client detects the reset-counter decrease,
stops old URBs and requests closure of the old import. A new epoch enumerates
the restarted guest. Readiness returns only after real descriptors and
configuration transactions finish. The desktop client must attach again.
Old results cannot complete new URBs, and late old-epoch HTTP failures cannot
terminate the replacement device.

## Transport and limits

The Node process relays USB requests; it exposes no file, process, memory,
ROM-loading or script-evaluation endpoint. Both servers bind `127.0.0.1`.
HTTP uses a random bearer token checked in constant time, an exact Origin
allowlist and the expected Host. CORS allows only required methods/headers.
Responses are not cached; browser fetches omit credentials and reject redirects.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/session` | Claim the single browser session with protocol 1 |
| `GET /v1/events` | Long-poll submissions, unlinks, release epochs and attachment status |
| `POST /v1/device` | Publish guest descriptor bytes for the current epoch |
| `POST /v1/results` | Complete guest transactions by unique bridge identity |
| `POST /v1/reset` | Release an import after guest USB reset |
| `DELETE /v1/session` | Disconnect and release queued work |

Subsequent operations require a random `X-Orchard-Session` identity. USB/IP
sequence numbers can be reused after cancel; bridge identities remain unique.
Detach epochs also reject stale descriptor publications. An idle event poll
holds its response instead of repeatedly requesting an empty queue.

| Bound | Default |
| --- | --- |
| HTTP connections | 16 |
| Browser sessions / pending event polls | 1 / 1 |
| JSON request or response | 256 KiB |
| Event/result batch | 8 |
| Queued events | 128 and at most 6 MiB |
| Pending URBs / bytes per URB | 64 / 64 KiB |
| Empty poll / browser lease | 20 s / 35 s |
| Wall-clock URB deadline | 15 s |
| Browser event fetch / other fetch timeout | 30 s / 8 s |

The USB/IP implementation follows the public
[Linux USB/IP specification](https://docs.kernel.org/usb/usbip_protocol.html):
version 1.1.1 list/import, control/bulk submissions, fragmented TCP input,
short packets, exclusive import and cancellation. It bounds TCP connections
at eight, input buffering at 128 KiB and queued socket output at 256 KiB.
Control and bulk endpoints 1–4 are supported; interrupt/isochronous transfers
remain unsupported.

NAK stays pending until guest progress, cancel or deadline; STALL remains an
error. Successful unlink sends RET_UNLINK with -104 and suppresses canceled
RET_SUBMIT. ZLP and short packets follow actual guest FIFOs. The original
GET_CONFIGURATION NAK remains a firmware/core compatibility gate and is never
converted to an invented configuration reply. Local USB/IP TCP has no
authentication/encryption; the authenticated HTTP boundary does not provide
multi-user isolation between local OS processes.

## Desktop client boundary

The [usbip-win2 project](https://github.com/vadimgrn/usbip-win2) documents Windows
10 x64 1903+ and Windows 11 ARM64 support, protocol 1.1.1 and WHLK-certified or
attestation-signed drivers. Its [releases](https://github.com/vadimgrn/usbip-win2/releases)
provide a separate client installer. Installation and any required HP driver
are user-managed. Orchard installs no drivers and changes no signing policy.

The documented list/attach/detach command forms are in
`host/README.md` in the host package. Successful DEVLIST or user-space IMPORT
alone does not establish OS enumeration, HP driver binding or Conn3x support.
This development container has no `vhci_hcd`/`usbip_core`, `/lib/modules` or
`/dev/fuse`. OS attachment, Conn3x discovery, bidirectional object transfers
and cancellation/reconnect on that stack remain host acceptance gates.

## Separate command-line host

The existing independent calculator remains available:

```sh
node host/run.mjs --rom /private/39g+.bin --session /private/transfer.ord --usbip 3240 --serial 8124
```

Its stdin commands are `usb`, `tap`, `pause`, `resume`, `save` and `quit`.
The raw serial stream requires a separate local adapter for software expecting
a named COM port or PTY. See `host/README.md` in the host package. Original
ROMs, private sessions and third-party driver/reference emulator code are
excluded from the package.

## Verification

The [r22 bridge evidence](evidence/host-bridge-r22.json) records the exact source
and production-WASM hashes, tested runtimes, passing boundaries and remaining
host/browser-policy acceptance cases.

`tests/host.mjs` checks the independent host's real TCP USB/IP and ARM UART echo.
`tests/host-bridge.mjs` uses actual HTTP, the browser client module, USB/IP and
the same running production WASM. Its `ORCHARD_BRIDGE_TEST` ARM guest has real
bulk FIFO echo and a vendor request that writes watchdog registers. It contains
no HP code and reports test VID/PID 1234:5678.

The bridge integration checks token/Origin/Host, CORS, body limits, exclusive
sessions/imports, split TCP, device descriptors, SET/GET_CONFIGURATION, a
129-byte binary bulk round trip, ZLP, NAK/STALL, unlink/sequence reuse, real
guest WDT reset, re-enumeration, detach, process loss and session lease expiry.
Set `ORCHARD_HOST_ROOT` to run the same gate on an unpacked host artifact;
`CLANG` selects the generated-guest compiler.

`tests/host-bridge-client.mjs` holds HTTP responses across disconnect/reset
boundaries and checks old-epoch isolation. `tests/host-bridge-worker.mjs` tests
the real Worker/controller ownership handlers, source generations and
pause/reset/session/model/core-stop teardown. `tests/browser-host-bridge.py`
uses the real App/controller in Chrome for persistent sidebar actions, link
exclusion, focus continuity, localized retries and narrow layout. Its UI
fixture does not claim a network connection or OS attachment.

`tests/browser-host-bridge-network.py` separately exercises the actual Chrome
module Worker with production WASM, real cross-origin HTTP/CORS and TCP USB/IP.
It checks guest descriptors, binary bulk, pause with an outstanding IN,
immediate reconnect and cleanup after Worker termination. The page runs on a
local secure context; public HTTPS-origin local-network permission prompts
remain a separate browser-policy acceptance case. This gate caught the native
browser fetch receiver requirement, which the Node implementation does not
enforce; the client now binds fetch to its Worker global.

The [original-ROM bridge evidence](evidence/usb-original-bridge-r22.json) records
independent HP48gII and HP49g+ cold boots followed by physical flag/SERVER entry,
HTTP, the production `BrowserHostBridge` module, USB/IP and Kermit SEND/GET.
Both return the seven-byte integer-42 object body exactly; HP48gII returns its
native `HPHP49-B` header for the uploaded `HPHP49-C` object. That evidence uses
the browser client module in Node and the same production core, so it does not
stand in for a Chrome production-page or OS-driver result. Their descriptor
and SET_CONFIGURATION transactions succeed; the separate original
GET_CONFIGURATION request remains NAK and returns -110, then a new SETUP
recovers control transfers. See [USB](usb.md) for the register-level boundary.
