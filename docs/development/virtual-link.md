# Virtual PC connectivity

## User connection panel

Connections has a Files tab for bounded HP48gII USB object transfers and a
Raw data tab for a UART0 byte stream and individual USB packets. The original
Kermit client, setup, supported operations and stock evidence are described in
[file transfer](file-transfer.md). A transfer owns its chosen connection until
it completes or is cancelled; raw operations cannot interleave protocol bytes.
UART receive bytes and actual guest transmit bytes are
shown in a capped log; partial queue acceptance reports the accepted count.
USB connect runs bus reset, EP0 descriptor reads, SET_ADDRESS and configuration
using guest FIFO responses. Metadata is never invented from a model selector.
NAK/no response is retried within a virtual-time deadline, while STALL and
unsupported operations are reported. Bulk operations send/read individual
packets only and preserve controller ACK/toggle behavior.

The new production host was locally exercised with the original HP50g
boot-only fixture and existing explicit GPIO/keyboard conditions. It reads
VID:PID 03F0:0121, HP Company, HPx9G+ Device and bulk endpoints 81/03 with
64-byte packets. This is the bootloader recovery mode, not an original OS
file-transfer witness or a newly enabled user-model preset. Enter an applicable
guest transfer mode before connecting; unsupported modes time out visibly.
The original GET_CONFIGURATION NAK counterexample is not resolved by this host,
which does not issue that request during enumeration.

The page creates no OS USB/serial device and does not invoke WebUSB/WebSerial
to access real hardware. Complete Conn3x replacement, serial stock transfer and
HP39 typed-file upload remain open. The [HP39 format validator](hp39-files.md)
checks envelopes and bundle references without certifying opaque payloads.
Serial routing, FIFO timing and physical board connectors remain
separate from the UART0 host queue. Restoring a session disconnects host links.
See the [infrared assessment](infrared.md) for the next independent transport.

## Three different meanings

A usable link can exist at three different levels. Keep them separately named:

| Level | Meaning | Current status |
| --- | --- | --- |
| Host byte stream | The emulated UART exchanges bytes with a host adapter | Functional UART0 queues and CLI files/UI hex injection exist; stock protocols unverified |
| Internal virtual USB | Guest USB device controller talks to a modeled packet host inside Orchard | Functional PIO subset; bounded HP48gII Kermit object upload/retrieval; HP50g bootloader control and synthetic bulk evidence remain separately scoped |
| Host-OS virtual device | Windows/Linux/macOS enumerates a device that existing PC software can use | Not implemented; optional native companion work |

The first level does not imply the second or third. A UART channel inside the
SoC also does not prove that a given calculator board exposes that channel on
a physical connector.

## Current functional UART0

The native interface has bounded `orchard_uart_send` and
`orchard_uart_receive` queues. The CLI feeds `--uart-in` and drains
`--uart-out`; output creation is exclusive. Uncaptured CLI transmit bytes are
explicitly discarded. The web workbench accepts hex receive bytes and shows
hex transmit output. Its display log is capped and labels truncation; it is
not a lossless file-transfer adapter. The Worker drains transmit data every
bounded execution slice rather than tying I/O service to LCD repaint.

This is an error-free functional byte stream. Baud timing, a complete UART
FIFO model and stock serial file transfer remain unverified. The separate
[native host prototype](host-mode.md) has its own loopback socket tests.
Nothing currently creates an operating-system USB device or opens the user's
real USB hardware.

## USB architecture and current boundary

```text
Guest HP stock transfer code
  -> S3C2410 USB device MMIO / endpoint FIFO / IRQ
  -> modeled USB bus transactions
  -> virtual host reset + EP0 enumeration + bulk transactions
  -> transport byte stream
  -> HP39 typed-file or HP48/49/50 object transfer protocol
  -> browser file operations / native host adapter
```

[USB device research](usb.md) records the current original implementation,
143-step real-bootloader transcript and unresolved GET_CONFIGURATION request.
The declared endpoints and strings are obtained from the guest. Physical
VBUS/pull-up sensing, a browser USB interface and host-OS enumeration are not
provided by the logical packet host.

Use guest-provided descriptors. Do not fabricate VID/PID, endpoint layout or
successful enumeration from the selected model name. Implement bus reset,
address/configuration state, indexed endpoint CSRs, FIFO ownership, STALL/NAK,
interrupt acknowledgement, packet boundaries, SOF and disconnect/reset recovery.
Endpoint quirks must be established by traces or device documentation.

hpclang's [stock USB research](https://github.com/zyf722/hpclang/blob/main/docs/development/stock-usb-transport.md)
and [live development history](https://github.com/zyf722/hpclang/issues/1)
provide useful behavioral evidence: an internal S3C2410 host/device bridge can
exercise stock transfers without automating the Conn3x GUI. This is design
input, not permission to copy GPL-linked x50ng/QEMU implementation into Orchard.
The existing research's passed tests do not become Orchard passes.

## Native host-OS bridge, after internal transfer works

A separate, preferably small native companion may adapt an authenticated
local transport to PTY/TCP or a suitable OS-specific virtual USB facility.
WebUSB grants browser access to available devices; it is not a browser API
for making the desktop OS enumerate the tab as a new HP device. A native
bridge therefore needs its own driver/OS compatibility and security review.
The exact mechanism is intentionally not committed before a working internal
USB endpoint model and real stock transfer witnesses exist.

Keep network bindings loopback-only by default, require explicit connection
approval, bound all frame/queue sizes and reject stale session IDs. Do not
expose a raw emulator memory writer or arbitrary filesystem access to a PC
client. Closing/reloading a tab must tear down the link predictably.

## Acceptance

Validate enumeration using guest descriptors, real stock send/receive with
file/object hash comparison, all supported model formats, cancellation,
timeouts, partial packets, queue pressure, disconnect, reset and a responsive
post-transfer stock UI. Native host-OS enumeration and legacy PC software
interoperation require an additional witness; an internal transfer does not
close those checkboxes.
