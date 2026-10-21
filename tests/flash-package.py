#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check the downloadable package is exactly reproducible from reviewed source."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('flash_package', ROOT / 'tools/package-flash-capture.py')
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
PREFIX = 'hp49gplus-flash-read-v1/'
FILES = {'LICENSE', 'README-zh.md', 'SHA256SUMS', 'manifest.json',
         'tools/flash-capture.mjs', 'tools/rom-inputs.mjs'} | {
    f'OR49{program}.{extension}' for program in 'PTAB' for extension in ('hp', 'rpl')}


class PackageTest(unittest.TestCase):
    def test_reproduction_contents_and_hashes(self):
        published = ROOT / 'docs/downloads/hp49gplus-flash-read-v1.zip'
        data = published.read_bytes()
        with tempfile.TemporaryDirectory(prefix='orchard-package-test-') as temporary:
            output = Path(temporary) / 'reproduced.zip'
            BUILDER.build(output)
            self.assertEqual(output.read_bytes(), data)
            with self.assertRaises(FileExistsError):
                BUILDER.build(output)
        digest = hashlib.sha256(data).hexdigest()
        self.assertEqual(published.with_suffix('.zip.sha256').read_text(),
                         f'{digest}  {published.name}\n')
        with zipfile.ZipFile(published) as archive:
            self.assertEqual(set(archive.namelist()),
                             {PREFIX + name for name in FILES | {'ORCHARD/', 'tools/'}})
            for entry in archive.infolist():
                self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(entry.compress_type, zipfile.ZIP_STORED)
            manifest = json.loads(archive.read(PREFIX + 'manifest.json'))
            self.assertFalse(manifest['hardware_validated'])
            self.assertFalse(manifest['physical_mapping_verified'])
            self.assertFalse(manifest['firmware_included'])
            for line in archive.read(PREFIX + 'SHA256SUMS').decode().splitlines():
                expected, name = line.split('  ', 1)
                self.assertIn(name, FILES)
                self.assertEqual(hashlib.sha256(archive.read(PREFIX + name)).hexdigest(), expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
