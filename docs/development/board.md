# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) records the exact
accepted commit and remote Build/Pages results. [Roadmap](roadmap.md) owns
gates; [validation](validation.md) and [boot research](boot-research.md) own
the repeatable evidence.

## Implemented in this slice

- [x] Stateful LCD source/pending/mask, read-only time-driven LINECNT and single-scan frame IRQ; unsupported FIFO/LPC/TFT behavior stays explicit.
- [x] Normal ADC prescaler/sample-and-hold/completion, standby, read-start and IRQ; no implicit analog inputs or battery voltage.
- [x] Explicit ADC stimuli and pure peripheral snapshots in the C API, CLI, WASM and probe-v5 reports.
- [x] Unchanged conditioned HP39g+ and HP48gII full NORs both reach USB initialization; strict defaults and the counted LCD hypothesis remain separate.
- [x] ROM-free guest takes ADC and LCD interrupts, acknowledges both and returns to WFI on native/WASM; unknown-input control and cold replays pass.
- [x] Preserve scheduled recovery-key controls, maintained tests and firmware-free production artifacts.

## Now / next

- [ ] Implement the concrete USB `52000144` initialization dependency from the device specification; initialization, enumeration and actual transfer are separate gates.
- [ ] Independently resolve LCD `+0x68`, physical scan timing/panel mapping, FIFO and real board analog/pad bias. Do not promote research conditions into defaults.
- [ ] Integrate the user's later HP39gs/HP49g+ real NOR dumps without blocking current work or requesting them now.
- [ ] M1 CPU conformance and M3 responsive stock cold boot/ARM return remain open; current conditional progression closes neither.

M0 remains closed. Pages publishes only documentation. Existing original NOR,
boot-only backing, explicit component conditions and hypotheses keep distinct
provenance; no newly reconstructed image is called a real hardware dump.
