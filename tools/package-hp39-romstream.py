#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Rebuild and verify the complete HP39gs ROM streamer; no network access.

Calculator bytes intentionally match the user's hpclang e240c58c package.
The receiver reuses its retry command for two independent reads of each block.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'hp39gs-rom-dump-v1/'
APPLET_SHA = '3669fb2c2ae1f755bd542c8373a469d49165f2769affdce5435e649010c62455'
PAYLOAD_SHA = '9baa02a66891d27ec771ce69c43f737fa322a6c3bc1d63402981a02ff90851f4'
LAUNCHER_SHA = '88b0d556ae86784dc0e3ede7f53a45ece12d2513128b4fc96b9655bf881dcdd1'
CALCULATOR = {
    'HPGCC000.000': (7373, APPLET_SHA),
    'LIB275L.000': (1489, LAUNCHER_SHA),
    'HP39DIR.000': (67, 'e0af2757fafa7a7ef0989cc5926f593ec64388644dc162c5f2255581484f4799'),
    'HP39DIR.CUR': (31, '542dda3d8ae6257461c7836962e390dfa7898f6c20759b650d927f73b9718d41'),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(command, work, env=None):
    result = subprocess.run([str(x) for x in command], cwd=work, env=env, check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    require(not re.search(rb'ERROR\s*\*\*\*|Fatal error|Undefined symbol', result.stdout, re.I),
            f'Build error: {result.stdout[-4000:].decode(errors="replace")}')
    return result.stdout.decode(errors='replace')


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def rebuild_sdk(sdk, hptools, work):
    """Build the template and launcher from source, not merely copy binaries."""
    template = work / 'template'
    template.mkdir()
    for source in (sdk / 'sources/HP39-Aplet/Skeleton').iterdir():
        if source.suffix in ('.s', '.h', '.m') or source.name.startswith('='):
            shutil.copyfile(source, template / source.name)
    run([hptools / 'rplcomp', 'hpgccaplet.s', 'hpgccaplet.c'], template)
    run([hptools / 'sasm', '-E', '-B', '-W', '-a', 'hpgccaplet.l', '-o', 'hpgccaplet.o', 'hpgccaplet.c'], template)
    run([hptools / 'sload', '-H', 'hpgccaplet.m'], template)
    raw = (template / 'HPGCC000.000').read_bytes()
    require(len(raw) == 933 and raw[30:846] == (sdk / 'apletcode.bin').read_bytes() and
            raw[911:933] == (sdk / 'apletepilog.bin').read_bytes(), 'Rebuilt template differs from original')
    output = work / 'sdk-data'
    output.mkdir()
    (output / 'apletcode.bin').write_bytes(raw[30:846])
    (output / 'apletepilog.bin').write_bytes(raw[911:933])
    shutil.copyfile(sdk / 'blank.gro', output / 'blank.gro')

    library = work / 'library'
    library.mkdir()
    for name in ('lib275.s', 'SEXE.s', 'SUPROM39.A', 'HEADER.H'):
        shutil.copyfile(sdk / 'sources/HP39-Aplet/LIB275' / name,
                        library / ('SEXE.S' if name == 'SEXE.s' else name))
    (library / '_bdl.a').write_text('\tNIBASC\t\\HP39BinH\\\n\tCON(2)\t((Name)-(*)-2)/2\n'
                                  '\tNIBASC\t\\ARMToolbox39\\\nName\n')
    (library / '_build.mn').write_text('TITLE ARMToolbox39\nOUTPUT __lib.o\nLLIST _.lr\n'
        'CONFIGURE ARMTbxConfig\nNAME ARMToolbox 39 1.0\nROMPHEAD _head.a\nREL _lib.o\n'
        'SEARCH SUPROM39.O\nTABLE _hash.a\nFINISH _end.a\nEND\n')
    (library / '_loader.m').write_text('TITLE ARMToolbox39\nOUTPUT lib275.sys\nOPTION CODE\n'
        'LLIST lib275.lr\nSUPPRESS XR\nSEARCH SUPROM39.O\nREL _bdl.o\nREL __lib.o\n'
        'CK LIB113 SYSEND113\nEND\n')
    run([hptools / 'sasm', '-e', '-N', '-o', 'SUPROM39.O', 'SUPROM39.A'], library)
    run([hptools / 'rplcomp', 'lib275.s', '_lib.a', '_lib.ext'], library)
    for stem in ('_bdl', '_lib'):
        run([hptools / 'sasm', '-e', '-N', '-o', f'{stem}.o', f'{stem}.a'], library)
    run([hptools / 'makerom', '_build.mn', '_build.m'], library)
    for stem in ('_head', '_hash', '_end'):
        run([hptools / 'sasm', '-e', '-N', '-o', f'{stem}.o', f'{stem}.a'], library)
    run([hptools / 'sload', '_build.m'], library)
    run([hptools / 'sload', '-H', '_loader.m'], library)
    launcher = (library / 'lib275.sys').read_bytes()
    require(digest(launcher) == LAUNCHER_SHA, 'Rebuilt 39-specific launcher differs')
    (output / 'LIB275L.L39').write_bytes(launcher)
    return output


def build_files(upstream, sdk, atfe, hptools, go):
    pins = json.loads((ROOT / 'tools/hp39-romstream/upstream.json').read_text())
    inputs = {}
    for category, folder in (('hpclang', upstream), ('hpgcc39', sdk)):
        for name, expected in pins[category].items():
            data = (folder / name).read_bytes()
            require(digest(data) == expected, f'Pinned source mismatch: {category}/{name}')
            inputs[f'third-party/{category}/{name}'] = data
    with tempfile.TemporaryDirectory(prefix='orchard-hp39-stream-') as temporary:
        work = Path(temporary)
        src = upstream / 'research/hp39gplus'
        cc, ld = atfe / 'bin/clang', atfe / 'bin/ld.lld'
        version = run([cc, '--version'], work).splitlines()[0]
        require('22.1.0' in version, 'Exact calculator rebuild requires ATfE 22.1.0')
        flags = ['--target=arm-none-eabi', '-mcpu=arm920t', '-marm', '-msoft-float',
                 '-ffreestanding', '-fno-builtin', '-fno-stack-protector', '-fno-unwind-tables',
                 '-fno-asynchronous-unwind-tables', '-fno-jump-tables', '-Os', '-Wall', '-Wextra', '-Werror']
        run([cc, *flags, '-c', src / 'rom-stream.c', '-o', work / 'stream.o'], work)
        run([cc, '--target=arm-none-eabi', '-mcpu=arm920t', '-marm', '-ffreestanding', '-fno-pic',
             '-c', src / 'rom-stream-entry.S', '-o', work / 'entry.o'], work)
        run([ld, '-T', src / 'rom-stream.ld', '--gc-sections', work / 'entry.o', work / 'stream.o',
             '-o', work / 'stream.elf'], work)
        rel = run([atfe / 'bin/llvm-readelf', '-r', work / 'stream.elf'], work)
        require('R_ARM_' not in rel, 'Payload has relocations')
        require(not run([atfe / 'bin/llvm-nm', '-u', work / 'stream.elf'], work).strip(), 'Payload has undefined symbols')
        run([atfe / 'bin/llvm-objcopy', '-O', 'binary', work / 'stream.elf', work / 'stream.bin'], work)
        payload = (work / 'stream.bin').read_bytes()
        require(len(payload) == 6376 and digest(payload) == PAYLOAD_SHA, 'Rebuilt payload differs from original')
        wrapper = module(src / 'rom-stream-wrap.py', 'hp39_stream_wrap')
        (work / 'stream.hp').write_bytes(wrapper.wrap(payload))
        sdk_data = rebuild_sdk(sdk, hptools, work)
        prepare = module(upstream / 'tools/prepare-hp39-aplet.py', 'hp39_stream_prepare')
        source = sdk / 'sources/HP39-Aplet/hp2aplet/hp2aplet.c'
        (work / 'hp2aplet.c').write_text(prepare.normalize_hp2aplet(source.read_text(errors='replace')))
        run(['cc', '-O2', work / 'hp2aplet.c', '-o', work / 'hp2aplet'], work)
        (work / 'hp39prj.dat').write_text('HP39 Aplet Project\nH39 ROM USB\nhpclang read-only HP39g+ USB ROM streamer\nN\n')
        run([work / 'hp2aplet', work / 'stream.hp'], work, dict(os.environ, HPGCC=str(sdk_data)))
        files = {}
        for name, (size, expected) in CALCULATOR.items():
            file = work / (name.lower() if name.startswith('HP39DIR') else name)
            data = file.read_bytes()
            require(len(data) == size and digest(data) == expected, f'Rebuilt calculator file differs: {name}')
            files[f'calculator/{name}'] = data
        receiver = ROOT / 'tools/hp39-romstream/receiver'
        env = dict(os.environ, GOTOOLCHAIN='local', CGO_ENABLED='0')
        go_version = run([go, 'version'], work, env).strip()
        run([go, 'test', '-count=1', './...'], receiver, env)
        run([go, 'build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w -buildid=', '-o', work / 'hp39-rom-receiver.exe', '.'],
            receiver, dict(env, GOOS='windows', GOARCH='amd64'))
        files['hp39-rom-receiver.exe'] = (work / 'hp39-rom-receiver.exe').read_bytes()
    files.update(inputs)
    for name in ('LICENSE', 'licenses/hpgcc39/COPYING', 'licenses/hp39-romstream/NOTICE.md',
                 'tools/package-hp39-romstream.py', 'tools/hp39-romstream/upstream.json'):
        files[name] = (ROOT / name).read_bytes()
    for path in sorted((ROOT / 'tools/hp39-romstream/receiver').iterdir()):
        if path.suffix == '.go' or path.name == 'go.mod':
            files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    docs = ROOT / 'docs/development/hp39gs-rom-dump.md'
    readme = (docs if docs.is_file() else ROOT / 'README-zh.md').read_text()
    # The standalone archive has neither the site's downloads nor its evidence
    # tree. Make those links absolute; the operation is idempotent when rebuilding
    # from the already-transformed README in an unpacked package.
    site = 'https://maxmixalex.github.io/orchard-emu/'
    readme = readme.replace('](../downloads/', f']({site}downloads/')
    readme = readme.replace('](evidence/', f']({site}development/evidence/')
    files['README-zh.md'] = readme.encode()
    manifest = {
        'schema': 'orchard-hp39-rom-stream-package-v1', 'target_model': 'hp39gs',
        'full_flash_reader': True, 'flash_bytes': 1048576, 'block_bytes': 16384,
        'read_passes_per_block': 2, 'hardware_validated': False,
        'target_stock_os_execution_verified': False,
        'reference_stock_os_execution_verified_model': 'hp39gplus', 'firmware_included': False,
        'original_calculator_bytes_unchanged': True,
        'hpclang_commit': pins['hpclang_commit'], 'sdk_commit': pins['sdk_commit'],
        'calculator_payload_bytes': 6376, 'calculator_payload_sha256': PAYLOAD_SHA,
        'calculator_aplet_sha256': APPLET_SHA, 'launcher_sha256': LAUNCHER_SHA,
        'source_rebuild': {'arm_payload_byte_equal': True, 'aplet_byte_equal': True,
                           'template_byte_equal': True, 'launcher_byte_equal': True},
        'toolchain': {'arm': version, 'go': go_version, 'hptools': '3.0.8 with pdo 20190426 patch'},
        'licenses': {'calculator_aplet_and_library': 'GPL-2.0-or-later',
                     'hpclang_arm_sources_and_receiver': 'MIT', 'orchard_changes': 'MIT'},
        'files': {name: {'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items())},
    }
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    files['SHA256SUMS'] = ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())).encode()
    return files


def build(upstream, sdk, atfe, hptools, go, output):
    require(not output.exists(), f'Output already exists: {output}')
    files = build_files(upstream, sdk, atfe, hptools, go)
    # Publish only a complete, synced archive, without replacing an existing file.
    with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.hp39-stream-', delete=False) as target:
        temporary = Path(target.name)
        try:
            with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for name, data in sorted(files.items()):
                    entry = zipfile.ZipInfo(PREFIX + name, date_time=(1980, 1, 1, 0, 0, 0))
                    entry.create_system, entry.external_attr = 3, 0o100644 << 16
                    entry.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(entry, data, compresslevel=9)
            target.flush()
            os.fsync(target.fileno())
            verify(temporary)
            os.link(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
    return verify(output)


def inspect_pe(data):
    require(1000000 < len(data) < 5000000 and data[:2] == b'MZ', 'Invalid Windows receiver')
    pe = struct.unpack_from('<I', data, 60)[0]
    require(pe + 26 <= len(data) and data[pe:pe+4] == b'PE\0\0', 'Invalid PE header')
    require(struct.unpack_from('<H', data, pe+4)[0] == 0x8664 and
            struct.unpack_from('<H', data, pe+24)[0] == 0x20b, 'Receiver must be Windows x64 PE32+')
    return {'machine': 'amd64', 'format': 'PE32+', 'bytes': len(data), 'sha256': digest(data)}


def verify(path):
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        require(len(entries) < 100 and len({e.filename for e in entries}) == len(entries), 'Duplicate/excess archive entries')
        require(sum(e.file_size for e in entries) < 12*1024*1024, 'Archive exceeds size limit')
        require(all(e.filename.startswith(PREFIX) and '..' not in e.filename.split('/') and '\\' not in e.filename
                    and e.external_attr >> 16 == 0o100644 for e in entries), 'Invalid archive path/type')
        files = {e.filename[len(PREFIX):]: archive.read(e) for e in entries}
    m = json.loads(files['manifest.json'])
    require(m['schema'] == 'orchard-hp39-rom-stream-package-v1' and m['target_model'] == 'hp39gs' and
            m['full_flash_reader'] is True and m['flash_bytes'] == 1048576 and m['block_bytes'] == 16384 and
            m['read_passes_per_block'] == 2 and m['hardware_validated'] is False and
            m['firmware_included'] is False and m['original_calculator_bytes_unchanged'] is True,
            'Wrong package scope or unsupported hardware claim')
    require(m['target_stock_os_execution_verified'] is False and
            m['reference_stock_os_execution_verified_model'] == 'hp39gplus', 'Unsupported stock OS execution claim')
    require(set(m['files']) == set(files) - {'manifest.json', 'SHA256SUMS'}, 'Incomplete package manifest')
    require(files['SHA256SUMS'] == ''.join(f'{digest(data)}  {name}\n' for name, data in sorted(files.items())
                                         if name != 'SHA256SUMS').encode(), 'Changed package checksum list')
    for name, info in m['files'].items():
        require(info == {'bytes': len(files[name]), 'sha256': digest(files[name])}, f'Changed package file: {name}')
    pins = json.loads(files['tools/hp39-romstream/upstream.json'])
    require(pins == json.loads((ROOT / 'tools/hp39-romstream/upstream.json').read_text()), 'Changed upstream pin set')
    require(m['hpclang_commit'] == pins['hpclang_commit'] and m['sdk_commit'] == pins['sdk_commit'], 'Wrong source commits')
    for category in ('hpclang', 'hpgcc39'):
        for name, expected in pins[category].items():
            require(digest(files[f'third-party/{category}/{name}']) == expected, f'Changed source: {category}/{name}')
    for name, (size, expected) in CALCULATOR.items():
        require(len(files[f'calculator/{name}']) == size and digest(files[f'calculator/{name}']) == expected,
                f'Changed calculator object: {name}')
    aplet = files['calculator/HPGCC000.000']
    require(digest(aplet[861:861+6376]) == PAYLOAD_SHA, 'Payload boundary/hash mismatch')
    require(m['calculator_payload_bytes'] == 6376 and m['calculator_payload_sha256'] == PAYLOAD_SHA and
            m['calculator_aplet_sha256'] == APPLET_SHA and m['launcher_sha256'] == LAUNCHER_SHA, 'Wrong binary identity')
    require(m['source_rebuild'] == {'arm_payload_byte_equal': True, 'aplet_byte_equal': True,
                                   'template_byte_equal': True, 'launcher_byte_equal': True}, 'Incomplete source correspondence')
    require(m['licenses'] == {'calculator_aplet_and_library': 'GPL-2.0-or-later',
                             'hpclang_arm_sources_and_receiver': 'MIT', 'orchard_changes': 'MIT'}, 'Wrong licensing scope')
    pe = inspect_pe(files['hp39-rom-receiver.exe'])
    require('tools/hp39-romstream/receiver/protocol_test.go' in files and
            'third-party/hpgcc39/sources/HP39-Aplet/Skeleton/hpgccaplet.s' in files and
            'licenses/hpgcc39/COPYING' in files, 'Missing corresponding source/test/license')
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes()), 'files': len(files),
            'calculator_bytes_unchanged': True, 'full_flash_reader': True, 'flash_bytes': 1048576,
            'read_passes_per_block': 2, 'hardware_validated': False, 'windows_receiver': pe,
            'source_rebuild': m['source_rebuild']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    builder = commands.add_parser('build')
    builder.add_argument('--upstream', type=Path, default=ROOT / 'third-party/hpclang')
    builder.add_argument('--sdk', type=Path, default=ROOT / 'third-party/hpgcc39')
    builder.add_argument('--atfe', type=Path, required=True)
    builder.add_argument('--hptools', type=Path, required=True)
    builder.add_argument('--go', default='go')
    builder.add_argument('output', type=Path)
    checker = commands.add_parser('verify')
    checker.add_argument('package', type=Path)
    args = parser.parse_args()
    try:
        result = build(args.upstream.resolve(), args.sdk.resolve(), args.atfe.resolve(), args.hptools.resolve(),
                       args.go, args.output.resolve()) if args.command == 'build' else verify(args.package.resolve())
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(1, f'{error}\n')
