# HP39 ROM stream package

The original ARM payload and original Go Windows HID implementation are from
hpclang, Copyright (c) 2026 Max Alex, MIT licence, at commit
e240c58c2e9dd3ac4d18002ed9a93d2c7cc67900. The original MIT licence is included
as third-party/hpclang/LICENSE in the downloadable package.

Orchard's V2 calculator/receiver changes, package builder and tests use MIT.
Calculator changes include framebuffer-safe MMU mappings and a private stack,
visible progress/errors, asynchronous EP0 transfers, cancellation and bounded
USB waits, reset-safe packet writes, and platform restoration. Receiver changes include
two independent checksummed reads per 16 KiB block, bounded retries and packet
budgets, exact USB identity, exclusive output creation, explicit model metadata
and completed cancellation of Windows asynchronous I/O before freeing memory.

The compiled calculator applet incorporates the HP-GCC39 applet template. Both
the resulting calculator applet and ARMToolbox39 library are distributed under
GPL version 2 or later. No non-profit or special exception is needed. Complete
corresponding sources for the applet template, launcher, ARM payload and tools
are included in the same archive. HP-GCC's original README and the GPL text are
included. All fixed source hashes are recorded in tools/hp39-romstream/upstream.json.

The HP-GCC source snapshot is
https://github.com/lobakkang/patched-hpgcc-1.1-sdk-for-hp39gs
at 7fa1503912338ea0fdf1d39eb584770f4d121cd2. These calculator-side components
are isolated from Orchard's emulator core, browser and host code.

External build dependencies (not distributed here) are Arm Toolchain for
Embedded 22.1.0, Go, a native C compiler and HPTools 3.0.8 with Paul Onions'
2019-04-26 64-bit patch. Exact download references and hashes are in README-zh.md.

The archive contains no HP firmware, raw ROM capture, OS checkpoint or user data.
