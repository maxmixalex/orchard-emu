#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original HP49g+ browser cold boot, input, display and session witness.

This uses the production page, file pickers, physical keypad/PC input and actual
downloads. The observer records Worker messages without modifying them. Private
ROMs, sessions and screenshots stay in the explicitly selected local directory.
Arithmetic screenshots require visual review; no OCR or fabricated framebuffer
is used. This is functional validation, not a speed measurement.
"""
import argparse
import functools
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import threading
from http.server import ThreadingHTTPServer

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('orchard_transfer_probe', ROOT/'tools/probe-file-transfer-browser.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def session_metadata(path):
    data = path.read_bytes()
    assert data[:8] == b'ORCHARD1'
    size = struct.unpack_from('<I', data, 8)[0]
    assert 0 < size <= 4096 and 12+size < len(data)
    meta = json.loads(data[12:12+size])
    state = data[12+size:]
    assert state[:8] == b'ORCHST01' and helper.sha(state) == meta['stateHash']
    return {**meta, 'checkpoint_version': struct.unpack_from('<I', state, 8)[0],
            'checkpoint_bytes': len(state), 'file_sha256': helper.sha(data)}


def frame(page):
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    value = page.locator('#lcd').evaluate('''c=>({width:c.width,height:c.height,
      pixels:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)})''')
    return {'width': value['width'], 'height': value['height'],
            'rgba_sha256': helper.sha(bytes(value['pixels']))}


def wait_ticks(page, ticks):
    page.wait_for_function('n=>window.__transferProbe.snapshot?.stopped||window.__transferProbe.snapshot?.ticks>=n',
                           arg=ticks, timeout=300000)
    snapshot = page.evaluate('window.__transferProbe.snapshot')
    assert not snapshot['stopped'], snapshot


def settle(page, ticks=4000000):
    start = page.evaluate('window.__transferProbe.snapshot.ticks')
    wait_ticks(page, start+ticks)


def cold_boot(page):
    wait_ticks(page, 60000000)
    helper.physical_keys(page, (40,))
    # Browser delivery can occur after the requested tick. Keep the OS startup
    # interval relative to the delivered NO key, not an earlier nominal time.
    settle(page, 60000000)
    helper.physical_keys(page, (40,))
    settle(page, 40000000)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--legacy-rom', type=Path)
    parser.add_argument('--legacy-session', type=Path)
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    model = helper.model_identity(args.rom)
    if model['id'] != 5:
        parser.error('--rom must be the admitted HP49g+ image')
    if bool(args.legacy_rom) != bool(args.legacy_session):
        parser.error('Supply both --legacy-rom and --legacy-session')
    assets = {n: helper.sha((ROOT/'dist'/n).read_bytes()) for n in helper.ASSETS}
    if args.expected_wasm != assets['orchard.wasm']:
        parser.error('--expected-wasm does not match the production WASM')
    args.output.mkdir()
    report = {'schema': 'orchard-hp49-browser-v1', 'passed': False,
              'performance_sample': False, 'production_worker': True,
              'model': model, 'assets': assets, 'physical_startup_keys': [40,40],
              'tools': {Path(__file__).name: helper.sha(Path(__file__).read_bytes()),
                        'probe-file-transfer-browser.py': helper.sha((ROOT/'tools/probe-file-transfer-browser.py').read_bytes())}}
    errors = []
    server = ThreadingHTTPServer(('127.0.0.1', 0),
                                functools.partial(helper.Handler, directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = None

    def stage(name):
        report['stage'] = name
        print('STAGE', name, flush=True)

    try:
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            if not executable:
                raise RuntimeError('Set CHROMIUM to an installed Chrome/Chromium executable')
            browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
            report['browser_version'] = browser.version
            try:
                page = browser.new_page(viewport={'width':1360, 'height':940}, locale='en-US')
                page.set_default_timeout(30000)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.add_init_script(helper.OBSERVE)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                stage('cold-boot-from-picker')
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button', name='Open ROM', exact=True).click()
                picker.value.set_files(str(args.rom.resolve()))
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                helper.verify_model(page, model)
                cold_boot(page)
                page.screenshot(path=str(args.output/'home.png'))
                report['home_frame'] = frame(page)

                stage('pc-input-and-capture')
                page.locator('#calculator').focus()
                before = page.evaluate('window.__transferProbe.snapshots')
                for key in ('Digit1','Shift+Equal','Digit1','Enter'):
                    page.keyboard.press(key)
                page.wait_for_function('n=>window.__transferProbe.snapshots>n&&window.__transferProbe.snapshot?.pending===0&&window.__transferProbe.snapshot?.active===null', arg=before)
                settle(page)
                page.screenshot(path=str(args.output/'one-plus-one.png'))
                report['one_plus_one_frame'] = frame(page)
                report['one_plus_one_requires_visual_review'] = True
                assert report['one_plus_one_frame'] != report['home_frame']
                page.get_by_role('button', name='Capture screen', exact=True).click()
                with page.expect_download() as pending:
                    page.get_by_role('menuitem', name='4× pixels', exact=True).click()
                path = args.output/'lcd-4x.png'
                pending.value.save_as(path)
                with Image.open(path) as image:
                    assert image.size == (524,320), image.size
                report['capture'] = {'width':524, 'height':320, 'sha256':helper.sha(path.read_bytes())}

                stage('save-and-restore')
                with page.expect_download() as pending:
                    page.get_by_role('button', name='Save', exact=True).click()
                saved = args.output/'saved.ord'
                pending.value.save_as(saved)
                report['save'] = session_metadata(saved)
                assert report['save']['model'] == 5 and report['save']['checkpoint_version'] == 3
                page.wait_for_function('window.__transferProbe.snapshot?.running===false')
                saved_frame = frame(page)
                page.get_by_role('button', name='Resume', exact=True).click()
                helper.physical_keys(page, (24,3,17,6))
                settle(page)
                page.screenshot(path=str(args.output/'seven-times-eight.png'))
                assert frame(page) != saved_frame
                report['seven_times_eight_requires_visual_review'] = True
                before = page.evaluate('window.__transferProbe.events.length')
                page.locator('#session-file').set_input_files(str(saved.resolve()))
                page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                page.wait_for_function("n=>window.__transferProbe.events.slice(n).some(e=>e.type==='checkpoint-restored')", arg=before)
                page.wait_for_function('window.__transferProbe.snapshot?.running===false')
                assert frame(page) == saved_frame, 'Restoration changed the complete displayed LCD'
                report['saved_lcd_restored_exactly'] = True

                stage('traditional-layout')
                page.get_by_role('button', name='Settings', exact=True).click()
                page.get_by_role('combobox', name='Appearance', exact=True).click()
                page.get_by_role('option', name='Traditional', exact=True).click()
                page.get_by_role('button', name='Apply', exact=True).click()
                page.wait_for_function('document.querySelector("#calculator").dataset.view==="traditional"&&document.querySelectorAll(".traditional-key").length===51')
                assert frame(page) == saved_frame
                page.screenshot(path=str(args.output/'traditional.png'))
                page.set_viewport_size({'width':390, 'height':844})
                page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                bounds = page.locator('#calculator').bounding_box()
                workspace = page.locator('#workspace').bounding_box()
                assert bounds['width'] <= 390 and bounds['x'] >= 0, bounds
                assert bounds['y']+bounds['height'] <= workspace['y']+workspace['height'], (bounds,workspace)
                for key in page.locator('.traditional-key').all():
                    key_bounds = key.bounding_box()
                    assert key_bounds and key_bounds['y']+key_bounds['height'] <= workspace['y']+workspace['height'], key_bounds
                report['narrow_layout'] = bounds
                page.screenshot(path=str(args.output/'traditional-narrow.png'), full_page=True)
                page.set_viewport_size({'width':1360, 'height':940})

                if args.legacy_rom:
                    stage('previous-model-v1-session')
                    previous = helper.model_identity(args.legacy_rom)
                    legacy = session_metadata(args.legacy_session)
                    assert legacy['checkpoint_version'] == 1 and legacy['model'] == previous['id']
                    with page.expect_file_chooser() as picker:
                        page.get_by_role('button', name='Open ROM', exact=True).click()
                    picker.value.set_files(str(args.legacy_rom.resolve()))
                    page.get_by_role('dialog').get_by_role('button', name='Open ROM', exact=True).click()
                    page.wait_for_function('id=>window.__transferProbe.snapshot?.loaded&&window.__transferProbe.snapshot?.model===id', arg=previous['id'])
                    before = page.evaluate('window.__transferProbe.events.length')
                    page.locator('#session-file').set_input_files(str(args.legacy_session.resolve()))
                    page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                    page.wait_for_function("n=>window.__transferProbe.events.slice(n).some(e=>e.type==='checkpoint-restored')", arg=before)
                    helper.verify_model(page, previous)
                    page.get_by_role('button', name='Resume', exact=True).click()
                    settle(page)
                    with page.expect_download() as pending:
                        page.get_by_role('button', name='Save', exact=True).click()
                    converted = args.output/'legacy-resaved.ord'
                    pending.value.save_as(converted)
                    report['legacy_session'] = {'input':legacy, 'resaved':session_metadata(converted)}
                    assert report['legacy_session']['resaved']['checkpoint_version'] == 3
                    page.screenshot(path=str(args.output/'legacy-restored.png'))

                report['worker_observation'] = page.evaluate('window.__transferProbe')
                report['page_errors'] = errors
                assert not errors and not report['worker_observation']['errors']
                assert not report['worker_observation']['snapshot']['stopped']
                assert {n:helper.sha((ROOT/'dist'/n).read_bytes()) for n in assets} == assets
                assert helper.model_identity(args.rom) == model
                report['passed'] = True
                stage('complete')
            except Exception as error:
                report['error'] = str(error)
                if page:
                    report['worker_observation'] = page.evaluate('window.__transferProbe')
                    page.screenshot(path=str(args.output/'failure.png'), timeout=5000)
                raise
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({k:report.get(k) for k in ('passed','stage','error')},indent=2))


if __name__ == '__main__':
    main()
