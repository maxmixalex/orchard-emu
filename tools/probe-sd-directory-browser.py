#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original HP49g+ directory SD roundtrip through the production page and Worker.

Only showDirectoryPicker is adapted to return a real origin-private directory.
The test exercises real filesystem streams and persisted handles, but does not
claim to automate the native operating-system picker or its permission prompts.
ROM input, session restore and SD controls use their ordinary UI. Guest input is
physical calculator keys, with no ROM/RAM edits or synthesized Worker messages.
Private ROMs, sessions, card images and screenshots remain in --output.
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
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('orchard_hp49', ROOT / 'tools/probe-hp49-browser.py')
hp49 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hp49)
h = hp49.helper
OBJECT_42 = bytes.fromhex('4850485034392d5814268000004200')
OBSERVE = h.OBSERVE.replace('ticks:d.tick', 'sd:d.sd,ticks:d.tick').replace(
    "else if(d.type==='file-transfer-status'",
    "else if(d.type==='sd-complete'||d.type==='sd-error'||d.type==='file-transfer-status'").replace(
    '++p.snapshots;', 'if(d.pixels)p.pixels=d.pixels;++p.snapshots;')
# Exact native-pixel identities of the visually reviewed, admitted HP49g+ ROM.
# This recognition exists only in this acceptance tool, never in the product.
STARTUP_FRAMES = {
    'fae0d5b7244ea34f005f289dc8f06e1e2a1ac6401ec6b99f668565c4b7eef34d': 'recover-memory',
    '3da35b0b5d18324cdea109155e260245ae8ed2fabbe36d38d707879d519dbf1f': 'memory-clear',
    'b1320269ea9173a797b454cba1ed79e4a2817574932d4b286bdb21415ec1d97d': 'home',
}
STARTUP_SCREEN = '''async()=>{
  const p=window.__transferProbe;if(!p?.pixels||!p.snapshot)return null;
  const pixels=new Uint8Array(p.pixels),snapshot=p.snapshot;
  const digest=await crypto.subtle.digest('SHA-256',pixels);
  return {sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),
    ticks:snapshot.ticks,stopped:snapshot.stopped};
}'''
DIRECTORY_ADAPTER = r"""(() => {
  // Retain the native handle and all native stream/permission methods.
  // Only the chooser is substituted because headless Chrome has no OS picker.
  window.showDirectoryPicker = async options => {
    const calls=JSON.parse(sessionStorage.getItem('directory-probe-pickers')||'[]');
    calls.push(options);sessionStorage.setItem('directory-probe-pickers',JSON.stringify(calls));
    return (await navigator.storage.getDirectory()).getDirectoryHandle('orchard-original-rom',{create:true});
  };
})();"""


def assets():
    return {p.relative_to(ROOT / 'dist').as_posix(): h.sha(p.read_bytes())
            for p in sorted((ROOT / 'dist').rglob('*'))
            if p.is_file() and p.name not in ('asset-manifest.json', 'revision.txt')}


