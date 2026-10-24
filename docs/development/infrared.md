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

Each asynchronous receive is bound to its specific peer link, independently of
the calculator's machine generation. Disconnecting while the Worker is accepting
a packet in parts prevents an older retry from delivering its suffix to a new
pairing; late results and old promise completions cannot acknowledge or close
the new link. Already queued output chunks are combined up to 1,024 bytes before
the next send. One packet per direction remains in flight and the total queued
limit stays at 16 KiB. This reduces repeated browser round trips without changing
byte order, retaining unavailable reception, or adding a batching delay.

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

## Browser interruption and recovery

The production two-tab browser flow also exercises an interrupted stock
HP49g+ `SEND` / HP48gII `RECV`, manual Pause ending both peer links, Resume,
a fresh pairing code, and ordinary ON cancellation of the firmware's pending
commands. A new forward transfer recalls `ORCHARD = 12345` on the HP48gII;
the reverse transfer recalls `RETURN = 54321` on the HP49g+. Both 26-byte
objects are checked exactly from the original UART2 / IrCOMM traffic. Complete
IrLAP frames must pass their FCS before contributing data. The original Kermit
S/F/D/Z/B sequence, negotiated CRC16 file packets, EOF and each corresponding
acknowledgment are checked. Final Disconnect
ends both browser connections.

The maintained private acceptance tools are:

```sh
node tools/prepare-irda-browser.mjs dist/orchard.wasm "$PRIVATE_ROMS" "$PRIVATE_OUT/irda-ready"
python3 tools/verify-irda-browser.py --rom-dir "$PRIVATE_ROMS" \
  --ready-dir "$PRIVATE_OUT/irda-ready" --output "$PRIVATE_OUT/irda-browser" \
  --expected-wasm "$WASM_SHA256"
```

Set `CHROMIUM` to the browser executable and supply the exact SHA-256 of the
tested WASM. The preparation cold boots the admitted unchanged NORs and types
the initial commands through physical contacts. The browser restores those
private sessions through the normal file dialog, then uses visible controls
and skin keys, including the production pointer press/release path. Source
session and ROM hashes, built asset hashes, input actions, received bytes,
protocol checks and LCD screenshots are retained in the private report folder.
The browser does not inject Worker messages or act as either guest's protocol
peer. A passive observer reads actual Worker output. Screenshots allow review
of the recalled values as well as the automatic exact-byte checks.
Malformed IrLAP frames and Kermit packets remain in the report with counts while
the unchanged peers receive a bounded opportunity to retry. Invalid IrLAP frames
contribute no Kermit bytes. Only the complete checksum-valid file sequence and
matching acknowledgments, including EOF, can complete the transfer witness.

The test brings a tab to the foreground before clicking its keypad and polls
Worker progress independently of animation frames. Otherwise a background
tab's throttled animation-frame waits can delay the test driver's next SEND
long enough for the original receiving calculator's discovery to time out.
The application still keeps both paired guest Workers running while either
tab is in the background, with the ordinary pause-on-blur preferences enabled.

## Limits

This functional link does not access a physical infrared adapter. It does not
claim optical pulse timing, collision behavior, printer compatibility, or
complete coverage of every model. In particular, the existence of the shared
SoC UART does not establish infrared hardware on a calculator board. HP's
[39gs/40gs mastering guide](https://literature.hpcalc.org/official/hp39gs40gs-mastering-en.pdf),
pages 227–229, documents the HP39gs infrared choice and its absence on HP40gs.

The user's requested scope excludes further native host-device bridging.
Physical PC-IrDA adapters and operating-system virtual devices are not part of
this connection feature.
