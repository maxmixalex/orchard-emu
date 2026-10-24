# HP48gII stock ARMToolbox execution

The admitted HP48gII USB-revision system runs the original HP-GCC greeting
through its own ARMToolbox, returns to HOME and calculates `1+1=2`. The workflow
uses the SDK's separate **`L275_48.LIB`**, not the HP49 library with the same
number. The program object itself is unchanged from the HP49g+ witness.

This adds original-program evidence for the 48gII native execution and return
path. It does not establish every ARM program's model compatibility. The
conditional board setup, SRAM decoding and packed LCD inspection limits in
[HP48gII startup](startup.md) still apply. It is a Node test of the production
WASM and virtual USB/Kermit modules, not a browser or physical speed test.

## Workflow and acceptance

`tools/verify-hp48-native.mjs` starts from a cold machine, acknowledges the
original startup dialogs, selects wired USB and binary transfer through
physical keys, and enters the original SERVER. It uploads both external
binary files and a small ordinary User RPL installer. The installer stores
the library in RAM port 0; ON+F3 attaches it. After selecting RPN mode, the
test recalls the program, opens the library menu and selects PrRUN.

The unchanged ARM program displays `Hello From Lobakkang` and waits for ON.
The witness then presses ON, performs `1 ENTER 1 +`, enters SERVER again,
retrieves the installed ARMToolbox library, sends FINISH and checks HOME.
No guest-memory write, CPU redirection or ROM/program modification is used.
All six captured frames have fixed SHA-256 assertions against independently
viewed original-OS output, including the native greeting and the result `2`.
Original input files and the production WASM are hashed again at the end.

The r25 cold run passed on production WASM SHA-256
`57d5d586bbf4e22e8e733130630c961df73ba0df57f1bcf683fc53bb327b8547`,
ending at virtual tick 1,643,331,232. It retained the single counted SRAM alias
read from this model's conditional startup and made no alias writes. Native
execution and return therefore do not remove that existing board-wiring
uncertainty.

The USB GET returns all 2,404 library-file bytes. This original ROM exports
`HPHP49-B`, whereas the SDK's input starts with `HPHP49-C`. The witness checks
the exact two headers and requires every object byte after them to agree.
It records byte 7 as the sole change; it does **not** claim that the whole
exported file equals the input. This is the same original-system header
conversion already recorded for [file transfers](file-transfer.md), and does
not require changing either input or the emulator's transfer implementation.

## Reproduce locally

Build the production WASM and provide the admitted private NOR and external
SDK directory. Output must be a new directory:

```sh
node tools/verify-hp48-native.mjs \
  /private/48gii.bin \
  /private/patched-hpgcc-1.1-sdk-for-hp39gs \
  /private/new-hp48-native-output
```

`ORCHARD_WASM` may select a frozen production WASM file. The tool downloads
nothing. Reports, original-frame pictures and checkpoints remain private
local artifacts; no firmware or SDK binary is included in the repository.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Original HP48gII USB-revision NOR | 2,097,152 | `4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937` |
| `L275_48.LIB` | 2,404 | `9469877dbc9791f2d87993fc596d6c34c966cc91a9bbc99e63b43cacdadba188` |
| `template/main.hp` | 12,536 | `423be27dbfa7f12f5645b666c0d389da28b1bfd9424813d00981601ce099248b` |

The SDK inputs come from
[`lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs`](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2),
commit `7fa1503912338ea0fdf1d39eb584770f4d121cd2`. Its
[ARMToolbox README](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/ARMToolbox/README.TXT)
documents PrRUN's stack argument; the
[example source](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/template/main.c)
prints the greeting and waits for ON. These external files retain their own
licenses and are test inputs only. The host witness and its ordinary RPL
installer are original orchard-emu code.
