#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Observe a stock USB object roundtrip through the production browser UI.

Requires a private, model-correct full ROM and a private session with USB and
binary transfer selected by physical calculator input. A SERVER-ready session
may be used directly; --start-server enters SERVER from a prepared HOME session
through the ordinary on-screen physical keys. Nothing
patches guest memory, changes instruction budgets, or fabricates protocol events.
The local server serves dist only. ROM/session files enter through real pickers.
This is a functional witness, not a timing benchmark or a firmware-free CI test.
"""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sha = lambda data: hashlib.sha256(data).hexdigest()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


OBSERVE = r"""(() => {
  const NativeWorker=window.Worker;
  window.__transferProbe={events:[],snapshot:null,snapshots:0,errors:[]};
  window.Worker=class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message',({data:d})=>{
        const p=window.__transferProbe;
        if(d.type==='snapshot'){
          p.snapshot={loaded:d.loaded,running:d.running,stopped:d.stopped,model:d.model,pending:d.pending,active:d.active};
          ++p.snapshots;
        }
        else if(d.type==='file-transfer-status'||d.type==='file-transfer-listing'||d.type==='usb-status'||d.type==='checkpoint-restored'){
          if(p.events.length<1024)p.events.push(d);
        }else if(d.type==='fatal'||d.type==='error')p.errors.push(d.message);
      });
    }
  };
})();"""


def terminal(page, mode, after):
    page.wait_for_function("""after=>window.__transferProbe.events.slice(after).some(e=>
      e.type==='file-transfer-status'&&!e.active)""",
                           arg=after, timeout=300000)
    events = page.evaluate('window.__transferProbe.events')[after:]
    result = [e for e in events if e['type'] == 'file-transfer-status'
              and not e['active']][-1]
    assert result['phase'] == 'complete', result
    assert result.get('direction') == mode, result
    return result


def physical_keys(page, scans):
    for scan in scans:
        page.locator(f'.skin-key[data-scan="{scan}"]').click()
    after = page.evaluate('window.__transferProbe.snapshots')
    page.wait_for_function('''after=>window.__transferProbe.snapshots>after&&
      window.__transferProbe.snapshot?.pending===0&&
      window.__transferProbe.snapshot?.active===null&&
      window.__transferProbe.snapshot?.running===true''',
                           arg=after, timeout=300000)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--session', type=Path, required=True)
    parser.add_argument('--upload', type=Path, required=True)
    parser.add_argument('--name', default='OR13UI')
    parser.add_argument('--start-server', action='store_true',
                        help='Enter SERVER through physical keys after restoring a HOME session with USB/binary flags already set')
    parser.add_argument('--server-commands', action='store_true',
                        help='Also verify directory and FINISH through the UI, then capture a physical 1+1 calculation for visual review')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir()  # Preserve earlier success/failure evidence.
    source = args.upload.read_bytes()
    if len(source) < 9 or source[:7] not in (b'HPHP48-', b'HPHP49-'):
        raise ValueError('This probe requires a binary HP object with an eight-byte header')
    report = {'schema': 'orchard-stock-browser-transfer-v1', 'passed': False,
              'performance_sample': False, 'production_worker': True,
              'start_server_with_physical_ui': args.start_server,
              'server_commands': args.server_commands,
              'rom_sha256': sha(args.rom.read_bytes()),
              'session_sha256': sha(args.session.read_bytes()),
              'upload_sha256': sha(source), 'upload_bytes': len(source),
              'source_header': source[:8].decode('ascii'),
              'assets': {name: sha((ROOT/'dist'/name).read_bytes()) for name in
                         ('orchard.wasm', 'calculator.js', 'worker.js',
                          'virtual-usb.js', 'file-transfer.js', 'kermit.js')}}
    server = ThreadingHTTPServer(('127.0.0.1', 0),
                                functools.partial(Handler, directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = None
    try:
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            if not executable:
                raise RuntimeError('Set CHROMIUM to an installed Chrome/Chromium executable')
            browser = p.chromium.launch(executable_path=executable, headless=True,
                                       args=['--no-sandbox'])
            try:
                page = browser.new_page(viewport={'width': 1360, 'height': 940}, locale='en-US')
                page.set_default_timeout(30000)
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script(OBSERVE)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.get_by_role('button', name='Settings', exact=True).wait_for()
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button', name='Open ROM', exact=True).click()
                picker.value.set_files(str(args.rom.resolve()))
                page.get_by_role('button', name='Restore', exact=True).wait_for(state='visible')
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                page.locator('#session-file').set_input_files(str(args.session.resolve()))
                page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='checkpoint-restored')")
                if args.start_server:
                    if not page.evaluate('window.__transferProbe.snapshot?.running'):
                        page.get_by_role('button', name='Resume', exact=True).click()
                    page.wait_for_function('window.__transferProbe.snapshot?.running===true')
                    physical_keys(page, (57,15,57,39,57,22,57,30,57,39,57,22,6))
                    page.screenshot(path=str(args.output/'server-before-connect.png'))
                # Use the normal UI speed and lifecycle defaults. The explicit
                # Connect/Upload action resumes after restoration or picker blur.
                page.get_by_role('button', name='Connections', exact=True).click()
                page.get_by_role('button', name='Connect USB', exact=True).click()
                page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='usb-status'&&e.phase==='Connected')", timeout=300000)
                page.locator('[data-testid="transfer-file"]').set_input_files(str(args.upload.resolve()))
                page.get_by_label('Name on calculator', exact=True).fill(args.name)
                before = page.evaluate('window.__transferProbe.events.length')
                page.get_by_role('button', name='Upload to calculator', exact=True).click()
                report['send'] = terminal(page, 'send', before)
                before = page.evaluate('window.__transferProbe.events.length')
                page.get_by_role('button', name='Get named object', exact=True).click()
                report['get'] = terminal(page, 'receive', before)
                with page.expect_download() as pending:
                    page.get_by_role('button', name='Download', exact=True).click()
                download = pending.value
                path = args.output/'returned.hp'
                download.save_as(path)
                returned = path.read_bytes()
                differences = [i for i, (a, b) in enumerate(zip(source, returned)) if a != b]
                report.update({'returned_bytes': len(returned), 'returned_sha256': sha(returned),
                               'returned_header': returned[:8].decode('ascii'),
                               'file_bytes_equal': source == returned,
                               'object_bytes_equal': source[8:] == returned[8:],
                               'object_sha256': sha(returned[8:]),
                               'differing_offsets': differences,
                               'download_name': download.suggested_filename,
                               'page_errors': errors,
                               'worker_observation': page.evaluate('window.__transferProbe')})
                assert len(returned) == len(source)
                assert source[:7] == returned[:7]
                assert differences in ([], [7]), report
                assert report['object_bytes_equal'], report
                if args.server_commands:
                    before = page.evaluate('window.__transferProbe.events.length')
                    page.get_by_role('button', name='List calculator files', exact=True).click()
                    report['directory'] = terminal(page, 'receive', before)
                    listings = page.evaluate('window.__transferProbe.events')[before:]
                    listing = [e['text'] for e in listings if e['type'] == 'file-transfer-listing']
                    assert len(listing) == 1 and args.name in listing[0], listing
                    report['directory_contains_uploaded_name'] = True
                    report['directory_characters'] = len(listing[0])
                    before = page.evaluate('window.__transferProbe.events.length')
                    page.get_by_role('button', name='Exit calculator SERVER', exact=True).click()
                    report['finish'] = terminal(page, 'receive', before)
                    page.get_by_role('button', name='Close', exact=True).click()
                    physical_keys(page, (26,5,26,6))
                    page.screenshot(path=str(args.output/'after-finish-calculation.png'))
                    report['post_finish_keys'] = [26,5,26,6]
                    report['post_finish_result_requires_visual_review'] = True
                report['worker_observation'] = page.evaluate('window.__transferProbe')
                assert not errors and not report['worker_observation']['errors'], report
                assert not report['worker_observation']['snapshot']['stopped'], report
                page.screenshot(path=str(args.output/'file-transfer.png'))
                report['passed'] = True
            except Exception:
                if page:
                    report['worker_observation'] = page.evaluate('window.__transferProbe')
                    page.screenshot(path=str(args.output/'failure.png'))
                raise
            finally:
                browser.close()
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        server.shutdown(); server.server_close()
        (args.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps({key: report.get(key) for key in ('passed', 'file_bytes_equal',
                          'object_bytes_equal', 'object_sha256', 'error')}, indent=2))


if __name__ == '__main__':
    main()
