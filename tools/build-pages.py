#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Assemble the single documentation/emulator artifact after Build passes."""
from pathlib import Path
import os
import subprocess
from pages import assemble

if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    source = os.environ.get('GITHUB_SHA') or subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    count = assemble(root / 'site', root / 'dist', source)
    print(f'Pages artifact: documentation + {count} emulator assets, source {source}')
