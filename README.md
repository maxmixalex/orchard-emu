# Orchard

An original MIT-licensed ARM hardware emulator for **HP 39g+, 39gs, 40gs,
48gII (USB revision), 49g+, and 50g**.

**Hardware bring-up, not yet a usable calculator.** Genuine HP39g+ and HP48gII
full NORs execute from reset; matching HP49g+/HP50g native boot regions now
also run as explicitly boot-only research inputs. No complete 49g+/50g dump
is claimed. One C17
core runs natively and as WebAssembly; no stock UI boot is accepted yet. The
firmware's Saturn interpreter is intended to run as guest ARM software, without replacing it with Emu48 or patching the ROM.

The original HP48gII OS now draws its **Try To Recover Memory?** startup
prompt under explicit component/pad/ADC and counted LCD research conditions.
Selecting NO advances to a precisely located SRAM-boundary data abort; the
normal calculator UI and physical panel mapping remain unverified. The x16
NOR adapter preserves flash bytes rather than treating ROM as writable.
See [startup memory and remaining boot gates](docs/development/startup-memory.md).

The C17 core includes ARM/Thumb and a CP15/MMU subset, physical SRAM/NOR,
GPIO/keyboard/EINT, timers/RTC/watchdog, functional LCD scan/frame interrupts,
normal ADC with explicit sample inputs, and a functional USB device/packet host.
Unknown hardware still stops.
An explicit, counted LCD idle-zero hypothesis lets the original 39g+ and
48gII NORs pass USB initialization; it does not change strict defaults or
certify stock boot. Original 50g recovery code responds to scheduled keys,
and its original bootloader now returns real USB descriptors, strings and
address/configuration status responses to a virtual packet host. Its input is
boot-only; GET_CONFIGURATION remains unresolved, and no stock file/card
transfer or host-OS virtual device is accepted. See [USB evidence](docs/development/usb.md).
The browser remains a diagnostic workbench. See [boot research](docs/development/boot-research.md),
[LCD limits](docs/development/lcd.md) and [ADC conditions](docs/development/adc.md). The USB continuation is reconciled onto `80a1466`, retaining its control guest
and extending the packet API to bulk endpoints. The live board records each
accepted commit and observed Build/Pages result.

## Build and verify

Native: C17 compiler, CMake 3.20+, and a build tool. Web: Node.js 22+ and Clang
with `wasm32` / `wasm-ld`. There are no npm runtime dependencies.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run dev
```

The checked-in regression suite runs natively and in WASM. A generated,
ROM-free guest compares all six profiles through reset, MMIO, ARM/Thumb, SWI,
GPIO, UART, LCD and WFI, including reset/replay. This is not a six-model stock-boot
claim. See [validation](docs/development/validation.md) for commands and limits.
Tests stay outside `dist/` and are not installed with the native application.

```sh
./build/orchard models
./build/orchard run --model hp39gplus --rom /path/to/full-nor.bin --ticks 100000
node tools/probe-rom.mjs --model hp39gplus --rom /path/to/full-nor.bin
```

The input must be a complete physical NOR of the selected model's exact size.
Exit zero means the budget finished, not that the OS booted. The CLI provides
`--trace`, `--frame`, `--uart-in`, `--uart-out` and explicit `--gpio-input`; outputs must be new paths.
The browser server is local-only at `127.0.0.1:8080`; ROM bytes are not uploaded.

Native boot regions and original full NORs are separate research inputs:

```sh
node tools/rom-info.mjs /path/to/boot-50g.bin
node tools/probe-rom.mjs --model hp50g --bootloader /path/to/boot-50g.bin
node tools/probe-usb.mjs /path/to/boot-50g.bin /new/path/usb-control.json
```

The boot-only probe supplies no OS. See [native ROM research](docs/development/native-roms.md)
for recovered regions, hashes, rejected lookalikes and remaining acquisition gaps.

## Development

[Documentation](https://zyf722.github.io/orchard-emu/) ·
[Roadmap](docs/development/roadmap.md) ·
[Live board](https://github.com/zyf722/orchard-emu/issues/1) ·
[Architecture](docs/development/architecture.md) ·
[Independent CPU tests](docs/development/cpu-oracle.md) ·
[Models](docs/development/models.md) ·
[LCD evidence](docs/development/lcd.md) ·
[Electrical input](docs/development/input.md) ·
[Virtual links](docs/development/virtual-link.md)

Zensical is configured in `zensical.toml`. Install
`tools/requirements-docs.txt` in a virtual environment and run
`zensical serve` or `zensical build --strict`. The `home-docker` workflow runs
on pushes to `main` and manual dispatch; it validates native/WASM and docs,
then uploads production artifacts. A separate Documentation workflow publishes
only the strict-built Zensical site to GitHub Pages and checks the live pages.
The repository stays private; firmware and the emulator workbench are not
published with the docs. Untrusted fork PRs do not run on the self-hosted runner.

## License and firmware

[MIT](LICENSE) covers original Orchard code and documentation. No Emu48,
x50ng or QEMU implementation, ROM, bootloader, skin or font is bundled.
See [licensing](docs/development/licensing.md),
[references](docs/development/references.md), and
[ROM provenance](docs/development/roms.md). Supply firmware you are entitled
to use; an updater or Saturn nibble image is not a full physical NOR dump.
