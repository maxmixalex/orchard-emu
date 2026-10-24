#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Private production-browser HP39 Wire receive acceptance.

Restore a stock-ROM NOTE CATALOG prepared from cold boot and ordinary Wire
uploads, then drive only visible application controls and physical skin keys.
The Worker observer is read-only: it neither captures a Worker handle nor sends
or synthesizes Worker messages. Full files are obtained from UI downloads.
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
import traceback
from playwright.sync_api import sync_playwright

sha = lambda data: hashlib.sha256(data).hexdigest()
ROOT = Path(__file__).resolve().parent.parent
OBSERVE = r'''(() => {
  const NativeWorker = window.Worker;
  const observation = window.__wireAcceptance = {
    events: [], snapshot: null, snapshots: 0, inputSerial: 0, errors: [], lastPixels: null
  };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({data:d}) => {
        if (d.type === 'snapshot') {
          observation.snapshot = {
            generation:d.generation, loaded:d.loaded, running:d.running,
            stopped:d.stopped, model:d.model, width:d.width, height:d.height,
            pending:d.pending, active:d.active, tick:d.tick,
            frameSerial:d.frameSerial, frameStatus:d.frameStatus,
            effectiveSpeed:d.effectiveSpeed, transferBoosted:d.transferBoosted
          };
          observation.snapshots++;
          if (d.pending || d.active !== null) observation.inputSerial++;
          if (d.pixels) observation.lastPixels = d.pixels.slice();
        } else if (d.type === 'file-transfer-received') {
          if (observation.events.length < 4096) observation.events.push({
            type:d.type, generation:d.generation, request:d.request,
            name:d.name, bytes:d.bytes.byteLength, tick:observation.snapshot?.tick
          });
        } else if (d.type.startsWith('file-transfer-') ||
                   ['checkpoint-restored','links-reset','usb-status','serial-status'].includes(d.type)) {
          if (observation.events.length < 4096)
            observation.events.push({...d,tick:observation.snapshot?.tick});
        } else if (d.type === 'error' || d.type === 'fatal') {
          observation.errors.push(d.message);
        }
      });
    }
  };
})();'''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def observe(page):
    return page.evaluate('''(() => {
      const {lastPixels, ...metadata} = window.__wireAcceptance;
      return metadata;
    })()''')


def wait_condition(page, expression, arg=None, timeout=120000):
    failure = '''window.__wireAcceptance.errors.length > 0 ||
      window.__wireAcceptance.snapshot?.stopped ||
      window.__wireAcceptance.events.some(e => e.type === 'file-transfer-status' && e.phase === 'error')'''
    page.wait_for_function(f'arg => ({expression}) || ({failure})', arg=arg, timeout=timeout)
    assert page.evaluate(f'arg => ({expression})', arg), observe(page)
    assert not page.evaluate(f'({failure})'), observe(page)


def wait_ticks(page, amount):
    start = page.evaluate('window.__wireAcceptance.snapshot.tick')
    wait_condition(page, 'window.__wireAcceptance.snapshot.tick >= arg', start + amount)


