# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) records the accepted
commit and observed CI/Pages outcome. [Roadmap](roadmap.md) owns gates;
[validation](validation.md), [USB](usb.md) and [boot research](boot-research.md)
own the reproducible evidence.

## Implemented locally

- [x] Original USB device registers/indexed endpoint state, bounded FIFOs and IRQ routing.
- [x] Explicit packet-level EP0 host, reset, SETUP/data/status, NAK/STALL, short replies and delayed address.
- [x] Original HP50g boot-only guest descriptors and six control requests on native/WASM, with cold replay.
- [x] New ROM-free assembly guest: seven requests, 26 guest IRQ entries and return to WFI on both hosts.
- [x] 145,021 assertions per host; four CTest suites; 22 separately named static-analysis units.
- [x] Two unchanged conditioned full NORs advance beyond USB initialization; retain strict/hypothesis distinctions.

## Now / next

- [ ] Diagnose the common zero-fill store into NOR at address zero; no blind ignored write or writable-NOR substitution.
- [ ] Resolve original GET_CONFIGURATION's DATA_END/IN-ready counterexample, then implement and test Bulk endpoint transactions.
- [ ] Independently resolve LCD +0x68, panel mapping and actual board clock/pad/analog behavior.
- [ ] Integrate the user's later 39gs/49g+ full dumps when supplied, without blocking current work or asking now.
- [ ] M1 independent CPU correctness, M3 interactive stock boot/native return, browser E2E and actual PC transfers.

No firmware or test artifacts in production packages. All original-firmware
probes run locally. M0 remains closed; this slice does not close M1/M3/M6.
