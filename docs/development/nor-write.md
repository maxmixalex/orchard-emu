# NOR programming and factory FLASH tests

The selected SST39VF800A and SST39VF1601 models now execute x16 word program,
4 KiB sector erase, 64 KiB block erase and chip erase. These operations change
the emulated array; the original input file remains unchanged. The r22 stop
on command `0x80` was an unimplemented erase setup sequence, not a firmware
failure. Both the HP39gs and HP49g+ original factory diagnostics now complete
their **QUICK FLASH TEST** and **FULL FLASH TEST** and display
`FLASH WRITE TEST OK`.

## Device behavior

Commands use the documented `AA@5555, 55@2AAA` word-address unlock sequence.
After `A0`, the next halfword is data even when its low byte is `F0`.
Programming only clears bits; erase sets the selected range to `FF` after
the operation completes. An aligned ARM word write is two x16 bus cycles.

While busy, DQ7 data polling and DQ6 toggle polling reflect the pending
operation. The VF1601 also implements DQ2 for the erase range, sector/block
erase suspend (`B0`), programming outside the suspended range, and resume
(`30`). Array fast paths and translation memoization cannot bypass command
mode or a pending operation. Pending flash operations prevent quiet scheduler
batching and advance on the functional external timebase, independently of
PCLK gating.

| Operation | SST39VF800A | SST39VF1601 |
| --- | ---: | ---: |
| Word program | 168 ticks | 84 ticks |
| Sector/block erase | 216,000 ticks | 216,000 ticks |
| Chip erase | 840,000 ticks | 480,000 ticks |
| Erase suspend latency | Not implemented for this part | 240 ticks |

These values convert the selected data sheets' typical operation times to
the existing 12 MHz functional timebase. They are not measurements of an
individual calculator or a physical-board timing calibration. WP# is assumed
deasserted in this bounded board model. Byte writes, odd halfword writes,
CFI/security modes and unsupported operations still produce explicit diagnostics.

The command sequences, polling bits and device timing come from Microchip's
[SST39VF1601 data sheet, DS25028A](https://ww1.microchip.com/downloads/aemDocuments/documents/OTH/ProductDocuments/DataSheets/25028A.pdf)
and [SST39VF800A family data sheet, DS20005001B](https://ww1.microchip.com/downloads/aemDocuments/documents/MPD/ProductDocuments/DataSheets/SST39LFX00A-SST39VFX00A-2-Mbit-4-Mbit-8-Mbit-x16-Multi-Purpose-Flash-DS20005001.pdf).
No external emulator implementation was copied.

## Save, reset and identity

The machine retains a separate immutable base image and a mutable flash
array. A cold reset aborts an unfinished operation and retains completed
programming. The modeled watchdog pulse retains the external NOR operation.
Checkpoint version 6 records the active command state, pending/suspended
operations and only those 4 KiB sectors that differ from the immutable base.
Import checks ROM identity against that base, validates all sector records,
restores the array and then resumes the saved operation. See
[saved sessions](sessions.md) for the exact layout and migration.

Because changed sectors can contain original-ROM bytes, session files and
diagnostic checkpoints remain private. Neither those files nor ROM dumps are
part of the repository or the deployed site.

## Verification

`tests/nor-write.c` covers program/erase completion, `F0` as program data,
busy polling, suspend/outside-program/resume, checkpoint continuation,
base-image identity, complete sector deltas and rejection of malformed
operations or delta lists without changing the destination machine. Existing
NOR-bus, memory, checkpoint and scheduler suites run alongside it in native,
reference, sanitizer and WASM builds.

The original-ROM witness enters the firmware factory menu through held ON+F4,
then chooses FLASH and the write test with physical keys. The quick and full
tests run through their own erase/program/readback loops to the stock success
screen. The final cold-boot witness observes the quick tests complete in 58.5 million reference ticks (39gs) and 46.5 million (49g+), and the full tests in 3.4665 billion and 5.6505 billion ticks. It matches the unchanged success-text pixels, rather than accepting a run budget that ended without a stop. Run `node tools/verify-flash-selftests.mjs --help` for the cold-boot procedure; add `--full` to include both full tests. The exact candidate identities and outcomes are recorded in
[the r23 evidence](evidence/nor-write-r23.json). This certifies those functional
firmware paths, not every NOR command or physical electrical characteristic.
