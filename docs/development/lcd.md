# LCD evidence, inspection and bounded hypotheses

## What is established, and what is not

The [Samsung S3C2410A manual](references.md) defines the STN data formats,
LCDCON5 byte/halfword controls and BLUELUT. It does **not** identify LCD
address `0x4d000068`. Original HP39g+ and HP48gII firmware poll this location
with video disabled and then enable video when the read becomes zero.
That code path alone does not establish the register's hardware function.

A comparative read of [x49gp's LCD implementation](https://github.com/claudiobsd/x49gp/blob/master/s3c2410_lcd.c)
(blob `3c7745863fabb8da5cfac974daae92ea76a50967`) found an explicitly unnamed
`__unknown_68` register initialized to zero. This is an older emulator's
approximation, **not independent silicon evidence**. Its register-storage,
read-driven scan counter and fixed-width rendering implementation were not
imported. Selected MAME LCD DMA code was also consulted for comparison;
see the provenance record in [references](references.md).

The project therefore retains two separate modes rather than declaring the
missing register solved. `src/lcd.c` is original code implementing the bounded
experiment and the documented inspection rules below.

## Explicit idle-zero experiment

The default remains strict: unsupported `+0x68` reads stop the machine.
`orchard_lcd_probe68(machine, true)` or CLI `--lcd-probe68 idle-zero` changes
**only aligned 32-bit reads of this exact address while ENVID is clear** to
return zero. Byte/halfword accesses, writes, neighboring addresses and reads
with video enabled remain unsupported. It neither patches NOR nor skips an
instruction. The guest executes the LDR and subsequent control flow itself.

This is a compatibility hypothesis intended to reveal later dependencies, not
an implementation of FIFO occupancy, drain completion or a measured reset
value. ENVID clear is the eligibility condition; it is not proof that the
physical LCD bus is idle. Do not enable it automatically by model or ROM hash.

`orchard_lcd_probe68_reads()` counts every unverified read. CLI/probe output
contains both `lcd_probe68` and `lcd_unverified_reads`. Disabling the option
does not erase the count; cold reset clears the policy and counter. Probe v4
reapplies the requested policy after reset. An experiment with a nonzero count
cannot close the canonical hardware or stock-boot gate. `boot_verified` remains
false even when a run budget finishes successfully.

With current explicit input conditions, the HP39g+ image passes this read once
and next stops on LCDSRCPND (`0x4d000058`), while HP48gII next stops on an ADC
configuration **write** (`0x58000000`, value `0x42f8`). Those locations have
normal vendor documentation, but their peripherals are still unimplemented.
Without the option, both established LCD stops remain unchanged.

## Controller stream versus packed-memory inspection

`orchard_framebuffer()` retains the controller-stream view. The new
`orchard_framebuffer_view()` accepts these explicitly distinct interpretations:

| View | Meaning | Selection |
| --- | --- | --- |
| Controller | STN MSB-first stream with LCDCON5 BSWP/HWSWP | Default / `ORCHARD_FRAME_CONTROLLER` |
| Packed LSB | Logical guest framebuffer memory, least-significant pixel group first within each byte, without controller byte swaps | `ORCHARD_FRAME_PACKED_LSB` / `--frame-view packed-lsb` |

Both use guest-programmed source, line count and stride, profile-visible
cropping, physical memory bounds and the implemented STN 1/2/4-bpp subset.
The 2-bpp intensity comes from the four BLUELUT nibbles, not an assumed linear
palette. Capturing either view has no guest-state side effects. Native PGM
output and WASM `frame_view()` use the same decoder.

The packed-memory view makes the known HP50g recovery text readable. It is a
**diagnostic interpretation, not a validated controller-to-panel wiring map**.
No register or guest buffer is modified to obtain it. It does not infer bits
per pixel from a convenient bootloader convention or hardcode a 160-pixel
stride. Physical line wiring, temporal grayscale, contrast and annunciators
remain separate work. The browser page still displays the default controller
view; these new controls are exposed through the CLI/core/WASM research APIs,
not a claimed browser interaction feature.

## Corrected inspection behavior

The previous decoder applied byte-lane permutations to buffer-relative offsets.
The address register can describe a halfword-aligned base, so the permutation
must instead refer to the absolute fetched 32-bit word. Tests now cover bases
at word and halfword alignment, a line stride that changes alignment, all four
swap settings, and all three supported pixel depths. The logical source range
is checked before the permutation; the selected bus lane is independently
checked against an implemented physical memory bank. This is functional fetch
inspection, not burst-timing validation.

The previous 2-bpp path also ignored BLUELUT. Directed tests use an asymmetric,
nonlinear palette so a linear substitute fails. Temporarily restoring each
old rule makes the maintained regression fail; restoring the corrections makes
it pass. Correcting these two issues does **not** by itself resolve the known
HP50g per-byte pixel-order difference between raw stream and packed memory.

## Required next evidence

Implement documented LCD pending/mask/scan behavior and ADC from their actual
interfaces, with bounded regressions. Separately measure or recover stronger
independent evidence for `+0x68`, and establish controller-to-panel bit wiring.
Keep strict and hypothesis-enabled firmware records side by side. A rendered
recovery menu, successful budget or comparison between two builds of the same
core is not a stock operating-system or independent ARM-conformance pass.