def cold_boot(page, output, report):
    """Confirm each original-ROM screen before sending a physical F6.

    Host load can change how far the guest has progressed when browser input
    arrives. A completed tap is not evidence that the ROM reached HOME. Reject
    unknown screens and bound retries; never inject a response or edit RAM.
    """
    report['startup'] = []
    hp49.wait_ticks(page, 60000000)
    for attempt in range(6):
        started = page.evaluate('window.__transferProbe.snapshot.ticks')
        deadline = started + 120000000
        # The native CAS splash between Recover and Memory Clear is not an
        # input prompt. Wait through it without spending another key attempt.
        while page.evaluate('window.__transferProbe.snapshot.ticks') < deadline:
            # evaluate awaits the digest itself. An async polling predicate can
            # expose a truthy Promise before its SHA result in browser harnesses.
            observed = page.evaluate(STARTUP_SCREEN)
            assert observed and not observed['stopped'], observed
            if observed['sha256'] not in STARTUP_FRAMES:
                hp49.settle(page, 4000000)
                continue
            hp49.settle(page, 2000000)
            stable = page.evaluate(STARTUP_SCREEN)
            if stable and stable['sha256'] == observed['sha256']:
                break
        else:
            raise AssertionError('Original ROM did not reach a recognized stable startup screen within 120M guest ticks')
        label = STARTUP_FRAMES.get(stable['sha256'])
        assert label in ('recover-memory', 'memory-clear', 'home'), stable
        report['startup'].append({'screen': label, **stable, 'waited_ticks': stable['ticks'] - started,
                                  'physical_scan': None if label == 'home' else 40})
        page.locator('#lcd').screenshot(path=str(output / f'startup-{attempt}-{label}.png'))
        if label == 'home':
            return
        h.physical_keys(page, (40,))
        hp49.settle(page, 12000000)
    raise AssertionError('Original ROM did not reach the recognized HOME screen within the bounded startup sequence')


