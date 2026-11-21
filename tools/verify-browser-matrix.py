#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run complete calculator browser workflows against one immutable local build.

This uses real ROMs, HTTP, the production Worker and browser storage. It does
not measure a percentage of all calculator features or replace application,
peripheral, cross-browser or physical-board acceptance. Inputs and detailed
outputs stay private; no firmware is copied into the distribution.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent


def sha(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def assets(directory: Path) -> dict[str, str]:
    return {path.relative_to(directory).as_posix(): sha(path)
            for path in sorted(directory.rglob('*')) if path.is_file()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, action='append', required=True,
                        help='Complete local NOR; repeat for each model. Never upload these outputs.')
    parser.add_argument('--output', type=Path, required=True,
                        help='New private directory; an existing directory is never overwritten.')
    parser.add_argument('--jobs', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--dist', type=Path, default=ROOT / 'dist',
                        help='Complete frozen web distribution, including a downloaded release.')
    parser.add_argument('--timeout-seconds', type=int, default=600)
    parser.add_argument('--expected-wasm', help='Optional independently retained production WASM SHA-256.')
    args = parser.parse_args()
    if args.timeout_seconds < 1:
        parser.error('--timeout-seconds must be positive')
    distribution = args.dist.resolve(strict=True)
    initial_assets = assets(distribution)
    for required in ('orchard.wasm', 'worker.js', 'calculator.js', 'skins/manifest.json'):
        if required not in initial_assets:
            parser.error(f'Build the complete web distribution first; missing {required}')
    wasm_hash = initial_assets['orchard.wasm']
    if args.expected_wasm and args.expected_wasm != wasm_hash:
        parser.error('The production WASM does not match --expected-wasm')
    inputs = []
    identities = set()
    for index, value in enumerate(args.rom):
        path = value.resolve(strict=True)
        if not path.is_file() or path.stat().st_size not in (1048576, 2097152):
            parser.error(f'Expected a complete 1 or 2 MiB NOR: {path.name}')
        identity = sha(path)
        if identity in identities:
            parser.error(f'Duplicate ROM bytes would double-count a model: {path.name}')
        identities.add(identity)
        inputs.append((index, path, identity))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)

    def run(item: tuple[int, Path, str]) -> dict:
        index, rom, identity = item
        stem = f'{index + 1:02d}-{identity[:12]}'
        destination = output / stem
        log = output / f'{stem}.log'
        command = [sys.executable, str(ROOT / 'tools/probe-local-workflows-browser.py'),
                   '--rom', str(rom), '--output', str(destination),
                   '--dist', str(distribution),
                   '--expected-wasm', wasm_hash, '--self-test', '--session-roundtrip']
        started = time.monotonic()
        error = None
        with log.open('w', encoding='utf-8') as stream:
            try:
                process = subprocess.run(command, cwd=ROOT, stdout=stream,
                                         stderr=subprocess.STDOUT, timeout=args.timeout_seconds)
                returncode = process.returncode
            except subprocess.TimeoutExpired:
                returncode = None
                error = f'Browser workflow exceeded {args.timeout_seconds} seconds'
        detail_path = destination / 'report.json'
        detail = None
        if detail_path.is_file():
            try:
                detail = json.loads(detail_path.read_text(encoding='utf-8'))
            except (OSError, ValueError) as failure:
                error = f'Invalid child report: {failure}'
        elif error is None:
            error = 'Browser workflow did not produce its required report'
        try:
            unchanged = sha(rom) == identity
        except OSError:
            unchanged = False
        passed = returncode == 0 and bool(detail and detail.get('passed')) and unchanged
        result = dict(rom_name=rom.name, rom_sha256=identity, passed=passed,
                      model=(detail or {}).get('model'),
                      returncode=returncode, seconds=round(time.monotonic() - started, 3),
                      rom_unchanged=unchanged, report=f'{stem}/report.json',
                      log=log.name, error=error or (detail or {}).get('error'))
        print(json.dumps({key: result[key] for key in ('rom_name', 'passed', 'seconds', 'error')}), flush=True)
        return result

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(run, inputs))
    try:
        final_assets = assets(distribution)
        build_unchanged = initial_assets == final_assets
    except OSError:
        build_unchanged = False
    report = dict(schema='orchard-browser-matrix-v1',
                  scope='Production HTTP/Worker ROM, calculator, storage, session and self-test workflows',
                  complete_feature_percentage=None, firmware_included=False,
                  wasm_sha256=wasm_hash, assets=initial_assets,
                  build_unchanged=build_unchanged, cases=results,
                  passed=build_unchanged and all(result['passed'] for result in results))
    (output / 'matrix.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(passed=report['passed'], cases=len(results), build_unchanged=build_unchanged)), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
