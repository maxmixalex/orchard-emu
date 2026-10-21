#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build a reproducible, firmware-free HP49g+ read package (Python + Node only)."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile


def build(output):
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='orchard-read-package-') as temporary:
        package = Path(temporary) / 'hp49gplus-flash-read-v1'
        subprocess.run(['node', str(root / 'tools/flash-capture.mjs'), 'package', str(package)],
                       check=True, stdout=subprocess.DEVNULL)
        # Exclusive output, fixed metadata, no shell, no downloads, no firmware.
        with output.open('xb') as target, zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED) as archive:
            for path in sorted(package.rglob('*')):
                name = 'hp49gplus-flash-read-v1/' + path.relative_to(package).as_posix()
                if path.is_dir():
                    name += '/'
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = ((0o40755 if path.is_dir() else 0o100644) << 16)
                if path.is_dir():
                    entry.external_attr |= 0x10
                archive.writestr(entry, b'' if path.is_dir() else path.read_bytes())
    data = output.read_bytes()
    return {'file': output.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: python3 tools/package-flash-capture.py NEW-OUTPUT.zip')
        print(json.dumps(build(Path(sys.argv[1]).resolve()), indent=2))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
