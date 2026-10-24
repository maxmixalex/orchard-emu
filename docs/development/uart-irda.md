# UART, RS232 and IrDA

The core models the three S3C2410A UARTs independently. UART0 remains the
existing decoded serial connection; UART2 is available to a second calculator
instance for the original firmware's IrDA stack. The host transports octets.
IrLAP discovery, IrCOMM negotiation, Kermit and calculator object handling run
inside the unchanged ROMs.

## Sources and scope

Register semantics come from Samsung's [S3C2410A user manual, revision 1.0,
2004](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf), chapter 11
(UART), chapter 14 (interrupt controller), and chapter 9 (GPIO). The separate
[HP49GP_IO_PORT board notes](https://github.com/chwdt/x49gp/blob/master/HP49GP_IO_PORT)
identify the IrDA transmit net used by the explicit HP49g+ research board
attachment. Only that standalone pin document was consulted, not another
emulator's implementation. Its downloaded SHA-256 is
`2c010d556f0bd0e4d433fa26d5979790bf9cb5a8ea02a2d7cbd31dec0ef4efe2`.

The [HP49g+/48gII Advanced User's Reference](https://literature.hpcalc.org/official/hp49gplus48gii-aur-en.pdf)
documents `SEND`, `RECV` and flag -33, which selects infrared when set. The
offline transfer observer follows the CRC16 block-check format in section 6.3
of the [Kermit protocol specification](https://kermitproject.org/kproto.pdf).
It analyzes captured guest traffic after a transfer and sends no responses.

This is a functional, decoded-byte implementation. Baud divisors and clock
selection remain guest-visible registers, but no unmeasured UEXTCLK frequency,
serial bit waveform, optical pulse width, propagation delay, collision model,
parity fault or transceiver shutdown polarity is fabricated. Passing a firmware
diagnostic does not establish physical hardware timing accuracy.

## Implemented UART behavior

Each UART has separate one-byte holding registers or 16-byte RX/TX FIFOs, plus
bounded host staging and capture queues. The guest sees hardware buffer counts,
not the host staging depth. The staging queues have 1,024 bytes per direction
and provide host backpressure; an accepted staged byte has not yet arrived at
the chip. Callers must honor the returned accepted length.

`UFCON` receive reset clears the chip's current holding register/FIFO, receive
error state and receive event. It preserves future bytes in the host staging
queue. With RX still enabled, normal servicing immediately refills the empty
hardware buffer from that queue; with RX disabled those bytes wait for enable.
The reset does not affect TX or another UART. This distinction is covered with
identical streams submitted in one or several API calls before the same guest
tick, in both holding-register and FIFO modes. It does not establish a baud
timing model or guarantee arbitrary host batching will preserve every firmware
protocol's turnaround interval.

The implementation covers:

- Per-UART clock gates and RX/TX enables; 5–8-bit data masking and stored line
  format, infrared, clock selection and divisor fields.
- `UTRSTAT`, `UFSTAT`, FIFO thresholds and self-clearing FIFO reset requests.
- RX/TX pulse and level interrupt sources for all three channels, plus overrun
  error interrupt and clear-on-read error status.
- The documented `UCON` internal loopback bit. Only that bit can reflect a
  transmitted octet into the same UART. Ordinary IrDA transmission does not
  echo into the sender.
- Non-FIFO overrun replaces the unread holding byte; a full FIFO retains its
  unread entries and rejects the new byte, setting overrun in both cases.
- UART0/1 CTS input, delta-CTS status and CTS gating of transmission when AFC is
  enabled, provided the corresponding GPIO mux and electrical input are known.
  The nRTS output waveform is not implemented.

DMA modes, send-break, and enabled FIFO receive timeout explicitly stop as
unsupported. A FIFO timeout requires a defined baud-time model. UART2 has no
modem interface: its historically accepted zero write to the reserved `UMCON`
location is preserved; nonzero writes and `UMSTAT` reads are unsupported.
Invalid register offsets, an unserviceable full TX holding/FIFO slot, and host
capture overflow retain explicit failure behavior.

## Host API and routing

The C APIs are `orchard_uart_send_channel(machine, channel, bytes, length)`
and `orchard_uart_receive_channel(machine, channel, bytes, capacity)` for
channels 0–2. The existing channel-less APIs remain UART0 wrappers.

Production WASM exports `uart_input()`, `uart_output()`,
`uart_send_channel(channel, length)`, `uart_receive_channel(channel)`, and
`uart_snapshot(channel)`. The input/output buffers hold at most 1,024 bytes.
The snapshot is nine consecutive `uint32_t` values:

| Index | Value |
| --- | --- |
| 0–4 | ULCON, UCON, UFCON, UMCON, UBRDIV |
| 5–6 | Hardware RX and TX byte counts |
| 7 | UART clock gate enabled, 0 or 1 |
| 8 | Latched receive errors |

Explicit pairing selects a decoded-byte UART2 transport. Forward bytes already
emitted into UART2's external capture queue even if the guest disables TX or
changes ULCON before the Worker drains its next slice. The core's internal
loopback never enters that external queue. There is no separate transmit-side
optical waveform or mode filter: current register values cannot reconstruct
the line mode of a byte that has already been emitted.

Deliver only while the destination is clocked, configured for infrared, has
RX enabled, and is not in internal loopback.
Bytes arriving while the destination is unavailable must not be held until a
later unrelated receive operation. The browser relay applies this readiness
policy separately from the core's flow-controlled staging API.

The tab relay's version 3 messages preserve each output chunk's sender virtual
tick observed when a bounded core run is followed by draining UART output.
This is a batch timestamp, not an exact per-byte emission time or waveform.
Already queued chunks may share a host message, but their observed tick
boundaries remain separate segments. The receiving Worker schedules those
segments on its own guest clock. The first batch establishes a fixed
source-to-receiver clock mapping: later host/ACK delay does not move that
connection anchor forward. A late merged packet retains its internal observed
batch offsets from its actual first due tick; partial acceptance does not
extend that schedule or deadline. Later packets can catch up to the nominal
mapping. This policy cannot simultaneously preserve every cross-packet minimum
interval under arbitrary host delay or backpressure. It never parses IrLAP,
generates a peer response or assigns a guessed baud rate. Previously, merging the last discovery
frame with the following connection request could consume their entire gap:
both original calculators then reached their own SEND/RECV timeout despite
every byte having been accepted by the core. A fixed original-ROM witness
reproduces this with a 94-byte batch and a 143,552-reference-tick interval;
retaining that interval completes the actual transfer and object recall.

Each packet contains at most 1,024 bytes and 1,024 segments. Each direction
has at most eight packets in flight; unacknowledged and unsent bytes together
remain bounded to 16 KiB. The receiver queues them in order and can consume
already due packets in the same guest tick, without another main-thread
round trip between tiny fragments. Out-of-order completion callbacks only
acknowledge the completed contiguous prefix. The source timestamps must be
safe, monotonic integers. Queued source spans and a receiver's initial future
lead are each bounded to 12 million reference ticks, one functional second.
Each packet also has a finite guest-time deadline consisting of its scheduled
span plus one second for input backpressure. Actual guest-clock progress keeps
each queued request's host/peer liveness timers alive during a scheduled wait; it cannot extend
that guest-time deadline. A receiver checks readiness when each segment is due:
a temporarily disabled receiver does not lose a later, not-yet-arrived segment.
The count shown as received includes only bytes actually accepted by the core,
including when other segments in the consumed packet were discarded.

The controller and Worker use a separate connection epoch, even when the
calculator generation remains unchanged. Disconnect, Pause, reset, save and
restore clear transport segments that have not reached the core; delayed old
Worker output, progress and completions cannot enter a new pairing. These
future transport segments are not serialized as calculator state. When the
queue is empty and the hardware receiver is unavailable, its old clock mapping
is released; the source timestamp ordering and connection identity remain. A
subsequent receive operation establishes a fresh mapping. Temporarily disabling
RX while future segments are still queued does not change their scheduled
arrival or discard them early. This does
not roll back bytes already accepted into core UART buffers. Version 1 and 2 tabs
must be reloaded to pair with the current transport.

`tests/irda-worker.mjs` runs generated ARM instructions through the actual WASM
and production Worker. It checks send-then-disable and send-then-mode-change
within one slice, and confirms that internal loopback, an unpaired transmitter,
and disabled TX produce no forwarded output. This regression caught and fixed
the former loss of a valid final byte when its transmitter was already closed
by the time the host inspected its current registers.

The reproducible two-core witness runs each machine in 512 reference-tick
slices, then drains and routes its UART2 output. Both original firmwares change
UBRDIV from 312 during discovery to 25 after negotiation. These register values
are observations, not a measured line-rate claim. The firmware's own timers
handle discovery, acknowledgments and timeouts.

## Explicit HP49g+ board net

`orchard_irda_attach(machine, true)`, exported as `irda_attach(1)` in WASM,
attaches the board-note connection between GPE12/SPIMOSI0 and GPH6/TXD2.
Attaching is permitted for the HP49g+/50g profiles, but the original-ROM
witness currently covers HP49g+ only. The admitted `hp49-home` preset selects
it. Strict setup and other profiles do not silently acquire this connection.

GPIO output latches, supplied external levels, pull-ups and weak board bias
resolve on the shared net. Opposing strong levels report contention; opposed
weak levels remain unknown. With GPH6 muxed to a clocked, enabled UART2 TX,
the observable decoded-byte boundary has its idle level: low in infrared mode,
high for ordinary serial. Unsupported alternate functions stay unresolved.
This does not extend the generic GPIO fallback or implement SPI printing.

The concrete obstruction without the net is original HP49g+ `SEND` at ARM
PC `0x0000ccb0`, reading GPEDAT `0x56000044` with unresolved GPE12 mask
`0x1000`. The original infrared startup changes GPE12 to an input without a
pull-up, and a later whole-port read observes that bit. The explicit shared net
resolves the read without inventing a fixed input for every board.

Checkpoint v6 records the UART hardware state, all host queues and the board
attachment. Loading versions 1–5 initializes the newly modeled hardware queues
while preserving the caller's already selected board attachment, which those
formats could not express. Retained-reset paths preserve that attachment.
The browser's cold Restart reapplies its admitted preset after resetting the
core; a bare C `orchard_reset()` clears the attachment with the other SoC state.

## Original-ROM diagnostics

The private witness starts from cold reset, uses physical ON/F4 to enter
diagnostics, F1 to open the factory menu, then the model's numeric test key.
It checks the unchanged firmware's result frame and physical ENTER return to
the exact initial menu frame.

| Original ROM | RS232 | IrDA | Return to factory menu |
| --- | --- | --- | --- |
| HP39g+ | No RS232 item | `IRDA TEST OK` | Passed |
| HP39gs | `RS232 TEST OK` | `IRDA TEST OK` | Passed for both |
| HP48gII | `RS232 TEST OK` | `IRDA TEST OK` | Passed for both |
| HP49g+ | Card test occupies this item | `IRDA TEST OK` | Passed |

The original HP39gs RS232 test programs UART0 with ULCON `0x03`, UCON
`0x725`, UFCON 0 and UBRDIV `0x19`. Before this change its requested internal
loopback was ignored, leaving the test waiting. This local reproduction was a
hang, rather than the user's exact reported compatibility-stop symptom.
The original HP39gs IrDA test stopped at PC `0x00027d7c` on the unsupported
UART2 URXH read at `0x50008024`. It now runs the documented loopback. The
original code writes ULCON `0x43`, enables `UCON` loopback, compares the
received values, and clears loopback. The tests emit zero host TX bytes.

## Original-ROM peer transfer

Ordinary `SEND`/`RECV` succeeds in both directions between independent original
HP49g+ and HP48gII instances. The witness stores `ORCHARD = 12345` on HP49g+,
sends it to HP48gII, and recalls it there. It then stores `RETURN = 54321` on
HP48gII and transfers and recalls it on HP49g+.

The read-only wire observer verifies the filename, exact ASCII object bytes,
CRC16 checks of the F/D/Z/B packets, and the receiver's final acknowledgment.
Both original commands close their UARTs and return to HOME. There is no host
Kermit responder, injected PASS text, ROM patch or guest RAM edit.

## HP39 family SRAM decoding

Original HP39g+ and HP39gs SEND setup exposed a separate physical-address
boundary. With exact SRAM decoding, both same-model controls reach an ARM data
abort (DFSR 8, FAR `0x08040000`) before either instance emits a UART2 octet.
The fault is one word beyond the 256 KiB physical array. This eliminates
received IrLAP packet corruption and cross-version object negotiation as
explanations of this first fault.

The [HP39gs board modification report](https://www.cnblogs.com/yanye0xcc/p/14615965.html)
identifies a LY62L12816ML, 128K × 16-bit SRAM, but does not establish the board's
upper address or chip-select decoding. Samsung's memory-controller chapter
gives the nGCS1 window `0x08000000..0x0fffffff` and a generic finite-address-pin
SRAM connection. These support an explicit decode hypothesis, not a verified
HP board schematic.

The admitted `hp39-home` and `hp39gs-home` presets now select the existing
`bank1-mirror` decoder: low address bits select the same 256 KiB cells within
nGCS1. It adds no RAM, does not alter ROM or page tables, and does not alias
unrelated banks. Strict setup and the core's default remain exact. Historical
checkpoints also retain their recorded decoder; the UI does not silently
upgrade their board settings. Export objects before Restart to move an old
exact-mode save into a new session using the current preset.

The clean cold-start witness passes all four combinations: HP39g+→HP39g+,
HP39gs→HP39gs, HP39g+→HP39gs and HP39gs→HP39g+. Each run evaluates `2+3=5`,
uses SAVE to create `IRTEST`, enters `F1=12345`, and invokes the original IR
SEND/RECV menus. After both original commands close UART2, the witness exports
the source and received aplet through stock USB Disk-drive SEND. Their complete
620-byte HP39BinB files are identical (SHA-256
`37e3f8c07e00debcb5fa86cdf350292fe0fef330ddf4a51a4f2169548e50e222`).
The recipient's symbolic LCD also exactly matches the sender's expression
frame. Separate cold-mirror runs preserve the original factory-test PASS and
menu-return hashes. These are functional acceptance conditions, not a claim
that the hypothesis has been independently measured on either physical board.

## Reproduction and regression

Reproduce with original ROMs kept outside the repository:

```sh
node tools/verify-serial-selftests.mjs dist/orchard.wasm /private/roms /private/new-selftests
node tools/verify-irda-peer.mjs dist/orchard.wasm /private/roms /private/new-selftests /private/new-peer
node tools/verify-hp39-irda-peer.mjs dist/orchard.wasm /private/roms 1 2 /private/new-39-peer
```

The output directories contain private ROM-derived checkpoints and LCDs and
must not be published. The repository's
[r23 evidence](evidence/uart-irda-r23.json) contains hashes and factual results,
without ROM bytes or LCD images.

`tests/uart.c` covers all three register banks, FIFO/holding behavior,
interrupt sources, clock and mode gating, loopback, a two-machine 256-byte
peer exchange, CTS input, board-net contention, unsupported operations, and
checkpoint continuation. The historical r23 gate passed 3,331 assertions
natively, in WASM and under address/undefined-behavior sanitizers. The r25
combined 36e2 core expands this to 5,455 assertions, including future-input
preservation across hardware RX reset. Its [core continuation](core-next-r25.md)
and [validation record](validation.md) identify the build and full suite results.
Local sanitizer runs disable LeakSanitizer under the sandbox's `/proc`
inspection restriction. The combined-core local 23-suite pass and isolated
executable-bit repair/rerun remain separate from a clean hosted sanitizer gate.