def root_files(image):
    """Independently read the small FAT16 root files exported by the UI."""
    u16 = lambda offset: struct.unpack_from('<H', image, offset)[0]
    u32 = lambda offset: struct.unpack_from('<I', image, offset)[0]
    start = u32(454)
    boot = start * 512
    sector, cluster = u16(boot + 11), image[boot + 13]
    reserved, fats, entries, fat_size = u16(boot + 14), image[boot + 16], u16(boot + 17), u16(boot + 22)
    fat = (start + reserved) * sector
    root = (start + reserved + fats * fat_size) * sector
    data = root + ((entries * 32 + sector - 1) // sector) * sector
    result = {}
    for offset in range(root, root + entries * 32, 32):
        first, attr = image[offset], image[offset + 11]
        if first == 0:
            break
        if first == 0xE5 or attr & 0x18 or attr == 0x0F:
            continue
        name = image[offset:offset + 8].decode('ascii').rstrip()
        extension = image[offset + 8:offset + 11].decode('ascii').rstrip()
        if extension:
            name += '.' + extension
        number, length, blocks, visited = u16(offset + 26), u32(offset + 28), [], set()
        while len(blocks) * cluster * sector < length:
            assert 2 <= number < 0xFFF0 and number not in visited
            visited.add(number)
            begin = data + (number - 2) * cluster * sector
            blocks.append(image[begin:begin + cluster * sector])
            number = u16(fat + number * 2)
        result[name] = b''.join(blocks)[:length]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', required=True, type=Path)
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--expected-checkpoint-version', required=True, type=int, choices=(6, 7),
                        help='Assert the exact checkpoint version emitted by this integrated build')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    model = h.model_identity(args.rom)
    assert model['id'] == 5, 'This witness requires the admitted complete HP49g+ ROM'
    before = assets()
    assert before['orchard.wasm'] == args.expected_wasm
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'schema': 'orchard-sd-directory-browser-v1', 'passed': False,
              'automatic_checks_passed': False, 'visual_review_required': True,
              'original_rom': True, 'production_worker': True, 'rom_ram_patches': False,
              'performance_sample': False, 'model': model, 'assets': before, 'stages': [],
              'expected_checkpoint_version': args.expected_checkpoint_version,
              'picker_adapter': 'Real OPFS FileSystemDirectoryHandle; native OS picker and permission prompts not automated',
              'tools': {Path(__file__).name: h.sha(Path(__file__).read_bytes())}}
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(h.Handler, directory=str(ROOT / 'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = browser = playwright = None
    errors, requests = [], []

    def stage(name):
        report['stages'].append(name)
        print('STAGE', name, flush=True)

    def snapshot():
        return page.evaluate('window.__transferProbe.snapshot')

    def keys(scans):
        for scan in scans:
            h.physical_keys(page, (scan,))
            hp49.settle(page, 4000000)

    def card():
        if not page.locator('#device-sidebar').is_visible():
            page.get_by_role('button', name='Connections', exact=True).click()
        page.locator('#device-sidebar').get_by_role('tab', name='SD card', exact=True).click()

    def close_card():
        page.get_by_role('button', name='Close sidebar', exact=True).click()
        expect(page.locator('#device-sidebar')).to_be_hidden()

    def button(name):
        return page.get_by_role('button', name=name, exact=True)

    def exported(name):
        with page.expect_download() as pending:
            button('Export card image').click()
        path = args.output / name
        pending.value.save_as(path)
        return path.read_bytes()

    def mounted(running=None, readonly=None):
        page.wait_for_function('window.__transferProbe.snapshot?.sd?.present')
        button('Sync folder').wait_for()
        if running is not None:
            page.wait_for_function('value=>window.__transferProbe.snapshot.running===value', arg=running)
        if readonly is not None:
            assert snapshot()['sd']['writeProtected'] is readonly
        assert not snapshot()['stopped']

    def write_local(name):
        page.evaluate('''async ({name,bytes})=>{
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('orchard-original-rom');
          const file=await root.getFileHandle(name,{create:true}),stream=await file.createWritable();
          await stream.write(new Uint8Array(bytes));await stream.close();
        }''', {'name': name, 'bytes': list(OBJECT_42)})

    def local_files():
        return page.evaluate('''async()=>{
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('orchard-original-rom');
          const files={};for await(const [name,handle] of root.entries()){
            if(handle.kind==='file')files[name]=Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
          }return files;
        }''')

    def binding():
        return page.evaluate('''async hash=>{
          const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('orchard-directories',1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
          const r=await new Promise((resolve,reject)=>{const tx=db.transaction('bindings'),q=tx.objectStore('bindings').get(hash);tx.oncomplete=()=>resolve(q.result);tx.onabort=()=>reject(tx.error);});db.close();
          const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('orchard-original-rom');
          return r?{name:r.association.name,serial:r.association.serial,
            sameEntry:await r.association.handle.isSameEntry(root),
            mappings:r.association.mappings,baseline:r.association.baseline.map(x=>({source:x.source,type:x.type}))}:null;
        }''', model['rom_sha256'])

    try:
        playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
        if not executable:
            raise RuntimeError('Set CHROMIUM to an installed Chrome/Chromium executable')
        browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
        report['browser_version'] = browser.version
        page = browser.new_page(viewport={'width': 1360, 'height': 1020}, locale='en-US')
        page.set_default_timeout(30000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append({'method': request.method, 'url': request.url}))
        page.add_init_script(OBSERVE)
        page.add_init_script(DIRECTORY_ADAPTER)
        page.goto(f'http://127.0.0.1:{server.server_port}/')

        stage('original-rom-cold-boot-and-real-directory')
        expect(button('Open ROM')).to_be_enabled()
        page.locator('#rom').set_input_files(str(args.rom.resolve()))
        page.wait_for_function('window.__transferProbe.snapshot?.loaded')
        cold_boot(page, args.output, report)
        h.verify_model(page, model)
        page.evaluate("navigator.storage.getDirectory().then(root=>root.getDirectoryHandle('orchard-original-rom',{create:true}))")
        write_local('ANSWER')
        card()
        button('Prepare card files').click()
        button('Choose local folder').click()
        preview = page.get_by_test_id('sd-directory-preview')
        expect(preview.get_by_role('cell', name='ANSWER', exact=True)).to_be_visible()
        expect(preview.get_by_role('cell', name='/ANSWER', exact=True)).to_be_visible()
        page.screenshot(path=str(args.output / 'directory-preview.png'))
        button('Use this folder as the draft').click()
        page.get_by_role('switch', name='Read only', exact=True).check()
        button('Insert prepared card').click()
        mounted(True, True)
        initial = exported('initial-readonly.img')
        assert root_files(initial) == {'ANSWER': OBJECT_42}
        original_binding = binding()
        assert original_binding['sameEntry']
        report['initial_binding'] = original_binding

        stage('mounted-cancel-and-back-preserve-original-media')
        button('Sync folder').click()
        plan = page.get_by_test_id('sd-directory-sync-plan')
        plan.wait_for()
        assert not snapshot()['sd']['present'] and not snapshot()['running']
        plan.get_by_role('button', name='Cancel', exact=True).click()
        mounted(True, True)
        assert exported('cancel-restored.img') == initial
        assert binding() == original_binding
        close_card()
        button('Pause').click()
        page.wait_for_function('!window.__transferProbe.snapshot.running')
        card()
        button('Sync folder').click()
        plan.wait_for()
        button('Discard draft and go back').click()
        mounted(False, True)
        assert exported('back-restored.img') == initial
        assert binding() == original_binding
        report['mounted_cancel'] = {'original_media_sha256': h.sha(initial), 'all_bytes_equal': True,
                                   'readonly_preserved': True, 'association_preserved': True,
                                   'running_cancel_resumes': True, 'paused_back_stays_paused': True}

        stage('original-files-reads-host-object-and-writes-test')
        button('Eject to edit / sync').click()
        page.get_by_test_id('sd-file-editor').wait_for()
        page.get_by_role('switch', name='Read only', exact=True).uncheck()
        button('Insert prepared card').click()
        mounted(False, False)
        close_card()
        button('Resume').click()
        page.wait_for_function('window.__transferProbe.snapshot.running')
        keys((58, 41, 42, 40))  # FILES / SD / OK; ANSWER is the only file.
        hp49.settle(page, 10000000)
        page.screenshot(path=str(args.output / 'files-host-answer.png'))
        keys((38, 56))  # RCL ANSWER and return HOME.
        page.locator('#lcd').screenshot(path=str(args.output / 'lcd-host-answer-42.png'))
        # Create TEST in HOME through ordinary arithmetic/STO and alpha keys.
        keys((56, 25, 19, 49, 57, 8, 57, 39, 57, 15, 57, 8, 6))
        keys((58, 41, 40, 36, 42, 40))  # FILES / HOME / COPY / SD / OK.
        keys((40, 42, 40))  # TREE / SD / OK.
        hp49.settle(page, 10000000)
        page.screenshot(path=str(args.output / 'files-firmware-created-test.png'))
        keys((56,))
        assert snapshot()['sd']['writtenBlocks'] > 0
        card()
        written = exported('firmware-write.img')
        assert root_files(written) == {'ANSWER': OBJECT_42, 'TEST': OBJECT_42}
        report['firmware_write'] = {'sd': snapshot()['sd'], 'file': 'TEST',
                                    'sha256': h.sha(root_files(written)['TEST'])}

        stage('bidirectional-preview-apply-and-reinsert')
        write_local('LOCAL')
        assert 'TEST' not in local_files()
        button('Sync folder').click()
        plan.wait_for()
        expect(plan.get_by_role('cell', name='LOCAL', exact=True)).to_be_visible()
        expect(plan.get_by_role('cell', name='TEST', exact=True)).to_be_visible()
        report['bidirectional_plan'] = plan.inner_text()
        page.screenshot(path=str(args.output / 'bidirectional-preview.png'))
        button('Apply and insert card').click()
        mounted(True, False)
        synced = exported('bidirectional-synced.img')
        expected = {'ANSWER': OBJECT_42, 'LOCAL': OBJECT_42, 'TEST': OBJECT_42}
        assert root_files(synced) == expected
        assert {name: bytes(value) for name, value in local_files().items()} == expected
        assert binding()['sameEntry']
        report['bidirectional_sync'] = {'card_files': sorted(expected), 'directory_files': sorted(local_files()),
                                        'exact_file_sha256': h.sha(OBJECT_42), 'running_resumed': True}

        stage('session-reload-reattaches-persisted-directory-handle')
        close_card()
        with page.expect_download() as pending:
            button('Save').click()
        saved = args.output / 'directory-card.ord'
        pending.value.save_as(saved)
        report['session'] = hp49.session_metadata(saved)
        assert report['session']['checkpoint_version'] == args.expected_checkpoint_version
        picker_before = page.evaluate("JSON.parse(sessionStorage.getItem('directory-probe-pickers'))")
        assert picker_before == [{'id': 'orchard-sd', 'mode': 'read'}]
        page.reload()
        # The ordinary file input remembered a browser-local copy of the ROM.
        # Let that automatic selection finish before restoring the full session.
        page.wait_for_function('window.__transferProbe.snapshot?.loaded')
        page.locator('#session-file').set_input_files(str(saved.resolve()))
        page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
        page.wait_for_function('window.__transferProbe.snapshot.sd.present&&window.__transferProbe.snapshot.running')
        card()
        mounted(True, False)
        assert exported('reloaded-before-sync.img') == synced
        assert binding()['sameEntry']
        write_local('AFTER')
        button('Sync folder').click()
        plan.wait_for()
        expect(plan.get_by_role('cell', name='AFTER', exact=True)).to_be_visible()
        page.screenshot(path=str(args.output / 'reload-reassociated-preview.png'))
        button('Apply and insert card').click()
        mounted(True, False)
        after = exported('reloaded-after-sync.img')
        expected['AFTER'] = OBJECT_42
        assert root_files(after) == expected
        assert {name: bytes(value) for name, value in local_files().items()} == expected
        picker_after = page.evaluate("JSON.parse(sessionStorage.getItem('directory-probe-pickers'))")
        assert picker_after == picker_before
        report['reload_reassociation'] = {'automatic_rom_copy_reopen': True, 'session_media_exact': True,
                                          'saved_handle_same_entry': True, 'picker_calls': picker_after,
                                          'new_local_file_synced': 'AFTER', 'running_resumed': True}
        close_card()
        keys((58, 41, 42, 40))  # FILES / SD: original Filer lists the four files.
        hp49.settle(page, 10000000)
        page.screenshot(path=str(args.output / 'files-after-reload-sync.png'))
        keys((38, 56))  # RCL the retained ANSWER selection and return HOME.
        page.locator('#lcd').screenshot(path=str(args.output / 'lcd-after-reload-42.png'))
        report['final_snapshot'] = snapshot()
        assert snapshot()['sd']['readBlocks'] > 0 and not snapshot()['stopped']
        assert not errors and not page.evaluate('window.__transferProbe.errors')
        assert all(request['method'] == 'GET' for request in requests)
        assert assets() == before, 'Production assets changed during the witness'
        report['automatic_checks_passed'] = True
        report['visual_review_files'] = ['lcd-host-answer-42.png', 'lcd-after-reload-42.png',
                                          'files-firmware-created-test.png', 'files-after-reload-sync.png']
    finally:
        report['page_errors'] = errors
        if page:
            try:
                report['worker_errors'] = page.evaluate('window.__transferProbe.errors')
                report['sd_events'] = [event for event in page.evaluate('window.__transferProbe.events')
                                       if event['type'] in ('sd-error', 'sd-complete')]
                if not report['automatic_checks_passed']:
                    report['failure_body'] = page.locator('body').inner_text()
                    report['failure_snapshot'] = snapshot()
                    page.screenshot(path=str(args.output / 'failure.png'))
            except Exception:
                pass
        if browser:
            browser.close()
        if playwright:
            playwright.stop()
        report['request_methods'] = sorted({request['method'] for request in requests})
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        server.shutdown()
        server.server_close()
    print(json.dumps({'automatic_checks_passed': report['automatic_checks_passed'],
                      'visual_review_required': True, 'stages': report['stages']}))


if __name__ == '__main__':
    main()
