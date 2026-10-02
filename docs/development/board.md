# Development board

[Issue #1](https://github.com/zyf722/orchard-emu/issues/1) owns the current
commit and observed CI/Pages outcomes. [Roadmap](roadmap.md) owns gates;
[validation](validation.md) and [boot research](boot-research.md) own evidence.

## Implemented locally, before publication

- [x] Preserve the M0 baseline and native-input distinctions from `d3d6528`.
- [x] Original opt-in electrical keyboard: raw switch connections, internal pull-ups, explicit drives, contention and unresolved pads.
- [x] Unfiltered EINT edge/level detection, pending/mask/group routing and guest IRQ/WFI handling; digital filters remain explicit stops.
- [x] Explicit SST39VF1601 software ID state machine; no inferred device ID or flash mutation.
- [x] Unchanged HP48gII NOR reaches original OS-region LCD initialization with recorded keyboard/part/pad conditions; native/WASM cold replay agrees.
- [x] Production-WASM generated guest handles matrix and ON press/release through its IRQ vector and returns to WFI.
- [x] Probe v3 records attachment, part and strong input conditions; maintain ROM-free regression and production packaging separation.

## Now / next

- [ ] Resolve the **shared** 39g+/48gII LCD `+0x68` read from independent evidence. No arbitrary zero-read implementation is present.
- [ ] Correct the recorded LCD controller/panel bit-order counterexample.
- [ ] Establish the remaining external pad bias and per-model populated switch maps; static high test drives are not a board preset.
- [ ] Recover original 39gs/40gs native inputs and complete 49g+/50g NORs; the current acquisition inventory remains unchanged.
- [ ] M1 independent CPU correctness; M3 first responsive stock cold boot.

Strict defaults retain the prior stops. The opt-in 48gII run reaches
`PC=0000707c` / LCD `4d000068` after 8,210,200 instructions, but its LCD is
still disabled. The boot-only HP50g runs a 2-million-quantum recovery poll with
keys released; this is neither an OS boot nor completed key interoperability.
Full board timing, all-model keyboard/UI, browser E2E, retained state and USB
are independent open gates. Run locally before pushing; synchronize observed
CI acceptance in the issue and publish only documentation to Pages.
