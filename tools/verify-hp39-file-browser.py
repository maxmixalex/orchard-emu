#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Verify HP39g+ Disk drive transfers in the unchanged production browser UI.

Starts from a complete private D1.55 ROM, boots using physical on-screen keys,
hosts the original four-file hpclang ROM-streamer package through a real picker,
lets stock RECV request its aplet and library, then downloads the three files
created by stock SEND. No guest memory, Worker inputs, timing or protocol events
are injected. A passive Worker observer retains bounded status metadata only.
It presses no aplet START key and issues no ROM-stream command. Private screenshots and downloads remain in
the new output directory; only the report without firmware bytes is publishable.
"""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import threading
import zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ROM_HASH = '95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67'
FILES = ('HP39DIR.CUR', 'HP39DIR.000', 'HPGCC000.000', 'LIB275L.000')
SOURCE_HASHES = (
    '542dda3d8ae6257461c7836962e390dfa7898f6c20759b650d927f73b9718d41',
    'e0af2757fafa7a7ef0989cc5926f593ec64388644dc162c5f2255581484f4799',
    '3669fb2c2ae1f755bd542c8373a469d49165f2769affdce5435e649010c62455',
    '88b0d556ae86784dc0e3ede7f53a45ece12d2513128b4fc96b9655bf881dcdd1',
)
RETURNED = ('H39ROMUS.000', 'LIB275L0.000', 'HP39DIR.000')
ASSETS = ('orchard.wasm', 'calculator.js', 'worker.js', 'virtual-usb.js',
          'file-transfer.js', 'kermit.js', 'hp39-files.js', 'hp39-transfer.js', 'hp39-archive.js')
sha = lambda data: hashlib.sha256(data).hexdigest()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


OBSERVE = r"""(() => {
  const NativeWorker=window.Worker;
  window.__hp39Transfer={events:[],snapshot:null,snapshots:0,errors:[]};
  window.Worker=class extends NativeWorker {
    constructor(...args){
      super(...args);
      this.addEventListener('message',({data:d})=>{
        const p=window.__hp39Transfer;
        if(d.type==='snapshot'){
          p.snapshot={loaded:d.loaded,running:d.running,stopped:d.stopped,
            model:d.model,width:d.width,height:d.height,pending:d.pending,
            active:d.active,tick:d.tick};++p.snapshots;
        }else if(d.type==='file-transfer-received'){
          if(p.events.length<2048)p.events.push({type:d.type,request:d.request,
            name:d.name,bytes:d.bytes.length,tick:p.snapshot?.tick});
        }else if(['file-transfer-status','file-transfer-listing','usb-status'].includes(d.type)){
          if(p.events.length<2048)p.events.push({...d,tick:p.snapshot?.tick});
        }else if(d.type==='error'||d.type==='fatal')p.errors.push(d.message);
      });
    }
  };
})();"""


def wait_ticks(page, delta):
    start = page.evaluate('window.__hp39Transfer.snapshot.tick')
    assert isinstance(start, (int, float)), 'Production snapshot must include guest tick'
    page.wait_for_function('''end=>window.__hp39Transfer.snapshot?.tick>=end||
      window.__hp39Transfer.snapshot?.stopped||window.__hp39Transfer.errors.length>0''',
                           arg=start+delta, timeout=300000)
    snapshot = page.evaluate('window.__hp39Transfer.snapshot')
    assert not snapshot['stopped'], snapshot
    assert not page.evaluate('window.__hp39Transfer.errors'), 'Worker error'


def keys(page, scans):
    for scan in scans:
        page.locator(f'.skin-key[data-scan="{scan}"]').click()
    count = page.evaluate('window.__hp39Transfer.snapshots')
    page.wait_for_function('''count=>window.__hp39Transfer.snapshots>count&&
      window.__hp39Transfer.snapshot?.pending===0&&
      window.__hp39Transfer.snapshot?.active===null&&
      window.__hp39Transfer.snapshot?.running===true''', arg=count, timeout=300000)


def typed_body(data):
    assert data[:8] == b'HP39BinH', data[:8]
    end = 9 + data[8]
    return {'title': data[9:end].decode('latin-1'), 'header_bytes': end,
            'body_bytes': len(data)-end, 'body_sha256': sha(data[end:])}, data[end:]


def wait_transfer(page, condition, arg=None):
    # End on a concrete operation failure instead of spending the remaining
    # deadline waiting for a completion which can no longer arrive.
    failed = """window.__hp39Transfer.errors.length>0||window.__hp39Transfer.snapshot?.stopped||
      window.__hp39Transfer.events.some(e=>e.type==='file-transfer-status'&&e.phase==='error')"""
    page.wait_for_function(f'arg=>({condition})||({failed})', arg=arg, timeout=600000)
    assert page.evaluate(f'arg=>({condition})', arg), page.evaluate('window.__hp39Transfer')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--package', type=Path, required=True,
                        help='Original hpclang calculator/ directory (four files)')
    parser.add_argument('--archive', type=Path,
                        help='Import the original hpclang ZIP through the picker, then re-import the downloaded ZIP on a fresh machine')
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{64}', args.expected_wasm):
        parser.error('--expected-wasm must be a lowercase SHA-256')
    rom = args.rom.read_bytes()
    assert len(rom) == 1048576 and sha(rom) == ROM_HASH, 'Use the admitted complete HP39g+ D1.55 NOR'
    assert sha((ROOT/'dist/orchard.wasm').read_bytes()) == args.expected_wasm
    sources = {name: (args.package/name).read_bytes() for name in FILES}
    assert tuple(sha(sources[name]) for name in FILES) == SOURCE_HASHES, 'Use the original unchanged four-file hpclang package'
    if args.archive:
        with zipfile.ZipFile(args.archive) as archive:
            assert all(archive.read('calculator/'+name) == data for name, data in sources.items())
    expected_total = len(sources['HPGCC000.000']) + len(sources['LIB275L.000'])
    args.output.mkdir()  # Never replace an earlier success or failed witness.
    report = {'schema': 'orchard-hp39-stock-browser-transfer-v1', 'passed': False,
              'performance_sample': False, 'production_worker': True,
              'cold_boot': True, 'model': 1, 'transport': 'usb',
              'rom_sha256': ROM_HASH, 'expected_wasm_sha256': args.expected_wasm,
              'assets': {name: sha((ROOT/'dist'/name).read_bytes()) for name in ASSETS},
              'inputs': {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in sources.items()},
              'tool_sha256': sha(Path(__file__).read_bytes())}
    def stage(name):
        report['stage'] = name
        print('STAGE', name, flush=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0),
                                functools.partial(Handler, directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = None
    try:
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            if not executable:
                raise RuntimeError('Set CHROMIUM to Chrome/Chromium')
            browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
            try:
                report['browser_version'] = browser.version
                page = browser.new_page(viewport={'width': 1360, 'height': 1000}, locale='en-US')
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script(OBSERVE)
                stage('open-rom')
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                # Standard file-input/local-copy path; native picker permission UI is separate.
                page.locator('#rom').set_input_files(str(args.rom.resolve()))
                page.wait_for_function('window.__hp39Transfer.snapshot?.loaded&&window.__hp39Transfer.snapshot?.running')
                snapshot = page.evaluate('window.__hp39Transfer.snapshot')
                assert (snapshot['model'], snapshot['width'], snapshot['height']) == (1, 131, 64), snapshot
                stage('cold-boot-physical-keys')
                wait_ticks(page, 50000000)
                keys(page, (40,))  # Memory Clear OK.
                wait_ticks(page, 70000000)
                keys(page, (49,))  # APLET.
                wait_ticks(page, 20000000)
                keys(page, (39,))  # RECV.
                wait_ticks(page, 3000000)
                page.screenshot(path=str(args.output/'receive-menu.png'))
                keys(page, (44, 44))  # Disk drive.
                stage('host-original-package')
                page.get_by_role('button', name='Connections', exact=True).click()
                page.get_by_role('button', name='Connect USB', exact=True).click()
                page.wait_for_function("window.__hp39Transfer.events.some(e=>e.type==='usb-status'&&e.phase==='Connected')", timeout=300000)
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button', name='Choose file', exact=True).click()
                picker.value.set_files(str(args.archive.resolve()) if args.archive else [str((args.package/name).resolve()) for name in FILES])
                page.get_by_role('button', name='Host selected files', exact=True).click()
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                keys(page, (6,))
                wait_transfer(page, "window.__hp39Transfer.events.some(e=>e.type==='file-transfer-status'&&e.phase==='serving'&&e.name==='HP39DIR.000')")
                wait_ticks(page, 30000000)
                page.screenshot(path=str(args.output/'host-directory.png'))
                keys(page, (6,))  # Select H39 ROM USB; stock OS requests its library.
                wait_transfer(page, "window.__hp39Transfer.events.some(e=>e.type==='file-transfer-status'&&e.phase==='serving'&&e.transferred===arg&&e.total===arg)", expected_total)
                wait_ticks(page, 120000000)
                page.screenshot(path=str(args.output/'installed-aplet.png'))
                report['hosted_object_bytes'] = expected_total
                page.get_by_role('button', name='Connections', exact=True).click()
                page.get_by_role('button', name='Stop file server', exact=True).click()
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                stage('calculator-send')
                keys(page, (38,))  # SEND.
                wait_ticks(page, 3000000)
                keys(page, (44, 44, 6))  # Disk drive; Send now remains selected.
                wait_ticks(page, 3000000)
                page.screenshot(path=str(args.output/'send-now-menu.png'))
                page.get_by_role('button', name='Connections', exact=True).click()
                page.get_by_role('button', name='Receive from calculator', exact=True).click()
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                keys(page, (6,))
                wait_transfer(page, "window.__hp39Transfer.events.filter(e=>e.type==='file-transfer-received').length===3")
                wait_ticks(page, 120000000)
                page.screenshot(path=str(args.output/'after-send.png'))
                stage('download-returned-files')
                page.get_by_role('button', name='Connections', exact=True).click()
                downloads = {}
                for index, expected_name in enumerate(RETURNED):
                    with page.expect_download() as pending:
                        page.get_by_role('button', name='Download', exact=True).nth(index).click()
                    downloaded = pending.value
                    assert downloaded.suggested_filename == expected_name, downloaded.suggested_filename
                    path = args.output/expected_name
                    downloaded.save_as(path)
                    data = path.read_bytes()
                    downloads[expected_name] = data
                aplet_equal = downloads['H39ROMUS.000'] == sources['HPGCC000.000']
                source_library, source_body = typed_body(sources['LIB275L.000'])
                returned_library, returned_body = typed_body(downloads['LIB275L0.000'])
                assert aplet_equal and source_body == returned_body
                report['returned'] = {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in downloads.items()}
                report['aplet_file_bytes_equal'] = aplet_equal
                report['library'] = {'source': source_library, 'returned': returned_library,
                                     'object_bytes_equal': source_body == returned_body,
                                     'directory_alias_preserved': returned_library['title'] == 'LIB275L'}
                with page.expect_download() as pending:
                    page.get_by_role('button', name='Download package', exact=True).click()
                downloaded = pending.value
                assert downloaded.suggested_filename == 'orchard-hp39-files.zip'
                archive_path = args.output/'orchard-hp39-files.zip'
                downloaded.save_as(archive_path)
                with zipfile.ZipFile(archive_path) as archive:
                    assert archive.testzip() is None
                    assert set(archive.namelist()) == set(RETURNED) | {'HP39DIR.CUR'}
                    assert all(archive.read(name) == data for name, data in downloads.items())
                    assert b'HP39DIR.000' in archive.read('HP39DIR.CUR')
                report['downloaded_archive'] = {'sha256': sha(archive_path.read_bytes()),
                                                'exact_returned_files': True, 'missing_cur_rebuilt': True}
                page.screenshot(path=str(args.output/'downloads.png'))
                page.get_by_role('button', name='Stop file server', exact=True).click()
                page.get_by_role('button', name='Disconnect USB', exact=True).click()
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                stage('home-arithmetic')
                keys(page, (48,))  # HOME.
                wait_ticks(page, 10000000)
                keys(page, (26, 5, 26, 6))  # 1+1 ENTER.
                wait_ticks(page, 30000000)
                page.screenshot(path=str(args.output/'home-arithmetic.png'))
                report['post_send_physical_keys'] = [48, 26, 5, 26, 6]
                report['post_send_result_requires_visual_review'] = True
                report['worker_observation'] = page.evaluate('window.__hp39Transfer')
                report['page_errors'] = errors
                assert not errors and not report['worker_observation']['errors']
                assert not report['worker_observation']['snapshot']['stopped']
                statuses = [e for e in report['worker_observation']['events'] if e['type'] == 'file-transfer-status']
                assert all(e['phase'] != 'error' for e in statuses), statuses
                if args.archive:
                    stage('fresh-machine-archive-reimport')
                    # A new browser context has no calculator RAM or local
                    # saves from the first pass. Restore through the public
                    # file picker, stock RECV and USB protocol again.
                    restored = browser.new_page(viewport={'width': 1360, 'height': 1000}, locale='en-US')
                    restore_errors = []
                    restored.on('pageerror', lambda e: restore_errors.append(str(e)))
                    restored.add_init_script(OBSERVE)
                    try:
                        restored.goto(f'http://127.0.0.1:{server.server_port}/')
                        # Standard file-input/local-copy path; native picker permission UI is separate.
                        restored.locator('#rom').set_input_files(str(args.rom.resolve()))
                        restored.wait_for_function('window.__hp39Transfer.snapshot?.loaded&&window.__hp39Transfer.snapshot?.running')
                        wait_ticks(restored, 50000000); keys(restored, (40,)); wait_ticks(restored, 70000000)
                        keys(restored, (49,)); wait_ticks(restored, 20000000)
                        keys(restored, (39,)); wait_ticks(restored, 3000000); keys(restored, (44, 44))
                        restored.get_by_role('button', name='Connections', exact=True).click()
                        restored.get_by_role('button', name='Connect USB', exact=True).click()
                        restored.wait_for_function("window.__hp39Transfer.events.some(e=>e.type==='usb-status'&&e.phase==='Connected')", timeout=300000)
                        with restored.expect_file_chooser() as picker:
                            restored.get_by_role('button', name='Choose file', exact=True).click()
                        picker.value.set_files(str(archive_path.resolve()))
                        restored.get_by_role('button', name='Host selected files', exact=True).click()
                        restored.get_by_role('button', name='Close sidebar', exact=True).click(); keys(restored, (6,))
                        wait_transfer(restored, "window.__hp39Transfer.events.some(e=>e.type==='file-transfer-status'&&e.phase==='serving'&&e.name==='HP39DIR.000')")
                        wait_ticks(restored, 30000000); keys(restored, (6,))
                        returned_total = len(downloads['H39ROMUS.000']) + len(downloads['LIB275L0.000'])
                        wait_transfer(restored, "window.__hp39Transfer.events.some(e=>e.type==='file-transfer-status'&&e.phase==='serving'&&e.transferred===arg&&e.total===arg)", returned_total)
                        wait_ticks(restored, 120000000)
                        restored.screenshot(path=str(args.output/'archive-reinstalled-aplet.png'))
                        report['archive_reimport'] = {'fresh_cold_boot': True, 'object_bytes': returned_total,
                                                     'worker_observation': restored.evaluate('window.__hp39Transfer'),
                                                     'page_errors': restore_errors}
                        assert not restore_errors and not report['archive_reimport']['worker_observation']['errors']
                        assert not report['archive_reimport']['worker_observation']['snapshot']['stopped']
                    except Exception:
                        restored.screenshot(path=str(args.output/'archive-reimport-failure.png'))
                        raise
                    finally:
                        restored.close()
                assert {name: sha((ROOT/'dist'/name).read_bytes()) for name in ASSETS} == report['assets'], 'Production assets changed during witness'
                assert sha(args.rom.read_bytes()) == ROM_HASH
                assert all((args.package/name).read_bytes() == data for name, data in sources.items())
                report['passed'] = True
                stage('complete')
            except Exception as error:
                report['error'] = str(error)
                if page:
                    try:
                        report['worker_observation'] = page.evaluate('window.__hp39Transfer')
                        page.screenshot(path=str(args.output/'failure.png'), timeout=5000)
                    except Exception as secondary:
                        report['observation_error'] = str(secondary)
                raise
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close()
        (args.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps({key: report.get(key) for key in ('passed', 'stage', 'error')}, indent=2))


if __name__ == '__main__':
    main()
