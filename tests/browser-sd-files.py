# SPDX-License-Identifier: MIT
"""Real Chromium file chooser/download + production controller, without a ROM.

The explicit Worker acknowledgement below is not a stock-firmware acceptance
test. The independent original HP49g+ SD workflow is recorded separately.
"""
from pathlib import Path
import base64,hashlib,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'build-r20/sd-files'
OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e', '''import {build} from 'esbuild';await build({entryPoints:['tests/sd-files-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build-r20/sd-files/ui-fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
checks=[]
def passed(name):checks.append(name)
def sha(data):return hashlib.sha256(data).hexdigest()
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser','google-chrome-stable'] if (path:=shutil.which(name))),None)
    if not chrome:raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1100,'height':1000},accept_downloads=True)
    page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<div id="root"></div>')
    page.add_style_tag(content=(OUT/'ui-fixture.css').read_text())
    page.add_script_tag(content=(OUT/'ui-fixture.js').read_text())
    # Optional local font for minimal Linux images lacking CJK system fonts.
    # This belongs only to screenshot verification, never the product bundle.
    if os.environ.get('SD_TEST_FONT'):
        data=base64.b64encode(Path(os.environ['SD_TEST_FONT']).read_bytes()).decode()
        page.add_style_tag(content="@font-face{font-family:SDTestCJK;src:url(data:font/ttf;base64,"+data+")} :root{--mantine-font-family:SDTestCJK,sans-serif}")
        page.evaluate("()=>document.fonts.load('16px SDTestCJK')")
    def button(name):return page.get_by_role('button',name=name,exact=True)
    def save_card(name):
        with page.expect_download() as pending:button('Download draft image').click()
        pending.value.save_as(OUT/name)
        return (OUT/name).read_bytes()
    button('Prepare card files').click()
    editor=page.get_by_test_id('sd-file-editor');editor.wait_for()
    assert page.locator('#sd-draft-files').get_attribute('accept') is None
    assert page.locator('#sd-draft-image').get_attribute('accept') is None
    assert page.locator('#sd-image-file').get_attribute('accept') is None
    passed('all SD chooser inputs accept arbitrary suffixes')

    payload=b'\x00\xff\r\nRAW HP CONTENT\x00'
    page.locator('#sd-draft-files').set_input_files([
        {'name':'Arbitrary extension.document','mimeType':'application/octet-stream','buffer':payload},
        {'name':'NOEXT','mimeType':'application/octet-stream','buffer':b''}])
    button('Add 2 files to draft').click()
    assert 'needs a valid short name' in page.get_by_role('alert').inner_text()
    assert editor.get_by_text('This folder is empty.',exact=True).count()==1
    page.get_by_label('Card name for Arbitrary extension.document',exact=True).fill('RAW.XYZ')
    button('Add 2 files to draft').click()
    button('Download RAW.XYZ').wait_for()
    assert page.get_by_role('alert').count()==0
    with page.expect_download() as pending:button('Download RAW.XYZ').click()
    assert pending.value.suggested_filename=='RAW.XYZ'
    pending.value.save_as(OUT/'browser-raw.xyz')
    assert (OUT/'browser-raw.xyz').read_bytes()==payload
    with page.expect_download() as pending:button('Download NOEXT').click()
    pending.value.save_as(OUT/'browser-empty')
    assert (OUT/'browser-empty').read_bytes()==b''
    passed('editable short names validate without truncation; arbitrary and empty file bytes round-trip')

    baseline=save_card('browser-before-duplicate.img')
    page.locator('#sd-draft-files').set_input_files([
        {'name':'FRESH','mimeType':'application/octet-stream','buffer':b'fresh'},
        {'name':'raw.xyz','mimeType':'application/octet-stream','buffer':b'overwrite'}])
    button('Add 2 files to draft').click()
    assert 'already exists' in page.get_by_role('alert').inner_text()
    assert button('Download FRESH').count()==0
    rejected=save_card('browser-after-duplicate.img')
    assert rejected==baseline
    button('Cancel').click()
    passed('duplicate in later batch member keeps complete draft byte-exact')

    page.get_by_label('New folder name',exact=True).fill('PROGRAMS')
    button('Create folder').click();button('Open folder PROGRAMS').click()
    page.locator('#sd-draft-files').set_input_files({'name':'NESTED','mimeType':'application/octet-stream','buffer':payload})
    button('Add 1 files to draft').click()
    button('Download NESTED').wait_for()
    button('Parent folder').click();button('Open folder PROGRAMS').wait_for()
    complete=save_card('browser-prepared.img')
    assert len(complete)==16*1024*1024 and complete!=baseline
    passed('new directory and nested file survive navigation and full-image download')

    # Use actual controls for transactional rename, collision, and deletion.
    button('Rename RAW.XYZ').click()
    page.get_by_label('New card name',exact=True).fill('RENAMED.ANY')
    button('Apply name').click();button('Download RENAMED.ANY').wait_for()
    with page.expect_download() as pending:button('Download RENAMED.ANY').click()
    pending.value.save_as(OUT/'browser-renamed.any')
    assert (OUT/'browser-renamed.any').read_bytes()==payload
    renamed=save_card('browser-renamed.img')
    button('Rename RENAMED.ANY').click()
    page.get_by_label('New card name',exact=True).fill('NOEXT')
    button('Apply name').click()
    assert 'already exists' in page.get_by_role('alert').inner_text()
    assert save_card('browser-rename-collision.img')==renamed
    page.get_by_label('New card name',exact=True).fill('RAW.XYZ');button('Apply name').click()
    button('Rename PROGRAMS').click()
    page.get_by_label('New card name',exact=True).fill('TOOLS');button('Apply name').click()
    button('Open folder TOOLS').click();button('Download NESTED').wait_for();button('Parent folder').click()
    button('Rename TOOLS').click()
    page.get_by_label('New card name',exact=True).fill('PROGRAMS');button('Apply name').click()
    assert save_card('browser-renamed-back.img')==complete
    passed('renames preserve payload/directory contents; collision rolls back exact image')

    button('Delete PROGRAMS').click();button('Delete').click()
    assert 'not empty' in page.get_by_role('alert').inner_text()
    assert save_card('browser-nonempty-rejected.img')==complete
    button('Cancel').click()
    button('Delete NOEXT').click();button('Cancel').click()
    assert save_card('browser-delete-cancelled.img')==complete
    button('Delete NOEXT').click();button('Delete').click()
    assert button('Download NOEXT').count()==0
    page.get_by_label('New folder name',exact=True).fill('REMOVE');button('Create folder').click()
    button('Delete REMOVE').click();button('Delete').click()
    assert button('Open folder REMOVE').count()==0
    button('Open folder PROGRAMS').click();button('Download NESTED').wait_for();button('Parent folder').click()
    complete=save_card('browser-managed.img')
    passed('delete confirmation/cancel works; nonempty folders rejected; files and empty folders deleted')

    page.locator('#sd-draft-image').set_input_files({'name':'BROKEN.custom','mimeType':'application/octet-stream','buffer':bytes(len(complete))})
    page.get_by_role('alert').wait_for()
    button('Open folder PROGRAMS').wait_for()
    assert save_card('browser-after-bad-image.img')==complete
    page.evaluate("""()=>{window.__arrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){return this.name==='READFAIL'?Promise.reject(new Error('unreadable')):window.__arrayBuffer.call(this)}}""")
    page.locator('#sd-draft-files').set_input_files({'name':'READFAIL','mimeType':'application/octet-stream','buffer':b'x'})
    assert 'could not be read' in page.get_by_role('alert').inner_text()
    assert save_card('browser-after-read-failure.img')==complete
    page.evaluate('()=>{File.prototype.arrayBuffer=window.__arrayBuffer;}')
    passed('malformed image and file-read failure visibly preserve current draft')

    button('Start a new blank card').click()
    assert button('Open folder PROGRAMS').count()==0
    page.locator('#sd-draft-image').set_input_files({'name':'source.any-suffix','mimeType':'application/octet-stream','buffer':complete})
    button('Open folder PROGRAMS').wait_for()
    assert page.get_by_label('Image filename',exact=True).input_value()=='source.any-suffix.img'
    button('Open folder PROGRAMS').click()
    with page.expect_download() as pending:button('Download NESTED').click()
    pending.value.save_as(OUT/'browser-nested')
    assert (OUT/'browser-nested').read_bytes()==payload
    button('Parent folder').click()
    page.evaluate("window.__failDownload=true")
    button('Download draft image').click();page.get_by_role('alert').wait_for()
    assert 'download could not be started' in page.get_by_role('alert').inner_text()
    button('Download RAW.XYZ').click()
    assert 'download could not be started' in page.get_by_role('alert').inner_text()
    page.evaluate("window.__failDownload=false")
    passed('download failure is visible; reopening an arbitrary-suffix image preserves nested contents')

    page.set_viewport_size({'width':390,'height':844})
    page.get_by_role('dialog').evaluate('(element)=>{element.scrollTop=0}')
    page.screenshot(path=str(OUT/'browser-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    page.evaluate("window.__i18n.changeLanguage('zh')")
    page.get_by_role('button',name='插入准备好的卡',exact=True).wait_for()
    page.get_by_role('button',name='重命名 RAW.XYZ',exact=True).click()
    page.get_by_label('新的卡内名称',exact=True).wait_for()
    page.get_by_role('button',name='取消',exact=True).click()
    page.get_by_role('dialog').evaluate('(element)=>{element.scrollTop=0}')
    page.screenshot(path=str(OUT/'browser-mobile-zh.png'),full_page=True)
    page.evaluate("window.__i18n.changeLanguage('en')")
    passed('390px viewport and both language controls render without horizontal overflow')

    page.get_by_label('Read only',exact=True).check()
    # The component keeps the draft while the production controller reports
    # local File-read failure or an explicit Worker insertion rejection.
    page.evaluate("""()=>{File.prototype.arrayBuffer=function(){return this.name==='source.any-suffix.img'?Promise.reject(new Error('insert read failed')):window.__arrayBuffer.call(this)}}""")
    button('Insert prepared card').click()
    page.wait_for_function('window.__controller.state.dialog?.message==="sdError"')
    assert page.get_by_test_id('sd-file-editor').count()==1
    assert page.evaluate('window.__messages.filter(m=>m.type==="sd-insert").length')==0
    page.evaluate('()=>{File.prototype.arrayBuffer=window.__arrayBuffer;window.__controller.answer(true);}')
    button('Insert prepared card').click()
    page.wait_for_function('window.__messages.some(m=>m.type==="sd-insert")')
    assert page.evaluate('window.__messages.filter(m=>m.type==="sd-insert").at(-1).writeProtected')
    assert page.evaluate('window.__messages.filter(m=>m.type==="sd-insert").at(-1).name')=='source.any-suffix.img'
    # Hash via WebCrypto is unavailable on about:blank; compare the complete
    # byte sequence in chunks, without serializing sixteen million integers.
    for offset in range(0,len(complete),1024*1024):
        segment=page.evaluate('(o)=>{const b=window.__messages.filter(m=>m.type==="sd-insert").at(-1).bytes;let s="";for(let i=o;i<Math.min(b.length,o+1048576);i+=8192)s+=String.fromCharCode(...b.subarray(i,Math.min(i+8192,b.length)));return btoa(s)}',offset)
        assert base64.b64decode(segment)==complete[offset:offset+1024*1024]
    assert button('Insert prepared card').is_disabled()
    page.evaluate('()=>{const c=window.__controller;c.receive({type:"sd-error",generation:c.generation,message:"Fixture storage allocation failure"})}')
    page.wait_for_function('window.__controller.state.dialog?.message==="sdError"')
    assert page.get_by_test_id('sd-file-editor').count()==1
    assert button('Insert prepared card').is_enabled()
    page.evaluate('window.__controller.answer(true)')
    assert save_card('browser-after-insert-failure.img')==complete
    button('Insert prepared card').click()
    page.wait_for_function('window.__messages.filter(m=>m.type==="sd-insert").length===2')
    assert page.evaluate('window.__messages.filter(m=>m.type==="sd-insert").at(-1).writeProtected')
    passed('failed File read and Worker rejection retain exact draft and support retry')
    page.evaluate('window.__ackInsert()')
    button('Export card image').wait_for()
    assert page.get_by_test_id('sd-file-editor').count()==0 and button('Prepare card files').count()==0
    passed('production insertion sends exact image/read-only state; mounted card has no host file editor')

    # A pending browser read must not populate a successor editor after closure.
    page.evaluate('window.__controller.patch({sd:null,busy:false})')
    button('Prepare card files').click()
    page.evaluate("""()=>{File.prototype.arrayBuffer=function(){return this.name==='WAIT.DAT'?new Promise(resolve=>window.__resolveRead=()=>resolve(new Uint8Array([1,2]).buffer)):window.__arrayBuffer.call(this)}}""")
    page.locator('#sd-draft-files').set_input_files({'name':'WAIT.DAT','mimeType':'application/octet-stream','buffer':b'xx'})
    page.wait_for_function('typeof window.__resolveRead==="function"')
    button('Close').click();page.get_by_role('dialog').wait_for(state='hidden')
    button('Open SD dialog').click();button('Prepare card files').click()
    page.evaluate('()=>{window.__resolveRead();File.prototype.arrayBuffer=window.__arrayBuffer;}')
    page.wait_for_timeout(100)
    assert page.get_by_label('Card name for WAIT.DAT',exact=True).count()==0
    assert page.get_by_test_id('sd-file-editor').get_by_text('This folder is empty.',exact=True).count()==1
    assert not errors,errors
    passed('closing during pending file read cannot mutate a new draft; no uncaught page errors')
    report={'checks':checks,'browser':browser.version,'card_sha256':sha(complete),'file_sha256':sha(payload),'errors':errors}
    (OUT/'browser-result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    browser.close()
