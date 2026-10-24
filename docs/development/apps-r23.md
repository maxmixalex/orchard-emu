# Original HP49g+ application validation (r23)

The unchanged original HP49g+ NOR and four downloaded third-party objects were
exercised through the stock operating system. The host cold-booted the admitted
ROM, selected wired USB/binary transfer through physical keys, sent the original
objects with production virtual USB/Kermit, and returned from the stock server
with ordinary FINISH. No ROM byte, guest instruction or application was patched.
The existing explicit `hp49-home` board setup remains a research preset, not a
claim of canonical physical hardware startup.

## Results

| Original object | Execution path | Observed result |
| --- | --- | --- |
| 2048 `MM48.EXE` | Standalone native ARM/Thumb; HOME variable `MMGAME` | Full 4×4 board appears; Left/Down/Right/Up changes the board and reaches score 8; ON returns the documented `HP-2048` game string; subsequent `1 ENTER 1 +` produces 2 |
| BabalPlus `BabalPlus.hp` | Library 1033, stock non-native calculator execution | Library attaches in RAM port 0; BABAL opens the title and ball/lane; F2/F3/F1/F4 input advances the game; ON returns to the normal stack/library menu; subsequent arithmetic produces 2 |
| `BASECONVERT.49` | User RPL, HOME variable `BCONV` | `42 ENTER 2 ENTER BCONV` produces `{ 1 0 1 0 1 0 }` |
| `LISTCONVERT.49` | User RPL, HOME variable `LCONV` | The digit list followed by `2 ENTER LCONV` produces 42; subsequent arithmetic produces 2 above the result |

These are bounded functional witnesses, including return to the operating
system. They do not establish every gameplay path, every conversion radix or
all third-party libraries. Actual LCD frames were inspected; their hashes and
physical-key sequences are retained in
[the application evidence](evidence/hp49-apps-r23.json). Private ROMs,
checkpoints, downloaded programs and framebuffer images are not distributed.

BabalPlus is a library, so evaluating the received object alone only puts
`Library 1033` on the stack. An ordinary user-authored RPL wrapper,
`<< ORBABAL 0 STO >>`, installs it in RAM port 0. Stock ON+F3 attaches it; right
shift + 2 opens LIB, F1 opens BABAL's exports and F3 starts the game. This wrapper
was itself transferred through Kermit. It contains no downloaded library code
and does not modify the original object. The exported KEYS function is a key
description loop; its F1 entry must not be confused with the F3 game entry.

## Real missing LCD behavior found by 2048

Before the r23 fix, the original executable stopped with
`ORCHARD_UNSUPPORTED_LCD` at a Thumb store to DITHMODE (`0x4d00004c`) with value
`0x12210`. Samsung's documented field permits both `0` and `0x12210`. Supporting
those documented values, reserved-bit masking and readback in the LCD device
allowed this unchanged executable to run. Unsupported values still stop.
See [the LCD register implementation and limitations](lcd.md#documented-stn-dither-patterns).

The successful test used core SHA-256
`4bd0b8bba8ae7c71b116bb4a2c4396478e01730d9283bedc1f62a11f100db6e9`.
The full original NOR SHA-256 is
`3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab`.
All four original object hashes and package hashes are in the evidence file.

## Sources and reproduction

The package readmes and author-provided objects were retrieved from HPcalc:

- [2048 package](https://www.hpcalc.org/hp49/games/board/2048.zip). The README
  documents the standalone `.EXE`, arrow controls, ON return and saved-game
  string. The separate `.HP` variant needs ARMToolbox and was not substituted.
- [BabalPlus package](https://www.hpcalc.org/hp49/games/arcade/babal49plus.zip).
  Its `Info.inf` credits U-Foot and the HP49g+ conversion by Alberto Villalba Kong.
- [Base conversion package](https://www.hpcalc.org/hp49/math/misc/baseconvert.zip).
  John Keith's included documentation describes the integer/base and
  digit-list/base stack arguments. The validation used positive base 2.

With those packages extracted into `2048/`, `babal49plus/Babal49Plus/` and
`baseconvert/`, run:

```sh
node tools/verify-hp49-apps.mjs FULL-49GPLUS-NOR DOWNLOADS-DIRECTORY NEW-PRIVATE-OUTPUT
```

The tool checks each object identity, installs through the stock USB server,
and records the launches, directional input, exits, arithmetic, PCs and frames.
`--installed-checkpoint PRIVATE-CHECKPOINT` reuses its normal stock-installed
stage for a shorter replay. The r23 cold installation and that shorter replay
are recorded separately in the evidence: restoring a checkpoint does not count
as another cold boot. Final replay frames matched the independently recorded
interactive run, including the 2048 board/score and each arithmetic result.

The witness runs the production WASM and production transfer modules in Node.
It does not exercise the production Worker, browser compositor or real USB
hardware. The restored-checkpoint convenience option preserves guest state and
does not bypass a failing application instruction.

## Bounded performance samples

After entering and operating each game, the witness ran 24,000,000 functional
reference ticks in 1024-tick slices, sampling the PC every 100,000 ticks:

| Program | Reference interval | Retired instructions | Host elapsed time |
| --- | ---: | ---: | ---: |
| 2048 | 2 seconds | 24,000,000 | 1608 ms |
| BabalPlus | 2 seconds | 23,999,709 | 824 ms |

These are single local Node measurements during concurrent development work,
not a claim of physical HP speed, a cross-machine benchmark or an isolated
instruction throughput score. Transfer polling and PC sampling are included;
browser rendering and audio are not. The performance entries retain exact
ticks, elapsed times and sampled PCs so later runs can compare the same scope.
