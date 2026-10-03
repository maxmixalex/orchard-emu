#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""ROM-free publication contract tests, with generated non-executable placeholders."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from pages import ASSETS, MAX_ASSET, assemble, verify

SHA = 'a' * 40


class PagesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.site, self.dist = self.root / 'site', self.root / 'dist'
        self.site.mkdir()
        (self.site / 'index.html').write_text('Orchard documentation')
        for name in ASSETS:
            path = self.dist / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'generated test asset')
        (self.dist / 'orchard.wasm').write_bytes(b'\0asm\x01\0\0\0')

    def build(self):
        self.assertEqual(assemble(self.site, self.dist, SHA), len(ASSETS))

    def test_roundtrip_repeat_and_docs_preserved(self):
        self.build()
        self.assertEqual(verify(self.site, SHA), len(ASSETS))
        self.build()
        self.assertEqual((self.site / 'index.html').read_text(), 'Orchard documentation')

    def test_every_asset_required(self):
        for name in ASSETS:
            with self.subTest(asset=name):
                path = self.dist / name
                old = path.read_bytes(); path.unlink()
                with self.assertRaises(ValueError): self.build()
                path.write_bytes(old)

    def test_no_unlisted_or_firmware(self):
        for name in ('flash.bin', 'mock.html', 'font.woff2', 'tests.js', 'session.orchard', 'ram.state'):
            with self.subTest(name=name):
                path = self.dist / name; path.write_text('unpublishable')
                with self.assertRaises(ValueError): self.build()
                path.unlink()
        (self.site / 'flash.rom').write_text('unpublishable')
        with self.assertRaises(ValueError): self.build()

    def test_invalid_revision(self):
        for value in ('main', '', 'a' * 39, 'G' * 40, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                assemble(self.site, self.dist, value)

    def test_symlinks(self):
        path = self.dist / 'linked'; path.symlink_to(self.site, target_is_directory=True)
        with self.assertRaises(ValueError): self.build()
        path.unlink()
        path = self.site / 'emulator'; path.symlink_to(self.dist, target_is_directory=True)
        with self.assertRaises(ValueError): self.build()

    def test_size_and_wasm(self):
        path = self.dist / 'orchard.wasm'
        for data in (b'not wasm', b'x' * (MAX_ASSET + 1)):
            path.write_bytes(data)
            with self.assertRaises(ValueError): self.build()

    def test_revision_pair(self):
        self.build()
        with self.assertRaises(ValueError): verify(self.site, 'b' * 40)
        (self.site / 'emulator/revision.txt').write_text('b' * 40 + '\n')
        with self.assertRaises(ValueError): verify(self.site, SHA)

    def test_tamper_and_extra_file(self):
        self.build()
        path = self.site / 'emulator/style.css'; old = path.read_bytes(); path.write_bytes(old + b'x')
        with self.assertRaises(ValueError): verify(self.site, SHA)
        path.write_bytes(old)
        (self.site / 'emulator/test-report.txt').write_text('unexpected')
        with self.assertRaises(ValueError): verify(self.site, SHA)

    def test_manifest_contract(self):
        self.build()
        path = self.site / 'emulator/asset-manifest.json'
        valid = json.loads(path.read_text())
        for mutation in ('revision', 'traversal', 'missing', 'hash', 'null'):
            data = json.loads(json.dumps(valid))
            if mutation == 'revision': data['revision'] = 'b' * 40
            if mutation == 'traversal': data['assets']['../secret'] = '0' * 64
            if mutation == 'missing': del data['assets']['LICENSE']
            if mutation == 'hash': data['assets']['LICENSE'] = 'not a hash'
            if mutation == 'null': data['assets'] = None
            path.write_text(json.dumps(data))
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): verify(self.site, SHA)


if __name__ == '__main__':
    unittest.main(verbosity=2)
