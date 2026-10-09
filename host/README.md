# Orchard local host (experimental)

Requires Node.js 22+. No npm installation is needed in the packaged host build.
This runs a **separate calculator instance**, not the live browser tab. It does
not install drivers, modify services or require administrator rights to listen
on its default loopback ports.

```sh
node host/run.mjs --rom /path/to/39g+.bin --session /path/to/saved.ord --usbip 3240 --serial 8124
```

The documented original HP39g+ or HP48gII full NOR is required. The optional
`.ord` must match its exact ROM and model. Exporting a session from the browser
while the calculator is in transfer mode avoids another cold boot. The ROM file is not transferred as a host asset. USB data intentionally
carries whatever the guest firmware sends, which may include calculator user
data or other bytes requested through guest protocols.

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

Serial is a raw bidirectional byte stream, not a COM-port or PTY driver. A
separate trusted local virtual-port adapter would be required by software that
only accepts a named serial port. Do not expose the sockets on an untrusted
network; there is no authentication, TLS or multi-user isolation.

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
