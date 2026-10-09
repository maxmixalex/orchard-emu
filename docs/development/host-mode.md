# Local host-mode prototype

`host/run.mjs` exposes an independent Orchard calculator instance through a
loopback USB/IP server and a raw TCP serial stream. It is a working user-space
protocol prototype, **not yet verified OS-level device attachment or Conn3x
compatibility**. It does not connect to or silently control an existing browser
tab. Exporting a matching `.ord` session transfers calculator state explicitly.

## Use

After `npm run build`, run `npm run build:host`. The standalone package needs
Node.js 22+, the user's original ROM, and optionally a matching session; no npm
install is required inside the package.

```sh
node host/run.mjs --rom /private/39g+.bin --session /private/transfer.ord --usbip 3240 --serial 8124
```

Both listeners bind 127.0.0.1 only. The package does not install or load drivers,
change services, bypass signing requirements or expose an external network
listener. `usb` on standard input starts guest descriptor discovery after the
calculator has entered its own transfer mode. `tap`, `pause`, `resume`, `save`
and `quit` are documented in `host/README.md`. No firmware or private session
is included in the package. Driver/client setup requires a separate user
choice and verification step.

## Implemented boundary

The original MIT implementation follows the public
[Linux USB/IP protocol specification](https://www.kernel.org/doc/html/latest/usb/usbip_protocol.html).
It handles version 1.1.1 device-list/import, guest-supplied descriptors,
control/bulk submissions, fragmented TCP input, short packets, cancellation,
exclusive attachment and bounded queues. Successful cancellation sends
RET_UNLINK with -104 and suppresses the canceled completion. No descriptors or
success responses are fabricated to satisfy a client. Original guest NAK and
STALL behavior remains observable.

Limits: eight connected sockets, one importing client, 64 pending requests,
64 KiB per transfer, 128 KiB input and 256 KiB queued output. Only control and
bulk endpoints are supported. The serial listener is raw bidirectional bytes,
not a COM/PTY device; applications requiring one need a separate local adapter.
The protocol has no network authentication or encryption, so remote listening
is intentionally unavailable.

## Current verification

`npm run test:host` uses real loopback TCP sockets and generated ARM guest
programs with the production WASM. It checks fragmented DEVLIST, exclusive
IMPORT, control descriptors written by guest endpoint code, cancellation and
oversized-input rejection. The serial test exchanges binary bytes including
zero and 255 through an ARM UART echo program. It is rerun on the actual
standalone package to catch missing imports/assets. These guests do not contain
HP code. The USB descriptor test's VID/PID is deliberately 1234:5678, not HP.

The first actual adapter test found that VirtualUSB parsed but discarded raw
device/configuration descriptors, breaking host enumeration. It now retains
copies of guest bytes and clears them on reset. Existing browser USB tests
remain active. Endpoint-toggle reset addresses are normalized to endpoint
number rather than including direction bit 7.

## Remaining gates

The kernel virtual-controller boundary, OS enumeration, HP driver binding,
Conn3x discovery, bidirectional real object/file transfer and recovery after
cancel/detach remain unverified. In particular, the historical original 50g
GET_CONFIGURATION NAK is not converted into a fake reply, and this prototype
cannot yet be described as seamless PC connectivity. The next connectivity
gate is a real local USB/IP client attaching to the server, followed by a stock
firmware transfer-mode witness and an unchanged Conn3x transfer.
