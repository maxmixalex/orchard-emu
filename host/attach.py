#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Loopback USB/IP discovery and explicit Linux vhci_hcd attachment.

Only --attach writes sysfs. No driver installation, modprobe, sudo or firmware.
The socket is handed to the kernel, not replaced by a user-space echo device.
Protocol/ABI references: docs.kernel.org/usb/usbip_protocol.html and Linux
Documentation/ABI/testing/sysfs-platform-vhci_hcd (where available).
"""
from __future__ import annotations
import argparse
import json
import re
import socket
import struct
import sys
import time
from pathlib import Path

VHCI = Path('/sys/devices/platform/vhci_hcd.0')
USB = Path('/sys/bus/usb/devices')
BUSID = '1-1'


def exact(sock: socket.socket, count: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < count:
        part = sock.recv(count - len(chunks))
        if not part:
            raise RuntimeError('Truncated USB/IP response')
        chunks.extend(part)
    return bytes(chunks)


def header(sock: socket.socket, command: int) -> None:
    version, reply, status = struct.unpack('!HHI', exact(sock, 8))
    if version != 0x111 or reply != command or status:
        raise RuntimeError(f'USB/IP rejected operation {command}: {version:x}/{reply:x}/{status}')


def cstring(raw: bytes) -> str:
    if b'\0' not in raw:
        raise RuntimeError('Unterminated USB/IP string')
    value, padding = raw.split(b'\0', 1)
    if any(padding):
        raise RuntimeError('Invalid USB/IP string padding')
    return value.decode('ascii', errors='strict')


def record(raw: bytes) -> dict:
    if len(raw) != 312:
        raise RuntimeError('Invalid device record length')
    bus, device, speed, vendor, product, revision = struct.unpack_from('!IIIHHH', raw, 288)
    return {'path': cstring(raw[:256]), 'busid': cstring(raw[256:288]),
            'devid': (bus << 16) | device, 'speed': speed,
            'vendor': vendor, 'product': product, 'revision': revision,
            'interfaces': raw[311]}


def connect(port: int) -> socket.socket:
    if not 1 <= port <= 65535:
        raise ValueError('Port must be between 1 and 65535')
    return socket.create_connection(('127.0.0.1', port), timeout=5)


def discover(port: int = 3240) -> list[dict]:
    with connect(port) as sock:
        sock.sendall(struct.pack('!HHI', 0x111, 0x8005, 0))
        header(sock, 5)
        count, = struct.unpack('!I', exact(sock, 4))
        if count > 8:
            raise RuntimeError('Unexpected exported-device count')
        devices = []
        for _ in range(count):
            info = record(exact(sock, 312))
            if info['interfaces'] > 8:
                raise RuntimeError('Unexpected interface count')
            exact(sock, info['interfaces'] * 4)
            devices.append(info)
        return devices


def statuses(root: Path = VHCI) -> list[dict]:
    result = []
    files = sorted(root.glob('status*'))
    if not files:
        raise RuntimeError('vhci_hcd is unavailable: no virtual USB host controller is exposed')
    for file in files:
        for line in file.read_text().splitlines()[1:]:
            parts = line.split()
            if len(parts) != 7 or parts[0] not in ('hs', 'ss'):
                raise RuntimeError('Unsupported vhci_hcd status layout')
            hub, port, state, speed, devid, _fd, local = parts
            result.append({'hub': hub, 'port': int(port), 'state': int(state),
                           'speed': int(speed), 'devid': int(devid, 16), 'local': local})
    return result


def attach(port: int = 3240, timeout: float = 15) -> dict:
    if sys.platform != 'linux':
        raise RuntimeError('This native attach adapter requires Linux vhci_hcd; no Windows driver is installed by this tool')
    available = [p for p in statuses() if p['hub'] == 'hs' and p['state'] == 4]
    if not available:
        raise RuntimeError('No free high/full-speed vhci_hcd port')
    selected = available[0]['port']
    # Check access before taking ownership of the exported device.
    with (VHCI / 'attach').open('w') as control, connect(port) as sock:
        sock.sendall(struct.pack('!HHI', 0x111, 0x8003, 0) + BUSID.encode().ljust(32, b'\0'))
        header(sock, 3)
        info = record(exact(sock, 312))
        if info['busid'] != BUSID or info['path'] != '/orchard/usb/' + BUSID or info['speed'] != 2 or info['devid'] != 0x10001:
            raise RuntimeError('Refusing to attach an unexpected non-Orchard device')
        sock.settimeout(None)
        control.write(f"{selected} {sock.fileno()} {info['devid']} {info['speed']}\n")
        control.flush()  # The kernel acquires its own reference to the TCP socket.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = next((p for p in statuses() if p['port'] == selected), None)
        if state and state['state'] == 6 and state['devid'] == info['devid'] and re.fullmatch(r'\d+-[\d.]+', state['local']):
            directory = USB / state['local']
            try:
                vendor = int((directory / 'idVendor').read_text().strip(), 16)
                product = int((directory / 'idProduct').read_text().strip(), 16)
            except FileNotFoundError:
                pass  # Enumeration has not published the device attributes yet.
            else:
                if (vendor, product) != (info['vendor'], info['product']):
                    raise RuntimeError('Enumerated USB identity does not match the guest')
                return {'osAttachmentVerified': True, 'port': selected, 'localBusid': state['local'],
                        'vendor': f'{vendor:04x}', 'product': f'{product:04x}',
                        'conn3xRoundtripVerified': False}
        time.sleep(.05)
    # A successful sysfs write is not a successful OS enumeration. Leave explicit
    # port information for diagnosis rather than claiming attach from IMPORT alone.
    raise RuntimeError(f'Kernel handoff accepted on port {selected}, but OS enumeration was not verified; inspect vhci status and detach that port with your USB/IP client')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=3240)
    parser.add_argument('--attach', action='store_true', help='Explicitly attach the exported calculator to Linux vhci_hcd')
    args = parser.parse_args()
    try:
        if args.attach:
            result = attach(args.port)
        else:
            result = {'devices': discover(args.port), 'osAttachmentVerified': False,
                      'vhciAvailable': (VHCI / 'status').exists(), 'conn3xRoundtripVerified': False}
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(json.dumps({'error': str(error), 'osAttachmentVerified': False, 'conn3xRoundtripVerified': False}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
