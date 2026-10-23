#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Validate the shipped full-reader package and reject rehashed false claims."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('hp39stream', ROOT / 'tools/package-hp39-romstream.py')
stream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stream)
PACKAGE = ROOT / 'docs/downloads/hp39gs-rom-dump-v2.zip'


class PackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with zipfile.ZipFile(PACKAGE) as archive:
            cls.files = {i.filename[len(stream.PREFIX):]: archive.read(i) for i in archive.infolist()}

    def repack(self, path, files, extra=None):
        manifest = json.loads(files['manifest.json'])
        for name in manifest['files']:
            manifest['files'][name] = {'bytes': len(files[name]), 'sha256': stream.digest(files[name])}
        files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
        files['SHA256SUMS'] = ''.join(f'{stream.digest(data)}  {name}\n' for name, data in sorted(files.items())
                                    if name != 'SHA256SUMS').encode()
        with zipfile.ZipFile(path, 'w') as archive:
            for name, data in files.items():
                entry = zipfile.ZipInfo(stream.PREFIX + name)
                entry.create_system, entry.external_attr = 3, 0o100644 << 16
                archive.writestr(entry, data)
            if extra:
                archive.writestr(extra, b'bad')

    def test_revised_calculator_and_complete_source(self):
        result = stream.verify(PACKAGE)
        self.assertEqual(result['flash_bytes'], 1048576)
        self.assertEqual(result['read_passes_per_block'], 2)
        self.assertFalse(result['calculator_bytes_unchanged'])
        self.assertEqual(result['calculator_reader_revision'], 2)
        self.assertFalse(result['hardware_validated'])
        source = self.files['third-party/hpclang/research/hp39gplus/rom-stream-entry.S']
        self.assertIn(b'0x00000c12', source)
        self.assertIn(b'0x07f00280', source)
        aplet = self.files['calculator/HPGCC000.000']
        self.assertEqual(stream.digest(aplet[stream.PAYLOAD_OFFSET:stream.PAYLOAD_OFFSET+stream.PAYLOAD_BYTES]), stream.PAYLOAD_SHA)
        for path in (ROOT / 'tools/hp39-romstream/calculator').iterdir():
            if path.suffix in ('.S', '.c', '.py', '.ld'):
                self.assertEqual(self.files[path.relative_to(ROOT).as_posix()], path.read_bytes())
        reader = self.files['tools/hp39-romstream/calculator/rom-stream-entry.S']
        self.assertIn(b'0x07f00044', reader)
        self.assertIn(b'0x07f00048', reader)
        self.assertIn(b'12288', reader)
        self.assertIn(b'hp39-rom-receiver.exe -model hp39gs', self.files['dump-hp39gs.cmd'])
        self.assertIn('GPL-2.0-or-later', self.files['manifest.json'].decode())
        self.assertIn('two reads equal', self.files['tools/hp39-romstream/receiver/main.go'].decode())
        for path in (ROOT / 'tools/hp39-romstream/receiver').iterdir():
            if path.suffix == '.go' or path.name == 'go.mod':
                self.assertEqual(self.files[path.relative_to(ROOT).as_posix()], path.read_bytes())
        self.assertEqual(self.files['tools/package-hp39-romstream.py'], (ROOT / 'tools/package-hp39-romstream.py').read_bytes())
        for name in ('hpgccaplet.s', '=Entry39.h', '=Common.h', '=Sharedvar.h', '=Head39.h'):
            self.assertIn(f'third-party/hpgcc39/sources/HP39-Aplet/Skeleton/{name}', self.files)

    def test_standalone_readme_links(self):
        readme = self.files['README-zh.md'].decode()
        source = (ROOT / 'docs/development/hp39gs-rom-dump.md').read_text()
        site = 'https://maxmixalex.github.io/orchard-emu/'
        expected = source.replace('](../downloads/', f']({site}downloads/')
        expected = expected.replace('](evidence/', f']({site}development/evidence/')
        self.assertEqual(readme, expected)
        links = re.findall(r'\]\(([^\s)]+)\)', readme)
        self.assertIn(site + 'downloads/hp39gs-rom-dump-v2.zip', links)
        self.assertIn(site + 'downloads/hp39gs-rom-dump-v2.zip.sha256', links)
        self.assertIn(site + 'development/evidence/hp39-romstream-r19.json', links)
        self.assertTrue(all(link.startswith('https://') for link in links))

    def test_rehashed_binary_and_source_tampering(self):
        names = ['calculator/HPGCC000.000', 'calculator/LIB275L.000', 'calculator/HP39DIR.000',
                 'third-party/hpclang/research/hp39gplus/rom-stream.c',
                 'third-party/hpgcc39/sources/HP39-Aplet/LIB275/SEXE.s',
                 'third-party/hpgcc39/sources/HP39-Aplet/Skeleton/hpgccaplet.s',
                 *[f'tools/hp39-romstream/calculator/{name}' for name in stream.CALCULATOR_SOURCES]]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'changed.zip'
            for name in names:
                with self.subTest(name=name):
                    files = dict(self.files)
                    value = bytearray(files[name]); value[len(value)//2] ^= 1; files[name] = bytes(value)
                    self.repack(path, files)
                    with self.assertRaises(ValueError):
                        stream.verify(path)

    def test_rehashed_false_scope_or_provenance(self):
        changes = {'hardware_validated': True, 'target_stock_os_execution_verified': False,
                   'target_native_bootloader_verified': True,
                   'target_stock_os_fixture': 'original-full-39gs-nor',
                   'original_calculator_bytes_unchanged': True, 'calculator_reader_revision': 1,
                   'reference_stock_os_execution_verified_model': 'hp39gs',
                   'firmware_included': True, 'flash_bytes': 2097152, 'read_passes_per_block': 1,
                   'full_flash_reader': False, 'target_model': 'hp49gplus',
                   'hpclang_commit': '0'*40, 'calculator_payload_sha256': '0'*64,
                   'licenses': {'calculator_aplet_and_library': 'MIT'},
                   'source_rebuild': {'arm_payload_byte_equal': True},
                   'calculator_source_sha256': {}}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'changed.zip'
            for name, value in changes.items():
                with self.subTest(name=name):
                    files = dict(self.files)
                    manifest = json.loads(files['manifest.json']); manifest[name] = value
                    files['manifest.json'] = json.dumps(manifest).encode()
                    self.repack(path, files)
                    with self.assertRaises(ValueError):
                        stream.verify(path)

    def test_archive_and_pe_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'changed.zip'
            for extra in (stream.PREFIX + '../escape', stream.PREFIX + 'calculator/HPGCC000.000', '/absolute'):
                with self.subTest(extra=extra):
                    self.repack(path, dict(self.files), extra)
                    with self.assertRaises(ValueError):
                        stream.verify(path)
        original = self.files['hp39-rom-receiver.exe']
        for position in (0, 60, 61, int.from_bytes(original[60:64], 'little')+4):
            data = bytearray(original); data[position] ^= 0xff
            with self.assertRaises(ValueError):
                stream.inspect_pe(bytes(data))


if __name__ == '__main__':
    unittest.main()
