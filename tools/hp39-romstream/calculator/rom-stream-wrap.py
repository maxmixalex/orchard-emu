#!/usr/bin/env python3
"""Wrap the HP39gs/39g+ ROM reader V2 for ARMToolbox39 old PrRUN."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

# Reserve private scratch RAM for the streamer C stack.  ARMToolbox39 PrRUN
# passes the allocated byte count in Saturn B.lo and the ARM address in C.hi;
# rom-stream-entry.S switches SP to the top of this block before calling C.
REQUEST_BYTES = 12288
FLAGS = 0x000
MEMORY_WORD = (FLAGS << 20) | REQUEST_BYTES
LINK_MARKER = 0x3176B34C


def wrap(image: bytes) -> bytes:
    l3 = bytearray(b"\x4c\xb3\x80A>CP")
    l3 += image
    l3 += struct.pack("<I", 0)
    l3 += struct.pack("<I", MEMORY_WORD)
    l3 += struct.pack("<III", 0, 0, LINK_MARKER)
    nibbles = (2 * len(l3) + 5) << 4
    if nibbles > 0xFFFFFF:
        raise ValueError("ROM stream stage is too large")
    return b"HPHP49-C" + b"\x2c\x2a" + nibbles.to_bytes(4, "little")[:3] + bytes(l3)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    image = args.input.read_bytes()
    output = wrap(image)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)
    print(
        f"{args.output}: ARM={len(image)} bytes "
        f"request={REQUEST_BYTES} flags=0x{FLAGS:x}"
    )


if __name__ == "__main__":
    main()
