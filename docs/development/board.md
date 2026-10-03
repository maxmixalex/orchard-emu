# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) owns the accepted
revision and observed Build/Pages results. [Validation](validation.md) records
local evidence; [USB](usb.md) records successful and unresolved transactions.
This continuation reconciles the preserved local USB patch onto remote
`80a1466`, retaining its original control guest and Git ancestry.

## Locally implemented and validated

- [x] Original USB device register/FIFO/PIO subset, bus reset, address staging, pending IRQ25, bounded endpoint packets and explicit packet-host API.
- [x] Native/WASM synthetic guest: reset/setup IRQ, control reply and bulk echo, including ZLP, duplicate suppression, retry, disconnect and cold replay.
- [x] Real HP50g boot-only guest: device/configuration/string descriptors, SET_ADDRESS and SET_CONFIGURATION status responses; 143 identical native/WASM transcript steps and independent cold replays.
- [x] Preserve GET_CONFIGURATION NAK as an unresolved case; a new SETUP recovers without guest-memory edits.
- [x] Pure USB diagnostics in native/WASM/probe-v6; 13 firmware/control replay comparisons. The two conditioned full NORs now reach a later NOR-base store, not an interactive OS.
- [x] Release, Debug and optimized ASan/UBSan CTest, shared test-WASM and static analysis. Optimized instrumentation also replays the complete real USB transcript.

## Next technical gates

- [ ] Resolve GET_CONFIGURATION and extend real stock transfer coverage; synthetic bulk echo is not HP object/update transfer.
- [ ] Investigate the full-NOR startup stores at physical zero, including real NOR command rejection/write width and CPU/cache/MMU behavior, without blindly discarding them.
- [ ] Independently resolve LCD `+0x68`, panel wiring and physical timing/pad/ADC conditions.
- [ ] Integrate the user's later HP39gs/HP49g+ full dumps when supplied; do not request them now.
- [ ] M1 conformance and M3 responsive stock boot/ARM return remain open. M0 remains historically closed.

Firmware, manuals, traces and tests do not enter production packages. Test
source remains in the repository patch; ordinary CI stays ROM-free.

## Publication contract

The provisional EP0-only session/API is superseded by the packet host. Its
original assembly guest remains active alongside the bulk guest. A successful
local test is not a remote CI or deployment result; issue #1 records each
observed result against its exact commit. No force push is required.
