# S3C2410A SPI controller subset

The four admitted original ROMs enter their factory-test version pages through
physical ON/F4. All then read SPI0 control at `0x59000000`; that formerly
produced an unimplemented-MMIO stop. `src/spi.c` implements the controller
semantics required at this boundary without substituting a self-test result.
Factory-test entry is not evidence that every factory test passes.

## Registers and clocking

Both channels provide low-byte SPCON, SPSTA, SPPIN, SPPRE, SPTDAT and SPRDAT
registers, at bases `0x59000000` and `0x59000020`. Aligned byte, halfword and
word accesses use the low-byte register; unsupported offsets and read-only
writes stop explicitly. Reset produces READY=1, SPPIN=2 and zero for the
other registers. No read advances virtual time.

Master transfers consume the existing shared PCLK stream. SPPRE selects
`PCLK / (2 × (SPPRE + 1))`; a byte takes sixteen half-clock intervals.
The eight input samples follow CPHA with MSB-first accumulation. Completion
stores the received byte, sets READY and raises interrupt 22 or 29 when
interrupt mode is selected. Polling mode does not raise that source.
CLKCON bit 18 and SPCON.ENSCK freeze/resume a partly completed master byte.
CPU issue policy and host rendering do not supply extra SPI clocks.

Writing TX or reading RX while a byte is active sets the collision flag and
preserves the active byte. Reading status clears the collision flag. With
TAGD enabled, an idle RX read starts another transfer of `0xff`. That TX
value is not a fabricated receive byte.

## External input and limitations

The MISO input uses the same GPIO/keyboard net resolver as ordinary pins:
GPE11 for SPI0 and GPG5 for SPI1, with the appropriate input mux selected.
Explicit external strong drives and enabled internal pull-ups determine
the sampled level. A floating input remains unresolved, and a conflicting
drive produces the existing GPIO-contention stop. Selecting SPI does not
disconnect a pad from a closed keyboard switch.

No external SPI device is attached. There is no TX-to-RX loopback, synthesized
device reply, generated test signature or ROM/RAM patch. The model does not
yet drive an external MOSI/SCK waveform. CPOL is retained and CPHA controls
relative sample edges, but pin-level clock output is not a claimed witness.
A disconnected slave receives no external clock and cannot finish a pending
byte. DMA, multi-master mode and changing a live transfer's format/prescaler
are rejected explicitly; ENSCK gating remains supported.

These are functional edge semantics. They do not establish board crystal
frequency, pad voltage, clock-switch transients or attached-device identity.
The primary register/timing reference is the
[Samsung S3C2410A manual, revision 1.0](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
sections 22-3/4/7–10, 7-21 and the GPIO mux tables in chapter 9. The original
[Linux S3C24xx SPI driver](https://code.googlesource.com/linux/torvalds/linux/+/c6e169bc146a76d5ccbf4d3825f705414352bd03/drivers/spi/spi-s3c24xx.c)
provides an independent hardware-use check for byte accesses and divider
selection. No implementation code was copied from it.

## Checkpoint and validation

Checkpoint v5 appends the following little-endian uint32 fields for each
channel: control, status, pin, prescaler, TX, RX, remaining half-clock delay,
half-clock index, and receive shift value. Channel 0 occupies bytes
4895–4930 and channel 1 occupies 4931–4966. The subsequent four bytes contain
the WDT hold count; RAM starts at 4971. Versions 1–4 import with both SPI
channels reset. Invalid fields, impossible READY/busy combinations and
unsupported mode encodings are rejected before the machine is changed.

`tests/spi.c` contains **5,069 assertions**, executed identically on native
and WASM. Cases include both channels, four CPOL/CPHA formats, independently
supplied `0x96` input bits against `0xa5` TX, exact edge counts at four
prescalers, collisions, TAGD, one-shot IRQ, clock gates, reset cancellation,
unknown/conflicting inputs, SPI direction changes on a shared EINT net,
disconnected slave behavior, fractional/faster
PCLK, and 76 partial-state checkpoint/reference-runner comparisons.
`tests/checkpoint.c` adds repaired-CRC corruption rejection and exact v4
clock-state preservation. The original-ROM entry/exit evidence is recorded
separately in [watchdog reset](watchdog-reset.md).
