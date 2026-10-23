#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Verify two selected uploads and actual GET downloads using the production UI.

Requires a private admitted HP48gII or HP49g+ NOR, a wired/binary HOME or SERVER
session, and an independently prepared HP binary object. The object is selected
twice with distinct local and calculator names; --second-upload can supply a
different second object. The observer only records production Worker messages.
No calculator memory, protocol event, controller state, or run budget is patched.
This is functional evidence, not a performance sample or physical-cable test.
"""
import argparse
import functools
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import threading
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HELPERS = ROOT / 'tools/probe-file-transfer-browser.py'
spec = importlib.util.spec_from_file_location('orchard_transfer_probe', HELPERS)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
sha = helper.sha
ASSETS = helper.ASSETS
SERVER_KEYS = (57,15,57,39,57,22,57,30,57,39,57,22,6)
SERIAL_FLAG_KEYS = (57,15,57,40,58,4,24,17,23,45,6)


def asset_hashes():
    return {name: sha((ROOT / 'dist' / name).read_bytes()) for name in ASSETS}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--session', type=Path, required=True)
    parser.add_argument('--upload', type=Path, required=True)
    parser.add_argument('--second-upload', type=Path)
    parser.add_argument('--first-name', default='OR22A')
    parser.add_argument('--second-name', default='OR22B')
    parser.add_argument('--transport', choices=('usb', 'serial'), required=True)
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--start-server', action='store_true',
                        help='Enter SERVER by physical keys from wired/binary HOME; serial first executes SF(-78)')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    names = [args.first_name, args.second_name]
    if any(not re.fullmatch(r'[A-Z][A-Z0-9]{0,7}', name) for name in names) or len(set(names)) != 2:
        parser.error('Choose two distinct uppercase alphanumeric target names, 1–8 characters, starting with a letter')
    if not re.fullmatch(r'[0-9a-f]{64}', args.expected_wasm):
        parser.error('--expected-wasm must be an exact lowercase SHA-256')
    assets = asset_hashes()
    model = helper.model_identity(args.rom)
    if assets['orchard.wasm'] != args.expected_wasm:
        raise ValueError('Production WASM does not match --expected-wasm')
    paths = [args.upload, args.second_upload or args.upload]
    sources = [path.read_bytes() for path in paths]
    for source in sources:
        if len(source) < 9 or len(source) > 2 * 1024 * 1024 or source[:7] not in (b'HPHP48-', b'HPHP49-'):
            raise ValueError('Each upload must be a bounded binary HP48/49 object')
    args.output.mkdir()  # A witness never replaces an earlier success/failure.
    report = {'schema': 'orchard-stock-browser-upload-batch-v1', 'passed': False,
              'performance_sample': False, 'production_worker': True,
              'transport': args.transport, 'assets': assets,
              'expected_wasm_sha256': args.expected_wasm,
              'start_server_with_physical_ui': args.start_server,
              'model': model,
              'rom_sha256': model['rom_sha256'],
              'session_sha256': sha(args.session.read_bytes()),
              'tools': {Path(__file__).name: sha(Path(__file__).read_bytes()),
                        HELPERS.name: sha(HELPERS.read_bytes())},
              'inputs': [{'target_name': name, 'bytes': len(source),
                          'sha256': sha(source), 'object_sha256': sha(source[8:])}
                         for name, source in zip(names, sources)]}
    server = browser = page = None
    errors = []

    def stage(name):
        report['stage'] = name
        print('STAGE', name, flush=True)

    try:
        server = ThreadingHTTPServer(('127.0.0.1', 0),
                                    functools.partial(helper.Handler, directory=str(ROOT / 'dist')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as p:
            stage('launch-browser')
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            if not executable:
                raise RuntimeError('Set CHROMIUM to an installed Chrome/Chromium executable')
            browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
            try:
                report['browser_version'] = browser.version
                page = browser.new_page(viewport={'width': 1360, 'height': 1080}, locale='en-US')
                page.set_default_timeout(30000)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script(helper.OBSERVE)
                stage('open-rom-and-session')
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.get_by_role('button', name='Settings', exact=True).wait_for()
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button', name='Open ROM', exact=True).click()
                picker.value.set_files(str(args.rom.resolve()))
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                helper.verify_model(page, model)
                page.locator('#session-file').set_input_files(str(args.session.resolve()))
                page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='checkpoint-restored')")
                if args.start_server:
                    stage('prepare-server')
                    if not page.evaluate('window.__transferProbe.snapshot?.running'):
                        page.get_by_role('button', name='Resume', exact=True).click()
                    page.wait_for_function('window.__transferProbe.snapshot?.running===true')
                    if args.transport == 'serial':
                        helper.physical_keys(page, SERIAL_FLAG_KEYS)
                    helper.physical_keys(page, SERVER_KEYS)
                    page.screenshot(path=str(args.output / 'server-before-connect.png'))
                stage('connect-' + args.transport)
                page.get_by_role('button', name='Connections', exact=True).click()
                page.get_by_role('button', name='Connect ' + ('USB' if args.transport == 'usb' else 'Serial'), exact=True).click()
                if args.transport == 'usb':
                    page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='usb-status'&&e.phase==='Connected')", timeout=300000)
                else:
                    page.wait_for_function("window.__transferProbe.events.some(e=>e.type==='serial-status'&&e.connected)")
                    page.get_by_role('combobox', name='Connection', exact=True).click()
                    page.get_by_role('option', name='Serial', exact=True).click()
                stage('select-two-files')
                local_names = ['batch-first.hp', 'batch-second.hp']
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button', name='Choose file', exact=True).click()
                assert picker.value.is_multiple(), 'The production picker must permit multiple files'
                picker.value.set_files([{'name': name, 'mimeType': 'application/octet-stream', 'buffer': source}
                                        for name, source in zip(local_names, sources)])
                for local, name in zip(local_names, names):
                    page.get_by_label('Name on calculator · ' + local, exact=True).fill(name)
                before = page.evaluate('window.__transferProbe.events.length')
                stage('upload-batch')
                page.get_by_role('button', name='Upload to calculator', exact=True).click()
                page.wait_for_function("""after=>{
                  const terminal=window.__transferProbe.events.slice(after).filter(e=>e.type==='file-transfer-status'&&!e.active);
                  return terminal.some(e=>e.phase!=='complete')||terminal.length>=2;
                }""", arg=before, timeout=600000)
                events = page.evaluate('window.__transferProbe.events')[before:]
                uploads = [e for e in events if e['type'] == 'file-transfer-status' and not e['active']]
                report['uploads'] = uploads
                assert len(uploads) == 2 and len({e['request'] for e in uploads}) == 2, uploads
                assert all(e['phase'] == 'complete' and e['direction'] == 'send'
                           and e['transport'] == args.transport for e in uploads), uploads
                # The posted order is observed through distinct real terminal
                # events; no controller state or synthetic ACK is injected.
                report['upload_status_events'] = events
                page.locator('[data-testid="upload-batch"]').get_by_text('2 / 2 files uploaded', exact=True).wait_for()
                report['batch_ui_text'] = page.locator('[data-testid="upload-batch"]').inner_text()
                assert '2 / 2 files uploaded' in report['batch_ui_text'], report['batch_ui_text']
                assert page.locator('[data-testid="upload-batch"]').get_by_text('Uploaded', exact=True).count() == 2
                page.locator('[data-testid="upload-batch"]').scroll_into_view_if_needed()
                page.screenshot(path=str(args.output / 'batch-complete.png'))
                stored_names = [e.get('name') or name for e, name in zip(uploads, names)]
                assert len(set(stored_names)) == 2, stored_names
                report['stored_names'] = stored_names
                report['downloads'] = []
                for index, (name, source) in enumerate(zip(stored_names, sources)):
                    stage('get-file-' + str(index + 1))
                    page.get_by_label('Object name to retrieve', exact=True).fill(name)
                    before = page.evaluate('window.__transferProbe.events.length')
                    page.get_by_role('button', name='Get named object', exact=True).click()
                    result = helper.terminal(page, 'receive', before, args.transport)
                    download = helper.download_object(page, source, args.output / f'returned-{index + 1}.hp')
                    report['downloads'].append({'name': name, 'terminal': result, **download})
                    page.get_by_role('button', name='Clear list', exact=True).click()
                stage('directory-and-finish')
                before = page.evaluate('window.__transferProbe.events.length')
                page.get_by_role('button', name='List calculator files', exact=True).click()
                report['directory'] = helper.terminal(page, 'receive', before, args.transport)
                listings = [e['text'] for e in page.evaluate('window.__transferProbe.events')[before:]
                            if e['type'] == 'file-transfer-listing']
                assert len(listings) == 1 and all(name in listings[0] for name in stored_names), listings
                report['directory_contains_both_objects'] = True
                report['directory_characters'] = len(listings[0])
                before = page.evaluate('window.__transferProbe.events.length')
                page.get_by_role('button', name='Exit calculator SERVER', exact=True).click()
                report['finish'] = helper.terminal(page, 'receive', before, args.transport)
                report['worker_observation'] = page.evaluate('window.__transferProbe')
                links = [e for e in report['worker_observation']['events'] if e['type'] == args.transport + '-status']
                connected = [i for i, e in enumerate(links) if e.get('connected')
                             and (args.transport == 'serial' or e.get('phase') == 'Connected')]
                assert len(connected) == 1 and all(e.get('connected') for e in links[connected[0]:]), links
                report['same_connection'] = True
                if args.transport == 'serial':
                    assert not any(e['type'] == 'usb-status' and e.get('connected')
                                   for e in report['worker_observation']['events'])
                    report['usb_connected'] = False
                report['page_errors'] = errors
                assert not errors and not report['worker_observation']['errors'], report
                assert not report['worker_observation']['snapshot']['stopped'], report
                helper.verify_model(page, model)
                assert asset_hashes() == assets, 'Production assets changed during the witness'
                assert sha(args.rom.read_bytes()) == report['rom_sha256']
                assert sha(args.session.read_bytes()) == report['session_sha256']
                assert [sha(path.read_bytes()) for path in paths] == [item['sha256'] for item in report['inputs']]
                page.screenshot(path=str(args.output / 'after-batch-finish.png'))
                report['passed'] = True
                stage('complete')
            except Exception as error:
                report['primary_error'] = str(error)
                if page:
                    try:
                        report['worker_observation'] = page.evaluate('window.__transferProbe')
                    except Exception as observation_error:
                        report['observation_error'] = str(observation_error)
                    try:
                        page.screenshot(path=str(args.output / 'failure.png'), timeout=5000)
                    except Exception as screenshot_error:
                        report['screenshot_error'] = str(screenshot_error)
                raise
            finally:
                browser.close()
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        if server:
            server.shutdown()
            server.server_close()
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({key: report.get(key) for key in ('passed', 'transport', 'stored_names', 'same_connection', 'error')}, indent=2))


if __name__ == '__main__':
    main()
