#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Private original-ROM witness for local storage, sidebars and system chords.

Uses the production page and Worker without changing guest memory or messages.
The ROM enters through the page's real standard file input: this validates its
local-copy fallback, not the native File System Access permission dialog. Real
handle serialization/read-through is covered separately by rom-storage-browser.
Screenshots and ROM-derived outputs remain in the selected private directory.
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
from urllib.parse import urljoin, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('transfer_probe', ROOT/'tools/probe-file-transfer-browser.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
spec = importlib.util.spec_from_file_location('pages', ROOT/'tools/pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)
MODELS = {
    '95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67': (1, 'hp39gplus', 64, 1048576),
    'a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff': (2, 'hp39gs', 64, 1048576),
    '4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937': (4, 'hp48gii', 64, 2097152),
    '3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab': (5, 'hp49gplus', 80, 2097152),
}


def settle(page, ticks):
    start = page.evaluate('window.__transferProbe.snapshot.ticks')
    page.wait_for_function('n=>window.__transferProbe.snapshot?.stopped||window.__transferProbe.snapshot?.ticks>=n',
                           arg=start+ticks, timeout=300000)
    assert not page.evaluate('window.__transferProbe.snapshot.stopped'), page.evaluate('window.__transferProbe')


def cold_boot(page, model):
    settle(page, 60000000)
    helper.physical_keys(page, (40,))
    settle(page, 70000000)
    if model['id'] >= 4:
        helper.physical_keys(page, (40,))
        settle(page, 57000000)


def frame(page):
    page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    value = page.locator('#lcd').evaluate('c=>({width:c.width,height:c.height,pixels:Array.from(c.getContext("2d").getImageData(0,0,c.width,c.height).data)})')
    return {'width':value['width'], 'height':value['height'], 'rgba_sha256':helper.sha(bytes(value['pixels']))}


def settings_storage(page):
    page.get_by_role('button', name='Settings', exact=True).click()
    page.get_by_role('tab', name='Storage', exact=True).click()


def remembered_records(page):
    return page.evaluate('''()=>new Promise((resolve,reject)=>{const r=indexedDB.open('orchard-roms',1);
      r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction('roms','readonly'),q=t.objectStore('roms').getAll();
        t.oncomplete=()=>{db.close();resolve(q.result.filter(x=>x&&typeof x==='object').map(({model,hash,name,kind})=>({model,hash,name,kind})))};
        t.onabort=()=>{db.close();reject(t.error)}}})''')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--url')
    parser.add_argument('--expected-revision')
    parser.add_argument('--self-test', action='store_true', help='Also exercise the toolbar and held Escape+F4, then exit by ON+F3')
    args = parser.parse_args()
    digest = helper.sha(args.rom.read_bytes())
    if digest not in MODELS or args.rom.stat().st_size != MODELS[digest][3]:
        parser.error('--rom must be an admitted, complete original image')
    identifier, name, height, _ = MODELS[digest]
    model = {'id':identifier, 'name':name, 'width':131, 'height':height, 'rom_sha256':digest}
    assets = {n:helper.sha((ROOT/'dist'/n).read_bytes()) for n in sorted(pages.ASSETS)}
    if assets['orchard.wasm'] != args.expected_wasm:
        parser.error('--expected-wasm must match the production dist build')
    if args.url:
        parts = urlsplit(args.url)
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
            parser.error('--url must be a plain HTTPS URL')
        if not re.fullmatch(r'[0-9a-f]{40}', args.expected_revision or ''):
            parser.error('--url requires an exact --expected-revision')
    elif args.expected_revision:
        parser.error('--expected-revision requires --url')
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'schema':'orchard-local-workflows-browser-v1', 'passed':False, 'model':model,
              'production_worker':True, 'performance_sample':False, 'rom_input':'standard-file-input/local-copy',
              'native_picker_permission_ui_tested':False, 'assets':assets,
              'tool_sha256':helper.sha(Path(__file__).read_bytes())}
    server = None
    if args.url:
        base = args.url.rstrip('/')+'/'
        report.update(published_url=base, published_revision=args.expected_revision)
    else:
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(helper.Handler, directory=str(ROOT/'dist')))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/'
    errors, requests, responses = [], [], []
    page = None

    def stage(value):
        report['stage'] = value
        print('STAGE', value, flush=True)

    def response_finished(request):
        # Chromium can evict earlier response bodies after a document reload.
        # Hash each completed request while its owning document still exists.
        if request.url.startswith(base):
            name = request.url[len(base):]
            if name in assets:
                response = request.response()
                record = {'name':name, 'status':response.status}
                try:
                    if response.status == 200:
                        record['sha256'] = helper.sha(response.body())
                except Exception as error:
                    record['error'] = str(error)
                responses.append(record)

    try:
        with sync_playwright() as p:
            chrome = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            if not chrome:
                raise RuntimeError('Set CHROMIUM to an installed browser')
            browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
            report['browser_version'] = browser.version
            try:
                page = browser.new_page(viewport={'width':1360, 'height':940}, locale='en-US')
                page.set_default_timeout(30000)
                page.on('pageerror', lambda error:errors.append(str(error)))
                page.context.on('request', lambda request:requests.append({'method':request.method, 'url':request.url}))
                page.context.on('requestfinished', response_finished)
                page.add_init_script(helper.OBSERVE)
                page.goto(base)
                if args.url:
                    manifest = page.evaluate('url=>fetch(url).then(r=>r.json())', urljoin(base,'asset-manifest.json'))
                    assert manifest['revision'] == args.expected_revision
                    assert manifest['assets'] == assets, 'Published build differs from the validated local build'
                stage('original-rom-standard-input')
                # Use visible preferences to keep this functional test short and
                # isolate ROM recall from the separate calculator-state autosave.
                page.get_by_role('button', name='Settings', exact=True).click()
                page.get_by_role('combobox', name='Speed', exact=True).click()
                page.get_by_role('option', name='Unlimited', exact=True).click()
                page.get_by_role('tab', name='Storage', exact=True).click()
                page.get_by_role('switch', name='Save automatically on this device', exact=True).uncheck()
                page.get_by_role('button', name='Apply', exact=True).click()
                page.locator('#rom').set_input_files(str(args.rom.resolve()))
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                helper.verify_model(page, model)
                cold_boot(page, model)
                page.screenshot(path=str(args.output/'home.png'))
                report['home_frame'] = frame(page)
                settings_storage(page)
                page.get_by_text('Copy stored in this browser', exact=True).wait_for()
                report['rom_records'] = remembered_records(page)
                assert report['rom_records'] == [{'model':identifier, 'hash':digest, 'name':args.rom.name, 'kind':'copy'}]
                page.get_by_role('button', name='Cancel', exact=True).click()

                stage('persistent-sidebar-with-live-calculator')
                page.get_by_role('button', name='Connections', exact=True).click()
                sidebar = page.locator('#device-sidebar')
                assert sidebar.is_visible() and page.get_by_role('dialog').count() == 0
                sidebar.get_by_role('tab', name='Raw data', exact=True).click()
                sidebar.get_by_role('textbox', name='Data', exact=True).fill('01 02 03')
                page.locator('#calculator').focus()
                for key in ('1','+','1','Enter'):
                    page.keyboard.press(key)
                settle(page, 30000000)
                report['sidebar_arithmetic_frame'] = frame(page)
                assert report['sidebar_arithmetic_frame'] != report['home_frame']
                report['arithmetic_requires_visual_review'] = True
                page.screenshot(path=str(args.output/'sidebar-arithmetic.png'))
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                assert not sidebar.is_visible()
                page.get_by_role('button', name='Connections', exact=True).click()
                assert sidebar.get_by_role('textbox', name='Data', exact=True).input_value() == '01 02 03'
                if identifier == 5:
                    page.get_by_role('button', name='SD card', exact=True).click()
                    sidebar.get_by_text('No card inserted', exact=True).wait_for()
                    sidebar.get_by_role('tab', name='Connections', exact=True).click()
                    assert sidebar.get_by_role('textbox', name='Data', exact=True).input_value() == '01 02 03'
                    report['sd_and_connections_share_sidebar'] = True
                page.set_viewport_size({'width':390, 'height':844})
                page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(args.output/'sidebar-mobile.png'))
                page.set_viewport_size({'width':1360, 'height':940})
                page.get_by_role('button', name='Close sidebar', exact=True).click()
                report['sidebar_keeps_draft_and_calculator_input'] = True

                stage('automatic-rom-reopen')
                page.reload()
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                helper.verify_model(page, model)
                cold_boot(page, model)
                page.screenshot(path=str(args.output/'automatic-reopen.png'))
                report['automatically_reopened_without_file_input'] = True
                assert remembered_records(page) == report['rom_records']
                if args.self_test:
                    report['self_test'] = []
                    for method in ('toolbar','held-Escape-F4'):
                        stage('self-test-'+method)
                        if method == 'toolbar':
                            page.get_by_role('button', name='Enter self-test', exact=True).click()
                        else:
                            page.locator('#calculator').focus()
                            page.keyboard.down('Escape')
                            page.keyboard.press('F4')
                            page.keyboard.up('Escape')
                        settle(page, 30000000)
                        entry = frame(page)
                        page.screenshot(path=str(args.output/(method+'-entry.png')))
                        page.get_by_role('button', name='Self-test actions', exact=True).click()
                        page.get_by_role('menuitem', name='Leave self-test', exact=True).click()
                        settle(page, 180000000)
                        page.locator('#calculator').focus()
                        for key in ('1','+','1','Enter'):
                            page.keyboard.press(key)
                        settle(page, 30000000)
                        page.screenshot(path=str(args.output/(method+'-exit-arithmetic.png')))
                        report['self_test'].append({'method':method, 'entry':entry, 'exit_arithmetic':frame(page),
                                                    'requires_visual_review':True, 'core_stopped':False})

                stage('remember-preference-and-forget')
                settings_storage(page)
                page.get_by_role('switch', name='Remember local ROMs', exact=False).uncheck()
                page.get_by_role('button', name='Apply', exact=True).click()
                page.reload()
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===false')
                assert remembered_records(page) == report['rom_records']
                settings_storage(page)
                page.get_by_role('switch', name='Remember local ROMs', exact=False).check()
                page.get_by_role('button', name='Apply', exact=True).click()
                page.reload()
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
                helper.verify_model(page, model)
                settings_storage(page)
                page.get_by_role('button', name='Forget saved ROM locations and copies', exact=True).click()
                page.get_by_text('Copy stored in this browser', exact=True).wait_for(state='hidden')
                assert remembered_records(page) == []
                page.get_by_role('button', name='Cancel', exact=True).click()
                page.reload()
                page.wait_for_function('window.__transferProbe.snapshot?.loaded===false')
                assert remembered_records(page) == []
                report['remember_disabled_preserves_record_but_does_not_open'] = True
                report['reenable_reopens_and_forget_prevents_next_reopen'] = True
                assert not errors, errors
                assert not page.evaluate('window.__transferProbe.errors'), page.evaluate('window.__transferProbe.errors')
                assert all(request['method']=='GET' for request in requests), requests
                received = {}
                for response in responses:
                    assert not response.get('error'), response
                    assert response['status'] in (200,304), response
                    if response['status'] == 304:
                        continue
                    name, value = response['name'], response['sha256']
                    assert value == assets[name], name
                    received[name] = value
                assert all(response['name'] in received for response in responses), 'Cached response lacks a verified original body'
                assert 'orchard.wasm' in received and 'worker.js' in received
                assert helper.sha(args.rom.read_bytes()) == digest, 'Original ROM was changed'
                report.update(passed=True, browser_assets=received,
                              network={'requests':requests, 'uploads':0, 'tls_verification_disabled':False})
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
        if server:
            server.shutdown()
            server.server_close()
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({key:report.get(key) for key in ('passed','stage','error')},indent=2), flush=True)


if __name__ == '__main__':
    main()
