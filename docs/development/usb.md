# Functional USB device and packet host

## Scope and evidence

The later [file-transfer client](file-transfer.md) adds original-ROM object
roundtrips through this packet interface. The r22 [live USB/IP relay](host-mode.md)
also carries real control and bulk transactions to the same running core.
The bootloader evidence below retains its original scope; the
GET_CONFIGURATION counterexample is now also reproduced on the complete
HP48gII and HP49g+ systems, as detailed below.

This continuation reconciles the locally validated `a9e03bd` patch onto
remote `80a1466`; issue #1 records its resulting CI/Pages acceptance. The production C
core and WASM now share an original S3C2410A USB device-controller subset.
A bounded packet host exchanges actual SETUP/IN/OUT transactions with guest
code. It does not supply descriptors, edit guest memory, skip instructions,
or create an operating-system USB device.

The implementation reference is the [Samsung S3C2410A manual](references.md),
chapter 13 (USB Device): register map/access widths, EP0 and bulk CSRs, FIFO
ownership, interrupt latches and software address update. No reference
emulator implementation is copied or translated into this module.

## Implemented interface

The HP39 ROM-stream continuation adds the older Samsung S3C2410X MAXP address
at `0x5200018c` alongside the S3C2410A address `0x52000180`. Both select the
existing indexed maximum-packet state. The 2003-04-28 S3C2410X revision table
and chapter 13-19 explicitly specify `+18c`; the 2004 S3C2410A manual specifies
`+180`. This is functional compatibility with both documented register layouts,
not a measured assertion that one physical chip simultaneously aliases both.
Source: [Samsung S3C2410X manual and revision history](https://www.sistemasorp.es/blog/S3C2410%20-%20datasheet.pdf).
Byte/word access, reserved-bit masking, endpoint isolation and reset are covered
by the shared native/WASM USB regression suite.

The unchanged hpclang ROM-stream applet writes both locations. After ordinary
HP39g+ stock-OS installation and physical key launch, its guest-generated Raw
HID descriptors enumerate EP1 IN and EP2 OUT as 64-byte interrupt endpoints.
The packet API then carries all 64 NOR blocks, each read twice, without a guest
memory patch. All 1 MiB match the input NOR; FINISH and physical disconnect
return to HOME and `1+1 = 2`. This uses explicit external GPF1 cable detection
in the developer harness, because the packet API does not infer board wiring.
See [the dump package and bounded witness](hp39gs-rom-dump.md).

`src/usb.c` supplies byte/word MMIO at the device block, indexed endpoint
state, five bounded FIFOs, EP0 control stages, and 64-byte single-buffer bulk
endpoints. Endpoint 0 accepts MAXP 8 or 16; the implemented bulk path requires
MAXP 64. Smaller bulk MAXP values need the documented two-packet buffering
model and are explicitly unsupported when used, not silently approximated.

Interrupts retain EP/bus pending state until their own W1C acknowledgment,
independently of main SRCPND/INTPND. Enabled USB requests reach IRQ25 through
the ordinary interrupt controller. FIFO writes do not invent a host ACK:
IN-ready stays owned by the USB side until the explicit host acknowledgment.
Repeated IN tokens without ACK reproduce the same bytes and DATA0/DATA1.
Duplicate OUT packets are acknowledged without a second delivery. Queue
pressure produces NAK; STALL, flush and toggle reset are separately modeled.

EP0 accepts guest-generated replies, multi-packet reads, status stages and
new-SETUP preemption. The address written by the guest remains pending until
the status packet is acknowledged at the old address. An early host status
OUT can end an exact-wLength read before guest DATA_END; SETUP_END then tells
the guest to retire that transfer. No bRequest-specific device emulation is
used: GET_DESCRIPTOR, SET_ADDRESS and SET_CONFIGURATION are guest handlers.

USB bus reset is distinct from machine cold reset. It resets controller state
and address, signals the reset event, but leaves CPU, SRAM and NOR untouched.
The reset assertion is explicit and idempotent. Cold reset clears diagnostic
counters and disconnects the bus. Logical disconnect makes transactions return
NO_RESPONSE; it does not claim to reproduce board VBUS or pull-up wiring.

### Public APIs

The C API exposes `orchard_usb_connect`, `orchard_usb_reset_signal`,
`orchard_usb_sof`, `orchard_usb_out`, `orchard_usb_in` and the side-effect-free
`orchard_get_usb_state`. USB packet results are a separate enum from emulator
stop reasons. For IN, the successful result means data is available; the
`ack` argument decides whether the host acknowledges and consumes it.

WASM exports the corresponding functions, a bounded 64-byte packet buffer,
received length/PID, and a pure 44-word USB snapshot. The existing CPU and
LCD/ADC snapshot layouts are unchanged. The native CLI reports USB state;
`probe-rom.mjs` v6 compares it with WASM without side-effecting MMIO reads.
The browser's internal USB host, file-transfer client and optional local relay
share these APIs; the relay does not run a second calculator core.

`orchard-usb-session`, built only with testing enabled and not installed,
replays text commands through the public API. Limits are 4,096 commands,
64 bytes per packet, 10 million quanta per run command and 100 million quanta
per process. It reads one exact-sized image, reads stdin and writes JSON lines
to stdout. It has no socket, arbitrary guest-memory write, filesystem output,
or implicit firmware download. `tools/usb-host.mjs` applies the same commands
in WASM and independently replays them twice through the native helper.

## Original HP50g bootloader experiment

Input: the archived, unchanged 16 KiB HP50g boot region, SHA-256
`dfa544617039e1bff0f62b9f51a943e57ff756d12bb81478de7aec41a5b73a28`.
The remaining 2 MiB backing is explicitly erased; **there is no OS and this
is not a recovered full NOR**. See [native inputs](native-roms.md).

Conditions: attached Apples keyboard, strong `D:cc7f:0,G:1:0`, weak
`G:f800:f800`, and key 1 at raw position (3,5), down at 2,000,000 quanta and
up at 2,400,000. The guest reaches its own USB recovery loop. The host then
connects, asserts/releases USB reset and issues control requests. LCD `+0x68`
remains strict in this boot-only experiment; no idle-zero read is required.

Observed guest replies:

| Item | Result |
| --- | --- |
| Device descriptor | 18 bytes, obtained as 8 + 8 + 2 data packets |
| VID / PID | `03f0:0121` |
| EP0 maximum packet | 8 bytes |
| Configuration descriptor | 32 bytes, with its header independently requested first |
| Bulk endpoints declared by firmware | IN `0x81`, OUT `0x03`, 64 bytes each |
| Manufacturer string | `HP Company` |
| Product string | `HPx9G+ Device` |
| String language | `0x0409` |
| SET_ADDRESS 7 | Status at old address completes; only address 7 responds afterward |
| SET_CONFIGURATION 1 | Guest completes its zero-length status response |
| Disconnect / reconnect / USB reset | Detached bus and old address do not respond; new address-0 descriptor succeeds |

The product string is deliberately not renamed to match the selected model.
Descriptors are parsed from guest FIFO output, not embedded in `src/usb.c`.
The accepted command transcript has **143 steps**, including unsuccessful
control probes. All exposed CPU/USB state and returned packets agree between
native and WASM, and each host's independent cold replay agrees. The complete
transcript was also replayed with the optimized ASan/UBSan native helper.

### Unresolved GET_CONFIGURATION response

After SET_CONFIGURATION, GET_CONFIGURATION still NAKs throughout the explicit
16,000-quantum diagnostic window. The guest writes one response byte but
leaves CSR0 at `0x08` (DATA_END without IN_PKT_RDY). A focused local trace finds
the guest CSR write value `0x49` at boot SRAM PC `0x080021e8`. The vendor table
states that the final data-IN packet is armed with IN_PKT_RDY and DATA_END.
The present model does not auto-arm a nonempty packet from DATA_END alone.

This is a concrete unresolved firmware/controller interaction, **not yet a
proven firmware bug or proof of the controller model's correctness**. A fresh
SETUP request recovers and returns the device descriptor again. Do not claim
complete Chapter 9 conformance, successful GET_CONFIGURATION, or full
operating-system enumeration from the successful descriptor/address requests.

```sh
node tools/probe-usb.mjs /private/boot-50g.bin /new/path/usb-control.json
ORCHARD_BUILD_DIR=build-sanitize-opt \
  node tools/probe-usb.mjs /private/boot-50g.bin /new/path/usb-control-sanitized.json
```

The tool verifies the admitted boot-region hash, preserves source and constructed
backing identities separately, records executable hashes and conditions, and
refuses to overwrite an existing report. No firmware enters the source tree.

## r22 original-ROM relay and EP0 investigation

[The source-bound r22 report](evidence/usb-original-bridge-r22.json) records a
separate integration witness using the production `BrowserHostBridge` module
inside Node, real loopback HTTP and USB/IP sockets, and the final production
WASM `51aded73e5d6cae3862fda4beec946118903dda97a39fccaa9fcf740214c8189`.
The original HP48gII and HP49g+ ROMs cold-booted independently. Physical key
input entered `CF(-33)`, `CF(-78)`, `SF(-35)` and `SERVER` for binary USB
transfer. No firmware, RAM, MMIO register or return value was patched.

This witness exercises the browser bridge module and its same-core pump in
Node. It does not by itself test browser network permissions, a production
page's Worker, an operating-system USB/IP driver or Conn3x. Production-browser
and host-driver evidence must retain their separate scope.

| Operation | HP48gII | HP49g+ |
| --- | --- | --- |
| Guest device and configuration descriptors through USB/IP | Exact guest bytes | Exact guest bytes |
| VID / PID; bulk endpoints | `03f0:0121`; IN `81`, OUT `03`, 64 bytes | Same guest values |
| SET_CONFIGURATION status | Complete, URB status `0` | Complete, URB status `0` |
| Kermit SEND of `OR22B`, an integer 42 object | Complete, 15 bytes | Complete, 15 bytes |
| GET of the same stored object | Complete; all 7 object-body bytes equal | Complete; all 15 file bytes equal |
| Binary file header on GET | `HPHP49-C` becomes `HPHP49-B` | Remains `HPHP49-C` |
| Final emulator stop status | `0` | `0` |

The sender waits for the firmware's complete initial Kermit response before
its first bulk OUT. USB NAK remains pending; a timed-out IN URB is retried as a
new request. Application writes are reported accepted only after their actual
USB/IP OUT completion. The relay neither interprets the object nor substitutes
its bytes for the calculator's GET response.

### Why GET_CONFIGURATION remains unresolved

A separate control-only run sends GET_CONFIGURATION after SET_CONFIGURATION.
Both original systems leave one response byte in EP0, keep CSR0 at `0x08`, and
return NAK throughout the five-second virtual URB deadline. The relay reports
`-110` with zero transferred bytes. A fresh GET_DESCRIPTOR SETUP then succeeds
and returns the exact original descriptor; the core remains at status `0`.

Read-only MMIO instrumentation isolates the following original firmware writes.
The instrumented build has its own identity in the report and is not confused
with the production WASM used for the transport results above.

| Original system | FIFO write PC and value | CSR0 write PC and value |
| --- | --- | --- |
| HP48gII | `0x0000c54c`: response `1` | `0x0000c558`: `0x49` |
| HP49g+ | `0x0000e478`: response `1` | `0x0000e484`: `0x49` |

The guest reads CSR0 as `1`, preserves its low status bits, and combines
SERVICED_OUT_PKT_RDY with DATA_END. It does not set IN_PKT_RDY before the
deadline. This is not a packet discarded by the bridge or a slow HTTP response.
Both the [S3C2410A manual, chapter 13-12/13](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf)
and the [S3C2410X revision 1.2 manual, chapter 13-12/13](https://dtsheet.com/doc/424485/samsung-s3c2410x)
assign IN_PKT_RDY to MCU software and describe a final IN packet with that bit
and DATA_END set together. AUTO_SET is disabled in the observed configuration;
in any case the response is shorter than MAXP.

These sources and traces do not justify auto-arming a nonempty packet from
DATA_END alone. The r22 investigation therefore leaves `src/usb.c` unchanged.
It also does not establish a firmware defect or prove every undocumented
silicon behavior. Resolving that distinction needs an original-device USB/MMIO
trace or an authoritative controller clarification.

The ROM-free USB regression now explicitly checks that an unarmed last packet
continues to NAK without consuming its FIFO, that later MCU IN_PKT_RDY arming
releases the exact byte once, and that a new SETUP discards the abandoned packet
and recovers. Two request numbers and arbitrary payload values avoid encoding
a special response for GET_CONFIGURATION or a particular firmware. The USB
suite passes **54,175 assertions on native and WASM**.

## Bulk validation and remaining limits

An original ROM-free ARM guest handles USB reset and endpoint interrupts,
sends a synthetic control reply, and echoes 1/7/63/64/0-byte bulk packets
through actual guest MMIO instructions. Its 49-step native/WASM transcript
checks IRQ returns/WFI, payloads, toggles, duplicate OUT suppression, IN retry,
disconnect and cold replay. Separate directed C tests exercise all lengths
0 through 64 on all four bulk endpoints. These are **synthetic bulk tests**,
not an HP file-transfer, OS installation or bootloader-update success.

Explicit limits include DMA execution, isochronous mode, small-MAXP dual
buffering, automatic suspend/resume timing, physical USB clocks and analog
signaling, CRC/bit-stuffing, wire-level arbitration and full retry/error
injection. Some inactive DMA configuration fields retain values, but enabled
DMA or ISO operations stop. SUSPEND_EN can be stored; no automatic suspend
state is generated. `sof` supplies a frame number explicitly, not wall time.
The packet API models a complete valid OUT transaction, not a separately lost
OUT-handshake ACK or every retry of a completed control status stage.

Host-OS device enumeration, Conn3x interoperability, firmware installation and
canonical calculator hardware acceptance remain separate open gates. Original
object/file-transfer evidence is documented above and in the
[file-transfer client](file-transfer.md). The [conditional HP48gII HOME witness](startup.md)
alone is a disconnected-USB operating-system run, not additional USB evidence.
