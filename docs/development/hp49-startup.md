# HP49g+ original-ROM support

The complete user-captured HP49g+ image now cold boots to the original
131 × 80 HOME screen, accepts physical-key input, calculates, runs CAS,
displays a graph, transfers files over the internal virtual USB connection,
and runs the existing HP-GCC native example through stock ARMToolbox.
The r19 continuation also fixes FILES navigation and adds
[emulated SD media](sd-cards.md), including stock file writes and recalls.
The catalog admits this exact image as **HP49g+ HOME · experimental**.
The immutable ROM and all private snapshots remain outside the repository.

## Image and explicit board conditions

| Item | Value |
| --- | --- |
| Full image | 2,097,152 bytes |
| Full SHA-256 | `3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab` |
| First 16 KiB SHA-256 | `54191621b1a104157258fd6190597b53e92050dc3a3d111a2daf295fa7f83e5e` |
| Independent acquisition | Both user reads equal; all 128 sidecar chunk hashes rechecked |
| SRAM | Fixed 512 KiB; explicit bank-1 address mirror in the HOME preset |
| NOR device selection | Explicit SST39VF1601 array/software-ID subset |
| Keyboard | Apples electrical matrix plus dedicated keys |
| GPIO inputs | D `cc7f:0000`, E `c000:c000`, F `008e:0000`, G `0001:0000` |
| Weak GPIO bias | G `f800:f800` |
| ADC | Explicit ideal AIN0=1023, AIN7=512 |
| SDI | Initially empty slot; bounded SDSC PIO controller and optional card image |
| LCD | Counted idle-zero `+0x68` hypothesis; packed-LSB inspection view |

These conditions are declared by the preset, not injected into the CPU
instruction implementation. The ROM is neither patched nor padded. GPE14/15
high resolves the first cold-boot unknown input; the new empty-slot SDI
controller resolves the subsequent SD initialization. Later FILES navigation
requires the explicit bank-1 SRAM decode described in [SD cards](sd-cards.md).
The older arithmetic witness alone did not expose that boundary. Actual
board wiring, pad levels, LCD routing, electrical timing and the
acquisition's `physical_mapping_verified=false` remain unverified.

At the stock startup prompts, press F6 for **NO** on recovery and F6 for
**OK** on memory clear, then wait for HOME. The model's skin, physical scan
mapping, default A–Z PC-key macros, custom mappings, autosave and `.ord`
sessions now use model 5 and the `hp49-home` identity.

## Original-system workflows from r17/r18

The earlier fixed cold-start arithmetic witness reaches 300,000,000 virtual ticks
with no diagnostic stop, no CPU data-fault state and zero SRAM alias accesses.
Its original LCD history contains `1+2`, `3`, `7*8`, `56`. Two native cold runs
and two production-WASM cold runs agree. The final raw frame SHA-256 is
`63bd1ac6a568ac693dfaf37f9514b942430dd832812b17263b571efec87834c2`.

A separate cold-start workflow types every command with physical keys and
checks exact frame hashes against visually inspected original-OS output:

| Workflow | Observed result |
| --- | --- |
| `VERSION` | Original HP49-C revision information |
| `FACTOR(X^2-1)` | `(X-1)·(X+1)` displayed by the stock CAS |
| APPS | Chooser opens; ON returns to the same CAS result |
| MODE | Settings form opens; F6 returns to the same CAS result |
| `STEQ(X^2)`, `ERASE`, `DRAW`, `PICTURE` | Parabola with the stock interactive plot menu |
| Plot ON/Cancel | Returns to HOME without a diagnostic stop |
| Save → reset → restore → continue | Entire continued checkpoint equals the uninterrupted result |
| Native ↔ WASM resume | Entire 532,506-byte checkpoint agrees after another 1,000,000 ticks |

`DRAW` updates the original `PICT`; the witness explicitly enters `PICTURE`
to display it. The plot frame SHA-256 is
`4456afd374894f168ce36162995dd0569ef2276075edf9bb6c01b2c84967820c`.
These are original firmware computations and pixels, not host-rendered
substitutes. The bounded public record is
[HP49g+ support evidence](evidence/hp49-support-r17.json).

Reproduce locally with the admitted private image:

```sh
ORCHARD_BUILD_DIR=build node tools/verify-hp49-startup.mjs \
  /private/hp49gplus-full.bin /new/hp49-startup.json
ORCHARD_BUILD_DIR=build node tools/verify-hp49-workflows.mjs \
  /private/hp49gplus-full.bin /new/hp49-workflows
```

