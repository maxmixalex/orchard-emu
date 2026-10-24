#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original HP49g+ SD media through the production page, Worker and file pickers.

Functional acceptance, not a timing benchmark. Observers only read messages.
Private ROMs, sessions, card images and screenshots stay in --output.
"""
import argparse, functools, importlib.util, json, os, shutil, struct, threading
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('orchard_hp49',ROOT/'tools/probe-hp49-browser.py')
hp49=importlib.util.module_from_spec(spec);spec.loader.exec_module(hp49)
h=hp49.helper
OBSERVE=h.OBSERVE.replace('ticks:d.tick','sd:d.sd,ticks:d.tick').replace(
    "else if(d.type==='file-transfer-status'", "else if(d.type==='sd-complete'||d.type==='sd-error'||d.type==='file-transfer-status'")

def assets():
    return {p.relative_to(ROOT/'dist').as_posix():h.sha(p.read_bytes()) for p in sorted((ROOT/'dist').rglob('*'))
            if p.is_file() and p.name not in ('asset-manifest.json','revision.txt')}

def stored_test(image):
    """Read the firmware-created TEST through FAT16, independently of the core."""
    u16=lambda p:struct.unpack_from('<H',image,p)[0]
    u32=lambda p:struct.unpack_from('<I',image,p)[0]
    start=u32(454);b=start*512;sector=u16(b+11);cluster=image[b+13]
    reserved=u16(b+14);fats=image[b+16];entries=u16(b+17);fat_size=u16(b+22)
    root=(start+reserved+fats*fat_size)*sector
    data=root+((entries*32+sector-1)//sector)*sector
    for offset in range(root,root+entries*32,32):
        if image[offset:offset+11]!=b'TEST       ': continue
        number=u16(offset+26);length=u32(offset+28)
        assert number>=2 and length<=cluster*sector
        body=image[data+(number-2)*cluster*sector:data+(number-2)*cluster*sector+length]
        assert body==bytes.fromhex('4850485034392d5814268000004200'),'Original OS must store the actual integer 42 object'
        return {'name':'TEST','bytes':length,'sha256':h.sha(body)}
    raise AssertionError('The exported FAT16 root must contain firmware-created TEST')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom',required=True,type=Path)
    parser.add_argument('--expected-wasm',required=True)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();model=h.model_identity(args.rom)
    assert model['id']==5,'This witness requires the admitted HP49g+ full NOR'
    before=assets();assert before['orchard.wasm']==args.expected_wasm
    args.output.mkdir(parents=True,exist_ok=False)
    report={'schema':'orchard-sd-browser-v1','passed':False,'performance_sample':False,
            'original_rom':True,'rom_ram_patches':False,'assets':before,'model':model,'stages':[]}
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(h.Handler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    page=None;browser=None;playwright=None;errors=[]
    def stage(name): report['stages'].append(name);print('STAGE',name,flush=True)
    def snapshot(): return page.evaluate('window.__transferProbe.snapshot')
    def close_card():
        page.get_by_role('button',name='Close sidebar',exact=True).click()
        expect(page.locator('#device-sidebar')).to_be_hidden()
    def keys(scans):
        for scan in scans:
            h.physical_keys(page,(scan,));hp49.settle(page,4000000)
    def card():
        if not page.locator('#device-sidebar').is_visible():
            page.get_by_role('button',name='Connections',exact=True).click()
        page.locator('#device-sidebar').get_by_role('tab',name='SD card',exact=True).click()
        expect(page.locator('#device-sidebar')).to_be_visible()
        expect(page.locator('#device-sidebar').get_by_role('tab',name='SD card',exact=True)).to_have_attribute('aria-selected','true')
    def eject():
        dirty=snapshot()['sd']['dirty']
        page.locator('#device-sidebar').get_by_role('button',name='Eject card',exact=True).click()
        if dirty:
            page.get_by_role('dialog',name='Eject card',exact=True).get_by_role('button',name='Eject card',exact=True).click()
            page.get_by_role('dialog',name='Eject card',exact=True).wait_for(state='hidden')
        page.wait_for_function('!window.__transferProbe.snapshot.sd.present')
    def exported(name):
        with page.expect_download() as pending: page.get_by_role('button',name='Export card image',exact=True).click()
        path=args.output/name;pending.value.save_as(path);return path
    try:
        playwright=sync_playwright().start()
        executable=os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
        if not executable: raise RuntimeError('Set CHROMIUM to an installed Chrome/Chromium executable')
        browser=playwright.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
        report['browser_version']=browser.version
        page=browser.new_page(viewport={'width':1360,'height':940},locale='en-US')
        page.set_default_timeout(30000);page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script(OBSERVE);page.goto(f'http://127.0.0.1:{server.server_port}/')
        stage('cold-boot-and-empty-slot-files')
        expect(page.get_by_role('button',name='Open ROM',exact=True)).to_be_enabled()
        page.locator('#rom').set_input_files(str(args.rom.resolve()))
        page.wait_for_function('window.__transferProbe.snapshot?.loaded')
        hp49.cold_boot(page);keys((58,41));hp49.settle(page,8000000)
        assert not snapshot()['stopped'];assert not snapshot()['sd']['present']
        page.screenshot(path=str(args.output/'files-no-card.png'))
        report['no_card_files']=snapshot();keys((56,));hp49.settle(page)

        stage('create-card-and-stock-files')
        card();page.get_by_role('button',name='Create 16 MiB card',exact=True).click()
        page.wait_for_function('window.__transferProbe.snapshot?.sd?.present')
        assert snapshot()['sd']['bytes']==16*1024*1024
        close_card();keys((58,41));hp49.settle(page,10000000)
        page.screenshot(path=str(args.output/'files-with-card.png'))
        report['with_card_files']=snapshot()
        assert snapshot()['sd']['readBlocks']>0 and not snapshot()['stopped']

        stage('stock-file-copy-to-card-and-recall')
        # HOME: 42 STO, physical ALPHA T E S T, ENTER. No injected object bytes.
        keys((56,25,19,49,57,8,57,39,57,15,57,8,6))
        keys((58,41,40,36,42,40))  # FILES / HOME / COPY / 3:SD / OK.
        keys((40,42,40))          # TREE / 3:SD / OK: open its directory.
        hp49.settle(page,10000000) # Allow the original Filer to finish directory reads/drawing.
        page.screenshot(path=str(args.output/'sd-stock-test-file.png'))
        keys((38,56))             # RCL selected TEST, then return HOME.
        page.screenshot(path=str(args.output/'sd-stock-recalled-42.png'))
        report['after_file_roundtrip']=snapshot()
        assert snapshot()['sd']['writtenBlocks']>0 and not snapshot()['stopped']

        stage('export-image-and-complete-session')
        card();first=exported('card-before.img');first_hash=h.sha(first.read_bytes())
        assert first.stat().st_size==16*1024*1024
        report['stock_file']=stored_test(first.read_bytes())
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(args.output/'sd-mobile.png'));close_card()
        page.set_viewport_size({'width':1360,'height':940})
        with page.expect_download() as pending: page.get_by_role('button',name='Save',exact=True).click()
        saved=args.output/'with-card.ord';pending.value.save_as(saved)
        report['session']=hp49.session_metadata(saved)
        assert report['session']['checkpoint_version']==7 and report['session']['checkpoint_bytes']>16*1024*1024
        page.wait_for_function('!window.__transferProbe.snapshot.running');saved_frame=hp49.frame(page)
        card();eject();close_card()
        page.locator('#session-file').set_input_files(str(saved.resolve()))
        page.get_by_role('dialog').get_by_role('button',name='Restore',exact=True).click()
        page.wait_for_function('window.__transferProbe.snapshot.sd.present&&window.__transferProbe.snapshot.running')
        report['manual_restore_auto_resumed']=True
        # Freeze only after observing the new automatic resume behavior. This
        # preserves the exact displayed-frame comparison used by this witness.
        page.get_by_role('button',name='Pause',exact=True).click()
        page.wait_for_function('!window.__transferProbe.snapshot.running')
        assert hp49.frame(page)==saved_frame,'Full displayed LCD must restore exactly'
        card();after=exported('card-restored.img');assert h.sha(after.read_bytes())==first_hash;close_card()
        report['card_image_sha256']=first_hash;report['manual_session_media_exact']=True

        stage('atomic-eject-to-edit-and-persistent-sidebar-draft')
        card();page.get_by_role('button',name='Eject to edit / sync',exact=True).click()
        page.wait_for_function('!window.__transferProbe.snapshot.sd.present')
        editor=page.get_by_test_id('sd-file-editor')
        expect(editor.get_by_role('cell',name='TEST',exact=True)).to_be_visible()
        close_card();card()
        expect(editor.get_by_role('cell',name='TEST',exact=True)).to_be_visible()
        page.get_by_role('button',name='Insert prepared card',exact=True).click()
        page.wait_for_function('window.__transferProbe.snapshot.sd.present')
        edited=exported('card-after-edit.img');assert h.sha(edited.read_bytes())==first_hash;close_card()
        report['atomic_edit_preserves_media']=True
        report['hidden_sidebar_retains_draft']=True

        stage('automatic-save-with-media-and-reload')
        page.get_by_role('button',name='Settings',exact=True).click()
        page.get_by_role('tab',name='Storage',exact=True).click()
        page.get_by_role('switch',name='Save automatically on this device',exact=True).check()
        page.get_by_role('combobox',name='Save interval',exact=True).click()
        page.get_by_role('option',name='15 seconds',exact=True).click()
        page.get_by_role('button',name='Apply',exact=True).click()
        page.get_by_text('Saved on this device',exact=True).wait_for(timeout=30000)
        report['automatic_save']=page.evaluate('''async hash=>{
          const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('orchard-sessions',1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
          const r=await new Promise((resolve,reject)=>{const tx=db.transaction('sessions'),q=tx.objectStore('sessions').get(hash);tx.oncomplete=()=>resolve(q.result);tx.onabort=()=>reject(tx.error);});db.close();
          return {bytes:r.file.length,model:r.model,version:r.version};
        }''',model['rom_sha256'])
        assert report['automatic_save']['bytes']>16*1024*1024
        # Standard file input stores a labelled browser-local ROM copy. Reload
        # must let that automatic read finish; selecting the same ROM again
        # races it and can turn the restore prompt into a replacement prompt.
        report['remembered_rom']=page.evaluate('''async model=>{
          const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('orchard-roms',1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
          const r=await new Promise((resolve,reject)=>{const tx=db.transaction('roms'),q=tx.objectStore('roms').get(model);tx.oncomplete=()=>resolve(q.result);tx.onabort=()=>reject(tx.error);});db.close();
          return r?{model:r.model,hash:r.hash,kind:r.kind}:null;
        }''',model['id'])
        assert report['remembered_rom']=={'model':model['id'],'hash':model['rom_sha256'],'kind':'copy'}
        page.reload()
        page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
        page.get_by_role('dialog',name='Restore local save?',exact=True).get_by_role('button',name='Restore',exact=True).click()
        page.wait_for_function('window.__transferProbe.snapshot?.sd?.present&&window.__transferProbe.snapshot.running')
        report['automatic_restore_auto_resumed']=True
        card();restored=exported('card-after-reload.img');assert h.sha(restored.read_bytes())==first_hash
        report['automatic_session_media_exact']=True
        report['automatic_rom_reopen']=True

        stage('read-only-import')
        eject()
        page.get_by_role('switch',name='Read only',exact=True).check()
        page.locator('#sd-image-file').set_input_files(str(first.resolve()))
        page.wait_for_function('window.__transferProbe.snapshot.sd.present&&window.__transferProbe.snapshot.sd.writeProtected')
        report['read_only_import']=snapshot()['sd'];close_card()
        assert not errors and not page.evaluate('window.__transferProbe.errors')
        assert assets()==before,'Production assets changed during the witness'
        report['passed']=True
    finally:
        report['page_errors']=errors
        if not report['passed'] and page:
            try:
                report['failure_body']=page.locator('body').inner_text();report['failure_snapshot']=snapshot()
                page.screenshot(path=str(args.output/'failure.png'))
            except Exception: pass
        if browser: browser.close()
        if playwright: playwright.stop()
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        server.shutdown();server.server_close()
    print(json.dumps({'passed':report['passed'],'card_bytes':16*1024*1024,'stages':report['stages']}))

if __name__=='__main__': main()
