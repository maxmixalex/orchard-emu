# HP49g+ stock ARMToolbox execution

The original HP49g+ OS can install and run the unchanged HP-GCC example through
its normal USB file service and ARMToolbox. The example displays
`Hello From Lobakkang`, waits for ON, and returns to HOME. A physical
`1 ENTER 1 +` sequence then produces `2` in RPN mode.

This is a functional witness for one existing native application and its
stock launcher. It does not establish compatibility with every native program,
populated SD cards, IrDA, NOR programming, or exact hardware timing. The
`hp49-home` preset still uses the explicit board conditions and packed LCD
inspection view documented in [HP49g+ startup](hp49-startup.md).

## Current verification

The maintained workflow passed from a fresh cold boot on final production WASM
`5fb9626e86eed337fd4371ebf3e6ea27f5fa7af12bcee40e84d09e009121d48f`.
All six recorded stages have diagnostic stop zero. The native greeting and
subsequent RPN result `2` were independently viewed, and the later USB GET
returned all 4,474 library bytes exactly. Both SRAM alias counters remained
zero. The run used 214 physical switch events and ended at virtual tick
1,842,810,528.

The bounded record is [native ARM evidence](evidence/hp49-native-r18.json).
It also identifies the earlier exploratory checkpoint-based investigation
separately from this complete cold-boot acceptance run. Neither path patches
the original ROM or guest RAM. This is a functional acceptance test, not a
performance measurement.

## Reproduce locally

Build the production WASM, provide the admitted complete private HP49g+ NOR,
and point the test at the pinned external SDK:

```sh
node tools/verify-hp49-native.mjs \
  /private/hp49gplus-full.bin \
  /private/patched-hpgcc-1.1-sdk-for-hp39gs \
  /private/new-hp49-native-output
```

The SDK is
[`lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs`](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2),
commit `7fa1503912338ea0fdf1d39eb584770f4d121cd2`. Although that repository
also contains HP39 support, this witness uses its **HP49** library and object
files, not the distinct HP39 library with the same number.

| Input | Size | SHA-256 |
|---|---:|---|
| Complete original HP49g+ NOR | 2,097,152 bytes | `3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab` |
| `LIB275.LIB` | 4,474 bytes | `7d204b746d0ded75e92da3d8e323637c2846fcd8f159dde2ba25ba8bdc0db637` |
| `template/main.hp` | 12,536 bytes | `423be27dbfa7f12f5645b666c0d389da28b1bfd9424813d00981601ce099248b` |

The script rejects other inputs before booting. It never downloads firmware or
SDK files. Its output directory must be new. Reports, framebuffer pictures, and
portable checkpoints remain private local evidence; the published evidence
contains identities and results only.

The workflow starts from a cold machine, acknowledges the two stock startup
dialogs, and selects wired USB binary transfer through physical calculator
keys. It then enters SERVER and uploads the two exact SDK files as `ARMTOOL`
and `ARMHELLO`. This OS rejects `MAIN` as an object name, so the source filename
is deliberately not reused as the calculator variable name.

A third ordinary User RPL file performs `ARMTOOL 0 STO`, installing Library 275
in **RAM port 0**. FINISH returns to the calculator. The test executes that
installer by typing its variable name, performs the normal ON+F3 warmstart to
attach the library, and switches MODE to RPN. It recalls `ARMHELLO`, opens
right-shift LIB, selects ARMToolbox, and selects PrRUN. This follows the standard
launcher route without changing guest RAM, redirecting the CPU, or replacing a
firmware routine.

RPN selection matters: in ALG mode the menu first inserts the PrRUN command in
the editor; evaluating it without an argument produces the stock
`Too Few Arguments` error. That is ordinary calculator behavior. The maintained
workflow supplies the object on the RPN stack before invoking PrRUN.

The tool compares the native application's actual LCD bytes against the
visually checked greeting, presses ON, and compares the later RPN result `2`.
It then starts SERVER again, reconnects USB, requests `ARMTOOL`, checks that
the returned library is byte-identical to the input, and sends FINISH. This
last transfer checks that the stock USB service still operates after the
native program has restored the OS context.

## Source and licensing boundary

`tools/verify-hp49-native.mjs` is original MIT host-side test code. The SDK
library and example remain external test inputs and are not embedded in the
emulator or committed with this witness. Their exact identities are pinned
above. The small installer is ordinary User RPL source authored for this test.

The launcher behavior is documented in the SDK's
[`sources/ARMToolbox/README.TXT`](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/sources/ARMToolbox/README.TXT).
The example source is
[`template/main.c`](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/blob/7fa1503912338ea0fdf1d39eb584770f4d121cd2/template/main.c).
The SDK supplies its own license and corresponding sources; these files do not
become part of orchard-emu's MIT CPU implementation.
