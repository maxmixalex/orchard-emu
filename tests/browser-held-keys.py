# SPDX-License-Identifier: MIT
"""Physical DOM input/lifecycle tests; synthetic snapshots, no guest ROM."""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'build/held-keys';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e','''import {build} from 'esbuild';await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/held-keys/fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
manifest=json.loads((ROOT/'dist/skins/manifest.json').read_text())
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or shutil.which('chromium') or shutil.which('google-chrome')
    if not chrome:raise RuntimeError('Set CHROMIUM to an installed Chromium')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1360,'height':940},has_touch=True)
    page=context.new_page();page.set_default_timeout(6000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="root"></div>')
    page.evaluate('(m)=>{window.__manifest=m;window.__fixtureView="traditional-landscape"}',manifest)
    page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
    page.add_style_tag(content=(OUT/'fixture.css').read_text());page.add_script_tag(content=(OUT/'fixture.js').read_text())
    page.wait_for_function('window.__controller&&document.querySelectorAll("#calculator .traditional-key").length===51')
    def settled():page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    def frame(active=(),**state):
        page.evaluate('''([active,state])=>{const c=window.__controller;c.receive({type:'snapshot',generation:c.generation,loaded:true,running:true,stopped:false,width:131,height:64,frameStatus:0,pixels:new Uint8Array(131*64),active:active[0]??null,activeKeys:active,annunciators:new Uint8Array(6),annunciatorStatus:0,...state})}''',[list(active),state]);settled()
    def messages():return page.evaluate('window.__messages.filter(m=>["key-down","key-up","tap-sequence","release","system-chord"].includes(m.type))')
    def clear():page.evaluate('window.__messages.length=0')
    def key(scan):return page.locator(f'#calculator .traditional-key[data-scan="{scan}"]')
    def point(scan):
        box=key(scan).bounding_box();return {'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
    frame();page.locator('#calculator').focus();clear()
    # The OS repeat event must neither retrigger a contact nor append a macro.
    page.keyboard.down('ArrowLeft');page.keyboard.down('ArrowLeft');page.keyboard.down('ArrowRight')
    assert [(m['type'],m.get('scan')) for m in messages()]==[('key-down',43),('key-down',45)]
    frame([43,45]);assert key(43).get_attribute('aria-pressed')=='true' and key(45).get_attribute('aria-pressed')=='true'
    page.keyboard.up('ArrowLeft');page.keyboard.up('ArrowRight')
    assert [m['source'] for m in messages() if m['type']=='key-up']==['keyboard:ArrowLeft','keyboard:ArrowRight']
    # Existing multi-contact macros remain finite sequences, even if held.
    frame();page.locator('#calculator').focus();clear();page.keyboard.down('a');page.keyboard.down('a');page.keyboard.up('a')
    assert [m['type'] for m in messages()]==['tap-sequence'] and len(messages()[0]['scans'])==2
    # Captured pointer release remains routed to the original key after moving
    # outside it. The compatibility click must not add a second input pulse.
    for view,selector in [('traditional-landscape','.traditional-key'),('immersive','.skin-key')]:
        page.evaluate('(view)=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view}})}',view);settled()
        target=page.locator(f'#calculator {selector}[data-scan="43"]');box=target.bounding_box()
        clear();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
        assert [(m['type'],m.get('scan')) for m in messages()]==[('key-down',43)]
        page.mouse.move(2,2);page.mouse.up()
        assert [m['type'] for m in messages()]==['key-down','key-up'] and messages()[-1]['cancel'] is False
        clear();target.click();assert [m['type'] for m in messages()]==['key-down','key-up']
        # Screen-reader/programmatic activation has no pointerdown and remains
        # a finite tap, as does Enter on an individually focused SVG key.
        clear();target.evaluate('(e)=>e.dispatchEvent(new MouseEvent("click",{bubbles:true,detail:0}))')
        assert [m['type'] for m in messages()]==['tap-sequence']
        clear();target.focus();page.keyboard.press('Enter');assert [m['type'] for m in messages()]==['tap-sequence']
    page.evaluate('()=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view:"traditional-landscape",pauseOnBlur:false}})}');settled()
    # Real Chromium touch dispatch creates independent pointer contacts.
    cdp=page.context.new_cdp_session(page);left={**point(43),'id':11};right={**point(45),'id':12}
    clear();cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[left]})
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[left,right]})
    assert [m['scan'] for m in messages() if m['type']=='key-down']==[43,45]
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[right]})
    assert len([m for m in messages() if m['type']=='key-up'])==1
    cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel','touchPoints':[]})
    ups=[m for m in messages() if m['type']=='key-up'];assert len(ups)==2 and ups[0]['source']!=ups[1]['source'] and ups[-1]['cancel'] is True
    # Browser capture loss is an immediate cancellation, not a minimum-dwell
    # click. Teardown and disabled controls also cancel outstanding pointers.
    for action in ['capture','pause','view']:
        frame();clear();pos=point(43);page.mouse.move(**pos);page.mouse.down()
        if action=='capture':
            page.mouse.move(pos['x']+1,pos['y'])
            key(43).evaluate('(e)=>{for(let id=1;id<20;id++)if(e.hasPointerCapture(id))e.releasePointerCapture(id)}');page.mouse.move(2,2)
        elif action=='pause':frame(running=False)
        else:page.evaluate('()=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view:"immersive"}})}');settled()
        assert any(m['type']=='key-up' and m['cancel'] for m in messages()),(action,messages())
        page.mouse.up();page.evaluate('()=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view:"traditional-landscape"}})}');settled()
    frame();page.locator('#calculator').focus();clear();page.keyboard.down('ArrowLeft');page.evaluate('window.dispatchEvent(new Event("blur"))')
    assert any(m['type']=='release' for m in messages())
    clear();page.keyboard.up('ArrowLeft');assert not messages(),'Late keyup must not release a new contact after a departure'
    page.locator('#calculator').focus();page.keyboard.down('ArrowRight');clear();page.get_by_role('button',name='Settings',exact=True).click()
    assert any(m['type']=='release' for m in messages());clear();page.keyboard.up('ArrowRight');assert not messages()
    page.get_by_role('button',name='Cancel',exact=True).click();settled()
    # Releasing only the Worker leaves the DOM capture alive when execution is
    # allowed in the background. A later pointerdown then targets the OLD key.
    # Chromium headless does not reliably emit blur/hidden on tab activation,
    # so dispatch those lifecycle events explicitly while all pointer events
    # and capture ownership remain real browser behavior.
    other=context.new_page();other.set_content('<button>Another tab</button>')
    departures=[]
    for view,selector in [('traditional-landscape','.traditional-key'),('immersive','.skin-key')]:
        for paired in [False,True]:
            for departure in ['blur','hidden']:
                frame();page.bring_to_front()
                page.evaluate('''([view,paired])=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view,pauseOnBlur:paired,pauseOnHidden:paired},irda:{...c.state.irda,active:paired}})}''',[view,paired]);settled()
                left=page.locator(f'#calculator {selector}[data-scan="43"]');right=page.locator(f'#calculator {selector}[data-scan="45"]')
                box=left.bounding_box();clear();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
                source=messages()[0]['source'];pointer=int(source.split(':')[1]);assert left.evaluate('(e,id)=>e.hasPointerCapture(id)',pointer)
                if departure=='blur':page.evaluate('window.dispatchEvent(new Event("blur"))')
                else:page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"))')
                assert any(m['type']=='release' for m in messages())
                assert any(m['type']=='key-up' and m['source']==source and m['cancel'] for m in messages()),(view,paired,departure,messages())
                assert not left.evaluate('(e,id)=>e.hasPointerCapture(id)',pointer)
                assert not page.evaluate('window.__messages.some(m=>m.type==="pause")'),'Background/paired-tab execution must continue'
                other.bring_to_front();other.mouse.up()
                if departure=='hidden':page.evaluate('delete document.hidden;document.dispatchEvent(new Event("visibilitychange"))')
                page.bring_to_front();clear();right.click()
                assert [(m['type'],m.get('scan')) for m in messages()]==[('key-down',45),('key-up',None)],(view,paired,departure,messages())
                departures.append({'view':view,'irda_paired':paired,'departure':departure,'next_click_scan':45})
    other.close();page.evaluate('()=>{const c=window.__controller;c.patch({irda:{...c.state.irda,active:false}})}');settled()
    frame();page.locator('#calculator').focus();page.keyboard.down('ArrowLeft');clear();page.evaluate('window.__unmount()')
    assert any(m['type']=='release' for m in messages());clear();page.keyboard.up('ArrowLeft');assert not messages()
    assert not errors,errors
    report={'passed':True,'scope':'Production UI and controller in Chromium, synthetic Worker snapshots; actual ROM hold witness is separate','keyboard_repeat_suppressed':True,'finite_macros':True,'pointer_capture_and_cancel':True,'multitouch_independent_owners':True,'pause_blur_modal_view_unmount_release':True,'background_pointer_release':departures,'page_errors':errors}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));browser.close()
