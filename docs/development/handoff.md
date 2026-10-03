# Continuation handoff

Current base is `e236fcc`, preserving the reconciled USB publication and the
separate Unicorn common-ISA differential. Exact accepted commit, CI and Pages
outcomes belong in issue #1. No history or repository visibility change.

The [startup-memory record](startup-memory.md) is the next-work entry point.
The selected-x16 HP48gII now reaches an original OS memory-recovery prompt.
Its NO transition hits a first data abort at tick 61,249,398, PC `1ce24`,
FAR `08040000`. Investigate actual SRAM decoding / preceding guest state;
do not silently enlarge memory or discard the fault. The 39g+ unspecified
NOR component remains strict at its earlier zero-store.

The prompt is conditional: extra F pads, AIN0=1023, AIN7=512, four counted LCD
idle-zero reads, and packed-LSB memory inspection are not measured board or
panel defaults. After NO the LCD count is five. Neither the prompt nor a
long-running abort loop is normal OS boot. USB GET_CONFIGURATION remains a
separate recorded bootloader counterexample.

The user will later provide HP39gs/HP49g+ full NORs; do not request them now.
Available full dumps remain HP39g+ and HP48gII. The 50g USB experiment contains
only its original 16 KiB boot region with erased OS backing. No firmware,
manuals, private traces, screenshots or external binaries are committed.

Run the five CTest suites, production/native-WASM tests and independent CPU
checks locally before publication. Test definitions stay outside production
packages. Pages publishes only documentation and verifies its exact revision.
