# Orchard

An original MIT-licensed ARM hardware emulator for **HP 39g+, 39gs, 40gs,
48gII (USB revision), 49g+, and 50g**.

**Hardware bring-up, not yet a usable calculator.** Genuine HP39g+ and HP48gII
full NORs now execute from reset to reproducible early hardware stops. One C17
core runs natively and as WebAssembly; no stock UI boot is accepted yet. The firmware's Saturn interpreter is intended to run as
guest ARM software, without replacing it with Emu48 or patching the ROM.

The current core includes a CP15/MMU subset, bounded execution and diagnostic
stops, internal/external SRAM, GPIO latches, IRQ arbitration, a functional RTC,
timers/UART0/watchdog and a raw single-scan STN LCD preview.
The browser UI remains a diagnostic workbench. See [real-ROM progression](docs/development/boot-research.md).

## Build and verify

Native: C17 compiler, CMake 3.20+, and a build tool. Web: Node.js 22+ and Clang
with `wasm32` / `wasm-ld`. There are no npm runtime dependencies.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run build
npm run test:wasm
npm run dev
```

The checked-in regression suite runs natively and in WASM. A generated,
ROM-free guest compares all six profiles through reset, MMIO, ARM/Thumb, SWI,
UART, LCD and WFI, including reset/replay. This is not a six-model stock-boot
claim. See [validation](docs/development/validation.md) for commands and limits.
Tests stay outside `dist/` and are not installed with the native application.

```sh
./build/orchard models
./build/orchard run --model hp39gplus --rom /path/to/full-nor.bin --ticks 100000
node tools/probe-rom.mjs --model hp39gplus --rom /path/to/full-nor.bin
```

The input must be a complete physical NOR of the selected model's exact size.
Exit zero means the budget finished, not that the OS booted. The CLI provides
`--trace`, `--frame`, `--uart-in` and `--uart-out`; outputs must be new paths.
The browser server is local-only at `127.0.0.1:8080`; ROM bytes are not uploaded.

## Development

[Documentation](https://zyf722.github.io/orchard-emu/) ·
[Roadmap](docs/development/roadmap.md) ·
[Live board](https://github.com/zyf722/orchard-emu/issues/1) ·
[Architecture](docs/development/architecture.md) ·
[Models](docs/development/models.md) ·
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
