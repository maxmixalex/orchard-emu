# HP39 return-probe package dependencies

The downloadable **calculator probe package**, separate from Orchard's C/WASM
core, includes the following HP-GCC files and a byte-identical rebuild of its
ARMToolbox39 library. Their original source and notices are included under
`third-party/hpgcc39/` in the ZIP.

- Copyright (C) 2004, 2005 The HP-GCC Development Team.
- The HP supported-entry/interface headers retain their existing Hewlett-Packard
  notices, including the 1992 notice in `HEADER.H` / `=Head39.h`.
- Source distribution: [HP-GCC 1.1 SDK preserved by its HP39gs patch maintainer](https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs/tree/7fa1503912338ea0fdf1d39eb584770f4d121cd2).
- The SDK's original `README.TXT` declares GPL version 2 or later and describes
  additional permissions. It is included verbatim. `COPYING` contains GPL v2.

The compiled calculator applet and launcher are distributed under GPL version
2 or later, with all corresponding source/header inputs and build scripts.
Orchard's new build/inspection script and return-probe source retain their MIT
notices, a GPL-compatible permissive licence. The library is not relabelled MIT,
and this distribution does not rely on the SDK's non-profit exception.
No HP firmware, bootloader, SDK executable, emulator implementation, or HPTools
binary is included.

The external HPTools compiler is by Hewlett-Packard and Jean-Yves Avenard.
Its original source and licence are available from [the author's archived
distribution](https://www.hpcalc.org/details/4263). Paul Onions' [64-bit build
patch](https://pdo.github.io/) was applied only to the local compiler build.
Neither modified compiler sources nor modified compiler executables are
redistributed in this package.
