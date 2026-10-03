#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Validate downloaded Build assets, or verify the actual public HTTPS assets."""
import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from pages import MAX_ASSET, digest, manifest_assets, revision, verify


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ValueError('Refusing a non-HTTPS redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def verify_live(url, source):
    revision(source)
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != 'https' or not parts.netloc or parts.query or parts.fragment:
        raise ValueError('Expected a plain HTTPS site URL')
    base = url.rstrip('/') + '/'
    opener = urllib.request.build_opener(HTTPSOnly())

    def get(name):
        for attempt in range(6):
            try:
                with opener.open(base + name + '?revision=' + source, timeout=25) as response:
                    data = response.read(MAX_ASSET + 1)
                if len(data) > MAX_ASSET:
                    raise ValueError(f'Oversized published file: {name}')
                return data
            except (OSError, ValueError):
                if attempt == 5:
                    raise
                time.sleep(3)

    for name in ('revision.txt', 'emulator/revision.txt'):
        if get(name).decode('utf-8') != source + '\n':
            raise ValueError('Live source revision mismatch')
    if b'Orchard' not in get('index.html'):
        raise ValueError('Documentation home missing')
    expected = manifest_assets(json.loads(get('emulator/asset-manifest.json')), source)
    for name, wanted in expected.items():
        if digest(get('emulator/' + name)) != wanted:
            raise ValueError(f'Live asset hash mismatch: {name}')
    return len(expected)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--site', type=Path)
    group.add_argument('--url')
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    count = verify(args.site, args.revision) if args.site else verify_live(args.url, args.revision)
    print(f'Verified {count} emulator assets and documentation; revision {args.revision}')
