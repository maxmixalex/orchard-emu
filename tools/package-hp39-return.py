#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Rebuild the HP39 return probe and its pinned external launcher; no network.

The calculator package carries HP-GCC's matching sources and licence separately.
HPTools itself is a local, external build dependency, never vendored or patched
by this script. See docs/development/hp39-return-probe.md for its provenance.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'hp39gs-arm-return-v1/'
SDK_COMMIT = '7fa1503912338ea0fdf1d39eb584770f4d121cd2'
LAUNCHER_SHA256 = '88b0d556ae86784dc0e3ede7f53a45ece12d2513128b4fc96b9655bf881dcdd1'
APPLET_SHA256 = '08c17dbc0a0ce376bf1c2b55aece5a861b4c1dc24a0ed7ff7e9f64257e32c18c'
SOURCES = {
    'README.TXT': 'e62bdc6bfa0ed8bc36300575dcabb9cc7465af98b8025d7a848a19045074804a',
    'sources/HP39-Aplet/LIB275/lib275.s': '87ea762769d00b2c6002d06733e5ba11b1079f5fe141720b95a6809e7e4a71c8',
    'sources/HP39-Aplet/LIB275/SEXE.s': '48eefd8683599d1e01b779d0dfcb23e575f7b569b851e2e60b6ae1873a84a127',
    'sources/HP39-Aplet/LIB275/SUPROM39.A': '72cdc61b0287d036edbb63d5109d4908af44233e8360b636e10c10da248e0e44',
    'sources/HP39-Aplet/LIB275/HEADER.H': '4c149a3f5df4fb33ee0acbce70ebc363dd16f4f756eb3dffcad52eaa97f16132',
    'sources/HP39-Aplet/LIB275/makefile.bat': '87d5c4e3ca26431a3a342342a266451a08b2d7e7945a8a445196eb43bac474ee',
    'sources/HP39-Aplet/Skeleton/=Entry39.h': '7e13f8dfce7e22bf5a79fc2359c8f3720b5dda15fd92f3d6795f36a48c80ba88',
    'sources/HP39-Aplet/Skeleton/=Common.h': '081d2a538d71042ffd1bbf89fabefd588890dd8211fb1c42b9c118f7de188594',
    'sources/HP39-Aplet/Skeleton/=Head39.h': '4c149a3f5df4fb33ee0acbce70ebc363dd16f4f756eb3dffcad52eaa97f16132',
    'sources/HP39-Aplet/Skeleton/=Sharedvar.h': '193ae4a5c61b50b11b70d076c54dc67d63a0b51b89153018005a22ab302c20fe',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def inspect_aplet(data):
    """Independently walk directory back-links, code entries and the ARM object.

    This does not emulate SysRPL. Offsets below are read from the object, not
    assembler listings. Exact artifact identity is checked separately.
    """
    require(isinstance(data, bytes) and len(data) == 815, 'Expected the bounded 815-byte return applet')
    require(data[:9] == b'HP39BinB\x0b' and data[9:20] == b'ORCHARD RET', 'Wrong typed applet/title')

    def number(at, count):
        require(0 <= at <= len(data) * 2 - count, 'Object field is out of bounds')
        return sum(((data[(at + i) // 2] >> (4 * ((at + i) % 2))) & 15) << (4 * i) for i in range(count))

    def octets(at, count):
        return bytes(number(at + 2 * i, 2) for i in range(count))

    root = 40
    require(number(root, 5) == 0x02a96 and number(root + 5, 3) == 275, 'Wrong attached launcher library')
    require(number(root + 13, 5) == 0, 'Unexpected directory header field')
    at = root + 8 + number(root + 8, 5)
    end = len(data) * 2 - 1  # The final half-byte is file padding, not an object.
    require(number(end, 1) == 0, 'Nonzero file padding')
    fields = []
    while True:
        require(root + 18 <= at < end and number(at, 2) == 0, 'Bad directory back-link/name')
        fields.append((at + 2, end))
        if at == root + 18:
            break
        previous = at - 5 - number(at - 5, 5)
        require(previous < at - 5 and len(fields) < 40, 'Directory cycle/out-of-range back-link')
        end, at = at - 5, previous
    fields.reverse()
    require(len(fields) == 40, 'Wrong standard applet field count')

    # First field is the standard type list; 33 shared fields follow. Fixed
    # scalar shapes must fit their links exactly, not merely stay inside a file.
    require(number(fields[0][0], 5) == 0x02a74, 'Missing standard applet type list')
    for start, finish in fields[1:34]:
        expected = {0x02911: 10, 0x02933: 21}.get(number(start, 5))
        require(expected is not None and start + expected == finish, 'Malformed shared applet scalar')
    table, code, parameters = fields[34:37]
    for start, finish in (table, code):
        require(number(start, 5) == 0x02a4e and start + 5 + number(start + 5, 5) == finish,
                'Bad code/link-table object length')
    require(table[1] - table[0] == 30, 'Need four code-entry links')
    entries = [root + number(table[0] + 10 + 5 * index, 5) for index in range(4)]
    require(len(set(entries)) == 4 and min(entries) == code[0] + 10, 'Bad code-entry targets')
    calls, strings = [], []

    def object_end(start, limit, depth=0):
        require(depth < 12 and start + 5 <= limit, 'Truncated/deep SysRPL object')
        tag = number(start, 5)
        cursor = start + 5
        if tag in (0x02d9d, 0x02a74):  # Program/list; walk contained objects.
            while cursor + 5 <= limit:
                if number(cursor, 5) == 0x0312b:
                    return cursor + 5
                cursor = object_end(cursor, limit, depth + 1)
            raise ValueError('Unterminated program/list')
        if tag == 0x02a2c:
            size = number(cursor, 5)
            require(size >= 5 and (size - 5) % 2 == 0 and cursor + size <= limit, 'Bad string length')
            strings.append(octets(cursor + 5, (size - 5) // 2))
            return cursor + size
        if tag == 0x02e92:
            require(cursor + 6 <= limit, 'Truncated library reference')
            calls.append((number(cursor, 3), number(cursor + 3, 3)))
            return cursor + 6
        if tag == 0x02911:
            require(cursor + 5 <= limit, 'Truncated binary integer')
            return cursor + 5
        # Other words are the ROM's primitive entry pointers. This inspection
        # does not claim their execution or stack effects have been emulated.
        return cursor

    ordered = sorted(entries)
    for index, entry in enumerate(ordered):
        limit = ordered[index + 1] if index + 1 < len(ordered) else code[1]
        require(code[0] + 10 <= entry < limit <= code[1] and number(entry, 5) == 0x02d9d,
                'Entry does not point to an in-bounds program')
        require(object_end(entry, limit) == limit, 'Code entries overlap or leave unparsed bytes')
    require(calls == [(275, 0)], 'Return probe must invoke only PrRUN, library 275 command 0')
    require(b'ARM RETURN OK' in strings, 'Missing post-return display string')

    start, finish = parameters
    require(number(start, 5) == 0x02a74 and number(start + 5, 5) == 0x02a2c,
            'Missing ARM string parameter')
    size_at = start + 10
    require(number(size_at, 5) == 27 and size_at + 27 + 5 == finish, 'Wrong ARM string boundary')
    arm_at = size_at + 5
    require(number(arm_at, 5) == 0x0b34c and number(arm_at + 5, 1) == 8, 'Bad launcher V3 header')
    require(octets(arm_at + 6, 4) == b'A>CP', 'Missing launcher alignment scratch word')
    require(number(arm_at + 14, 8) == 0xe12fff1e, 'ARM payload is not exactly BX LR')
    require(number(finish - 5, 5) == 0x0312b, 'Missing parameter-list terminator')
    require(data.hex().count('1eff2fe1') <= 1, 'Unexpected duplicate aligned ARM payload')
    for start, finish in fields[37:]:
        require(object_end(start, finish) == finish, 'Malformed final applet field')
    return {'bytes': len(data), 'sha256': digest(data), 'directory_fields': 40,
            'entries': dict(zip(('main', 'entry', 'exit', 'display'), entries)),
            'launcher_library': 275, 'launcher_command': 0, 'arm_instruction': 'bx lr',
            'arm_instruction_word': 'e12fff1e', 'arm_bytes': 4, 'requested_ram': 0,
            'mmu_reconfiguration': False, 'flash_access': False,
            'stock_os_execution_verified': False, 'hardware_validated': False}


def run(tool, arguments, directory):
    result = subprocess.run([str(tool), *arguments], cwd=directory, check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
    require(not re.search(rb'ERROR\s*\*\*\*|Fatal error|Undefined symbol', result.stdout, re.I),
            f'{tool.name} reported an assembly error: {result.stdout.decode(errors="replace")}')


def build_files(sdk, hptools):
    source_bytes = {name: (sdk / name).read_bytes() for name in SOURCES}
    for name, expected in SOURCES.items():
        require(digest(source_bytes[name]) == expected, f'External source hash mismatch: {name}')
    tools = {name: (hptools / name).resolve() for name in ('sasm', 'rplcomp', 'makerom', 'sload')}
    for tool in tools.values():
        require(tool.is_file(), f'Missing external HPTools executable: {tool.name}')
    with tempfile.TemporaryDirectory(prefix='orchard-hp39-return-') as temporary:
        work = Path(temporary)
        for name in ('lib275.s', 'SEXE.s', 'SUPROM39.A', 'HEADER.H'):
            target = 'SEXE.S' if name == 'SEXE.s' else name
            (work / target).write_bytes(source_bytes[f'sources/HP39-Aplet/LIB275/{name}'])
        (work / '_bdl.a').write_text('\tNIBASC\t\\HP39BinH\\\n\tCON(2)\t((Name)-(*)-2)/2\n'
                                   '\tNIBASC\t\\ARMToolbox39\\\nName\n')
        (work / '_build.mn').write_text('TITLE ARMToolbox39\nOUTPUT __lib.o\nLLIST _.lr\n'
            'CONFIGURE ARMTbxConfig\nNAME ARMToolbox 39 1.0\nROMPHEAD _head.a\nREL _lib.o\n'
            'SEARCH SUPROM39.O\nTABLE _hash.a\nFINISH _end.a\nEND\n')
        (work / '_loader.m').write_text('TITLE ARMToolbox39\nOUTPUT lib275.sys\nOPTION CODE\n'
            'LLIST lib275.lr\nSUPPRESS XR\nSEARCH SUPROM39.O\nREL _bdl.o\nREL __lib.o\n'
            'CK LIB113 SYSEND113\nEND\n')
        run(tools['sasm'], ['-e', '-N', '-o', 'SUPROM39.O', 'SUPROM39.A'], work)
        run(tools['rplcomp'], ['lib275.s', '_lib.a', '_lib.ext'], work)
        for stem in ('_bdl', '_lib'):
            run(tools['sasm'], ['-e', '-N', '-o', f'{stem}.o', f'{stem}.a'], work)
        run(tools['makerom'], ['_build.mn', '_build.m'], work)
        for stem in ('_head', '_hash', '_end'):
            run(tools['sasm'], ['-e', '-N', '-o', f'{stem}.o', f'{stem}.a'], work)
        run(tools['sload'], ['_build.m'], work)
        run(tools['sload'], ['-H', '_loader.m'], work)
        launcher = (work / 'lib275.sys').read_bytes()
        require(len(launcher) == 1489 and digest(launcher) == LAUNCHER_SHA256,
                'Rebuilt launcher does not match the independently pinned original binary')
        for name in ('=Entry39.h', '=Common.h', '=Head39.h', '=Sharedvar.h'):
            (work / name).write_bytes(source_bytes[f'sources/HP39-Aplet/Skeleton/{name}'])
        for name in ('return.s', 'return.m'):
            shutil.copyfile(ROOT / 'tools/hp39-return' / name, work / name)
        run(tools['rplcomp'], ['return.s', 'return.a', 'return.ext'], work)
        run(tools['sasm'], ['-E', '-B', '-W', '-a', 'return.l', '-o', 'return.o', 'return.a'], work)
        run(tools['sload'], ['-H', 'return.m'], work)
        applet = (work / 'ORCHRET.000').read_bytes()
        inspection = inspect_aplet(applet)
        require(inspection['sha256'] == APPLET_SHA256, 'Unexpected return-probe build identity')
    files = {'ORCHRET.000': applet, 'lib275.sys': launcher,
             'HP39DIR.CUR': b'HP39AscA A 11 HP39DIR.0004 Root',
             'HP39DIR.000': b'HP39AscA B 11 ORCHRET.00011 ORCHARD RET H 10 lib275.sys12 ARMToolbox39'}
    readme = ROOT / 'docs/development/hp39-return-probe.md'
    instructions = (readme if readme.is_file() else ROOT / 'README-zh.md').read_text()
    repo = 'https://github.com/maxmixalex/orchard-emu/blob/main/docs/'
    instructions = instructions.replace('](../downloads/', f']({repo}downloads/')
    instructions = instructions.replace('](hp39-native-prerequisites.md)',
                                        f']({repo}development/hp39-native-prerequisites.md)')
    files['README-zh.md'] = instructions.encode()
    for name in ('LICENSE', 'tools/package-hp39-return.py', 'tools/hp39-return/return.s',
                 'tools/hp39-return/return.m', 'licenses/hpgcc39/COPYING', 'licenses/hpgcc39/NOTICE.md'):
        files[name] = (ROOT / name).read_bytes()
    files.update({f'third-party/hpgcc39/{name}': data for name, data in source_bytes.items()})
    manifest = {'schema': 'orchard-hp39-return-probe-v1', 'model': 'hp39gs',
                'purpose': 'ARM entry and return probe; no flash read',
                'minimum_stock_rom': 'C2.22 (author compatibility prerequisite; this probe not hardware tested)',
                'sdk_commit': SDK_COMMIT, 'launcher_rebuilt_byte_equal': True,
                'launcher_sha256': LAUNCHER_SHA256, 'inspection': inspection,
                'firmware_included': False, 'full_flash_reader': False,
                'hardware_validated': False,
                'files': {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items())}}
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    files['SHA256SUMS'] = ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())).encode()
    return files


def build(sdk, hptools, output):
    files = build_files(sdk, hptools)
    with output.open('xb') as target, zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(PREFIX + name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    return verify(output)


def verify(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(len(entries) == 23 and len({item.filename for item in entries}) == len(entries),
                'Unexpected/duplicate package entries')
        require(sum(item.file_size for item in entries) < 1024 * 1024, 'Package exceeds bound')
        require(all(item.filename.startswith(PREFIX) and '..' not in item.filename.split('/') and
                    item.external_attr >> 16 == 0o100644 for item in entries), 'Bad package entry path/type')
        files = {item.filename[len(PREFIX):]: archive.read(item) for item in entries}
    manifest = json.loads(files['manifest.json'])
    require(manifest['schema'] == 'orchard-hp39-return-probe-v1' and manifest['model'] == 'hp39gs' and
            manifest['hardware_validated'] is False and manifest['full_flash_reader'] is False and
            manifest['firmware_included'] is False and manifest['launcher_rebuilt_byte_equal'] is True and
            manifest['sdk_commit'] == SDK_COMMIT and manifest['launcher_sha256'] == LAUNCHER_SHA256,
            'Incorrect package scope/source identity')
    require(set(manifest['files']) == set(files) - {'manifest.json', 'SHA256SUMS'}, 'Incomplete manifest')
    expected_sums = ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())
                            if name != 'SHA256SUMS').encode()
    require(files['SHA256SUMS'] == expected_sums, 'Package checksum list differs')
    for name, metadata in manifest['files'].items():
        require(metadata == {'bytes': len(files[name]), 'sha256': digest(files[name])}, f'Changed package file: {name}')
    for name, expected in SOURCES.items():
        require(digest(files[f'third-party/hpgcc39/{name}']) == expected, f'Changed external source: {name}')
    require(digest(files['lib275.sys']) == LAUNCHER_SHA256, 'Changed external launcher')
    inspection = inspect_aplet(files['ORCHRET.000'])
    require(inspection['sha256'] == APPLET_SHA256 and inspection == manifest['inspection'], 'Changed probe/inspection')
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes()),
            'files': len(files), 'aplet': inspection, 'launcher_rebuilt_byte_equal': True,
            'hardware_validated': False, 'full_flash_reader': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    builder = commands.add_parser('build')
    builder.add_argument('--sdk', type=Path, default=ROOT / 'third-party/hpgcc39')
    builder.add_argument('--hptools', type=Path, required=True)
    builder.add_argument('output', type=Path)
    checker = commands.add_parser('verify')
    checker.add_argument('package', type=Path)
    args = parser.parse_args()
    try:
        result = build(args.sdk.resolve(), args.hptools.resolve(), args.output.resolve()) if args.command == 'build' else verify(args.package.resolve())
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(1, f'{error}\n')
