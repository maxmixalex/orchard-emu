#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Observe a stock calculator object roundtrip through the production browser UI.

Requires a private, model-correct full ROM and a private session with wired and
binary transfer selected by physical calculator input. A SERVER-ready session
may be used directly; --start-server enters SERVER from a prepared HOME session
through the ordinary on-screen physical keys. With --transport serial it first
selects serial using physical SF(-78) input. Nothing
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
import re
import shutil
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASELINE_WASM = '76db5cb395cca4fffec807a76d3e969bf4cd73842662e39e81e38de4110527d0'
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
        else if(d.type==='file-transfer-status'||d.type==='file-transfer-listing'||d.type==='usb-status'||d.type==='serial-status'||d.type==='checkpoint-restored'){
          if(p.events.length<1024)p.events.push(d);
        }else if(d.type==='fatal'||d.type==='error')p.errors.push(d.message);
      });
    }
  };
})();"""


def terminal(page, mode, after, transport='usb'):
    page.wait_for_function("""after=>window.__transferProbe.events.slice(after).some(e=>
      e.type==='file-transfer-status'&&!e.active)""",
                           arg=after, timeout=300000)
    events = page.evaluate('window.__transferProbe.events')[after:]
    result = [e for e in events if e['type'] == 'file-transfer-status'
              and not e['active']][-1]
    assert result['phase'] == 'complete', result
    assert result.get('direction') == mode, result
    assert result.get('transport') == transport, result
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


def active_send_keys(name):
    """ALG SEND('NAME'), using the stock HP48gII physical keyboard."""
    if not re.fullmatch(r'[A-Z][A-Z0-9]{0,7}', name):
        raise ValueError('--active-send requires a 1–8 character uppercase alphanumeric name starting with a letter')
    alpha = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                     (35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,
                      29,22,15,8,1,30,23,16,9,2)))
    digits = dict(zip('0123456789', (27,26,19,12,25,18,11,24,17,10)))
    scans = [57,15,57,39,57,21,57,38,58,4,14]
    for character in name:
        scans.extend((57, alpha[character]) if character in alpha else (digits[character],))
    # Move beyond the quoted name; ENTER accepts the enclosing expression even
    # if the cursor remains before its already-inserted closing parenthesis.
    return scans + [45]


def download_object(page, source, path):
    with page.expect_download() as pending:
        page.get_by_role('button', name='Download', exact=True).click()
    download = pending.value
    download.save_as(path)
    returned = path.read_bytes()
    differences = [i for i, (a, b) in enumerate(zip(source, returned)) if a != b]
    result = {'bytes': len(returned), 'sha256': sha(returned),
              'header': returned[:8].decode('ascii'), 'download_name': download.suggested_filename,
              'file_bytes_equal': source == returned,
              'object_bytes_equal': source[8:] == returned[8:],
              'object_sha256': sha(returned[8:]), 'differing_offsets': differences}
    assert len(returned) == len(source) and source[:7] == returned[:7], result
    assert differences in ([], [7]) and result['object_bytes_equal'], result
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--session', type=Path, required=True)
    parser.add_argument('--upload', type=Path, required=True)
    parser.add_argument('--name', default='OR13UI')
    parser.add_argument('--transport', choices=('usb', 'serial'), default='usb')
    parser.add_argument('--expected-wasm',
                        help='Exact SHA-256 of the production WASM; required for serial, otherwise defaults to the frozen USB baseline')
    parser.add_argument('--start-server', action='store_true',
                        help='Enter SERVER through physical keys after restoring a wired/binary HOME session; serial first executes SF(-78)')
    parser.add_argument('--server-commands', action='store_true',
                        help='Also verify directory and FINISH through the UI, then capture a physical 1+1 calculation for visual review')
    parser.add_argument('--active-send', action='store_true',
                        help='After FINISH, verify physical calculator SEND, a real Receive download, then GET again on the selected connection')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.active_send and not args.server_commands:
        parser.error('--active-send requires --server-commands')
    if args.transport == 'serial' and not args.expected_wasm:
        parser.error('--transport serial requires an explicit --expected-wasm SHA-256')
    expected_wasm = args.expected_wasm or BASELINE_WASM
    if not re.fullmatch(r'[0-9a-f]{64}', expected_wasm):
        parser.error('--expected-wasm must be an exact lowercase 64-character SHA-256')
    actual_wasm = sha((ROOT/'dist/orchard.wasm').read_bytes())
    if actual_wasm != expected_wasm:
        raise ValueError(f'Production WASM identity mismatch: expected {expected_wasm}, got {actual_wasm}')
    send_scans = active_send_keys(args.name) if args.active_send else None
    args.output.mkdir()  # Preserve earlier success/failure evidence.
    source = args.upload.read_bytes()
    if len(source) < 9 or source[:7] not in (b'HPHP48-', b'HPHP49-'):
        raise ValueError('This probe requires a binary HP object with an eight-byte header')
    report = {'schema': 'orchard-stock-browser-transfer-v1', 'passed': False,
              'performance_sample': False, 'production_worker': True,
              'transport': args.transport, 'expected_wasm_sha256': expected_wasm,
              'start_server_with_physical_ui': args.start_server,
              'server_commands': args.server_commands,
              'active_send': args.active_send,
              'rom_sha256': sha(args.rom.read_bytes()),
              'session_sha256': sha(args.session.read_bytes()),
              'upload_sha256': sha(source), 'upload_bytes': len(source),
              'source_header': source[:8].decode('ascii'),
              'assets': {name: sha((ROOT/'dist'/name).read_bytes()) for name in
                         ('orchard.wasm', 'calculator.js', 'worker.js',
                          'virtual-usb.js', 'file-transfer.js', 'kermit.js')}}
    def stage(name):
        report['stage'] = name
        print('STAGE', name, flush=True)

    server = ThreadingHTTPServer(('127.0.0.1', 0),
                                functools.partial(Handler, directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = None
    try:
        with sync_playwright() as p:
            stage('launch-browser')
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
                stage('open-page')
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.get_by_role('button', name='Settings', exact=True).wait_for()
                stage('open-rom')
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button', name='Open ROM', exact=True).click()
                picker.value.set_files(str(args.rom.resolve()))
                page.get_by_role('button', name='Restore', exact=True).wait_for(state='visible')
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                stage('restore-session')
                page.locator('#session-file').set_input_files(str(args.session.resolve()))
                page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='checkpoint-restored')")
                if args.start_server:
                    stage('prepare-server')
                    if not page.evaluate('window.__transferProbe.snapshot?.running'):
                        page.get_by_role('button', name='Resume', exact=True).click()
                    page.wait_for_function('window.__transferProbe.snapshot?.running===true')
                    if args.transport == 'serial':
                        physical_keys(page, (57,15,57,40,58,4,24,17,23,45,6))
                        page.screenshot(path=str(args.output/'serial-flag-selected.png'))
                    physical_keys(page, (57,15,57,39,57,22,57,30,57,39,57,22,6))
                    page.screenshot(path=str(args.output/'server-before-connect.png'))
                # Use the normal UI speed and lifecycle defaults. The explicit
                # Connect/Upload action resumes after restoration or picker blur.
                stage('connect-' + args.transport)
                page.get_by_role('button', name='Connections', exact=True).click()
                if args.transport == 'usb':
                    page.get_by_role('button', name='Connect USB', exact=True).click()
                    page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='usb-status'&&e.phase==='Connected')", timeout=300000)
                else:
                    page.get_by_role('button', name='Connect Serial', exact=True).click()
                    page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='serial-status'&&e.connected===true)")
                    page.get_by_role('combobox', name='Connection', exact=True).click()
                    page.get_by_role('option', name='Serial', exact=True).click()
                page.locator('[data-testid="transfer-file"]').set_input_files(str(args.upload.resolve()))
                page.get_by_label('Name on calculator', exact=True).fill(args.name)
                before = page.evaluate('window.__transferProbe.events.length')
                stage('upload')
                page.get_by_role('button', name='Upload to calculator', exact=True).click()
                report['send'] = terminal(page, 'send', before, args.transport)
                before = page.evaluate('window.__transferProbe.events.length')
                stage('get')
                page.get_by_role('button', name='Get named object', exact=True).click()
                report['get'] = terminal(page, 'receive', before, args.transport)
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
                    stage('server-commands')
                    before = page.evaluate('window.__transferProbe.events.length')
                    page.get_by_role('button', name='List calculator files', exact=True).click()
                    report['directory'] = terminal(page, 'receive', before, args.transport)
                    listings = page.evaluate('window.__transferProbe.events')[before:]
                    listing = [e['text'] for e in listings if e['type'] == 'file-transfer-listing']
                    assert len(listing) == 1 and args.name in listing[0], listing
                    report['directory_contains_uploaded_name'] = True
                    report['directory_characters'] = len(listing[0])
                    before = page.evaluate('window.__transferProbe.events.length')
                    page.get_by_role('button', name='Exit calculator SERVER', exact=True).click()
                    report['finish'] = terminal(page, 'receive', before, args.transport)
                    page.get_by_role('button', name='Close', exact=True).click()
                    if args.active_send:
                        stage('calculator-send')
                        # Enter the command before starting the bounded receiver;
                        # only its final ENTER follows the Receive button.
                        physical_keys(page, send_scans)
                        page.screenshot(path=str(args.output/'calculator-send-entry.png'))
                        page.get_by_role('button', name='Connections', exact=True).click()
                        page.get_by_role('button', name='Clear list', exact=True).click()
                        before = page.evaluate('window.__transferProbe.events.length')
                        page.get_by_role('button', name='Receive from calculator', exact=True).click()
                        page.get_by_role('button', name='Close', exact=True).click()
                        physical_keys(page, (6,))
                        report['calculator_send'] = terminal(page, 'receive', before, args.transport)
                        page.get_by_role('button', name='Connections', exact=True).click()
                        report['active_send_download'] = download_object(page, source, args.output/'active-send.hp')
                        page.get_by_role('button', name='Clear list', exact=True).click()
                        page.get_by_role('button', name='Close', exact=True).click()
                        physical_keys(page, (57,15,57,39,57,22,57,30,57,39,57,22,6))
                        page.screenshot(path=str(args.output/'server-after-active-send.png'))
                        page.get_by_role('button', name='Connections', exact=True).click()
                        page.get_by_label('Name on calculator', exact=True).fill(args.name)
                        before = page.evaluate('window.__transferProbe.events.length')
                        page.get_by_role('button', name='Get named object', exact=True).click()
                        report['get_after_active_send'] = terminal(page, 'receive', before, args.transport)
                        report['subsequent_get_download'] = download_object(page, source, args.output/'after-active-send.hp')
                        report['active_send_physical_keys'] = send_scans + [6]
                        link_events = [e for e in page.evaluate('window.__transferProbe.events')
                                       if e['type'] == args.transport + '-status']
                        connected = [i for i, e in enumerate(link_events) if e.get('connected')
                                     and (args.transport == 'serial' or e['phase'] == 'Connected')]
                        assert len(connected) == 1 and all(e['connected'] for e in link_events[connected[0]:]), link_events
                        report['same_' + args.transport + '_connection'] = True
                    else:
                        physical_keys(page, (26,5,26,6))
                        page.screenshot(path=str(args.output/'after-finish-calculation.png'))
                        report['post_finish_keys'] = [26,5,26,6]
                        report['post_finish_result_requires_visual_review'] = True
                report['worker_observation'] = page.evaluate('window.__transferProbe')
                if args.transport == 'serial':
                    usb_connected = any(e['type'] == 'usb-status' and e.get('connected')
                                        for e in report['worker_observation']['events'])
                    assert not usb_connected, 'Serial witness must not connect USB'
                    report['usb_connected'] = False
                assert not errors and not report['worker_observation']['errors'], report
                assert not report['worker_observation']['snapshot']['stopped'], report
                assert {name: sha((ROOT/'dist'/name).read_bytes()) for name in report['assets']} == report['assets'], 'Production assets changed during the witness'
                page.screenshot(path=str(args.output/'file-transfer.png'))
                report['passed'] = True
                stage('complete')
            except Exception as error:
                # A stalled renderer can also reject a diagnostic screenshot.
                # Preserve the actual operation failure instead of replacing it.
                report['primary_error'] = str(error)
                if page:
                    try:
                        report['worker_observation'] = page.evaluate('window.__transferProbe')
                    except Exception as observation_error:
                        report['observation_error'] = str(observation_error)
                    try:
                        page.screenshot(path=str(args.output/'failure.png'), timeout=5000)
                    except Exception as screenshot_error:
                        report['screenshot_error'] = str(screenshot_error)
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
