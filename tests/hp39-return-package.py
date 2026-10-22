#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Check the shipped HP39 probe without requiring the external HPTools compiler."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('hp39_package', ROOT / 'tools/package-hp39-return.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
PUBLISHED = ROOT / 'docs/downloads/hp39gs-arm-return-v1.zip'
PREFIX = 'hp39gs-arm-return-v1/'


def changed_nibble(data, at):
    result = bytearray(data)
    result[at // 2] ^= 1 << (4 * (at % 2))
    return bytes(result)


class ReturnPackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with zipfile.ZipFile(PUBLISHED) as archive:
            cls.files = {name[len(PREFIX):]: archive.read(name) for name in archive.namelist()}

    def test_published_identity_and_source_correspondence(self):
        result = PACKAGE.verify(PUBLISHED)
        self.assertFalse(result['hardware_validated'])
        self.assertFalse(result['full_flash_reader'])
        self.assertEqual(PUBLISHED.with_suffix('.zip.sha256').read_text(),
                         f'{hashlib.sha256(PUBLISHED.read_bytes()).hexdigest()}  {PUBLISHED.name}\n')
        for name in ('LICENSE', 'tools/package-hp39-return.py', 'tools/hp39-return/return.s',
                     'tools/hp39-return/return.m', 'licenses/hpgcc39/COPYING', 'licenses/hpgcc39/NOTICE.md'):
            with self.subTest(source=name):
                self.assertEqual(self.files[name], (ROOT / name).read_bytes())
        instructions = (ROOT / 'docs/development/hp39-return-probe.md').read_text()
        repo = 'https://github.com/maxmixalex/orchard-emu/blob/main/docs/'
        instructions = instructions.replace('](../downloads/', f']({repo}downloads/')
        instructions = instructions.replace('](hp39-native-prerequisites.md)',
                                            f']({repo}development/hp39-native-prerequisites.md)')
        self.assertEqual(self.files['README-zh.md'], instructions.encode())
        with zipfile.ZipFile(PUBLISHED) as archive:
            for entry in archive.infolist():
                self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(entry.compress_type, zipfile.ZIP_STORED)

    def test_object_corruption_is_rejected_without_digest_shortcut(self):
        applet = self.files['ORCHRET.000']
        self.assertEqual(PACKAGE.inspect_aplet(applet)['arm_instruction_word'], 'e12fff1e')
        # These offsets come from the final object's assembler listing. Mutate
        # semantic boundaries directly so an exact-file digest cannot hide a
        # nonfunctional structural inspection. The payload is nibble aligned.
        targets = {'typed_title': 18, 'library': 45, 'directory_link': 48,
                   'code_entry': 945, 'code_length': 977, 'arm_string_size': 1546,
                   'alignment_size': 1556, 'alignment_scratch': 1557,
                   'arm_opcode': 1565, 'file_padding': 1629}
        for name, at in targets.items():
            with self.subTest(field=name), self.assertRaises(ValueError):
                PACKAGE.inspect_aplet(changed_nibble(applet, at))

    def test_changed_launcher_duplicate_and_scope_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='orchard-hp39-negative-') as temporary:
            for kind in ('launcher', 'duplicate', 'hardware_claim'):
                damaged = Path(temporary) / f'{kind}.zip'
                files = dict(self.files)
                if kind == 'launcher':
                    files['lib275.sys'] = changed_nibble(files['lib275.sys'], 100)
                elif kind == 'hardware_claim':
                    manifest = json.loads(files['manifest.json'])
                    manifest['hardware_validated'] = True
                    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
                with zipfile.ZipFile(damaged, 'w') as archive:
                    for name, data in files.items():
                        entry = zipfile.ZipInfo(PREFIX + name)
                        entry.create_system = 3
                        entry.external_attr = 0o100644 << 16
                        archive.writestr(entry, data)
                    if kind == 'duplicate':
                        with warnings.catch_warnings():
                            warnings.simplefilter('ignore', UserWarning)
                            archive.writestr(PREFIX + 'lib275.sys', files['lib275.sys'])
                with self.subTest(kind=kind), self.assertRaises(ValueError):
                    PACKAGE.verify(damaged)

    def test_packaged_checker_runs_offline(self):
        with tempfile.TemporaryDirectory(prefix='orchard-hp39-checker-') as temporary:
            script = Path(temporary) / 'package-hp39-return.py'
            script.write_bytes(self.files['tools/package-hp39-return.py'])
            result = subprocess.run([sys.executable, str(script), 'verify', str(PUBLISHED)],
                                    cwd=temporary, check=True, capture_output=True, text=True, timeout=10)
            checked = json.loads(result.stdout)
            self.assertEqual(checked['sha256'], hashlib.sha256(PUBLISHED.read_bytes()).hexdigest())
            self.assertFalse(checked['aplet']['stock_os_execution_verified'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
