# SPDX-License-Identifier: MIT
"""Mounted sync cancellation with real OPFS handles and explicit Worker acks.

This component regression injects insertion rejection, IndexedDB quota failure
and same-model session changes. Original firmware integration is exercised by
the private ROM probe.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'build-r24/sd-sync-cancel'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', '''
import {build} from 'esbuild';
await build({entryPoints:['tests/sd-directory-fixture.jsx'],bundle:true,format:'iife',target:'es2022',
 outfile:'build-r24/sd-sync-cancel/ui.js',define:{'process.env.NODE_ENV':'"production"'}});
'''], cwd=ROOT, check=True)

checks, errors = [], []
with sync_playwright() as p:
    chrome = os.environ.get('CHROMIUM') or next((path for name in
        ('google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable')
        if (path := shutil.which(name))), None)
    if not chrome:
        raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1100, 'height': 1000})
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))

    def serve(route):
        name = route.request.url.rsplit('/', 1)[-1]
        if name in ('ui.js', 'ui.css'):
            route.fulfill(status=200, body=(OUT / name).read_bytes(),
                          content_type='text/javascript' if name.endswith('.js') else 'text/css')
        else:
            route.fulfill(status=200, content_type='text/html', body=
                '<div id="root"></div><link rel="stylesheet" href="/ui.css"><script src="/ui.js"></script>')

    page.route('http://localhost:8745/**', serve)
    page.goto('http://localhost:8745/')
    button = lambda name: page.get_by_role('button', name=name, exact=True)
    plan = page.get_by_test_id('sd-directory-sync-plan')
    editor = page.get_by_test_id('sd-file-editor')
    page.evaluate('window.__prepareDirectory()')
    page.get_by_role('switch', name='Read only', exact=True).check()
    button('Prepare card files').click()
    button('Choose local folder').click()
    button('Use this folder as the draft').click()
    button('Insert prepared card').click()
    button('Sync folder').wait_for()
    baseline = page.evaluate('window.__cardHash()')
    page.evaluate('window.__saveCard()')

    def mounted(running, saved=True):
        button('Sync folder').wait_for()
        page.wait_for_function('running=>window.__controller.state.running===running', arg=running)
        assert page.evaluate('window.__cardHash()') == baseline
        assert page.evaluate('window.__controller.state.sd.writeProtected') is True
        assert page.evaluate('window.__controller.sdDirectory.name') == 'fixture-source'
        if saved:
            assert page.evaluate('window.__storedDirectory().then(record=>record.association.handle.isSameEntry(window.__directoryRoot))')

    page.evaluate('window.__controller.patch({running:true})')
    button('Sync folder').click()
    plan.wait_for()
    assert page.evaluate('window.__cardHash()') is None
    assert page.evaluate('window.__controller.state.running') is False
    plan.get_by_role('button', name='Cancel', exact=True).click()
    mounted(True)
    checks.append('Cancel restores every original card byte, read-only state, directory handle and running state')

    page.evaluate('window.__controller.patch({running:false})')
    button('Sync folder').click()
    plan.wait_for()
    button('Discard draft and go back').click()
    mounted(False)
    checks.append('Back from an unapplied mounted sync restores the card and preserves a previously paused machine')

    button('Sync folder').click()
    plan.wait_for()
    page.evaluate('''async()=>{
      const origin=await navigator.storage.getDirectory(),other=await origin.getDirectoryHandle('replacement-preview',{create:true});
      window.showDirectoryPicker=async()=>other;
    }''')
    button('Choose local folder').click()
    button('Use this folder as the draft').click()
    assert page.evaluate('window.__storedDirectory().then(record=>record.association.name)') == 'replacement-preview'
    button('Discard draft and go back').click()
    mounted(False)
    page.evaluate('window.showDirectoryPicker=async()=>window.__directoryRoot')
    checks.append('Cancel restores the original saved handle even after another folder was selected as the uncommitted draft')

    page.evaluate('window.__controller.patch({running:true})')
    button('Sync folder').click()
    plan.wait_for()
    page.evaluate('window.__rejectInsertOnce=true')
    plan.get_by_role('button', name='Cancel', exact=True).click()
    page.wait_for_function('window.__controller.state.dialog?.message==="sdError"')
    expect(editor).to_be_visible()
    assert page.evaluate('window.__cardHash()') is None
    assert page.evaluate('window.__controller.state.running') is False
    with page.expect_download() as pending:
        button('Download draft image').click()
    pending.value.save_as(OUT / 'retained-draft.img')
    assert hashlib.sha256((OUT / 'retained-draft.img').read_bytes()).hexdigest() == baseline
    page.evaluate('window.__controller.answer(true)')
    button('Discard draft and go back').click()
    mounted(True)
    checks.append('Rejected reinsertion keeps a downloadable exact draft; retry restores it and then resumes')

    # Changing the visible draft and then failing its original association save
    # must neither strand the real card nor make Download export the new folder.
    for reject_insert in (False, True):
        page.evaluate('window.__controller.patch({running:true})')
        button('Sync folder').click()
        plan.wait_for()
        page.evaluate('''async()=>{
          const origin=await navigator.storage.getDirectory(),other=await origin.getDirectoryHandle('quota-preview',{create:true});
          window.showDirectoryPicker=async()=>other;
        }''')
        button('Choose local folder').click()
        button('Use this folder as the draft').click()
        page.wait_for_function('window.__storedDirectory().then(record=>record.association.name==="quota-preview")')
        page.get_by_role('switch', name='Read only', exact=True).uncheck()
        page.evaluate('''reject=>{
          window.__rejectInsertOnce=reject;
          window.__realDirectoryTransaction=IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction=function(names,mode,...rest){
            if(mode==='readwrite')throw new DOMException('Injected quota failure','QuotaExceededError');
            return window.__realDirectoryTransaction.call(this,names,mode,...rest);
          };
        }''', reject_insert)
        before = page.evaluate('window.__messages.filter(message=>message.type==="sd-insert").length')
        button('Discard draft and go back').click()
        page.wait_for_function('window.__controller.state.dialog?.message==="sdFs_directoryStorage"')
        page.wait_for_function('(before)=>window.__messages.filter(message=>message.type==="sd-insert").length===before+1', arg=before)
        page.wait_for_function('!window.__controller.state.busy')
        assert page.evaluate('window.__storedDirectory().then(record=>record.association.name)') == 'quota-preview'
        if reject_insert:
            expect(editor).to_be_visible()
            assert page.evaluate('window.__cardHash()') is None
            assert page.evaluate('window.__controller.state.running') is False
            assert page.get_by_role('switch', name='Read only', exact=True).is_checked()
            assert page.get_by_label('Image filename', exact=True).input_value() == 'fixture-source.img'
            assert page.evaluate('window.__controller.dialogs.some(dialog=>dialog.message==="sdError")')
            page.evaluate('()=>{const c=window.__controller;while(c.state.dialog)c.answer(true);}')
            with page.expect_download() as pending:
                button('Download draft image').click()
            pending.value.save_as(OUT / 'quota-and-insert-rejected-original.img')
            assert hashlib.sha256((OUT / 'quota-and-insert-rejected-original.img').read_bytes()).hexdigest() == baseline
        else:
            mounted(True, saved=False)
            expect(editor).to_have_count(0)
            page.evaluate('window.__controller.answer(true)')
        page.evaluate('''()=>{
          IDBDatabase.prototype.transaction=window.__realDirectoryTransaction;
          window.showDirectoryPicker=async()=>window.__directoryRoot;
        }''')
        if reject_insert:
            button('Discard draft and go back').click()
        else:
            button('Sync folder').click()
            plan.wait_for()
            plan.get_by_role('button', name='Cancel', exact=True).click()
        mounted(True)
    checks.append('After another folder replaces the draft, quota failure still reinserts the exact original card and reports a translated storage error')
    checks.append('Combined quota and insertion failure keeps the original filename, read-only state and downloadable bytes; retry restores the original association and running state')

    page.evaluate('window.__controller.patch({running:false})')
    button('Eject to edit / sync').click()
    editor.wait_for()
    before = page.evaluate('window.__messages.filter(message=>message.type==="sd-insert").length')
    button('Discard draft and go back').click()
    expect(editor).to_have_count(0)
    assert page.evaluate('window.__cardHash()') is None
    assert page.evaluate('window.__messages.filter(message=>message.type==="sd-insert").length') == before
    checks.append('Ordinary eject-to-edit Back remains an explicit discard with no automatic reinsertion')

    for action in ('reset', 'checkpoint-load'):
        page.evaluate('window.__restoreCard()')
        button('Sync folder').click()
        plan.wait_for()
        before = page.evaluate('window.__messages.filter(message=>message.type==="sd-insert").length')
        generation = page.evaluate('window.__controller.generation')
        page.evaluate('action=>window.__controller.send(action)', action)
        expect(editor).to_have_count(0)
        assert page.evaluate('window.__controller.generation') == generation
        assert page.evaluate('window.__messages.filter(message=>message.type==="sd-insert").length') == before
        assert page.evaluate('window.__cardHash()') is None
    checks.append('Same-model reset and restore invalidate the old synchronization without reinserting its media')
    assert not errors, errors
    report = {'passed': True, 'browser': browser.version, 'checks': checks, 'page_errors': errors,
              'card_sha256': baseline, 'picker_adapter': 'Real OPFS DirectoryHandle; native picker dialog not automated',
              'guest_adapter': 'Explicit Worker acknowledgements and injected rejection; no ROM execution'}
    (OUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    browser.close()
