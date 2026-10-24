# SPDX-License-Identifier: MIT
"""Browser directory workflow using real OPFS handles and directory input.

showDirectoryPicker alone is adapted to return an origin-private test directory;
all recursive reads, file streams, conflict checks and UI are production code.
Worker acknowledgements are explicit fixtures; stock ROM evidence is separate.
"""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'build-r23/directory-sd'
OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e','''import {build} from 'esbuild';await build({entryPoints:['tests/sd-directory-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build-r23/directory-sd/ui-fixture.js',define:{'process.env.NODE_ENV':'"production"'}});'''],cwd=ROOT,check=True)
checks=[]
def passed(name):checks.append(name)
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser','google-chrome-stable'] if (path:=shutil.which(name))),None)
    if not chrome:raise RuntimeError('Set CHROMIUM to a real Chrome executable')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1100,'height':1000},accept_downloads=True)
    page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    html='<div id="root"></div><link rel="stylesheet" href="/ui-fixture.css"><script src="/ui-fixture.js"></script>'
    def serve(route):
        name=route.request.url.rsplit('/',1)[-1]
        if name in ['ui-fixture.js','ui-fixture.css']:
            route.fulfill(status=200,body=(OUT/name).read_bytes(),content_type='application/javascript' if name.endswith('.js') else 'text/css')
        else:route.fulfill(status=200,body=html,content_type='text/html')
    page.route('http://localhost:8743/**',serve);page.goto('http://localhost:8743/')
    def apply_font():
        if not os.environ.get('SD_TEST_FONT'):return
        font=base64.b64encode(Path(os.environ['SD_TEST_FONT']).read_bytes()).decode()
        page.add_style_tag(content="@font-face{font-family:SDDirectoryCJK;src:url(data:font/otf;base64,"+font+")} body,body *{font-family:SDDirectoryCJK,sans-serif!important}")
        page.evaluate("document.fonts.load('16px SDDirectoryCJK')")
    apply_font()
    def button(name):return page.get_by_role('button',name=name,exact=True)
    page.evaluate('window.__prepareDirectory()')
    button('Prepare card files').click();button('Choose local folder').click()
    preview=page.get_by_test_id('sd-directory-preview');preview.wait_for()
    assert page.evaluate('window.__pickerOptions.mode')=='read'
    assert 'notes long.随意' in preview.inner_text() and '/NOTESL~1' in preview.inner_text()
    assert '/EMPTYF~1/' in preview.inner_text()
    assert page.evaluate('window.__getHostFile("ANSWER")')==[0,255,13,10]
    button('Use this folder as the draft').click()
    button('Open folder EMPTYF~1').click();page.get_by_text('This folder is empty.',exact=True).wait_for();button('Parent folder').click()
    button('Open folder PROGRAMS').click()
    with page.expect_download() as pending:button('Download NESTED').click()
    pending.value.save_as(OUT/'nested.any');assert (OUT/'nested.any').read_bytes()==bytes([1,2,3])
    button('Parent folder').click()
    with page.expect_download() as pending:button('Download draft image').click()
    pending.value.save_as(OUT/'directory-card.img');assert (OUT/'directory-card.img').stat().st_size==16*1024*1024
    passed('native browser directory handles recursively import empty/nested folders and arbitrary names with reviewed 8.3 aliases and exact bytes')

    button('Close').click();page.get_by_role('complementary',name='SD tools').wait_for(state='hidden')
    button('Open SD sidebar').click();button('Open folder PROGRAMS').wait_for()
    button('Insert prepared card').click();button('Eject to edit / sync').wait_for()
    assert page.get_by_test_id('sd-file-editor').count()==0
    assert page.evaluate('window.__controller.sdDirectory.name')=='fixture-source'
    page.evaluate('window.__guestChanges()')
    page.evaluate('window.__setHostFile("notes long.随意",[77])')
    page.evaluate('window.__setHostFile("NEW.LOC",[55])')
    page.evaluate('window.__controller.patch({running:true})')
    button('Sync folder').click()
    plan=page.get_by_test_id('sd-directory-sync-plan');plan.wait_for()
    assert page.evaluate('window.__controller.state.sd') is None
    assert page.evaluate('window.__controller.state.running') is False
    assert page.evaluate('window.__messages.filter(item=>item.type==="sd-edit").length')==1
    assert '1 changes to card, 3 to folder, 1 conflicts' in plan.inner_text()
    assert '1 entries will be deleted.' in plan.inner_text()
    assert page.evaluate('window.__getHostFile("ANSWER")')==[0,255,13,10]
    button('Apply and insert card').click()
    page.get_by_text('Saved 3 folder changes, 1 conflicts, 0 failed',exact=True).wait_for()
    assert page.evaluate('window.__controller.state.sd') is None
    assert page.evaluate('window.__getHostFile("ANSWER")')==[42]
    assert page.evaluate('window.__getHostFile("GUEST.ANY")')==[8,0,255]
    assert page.evaluate('window.__getHostFile("notes long.随意")')==[77]
    assert page.evaluate('window.__directoryRoot.getFileHandle("README").then(()=>true,()=>false)') is False
    button('Download NEW.LOC').wait_for()
    passed('running guest pauses before eject; explicit three-way review imports local additions, writes guest changes, propagates deletions and leaves unresolved conflicts ejected')

    button('Preview synchronization').click();plan.wait_for()
    assert '0 changes to card, 0 to folder, 1 conflicts' in plan.inner_text()
    page.get_by_role('combobox',name='Resolve notes long.随意',exact=True).select_option('local')
    button('Apply and insert card').click();button('Sync folder').wait_for()
    page.wait_for_function('window.__controller.state.running===true')
    assert page.evaluate('window.__cardFile("/NOTESL~1")')==[77]
    assert page.evaluate('window.__cardFile("/NEW.LOC")')==[55]
    assert page.evaluate('window.__storedDirectory().then(record=>record.association.name)')=='fixture-source'
    page.evaluate('window.__saveCard()')
    passed('explicit conflict selection updates the card, persists the new common baseline and inserts before restoring the original running state')

    page.reload();button('Prepare card files').wait_for();apply_font()
    page.evaluate('window.__restoreCard()');button('Sync folder').wait_for()
    assert page.evaluate('window.__controller.sdDirectory') is None
    page.evaluate('window.__setHostFile("NEW.LOC",[56])')
    button('Sync folder').click();plan.wait_for()
    assert '1 changes to card, 0 to folder, 0 conflicts' in plan.inner_text()
    button('Apply and insert card').click();button('Sync folder').wait_for()
    assert page.evaluate('window.__cardFile("/NEW.LOC")')==[56]
    assert page.evaluate('window.__controller.state.running') is False
    passed('actual IndexedDB structured-clone directory handle and baseline survive reload; matching restored card reconnects without reopening picker and preserves paused state')

    page.evaluate('window.__guestConvergingBoundaries()')
    page.evaluate('''async()=>{
      await window.__directoryRoot.removeEntry('PROGRAMS',{recursive:true});
      await window.__directoryRoot.removeEntry('Empty folder');
      await window.__setHostFile('PROGRAMS',[31,0,255]);
    }''')
    button('Sync folder').click();plan.wait_for()
    assert '0 changes to card, 0 to folder, 0 conflicts' in plan.inner_text()
    assert page.get_by_role('combobox',name='Resolve PROGRAMS',exact=True).count()==0
    button('Apply and insert card').click();button('Sync folder').wait_for()
    assert page.evaluate('window.__cardFile("/PROGRAMS")')==[31,0,255]
    assert page.evaluate('window.__getHostFile("PROGRAMS")')==[31,0,255]
    assert page.evaluate('window.__storedDirectory().then(record=>record.association.baseline.some(entry=>entry.source==="PROGRAMS/NESTED"||entry.source==="Empty folder"))') is False
    button('Sync folder').click();plan.wait_for()
    assert '0 changes to card, 0 to folder, 0 conflicts' in plan.inner_text()
    button('Apply and insert card').click();button('Sync folder').wait_for()
    passed('matching directory deletion and directory-to-file replacement converge without conflicts; real OPFS blocked descendants leave the persisted baseline and the next sync is empty')

    page.evaluate('window.__restoreCard(true)');button('Sync folder').click()
    button('Choose local folder').wait_for()
    assert page.evaluate('window.__controller.state.dialog.message')=='sdDirectoryMismatch'
    assert page.get_by_test_id('sd-directory-sync-plan').count()==0
    page.evaluate('window.__controller.answer(true)')
    button('Open fixture-source').click();preview.wait_for()
    button('Use this folder as the draft').click()
    page.set_viewport_size({'width':390,'height':844})
    page.evaluate('window.__i18n.changeLanguage("zh")')
    button('预览同步').click();plan.wait_for()
    assert '卡内修改 0 项，本地修改 0 项，冲突 0 项' in plan.inner_text()
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    page.screenshot(path=str(OUT/'directory-mobile-zh.png'),full_page=True)
    page.evaluate('window.__i18n.changeLanguage("en")');button('Cancel').click()
    button('Forget folder').click()
    page.wait_for_function('window.__storedDirectory().then(record=>record===null)')
    passed('unrelated card serial cannot attach to remembered folder; explicit reopen imports anew; mobile Chinese review fits viewport; forget removes persisted association')

    button('Start a new blank card').click();page.evaluate('window.showDirectoryPicker=undefined')
    fallback=OUT/'fallback-local';(fallback/'Subfolder').mkdir(parents=True,exist_ok=True)
    (fallback/'Raw payload.unrestricted').write_bytes(bytes([0,255,0,13,10]));(fallback/'Subfolder'/'NOEXT').write_bytes(b'abc')
    page.locator('#sd-directory-input').set_input_files(str(fallback))
    preview.wait_for();assert 'direct write-back is unavailable' in preview.inner_text()
    assert page.locator('#sd-directory-input').get_attribute('accept') is None
    button('Use this folder as the draft').click();button('Download RAWPAY~1.UNR').wait_for()
    assert page.get_by_test_id('sd-directory-association').count()==0
    with page.expect_download() as pending:button('Download RAWPAY~1.UNR').click()
    pending.value.save_as(OUT/'fallback-content');assert (OUT/'fallback-content').read_bytes()==bytes([0,255,0,13,10])
    passed('real directory file input fallback imports nested files without extension filter and clearly omits direct write-back')
    page.evaluate('''async()=>{
      const origin=await navigator.storage.getDirectory();window.__directoryRoot=await origin.getDirectoryHandle('large-source',{create:true});
      const file=await window.__directoryRoot.getFileHandle('LARGE',{create:true}),stream=await file.createWritable();
      await stream.write(new Uint8Array(17*1024*1024));await stream.close();
      window.showDirectoryPicker=async()=>window.__directoryRoot;
    }''')
    button('Choose local folder').click()
    page.get_by_role('alert').filter(has_text='does not fit in a 16 MiB card').wait_for()
    button('Download RAWPAY~1.UNR').wait_for()
    page.get_by_role('combobox',name='New card size',exact=True).click();page.get_by_role('option',name='32 MiB',exact=True).click()
    preview.wait_for();assert '32 MiB card' in preview.inner_text()
    button('Use this folder as the draft').click();button('Download LARGE').wait_for()
    with page.expect_download() as pending:button('Download draft image').click()
    pending.value.save_as(OUT/'directory-large.img');assert (OUT/'directory-large.img').stat().st_size==32*1024*1024
    passed('capacity overflow keeps the current draft; changing to 32 MiB rebuilds the already-read snapshot successfully')
    assert not errors,errors
    report={'checks':checks,'browser':browser.version,'errors':errors,'picker_adapter':'Origin-private FileSystemDirectoryHandle; native permission dialog not automated','guest_adapter':'Explicit Worker ack; firmware acceptance tested separately'}
    (OUT/'browser-result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));browser.close()
