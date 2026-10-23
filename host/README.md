# Orchard local host (experimental)

Requires Node.js 22+. No npm installation is needed in the packaged host build.
The package offers a live browser bridge and a separate command-line calculator.
Both use loopback listeners. Driver installation is a separate, manual step.

## Connect the running browser calculator

```sh
node host/bridge.mjs
```

Keep the process running. Enter USB transfer mode on the calculator, open
**Connections → Local device**, paste the printed HTTP address and access token,
and choose **Connect local device**. When the panel says **Ready for a USB/IP
client**, the server offers bus `1-1` at `127.0.0.1:3240`.

The bridge forwards requests to the **same live Worker and calculator memory**.
The Node process loads no ROM or WASM. Every descriptor, control reply and bulk
packet comes from that calculator's USB controller and guest firmware. Internal
serial/USB transfer is released when the local connection starts; disconnect
the local device to use the built-in transfers again.

The default allowed origins are exactly `https://maxmixalex.github.io`,
`http://127.0.0.1:8123` and `http://localhost:8123`. For another frontend port or
self-hosted site, supply its exact origin, including the port:

```sh
node host/bridge.mjs --origin http://127.0.0.1:9000
```

Repeat `--origin` to allow several origins; these options replace the defaults.
`--http` and `--usbip` change the HTTP port `8125` and USB/IP port `3240`.
The HTTP address in the panel must use `127.0.0.1`. Every process start generates
a new token. It is sent in an Authorization header and retained in page memory,
never local storage or a URL.

Browsers may ask for local network permission when an HTTPS page contacts the
bridge. Allow the requested access for this page, then retry. Check the process,
printed address, token and allowed origin if connection fails. Browser security
policy remains enabled. See the
[Chrome Local Network Access guidance](https://developer.chrome.com/blog/local-network-access).

The calculator keeps running when focus moves to a desktop USB client. Pause,
restart, model changes, closing the page or losing the bridge disconnect it.
A guest watchdog reset releases the old USB/IP import and re-enumerates the
same calculator; attach the client again after it is ready. Closing only the
Connections sidebar preserves the connection.

### Desktop client

A compatible USB/IP client/virtual-controller driver and any required HP driver
must be installed separately. Windows users can evaluate the
[usbip-win2 signed releases](https://github.com/vadimgrn/usbip-win2/releases)
and follow its [client documentation](https://github.com/vadimgrn/usbip-win2).
Orchard does not install a driver or change Windows signing policy.
At the default USB/IP port, the documented client commands are:

```text
usbip.exe list -r 127.0.0.1
usbip.exe attach -r 127.0.0.1 -b 1-1
usbip.exe detach -p <port-reported-by-the-client>
```

Listing through a user-space client verifies only the server protocol. Actual
OS enumeration, HP driver binding and an unchanged Conn3x transfer remain
acceptance gates on a supported computer. The development environment has no
kernel virtual host controller and cannot establish those claims.

## Run a separate command-line calculator

```sh
node host/run.mjs --rom /path/to/39g+.bin --session /path/to/saved.ord --usbip 3240 --serial 8124
```

The documented original HP39g+ or HP48gII full NOR is required. The optional
`.ord` must match its exact ROM and model. Exporting a session from the browser
while the calculator is in transfer mode avoids another cold boot. The ROM file is not transferred as a host asset. USB data intentionally
carries whatever the guest firmware sends, which may include calculator user
data or other bytes requested through guest protocols.

This entry point opens its own WASM instance and the supplied ROM/session.
Both listeners bind **127.0.0.1 only**. USB/IP clients using a kernel virtual
host controller may inspect bus `1-1` and import it after enumeration. The
client/virtual-controller driver and HP driver must be supplied separately.
The server implements the Linux USB/IP v1.1.1 packet contract; an actual OS
attach and Conn3x round trip **have not been verified**. Do not treat a successful
user-space protocol test as installation of a Windows virtual device. Windows
support also depends on a compatible, properly signed USB/IP client driver.
No driver-signing/security-policy changes are part of this package.

Commands on standard input:

- `tap 40` sends F6 through the physical keyboard model. `tap 58,28` is an
  ordered Alpha/VARS sequence on HP39g+. Scan meanings are model-specific.
- `usb` connects/resets the guest bus and starts descriptor discovery. Enter
  the calculator's USB mode first. It refuses to reset while a client is attached.
- `pause`, `resume` control execution. Normal uses the functional timebase,
  not a calibrated physical clock. `--speed 0` explicitly requests unlimited.
- `save /path/to/new.ord` exports to a new file (no overwrite), leaving execution
  paused. `quit` closes both listeners and releases host keys.

The separate host's serial listener is a raw bidirectional byte stream. A
separate trusted local virtual-port adapter would be required by software that
requires a named COM port or PTY. USB/IP and raw serial are available only to
local processes; their TCP protocols have no authentication or encryption.

## Bounds and behavior

The live HTTP bridge admits one authenticated browser session, with one pending
long poll. Requests are capped at 256 KiB, batches at eight events and the queue
at 128 events / 6 MiB. Empty polls complete after 20 seconds, a missing browser
expires after 35 seconds, and a USB request times out after 15 wall-clock
seconds even if the browser cannot advance. Normal disconnect and aborted
polls release the client immediately. If a session-creation reply never reaches
the page, the unknown session is reclaimed by its 35-second lease.

USB/IP: one importing client, at most 64 pending requests, 64 KiB per URB,
128 KiB input buffering and 256 KiB queued socket output. Control requests and
bulk endpoints 1–4 use guest FIFOs/interrupts, including short packets, ZLP,
NAK, STALL, cancel and detach. Isochronous/interrupt endpoints are unsupported.
A successful cancel sends RET_UNLINK only, not a later RET_SUBMIT. Detach resets
and re-enumerates the guest; reconnection does not preserve another client's
in-flight requests. Errors remain errors: the original 50g bootloader's
GET_CONFIGURATION NAK is not turned into a made-up response.

The original emulator/host code is MIT. No firmware, skins, fonts, private
sessions, test programs, third-party virtual-device driver or reference
emulator implementation is included. See the repository's development/host-mode
and validation documents for the measured scope and outstanding gates.