def key(page, scan, report):
    before = page.evaluate('window.__wireAcceptance.snapshot.tick')
    input_serial = page.evaluate('window.__wireAcceptance.inputSerial')
    page.locator(f'.skin-key[data-scan="{scan}"]').click()
    count = page.evaluate('window.__wireAcceptance.snapshots')
    wait_condition(page, '''window.__wireAcceptance.snapshots > arg.count &&
      window.__wireAcceptance.inputSerial > arg.input &&
      window.__wireAcceptance.snapshot.pending === 0 &&
      window.__wireAcceptance.snapshot.active === null &&
      window.__wireAcceptance.snapshot.running''', {'count': count, 'input': input_serial})
    wait_ticks(page, 2000000)
    report['physical_keys'].append({'scan': scan, 'before_tick': before,
        'after_tick': page.evaluate('window.__wireAcceptance.snapshot.tick')})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--transport', choices=['usb','serial'], default='usb')
    parser.add_argument('--expected-wasm', required=True)
    args = parser.parse_args()
    dist = args.root.resolve() / 'dist'
    prep = json.loads((args.input / 'report.json').read_text())
    assert prep['passed'] and prep['cold_boot'] and not prep['guest_memory_patched']
    assert sha(args.rom.read_bytes()) == prep['rom_sha256']
    assert sha((dist / 'orchard.wasm').read_bytes()) == args.expected_wasm
    assert args.transport != 'serial' or prep['model'] == 2, 'Serial Wire needs original 39gs'
    session = args.input / prep['session']['name']
    assert sha(session.read_bytes()) == prep['session']['sha256']
    expected = {}
    for note in prep['notes']:
        data = (args.input / note['expected']).read_bytes()
        assert len(data) == note['expected_bytes'] and sha(data) == note['expected_sha256']
        expected[sha(data)] = (note['title'], data)
    assert len(expected) == 2

    def assets():
        return {str(path.relative_to(dist)): sha(path.read_bytes())
                for path in sorted(dist.rglob('*')) if path.is_file()}
    args.output.mkdir()
    report = {'schema': 'orchard-hp39-wire-production-browser-v1', 'passed': False,
        'model': prep['model'], 'rom_sha256': prep['rom_sha256'], 'wasm_sha256': args.expected_wasm, 'transport': args.transport,
        'production_worker': True, 'synthetic_worker_messages': False,
        'guest_memory_patched': False, 'browser_cold_boot': False,
        'prepared_from_cold_boot': True, 'preparation_report_sha256': sha((args.input/'report.json').read_bytes()),
        'preparation_wasm_sha256': prep['wasm_sha256'],
        'session': prep['session'], 'notes': prep['notes'], 'physical_keys': [],
        'assets': assets(), 'tool_sha256': sha(Path(__file__).read_bytes()),
        'performance_sample': False, 'hardware_validated': False}
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = None

    def stage(name):
        report['stage'] = name
        print('STAGE', name, flush=True)

    try:
        with sync_playwright() as playwright:
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            assert executable, 'CHROMIUM is required'
            browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
            try:
                report['browser_version'] = browser.version
                page = browser.new_page(viewport={'width': 1360, 'height': 1000}, locale='en-US', accept_downloads=True)
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script(OBSERVE)
                stage('open-original-rom')
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.get_by_role('button', name='Settings', exact=True).wait_for()
                page.locator('#rom').set_input_files(str(args.rom.resolve()))
                wait_condition(page, 'window.__wireAcceptance.snapshot?.loaded === true')
                assert page.evaluate('window.__wireAcceptance.snapshot.model') == prep['model']

                stage('restore-stock-notepad')
                page.locator('#session-file').set_input_files(str(session.resolve()))
                page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'checkpoint-restored')")
                wait_condition(page, 'window.__wireAcceptance.snapshot.running === true')
                wait_ticks(page, 10000000)
                page.screenshot(path=str(args.output / 'notepad-ready.png'))

                stage('start-one-wire-listener')
                page.get_by_role('button', name='Connections', exact=True).click()
                if args.transport == 'serial':
                    page.get_by_role('button', name='Connect Serial', exact=True).click()
                    wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'serial-status' && e.connected)")
                    page.get_by_role('combobox', name='Connection', exact=True).click()
                    page.get_by_role('option', name='Serial', exact=True).click()
                else:
                    page.get_by_role('button', name='Connect USB', exact=True).click()
                    wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'usb-status' && e.phase === 'Connected')")
                page.get_by_role('combobox', name='Calculator transfer menu', exact=True).select_option('wire')
                report['transfer_menu_label'] = page.get_by_role('combobox', name='Calculator transfer menu', exact=True).locator('option:checked').inner_text()
                page.get_by_role('button', name='Receive from calculator', exact=True).click()
                wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'file-transfer-status' && e.protocol === 'hp39-wire' && e.direction === 'receive' && e.phase === 'listening')")
                request = page.evaluate("window.__wireAcceptance.events.find(e => e.type === 'file-transfer-status' && e.protocol === 'hp39-wire' && e.direction === 'receive' && e.phase === 'listening').request")
                report['listener_request'] = request
                page.screenshot(path=str(args.output / 'listener-ready.png'))
                page.get_by_role('button', name='Close sidebar', exact=True).click()

                for count in (1, 2):
                    stage(f'physical-send-note-{count}')
                    if count == 2:
                        key(page, 44, report)  # Select the other visible Note.
                    key(page, 38, report)  # SEND.
                    wait_ticks(page, 3000000)
                    key(page, 44, report)  # Wire USB in the stock SEND menu.
                    if args.transport == 'serial':
                        key(page, 44, report)  # HP39/40 (Ser).
                    page.screenshot(path=str(args.output / f'note-{count}-send-menu.png'))
                    key(page, 6, report)  # One OK starts SEND; no filename prompt.
                    wait_condition(page, "window.__wireAcceptance.events.filter(e => e.type === 'file-transfer-received').length === arg", count)
                    wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'file-transfer-status' && e.request === arg.request && e.phase === 'listening' && e.filesCompleted === arg.count)", {'request': request, 'count': count})
                    wait_ticks(page, 24000000)
                    page.screenshot(path=str(args.output / f'note-{count}-received.png'))

                received = [e for e in observe(page)['events'] if e['type'] == 'file-transfer-received']
                assert len(received) == 2 and {e['request'] for e in received} == {request}
                assert len({e['name'] for e in received}) == 2
                report['received_events'] = received
                report['one_listener_two_distinct_files'] = True

                stage('stop-and-download')
                page.get_by_role('button', name='Connections', exact=True).click()
                page.get_by_role('button', name='Stop receiving', exact=True).click()
                wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'file-transfer-status' && e.request === arg && e.phase === 'cancelled' && !e.active)", request)
                wait_condition(page, "window.__wireAcceptance.events.some(e => e.type === 'file-transfer-cancelled' && e.request === arg)", request)
                page.get_by_role('button', name='Receive from calculator', exact=True).wait_for()
                assert page.get_by_role('button', name='Receive from calculator', exact=True).is_enabled()
                report['worker_cancel_acknowledged'] = True
                assert page.get_by_role('button', name='Download', exact=True).count() == 2
                report['downloads'] = []
                returned_hashes = set()
                for index, event in enumerate(received):
                    with page.expect_download() as pending:
                        page.get_by_role('button', name='Download', exact=True).nth(index).click()
                    download = pending.value
                    assert download.suggested_filename == event['name']
                    path = args.output / download.suggested_filename
                    download.save_as(path)
                    data = path.read_bytes()
                    digest = sha(data)
                    assert digest in expected, (event, digest)
                    title, original = expected[digest]
                    assert data == original and len(data) == event['bytes']
                    returned_hashes.add(digest)
                    report['downloads'].append({'name': path.name, 'title': title, 'bytes': len(data),
                        'sha256': digest, 'exact_file_equal': True})
                assert returned_hashes == set(expected)
                report['stop_preserved_all_files'] = True
                report['total_download_bytes'] = sum(d['bytes'] for d in report['downloads'])
                page.screenshot(path=str(args.output / 'stopped-with-downloads.png'))

                stage('post-transfer-arithmetic')
                page.get_by_role('button', name='Disconnect Serial' if args.transport == 'serial' else 'Disconnect USB', exact=True).click()
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                key(page, 48, report)  # HOME.
                wait_ticks(page, 10000000)
                for scan in (26, 5, 26, 6):
                    key(page, scan, report)
                wait_ticks(page, 30000000)
                page.screenshot(path=str(args.output / 'one-plus-one.png'))
                pixels = bytes(page.evaluate('Array.from(window.__wireAcceptance.lastPixels)'))
                report['arithmetic_work_area_sha256'] = sha(pixels[131*8:])
                assert report['arithmetic_work_area_sha256'] == '4f424d9352b6962f8d3d8ec76203f9d7c60136d66caf9b85774d8c6227717bea'
                report['arithmetic_after_transfer'] = True
                report['worker_observation'] = observe(page)
                report['page_errors'] = errors
                assert not errors and not report['worker_observation']['errors']
                assert not report['worker_observation']['snapshot']['stopped']
                assert all(e.get('phase') != 'error' for e in report['worker_observation']['events']
                    if e['type'] == 'file-transfer-status')
                assert assets() == report['assets'], 'Production assets changed during the witness'
                assert sha(args.rom.read_bytes()) == prep['rom_sha256']
                report['passed'] = True
                stage('complete')
            except Exception as error:
                report['error'] = str(error)
                report['traceback'] = traceback.format_exc()
                if page:
                    try:
                        report['worker_observation'] = observe(page)
                        report['page_errors'] = errors
                        page.screenshot(path=str(args.output / 'failure.png'), timeout=5000)
                    except Exception as secondary:
                        report['observation_error'] = str(secondary)
                raise
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