Build `orchard`, `orchard-checkpoint-replay` and `dist/orchard.wasm` first.
The workflow directory is private: it contains local screenshots, checkpoints
and an immutable input snapshot for the cross-host comparison. These commands
are explicit local acceptance work, not firmware downloads or ordinary CI.

## Native ARM installation, execution and return

The unchanged SDK `LIB275.LIB` and `template/main.hp` also run on the original
HP49g+ OS. They are uploaded through ordinary virtual USB as `ARMTOOL` and
`ARMHELLO`, Library 275 is installed in RAM port 0, and the physical ON+F3
warmstart attaches it. In RPN mode the stock ARMToolbox PrRUN command launches
the example. Its own LCD output reads `Hello From Lobakkang`; ON returns to
HOME and `1 ENTER 1 +` then yields `2` without a diagnostic stop. No host
memory edit or firmware patch is involved.

The maintained reproduction starts from cold boot and includes USB GET after
the native return. It takes the original ROM and the external pinned SDK as
inputs; the SDK code is not embedded in the MIT emulator:

```sh
node tools/verify-hp49-native.mjs \
  /private/hp49gplus-full.bin \
  /private/patched-hpgcc-1.1-sdk-for-hp39gs \
  /new/hp49-native
```

See [native ARM execution](hp49-native.md) for the exact fixture hashes,
launcher choreography and licensing boundary. This proves the existing
example's install/run/return path, not compatibility with every native program.
The empty SD slot, USB-only file service and explicit board conditions remain
the same.

## USB and the serial/infrared distinction

The production Chrome interface and Worker have passed upload, named GET,
directory, FINISH, calculator-initiated SEND/Receive, and another GET on the
same USB connection. A two-object upload batch followed by both downloads,
directory and FINISH also passes. Returned HP49 binary files are byte-identical,
including their `HPHP49-C` headers. The virtual link is internal to Orchard;
it does not create an operating-system USB device.

HP's [49g+ User's Manual](https://literature.hpcalc.org/official/hp49gplus-um-en.pdf)
describes USB and infrared connectivity. The
[49g+/48gII Advanced User's Reference](https://literature.hpcalc.org/official/hp49gplus48gii-aur-en.pdf),
Appendix C, defines system flag −33 as the wired/IrDA selector and −35 as
the Kermit text/binary selector. The verified USB preparation uses `CF(-33)`
and `SF(-35)`; the local transfer fixture also clears −78.

HP48gII's virtual UART0 serial recipe must not be generalized to HP49g+.
In this exact HP49 ROM, `SF(-78)` followed by `SERVER` reaches the real
Awaiting Server screen but does not accept UART0 traffic. All three UART
register sets remain unchanged from HOME and the UART subinterrupts remain
masked. `SF(-33)` actually selects IrDA: firmware configures UART2 with
ULCON=`0x43`, UCON=`0x705`, divisor=`0x138` and reaches the explicitly
unsupported receive register `0x50008024`. Model 5's file operations therefore
advertise USB only. IrDA framing, discovery and UART2 are not implemented.

## Historical r17/r18 empty-slot controller

The following records the original boot-only subset. The r19
[SD card implementation](sd-cards.md) supersedes its FIFO/data restrictions
and exports version-3 checkpoints while retaining v1/v2 imports.

The new SDI subset follows Samsung's
[S3C2410A User's Manual, March 2004](https://www.keil.com/dd/docs/datashts/samsung/s3c2410_um.pdf),
chapter 19: command/status registers, prescaler, write-one-to-clear flags,
interrupt mask and command/response phases. A command consumes 48 serial
clocks, followed by a 64-clock response timeout when a response was requested
from the absent card. CLKCON gating freezes progress. Reads do not advance
time. The scheduler accounts for an active command's next boundary; an idle
controller adds no per-instruction SDI tick call.

No successful response, sector contents or filesystem is fabricated. Active
data transfer, DMA and FIFO access remain diagnostic stops. The 678-assertion
SDI test covers all six profiles, timing/IRQ, masking, checkpoint continuation,
unsupported-access atomicity and scheduler/reference equivalence.

Checkpoint export is now version 2 and adds 52 explicitly serialized SDI
bytes. Version 1 checkpoints remain importable for all six models, with the
missing controller reset to its documented empty-slot initial state. Invalid
state fails before mutation. ROM identity, size and CRC validation remain in
the core, and the session envelope still binds the model, full ROM SHA-256,
preset and framebuffer view. This support does not certify physical clock
accuracy, SD card media, NOR program/erase, infrared or every original-OS
peripheral path.
