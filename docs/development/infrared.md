# Infrared assessment

**Useful, but not implemented or a prerequisite for the available HOME paths.**
Priority is complete stock USB/serial transfer and stable clock behavior before
a new physical-link model. Merely exposing an Infrared button would overstate
support, so no nonfunctional IR connection is advertised in the user page.

## Why it belongs on the roadmap

HP's *Mastering the hp39gs and hp40gs*, pp.227–229, describes calculator-to-
calculator infrared aplet transfer and the `HP39 (IrDA)` choice on HP39gs.
The corresponding option is absent on HP40gs, which uses a cable instead.
Thus infrared is a real compatibility feature for applicable boards, not a
six-model checkbox that can be derived from the shared processor alone.

Samsung's S3C2410A manual, chapter 11, describes UART infrared mode, selected
by ULCON bit 6 and using the IR transmit/receive path. That silicon facility
is not a complete IrDA connection, discovery/negotiation implementation or
an HP file-transfer protocol. The existing UART0 error-free byte queue does
not model pulse width, actual baud clocking, channel-to-board wiring or the
external transceiver. None becomes verified because a byte can be enqueued.

## Proposed implementation order

First identify the actual channel, pin mux, enable/power control and configured
baud/parity for each applicable original ROM/board. Capture the guest's register
sequence and transmitted data without replacing its driver. Separate PC-IrDA
interoperation, calculator-to-calculator protocols and printer infrared; the
name "infrared" alone does not establish that their framing/protocols match.

Then add a bounded, deterministic virtual link between two emulated machines,
with explicit connection, direction/turnaround, collision/error policy and
clock-domain conversion. Start with register-derived frame-level exchange;
add pulse-level fidelity only when a demonstrated guest behavior requires it.
Use guest firmware to send an actual aplet/object in both directions and verify
its identity and a responsive post-transfer UI. A synthetic echo is not that gate.

Connecting to a real PC infrared adapter is a separate native/browser-device
bridge project. The existing virtual host does not make the OS enumerate a
new device. Printer support likewise needs an independent interface and
acceptance witness rather than being called "IrDA" by assumption.

## Sources and limits

[HP's original mastering guide](https://literature.hpcalc.org/official/hp39gs40gs-mastering-en.pdf)
(F2224-90010, December 2006), infrared/cable discussion, and
[Samsung's original S3C2410A manual](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
UART chapter. Text was available for this assessment; remote PDF screenshot
retrieval failed. No circuit photograph or diagram is claimed inspected and
no reference manual or external emulator implementation is bundled.

This is a scoped M6 follow-up, not a claim of all-model routing, physical
adapter access, printer compatibility or completed infrared transfer.
