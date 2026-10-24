# Infrared connections

**Connections → Infrared** pairs two calculator tabs on the same origin using
a shared connection code. Both tabs keep running while paired, including when
one is in the background. Choose the original calculator's infrared SEND and
RECV operations after pairing. Pause, reset, ROM/session replacement and
disconnect end the peer connection.

The relay exchanges decoded UART2 octets. The original firmware performs
IrLAP discovery, IrCOMM negotiation and object transfer. Ordinary `SEND`/`RECV`
is verified in both directions between the admitted original HP49g+ and
HP48gII ROMs, including exact object bytes, Kermit CRC16 acknowledgments and
recall on the recipient. Stock RS232/IrDA factory tests and return to their
menu also pass on the applicable admitted original HP39g+, HP39gs, HP48gII and
HP49g+ ROMs.

An explicitly paired link forwards bytes already emitted by UART2, including
the final bytes when firmware closes TX within the same execution slice.
Internal loopback remains inside the UART. The receive side accepts bytes only
while its UART is enabled and configured for infrared; it discards unavailable
reception instead of replaying it into a later operation. Transmit-side optical
encoding and waveform-dependent mode filtering are outside this byte transport.

The HP39g+/HP39gs HOME presets also pass actual aplet transfer in all four
same-model and cross-model directions. Their explicitly selected nGCS1 SRAM
mirror condition, exact-mode counterexample, and byte-for-byte stock export
checks are described in the [HP39 decoding section](uart-irda.md#hp39-family-sram-decoding).
Older sessions preserve their recorded exact decoder; export their objects
before Restart when moving to the current preset.

The implementation, board-net assumption, core APIs, original-ROM witnesses
and explicit limits are documented in [UART, RS232 and IrDA](uart-irda.md).
The [r23 evidence](evidence/uart-irda-r23.json) records the tested ROM identities
and results without publishing ROM-derived checkpoints or LCD images.

This functional link does not access a physical infrared adapter. It does not
claim optical pulse timing, collision behavior, printer compatibility, or
complete coverage of every model. In particular, the existence of the shared
SoC UART does not establish infrared hardware on a calculator board. HP's
[39gs/40gs mastering guide](https://literature.hpcalc.org/official/hp39gs40gs-mastering-en.pdf),
pages 227–229, documents the HP39gs infrared choice and its absence on HP40gs.

The user's requested scope excludes further native host-device bridging.
Physical PC-IrDA adapters and operating-system virtual devices are not part of
this connection feature.
