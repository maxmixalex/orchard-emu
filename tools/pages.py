# SPDX-License-Identifier: MIT
"""Production Pages assembly/verification; no compiler or firmware access."""
from pathlib import Path
import hashlib
import json
import re
import shutil

MODELS = ('hp39gplus', 'hp39gs', 'hp40gs', 'hp48gii', 'hp49gplus', 'hp50g', 'hp50g-blue')
ASSETS = {
    'index.html', 'style.css', 'main.js', 'worker.js', 'hp48.js', 'skin.js', 'usb-device.js', 'host-bridge-client.js', 'host-bridge-protocol.js',
    'lifecycle.js', 'debug.html', 'calculator.js', 'session.js', 'calculator.css', 'catalog.js', 'preferences.js', 'pacing.js', 'task-scheduler.js', 'virtual-usb.js', 'kermit.js', 'file-transfer.js', 'hp39-files.js', 'hp39-transfer.js', 'hp39-archive.js', 'hp39-wire.js', 'hp39-wire-receive.js', 'transfer-errors.js', 'sd-card.js', 'sd-filesystem.js', 'buzzer-worker.js', 'buzzer-audio.js', 'lcd-frames.js', 'orchard.wasm', 'LICENSE', 'serve.mjs', 'README.txt',
    'irda-input.js', 'licenses/frontend.txt', 'skins/manifest.json', 'licenses/hp-calcs-svg/LICENSE.txt',
    'licenses/hp-calcs-svg/NOTICE.txt', 'licenses/hp-calcs-svg/README.md',
} | {f'skins/{model}.svg' for model in MODELS}
METADATA = {'revision.txt', 'asset-manifest.json'}
FORBIDDEN = {'.bin', '.raw', '.rom', '.xz', '.ttf', '.otf', '.woff', '.woff2', '.orchard', '.ord', '.state'}
MAX_ASSET = 2_000_000


def revision(value):
    if not isinstance(value, str) or re.fullmatch(r'[0-9a-f]{40}', value) is None:
        raise ValueError('Expected an exact 40-character source revision')
    return value


def inventory(root):
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f'Not a regular directory: {root}')
    files = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Symlink is not a publishable asset: {path}')
        if path.is_file():
            if path.stat().st_size > MAX_ASSET:
                raise ValueError(f'Oversized asset: {path}')
            files[path.relative_to(root).as_posix()] = path
    return files


def manifest_assets(value, source):
    if not isinstance(value, dict) or value.get('revision') != revision(source):
        raise ValueError('Manifest source revision mismatch')
    assets = value.get('assets')
    if not isinstance(assets, dict) or set(assets) != ASSETS:
        raise ValueError('Missing or unexpected web assets in manifest')
    for name, digest in assets.items():
        if not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None:
            raise ValueError(f'Invalid asset hash: {name}')
    return assets


def digest(data):
    return hashlib.sha256(data).hexdigest()


def assemble(site, dist, source):
    """Assemble only after every expected input has passed validation."""
    revision(source)
    if not (site / 'index.html').is_file():
        raise ValueError('Build strict documentation first')
    files = inventory(dist)
    if set(files) - METADATA != ASSETS:
        raise ValueError(f'Missing/unexpected web files: {set(files) - METADATA ^ ASSETS}')
    docs = inventory(site)
    if any(Path(name).suffix.lower() in FORBIDDEN for name in docs):
        raise ValueError('Firmware or font file in Pages site')
    if files['orchard.wasm'].read_bytes()[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('Invalid production WASM header')
    assets = {name: digest(files[name].read_bytes()) for name in sorted(ASSETS)}
    (dist / 'revision.txt').write_text(source + '\n', encoding='utf-8')
    (dist / 'asset-manifest.json').write_text(json.dumps(
        {'revision': source, 'assets': assets}, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    target = site / 'emulator'
    if target.is_symlink():
        raise ValueError('Refusing a linked emulator output directory')
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(dist, target)
    (site / 'revision.txt').write_text(source + '\n', encoding='utf-8')
    return verify(site, source)


def verify(site, source):
    """Read-only validation of the exact Build artifact before deployment."""
    revision(source)
    files = inventory(site)
    if any(Path(name).suffix.lower() in FORBIDDEN for name in files):
        raise ValueError('Firmware or font file in Pages site')
    if not (site / 'index.html').is_file():
        raise ValueError('Missing documentation home')
    for path in (site / 'revision.txt', site / 'emulator/revision.txt'):
        if path.read_text(encoding='utf-8') != source + '\n':
            raise ValueError('Artifact source revision mismatch')
    app = site / 'emulator'
    if set(inventory(app)) != ASSETS | METADATA:
        raise ValueError('Missing or unexpected emulator files')
    expected = manifest_assets(json.loads((app / 'asset-manifest.json').read_text(encoding='utf-8')), source)
    for name, wanted in expected.items():
        if digest((app / name).read_bytes()) != wanted:
            raise ValueError(f'Asset hash mismatch: {name}')
    if (app / 'orchard.wasm').read_bytes()[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('Invalid production WASM header')
    return len(expected)
