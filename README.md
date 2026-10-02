# Orchard

An original MIT-licensed ARM hardware emulator for the HP Apples calculators:
**HP 39g+, 39gs, 40gs, 48gII, 49g+, and 50g**.

**Status: hardware bring-up, not yet a usable calculator emulator.** The same
C17 core builds natively and as WebAssembly. Synthetic ARM/Thumb programs run
on all six candidate profiles; **no HP stock ROM has been boot-verified in
Orchard**. CPU conformance, NOR commands, board GPIO, accurate peripheral
behavior and stock-OS boot remain active work. Six profiles are not six
completed machines.

Orchard executes the ARM instructions in a supplied full physical NOR image,
starting at the reset vector. The intended stock Saturn interpreter runs as
ordinary guest ARM software; Orchard does not substitute an Emu48 Saturn core,
translate a Saturn ROM, inject a different bootloader or patch firmware.

## Build and run

Native: a C17 compiler, CMake 3.20 or newer, and an ordinary build tool.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
./build/orchard models
./build/orchard run --model hp50g --rom /path/to/full-nor.bin --ticks 100000
```

Exit zero means the instruction/tick budget finished, **not** successful OS
boot. Unsupported operations report their PC, instruction and address.
`--trace`, `--frame`, `--uart-in` and `--uart-out` provide bring-up diagnostics;
outputs must be new paths and are not allowed to overwrite existing files.

Web: Node.js 22+, Clang with the `wasm32` backend, and `wasm-ld` on PATH.
There are no npm dependencies and no Emscripten or pthread requirement.

```sh
npm run check
npm run build
npm run dev
```

The local server listens on `127.0.0.1:8080`. `dist/` is the static web build.
The workbench loads a local ROM, shows raw LCD/register state and exposes a
functional UART0 hex stream. It is not a calculator skin or a working Conn3x
connection. A dedicated Worker owns the core; ROM bytes are not uploaded.
See [web build and verification limits](docs/development/web.md).

## Development

[Roadmap](docs/development/roadmap.md) ·
[Live board](https://github.com/zyf722/orchard-emu/issues/1) ·
[Architecture](docs/development/architecture.md) ·
[Models](docs/development/models.md) ·
[Validation](docs/development/validation.md) ·
[Virtual connectivity](docs/development/virtual-link.md)

Zensical documentation is configured in `zensical.toml`:

```sh
python -m venv .venv
# Activate .venv for your shell, then:
python -m pip install -r tools/requirements-docs.txt
zensical serve
```

`zensical build --strict` is the documentation acceptance command. The current
handoff includes Markdown/configuration checks, not a completed Zensical render
or a published site. The opt-in Actions workflow builds artifacts; it does not
automatically publish this private repository to Pages.

## License and firmware

[MIT](LICENSE) applies to Orchard's original source and documentation. No
Emu48/x50ng/QEMU implementation, calculator artwork, ROM or bootloader is
bundled. Research sources and the independence boundary are recorded in
[licensing](docs/development/licensing.md) and
[references](docs/development/references.md).

Supply only firmware you are entitled to use. Full dumps, updater packages
and Saturn nibble images are different formats; see
[ROM provenance and input rules](docs/development/roms.md).
