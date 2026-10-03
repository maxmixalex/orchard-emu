#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Assemble one Pages site: preserve documentation URLs, add /emulator/.
The published emulator contains build assets only, never firmware or font files.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
DIST = ROOT / 'dist'
REVISION = os.environ.get('GITHUB_SHA') or subprocess.check_output(
    ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
ALLOWED = {'index.html','style.css','main.js','worker.js','hp48.js','skin.js','orchard.wasm',
           'LICENSE','serve.mjs','README.txt','skins/manifest.json',
           'licenses/hp-calcs-svg/LICENSE.txt','licenses/hp-calcs-svg/NOTICE.txt','licenses/hp-calcs-svg/README.md'}
ALLOWED |= {f'skins/{model}.svg' for model in ('hp39gplus','hp39gs','hp40gs','hp48gii','hp49gplus','hp50g','hp50g-blue')}

if not re.fullmatch(r'[0-9a-f]{40}', REVISION):
    raise SystemExit('Expected an exact source revision')
if not (SITE / 'index.html').is_file():
    raise SystemExit('Build the strict documentation first')
assets = {}
for file in sorted(DIST.rglob('*')):
    if file.is_symlink():
        raise SystemExit(f'Symlink in web distribution: {file}')
    if not file.is_file():
        continue
    name = file.relative_to(DIST).as_posix()
    if name in {'revision.txt', 'asset-manifest.json'}:
        continue
    if name not in ALLOWED:
        raise SystemExit(f'Unexpected distribution file: {name}')
    assets[name] = hashlib.sha256(file.read_bytes()).hexdigest()
required = {'index.html', 'worker.js', 'main.js', 'hp48.js', 'skin.js',
            'orchard.wasm', 'skins/manifest.json', 'licenses/hp-calcs-svg/NOTICE.txt'}
if not required.issubset(assets):
    raise SystemExit(f'Missing web assets: {required - assets.keys()}')
if (DIST / 'orchard.wasm').read_bytes()[:4] != b'\0asm':
    raise SystemExit('Invalid production WASM')
(DIST / 'revision.txt').write_text(REVISION + '\n')
(DIST / 'asset-manifest.json').write_text(json.dumps(
    {'revision': REVISION, 'assets': assets}, sort_keys=True, indent=2) + '\n')
target = SITE / 'emulator'
if target.exists():
    shutil.rmtree(target)
shutil.copytree(DIST, target)
(SITE / 'revision.txt').write_text(REVISION + '\n')
print(f'Pages: documentation + {len(assets)} emulator assets, exact revision {REVISION}')
