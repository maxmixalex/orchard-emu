# Orchard

An original MIT-licensed ARM hardware emulator for HP 39g+, 39gs, 40gs,
48gII (USB revision), 49g+ and 50g. One C17 core runs natively and as WASM.
The ROM's ARM Saturn interpreter executes as guest software; there is no
host-side Saturn replacement or firmware patch.

**HP48gII and HP39g+ D1.55 reach original HOME and evaluate `1+2=3` and
`7*8=56` under explicit experimental setups.** HP39g+ uses a separately selected
1 MiB NOR and exact SRAM, not the HP48gII mirroring hypothesis. LCD `+0x68`,
component identification, panel interpretation and pad/ADC conditions remain
unverified hardware assumptions.
This is conditional functional operation, not complete six-model support.

## Browser

**[Open the web emulator](https://zyf722.github.io/orchard-emu/emulator/)** ·
[Development documentation](https://zyf722.github.io/orchard-emu/)


```sh
npm run build
npm run dev
```

Python 3, Node.js 22+, Clang/wasm-ld are needed to build; there are no npm dependencies.
Open the printed localhost URL (default port 8123). In a downloaded web build,
only Node.js 22+ is needed: extract it and run `node serve.mjs` in that folder.
Do not use `file://`. No ROM is bundled or uploaded.

Select **HP48gII HOME · experimental**, load the documented full NOR, and press
Run. At `Try To Recover Memory?`, tap F6 (NO); at `Memory Clear`, tap F6 (OK).
The page exposes a 51-position keypad, computer-keyboard shortcuts, pause,
cold reset, LCD view selection and diagnostic export. Taps are physical
switch transitions, not guest-memory edits. Changing setup/reset clears RAM;
switching away pauses. Save/restore and actual browser-origin E2E remain open.
For HP39g+, select **HP39g+ HOME · experimental** and acknowledge Memory Clear
with F6/OK. Both setups require their documented model-specific NOR hash.
Seven pinned outlined skins and their exact hit geometry come from
[hp-calcs-svg](https://github.com/zyf722/hp-calcs-svg). The separate status strip
reads guest display data; Shift/Alpha transitions were checked on both systems.
See [skins and status segments](docs/development/skins-segments.md) and
[browser operation and verification](docs/development/web.md).

## Native and tests

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
ctest --test-dir build --output-on-failure
npm run check
npm run test:tools
npm run build
npm run test:wasm
npm run test:web
npm run test:skins
```

[Startup](docs/development/startup.md) records the full-NOR witness and exact
experimental conditions. A successful run budget is not a boot certificate.
The optional [Unicorn differential](docs/development/cpu-oracle.md) is a
separate developer tool, never a linked dependency of the MIT runtime.

## Development

[Documentation](https://zyf722.github.io/orchard-emu/) ·
[Roadmap](docs/development/roadmap.md) ·
[Board](https://github.com/zyf722/orchard-emu/issues/1) ·
[Validation](docs/development/validation.md) ·
[ROM provenance](docs/development/native-roms.md)

Zensical configuration is in `zensical.toml`; install
`tools/requirements-docs.txt` in a virtual environment and run
`zensical build --strict`. Pages publishes documentation at the root and the emulator at `/emulator/`. Tests and
private firmware evidence stay out of production packages.

[MIT](LICENSE) covers original source/documentation, not HP firmware or
trademarks. No external emulator implementation, firmware or font file is bundled.
Outlined calculator art is separately Apache-2.0, with its LICENSE/NOTICE
in `licenses/hp-calcs-svg`; see [licensing](docs/development/licensing.md).
