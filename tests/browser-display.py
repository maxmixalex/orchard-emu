# SPDX-License-Identifier: MIT
"""Real Chromium display/layout/input checks using synthetic LCD pixels."""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'build/display-r23';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e','''import {build} from 'esbuild';await build({entryPoints:['tests/lcd-browser-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/display-r23/fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
manifest=json.loads((ROOT/'dist/skins/manifest.json').read_text())
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser'] if (path:=shutil.which(name))),None)
    if not chrome:raise RuntimeError('Set CHROMIUM to a real Chrome/Chromium executable')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1360,'height':940});page.set_default_timeout(6000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content('<div id="root"></div>')
    page.evaluate('(m)=>{window.__manifest=m;window.__fixtureView="traditional-landscape"}',manifest)
    page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
    page.add_style_tag(content=(OUT/'fixture.css').read_text());page.add_script_tag(content=(OUT/'fixture.js').read_text())
    def settled():page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    def preferences(**values):
        page.evaluate('(v)=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,...v}})}',values);settled()
    def frame():
        page.evaluate('''()=>{const c=window.__controller,height=c.state.model.id>=5?80:64;c.receive({type:'snapshot',generation:c.generation,loaded:true,running:true,stopped:false,width:131,height,frameStatus:0,pixels:Uint8Array.from({length:131*height},(_,i)=>(Math.floor(i/131)+i%131)%2?255:0),active:null,annunciators:new Uint8Array([255,255,255,255,255,255]),annunciatorStatus:0});}''');settled()
    results=[]
    for model,slug in [(1,'hp39gplus'),(2,'hp39gs'),(4,'hp48gii'),(5,'hp49gplus')]:
        page.evaluate('(id)=>{const c=window.__controller;c.patch({loaded:false});c.select(id)}',model)
        page.wait_for_function('(slug)=>document.querySelector("#skin-stage")?.dataset.model===slug&&document.querySelectorAll("#calculator .traditional-key").length===51',arg=slug)
        frame();preferences(view='traditional-landscape',screenScaling='nearest',zoom=100)
        page.evaluate('window.__originalCanvas=document.querySelector("#lcd");window.__originalSoft=document.querySelector(".traditional-key[data-scan=\\"40\\"]");window.__originalKey=document.querySelector(".traditional-key[data-scan=\\"26\\"]")')
        for width,height in [(1360,940),(844,390),(390,844),(360,640)]:
            page.set_viewport_size({'width':width,'height':height});settled()
            geometry=page.evaluate('''()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};const host=document.querySelector('#calculator');return {outer:document.documentElement.scrollWidth,viewport:innerWidth,host:rect(host),workspace:rect(document.querySelector('#workspace')),screen:rect(document.querySelector('.calculator-screen')),keys:rect(document.querySelector('.traditional-keypad')),lcd:rect(document.querySelector('#lcd')),soft:[...document.querySelectorAll('.traditional-softkeys .traditional-key')].map(e=>({scan:+e.dataset.scan,...rect(e)})),main:[...document.querySelectorAll('.traditional-keypad .traditional-key')].map(e=>({scan:+e.dataset.scan,...rect(e)}))}}''')
            assert geometry['outer']<=geometry['viewport'],geometry
            if width<600 and height>width:assert geometry['screen']['bottom']<geometry['keys']['y'],geometry
            else:assert geometry['screen']['right']<geometry['keys']['x'],geometry
            assert geometry['host']['w']<=geometry['workspace']['w']+.1,geometry
            if width>=600 or height<=width:assert geometry['host']['h']<=geometry['workspace']['h']+.1,geometry
            assert len(geometry['soft'])==6 and len(geometry['main'])==45,geometry
            assert all(35<=key['scan']<=40 and key['y']>=geometry['lcd']['bottom'] for key in geometry['soft']),geometry
            assert all(key['x']>=geometry['keys']['x']-.1 and key['right']<=geometry['keys']['right']+.1 for key in geometry['main']),geometry
            assert len({key['scan'] for key in geometry['soft']+geometry['main']})==51
            if width<600 and height>width:
                page.locator('#workspace').evaluate('(e)=>e.scrollTop=e.scrollHeight');settled()
                reached=page.evaluate('''()=>{const r=q=>document.querySelector(q).getBoundingClientRect(),w=r('#workspace'),lcd=r('#lcd'),end=r('.traditional-key[data-scan="6"]');return lcd.y>=w.y&&lcd.bottom<w.bottom&&end.bottom<=w.bottom}''')
                assert reached,'The LCD stays visible while scrolling to the bottom keyboard row'
                page.locator('#workspace').evaluate('(e)=>e.scrollTop=0');settled()
            if model in [2,5]:page.screenshot(path=str(OUT/f'{slug}-traditional-{width}x{height}.png'))
        page.set_viewport_size({'width':1360,'height':940});settled()
        for mode in ['traditional','immersive','immersive-landscape','traditional-landscape']:
            preferences(view=mode)
            assert page.evaluate('window.__originalCanvas===document.querySelector("#lcd")&&window.__originalSoft===document.querySelector(".traditional-key[data-scan=\\"40\\"]")&&window.__originalKey===document.querySelector(".traditional-key[data-scan=\\"26\\"]")')
        for scan in [40,26]:
            page.evaluate('window.__messages.length=0');page.locator(f'.traditional-key[data-scan="{scan}"]').click()
            assert page.evaluate('window.__messages.filter(m=>m.type==="tap-sequence").map(m=>m.scans)')==[[scan]]
        results.append({'model':model,'viewports':4,'soft_keys_with_display':6,'main_keys':45,'node_identity_preserved':True})
    # Actual display pixels change with the selected kernel, while guest/capture
    # pixels remain native and untouched. Non-integer zoom exercises resampling.
    preferences(view='traditional-landscape',zoom=115)
    source=page.evaluate('Array.from(window.__controller.last.pixels)')
    scaled=[];physical_width=None
    for mode in ['nearest','linear','cubic','lanczos']:
        preferences(screenScaling=mode)
        output=page.locator('#lcd').evaluate('''c=>({width:c.width,height:c.height,physicalWidth:c.getBoundingClientRect().width,red:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data].filter((_,i)=>i%4===0),css:getComputedStyle(c).imageRendering})''')
        if physical_width is None:physical_width=output['physicalWidth']
        assert output['physicalWidth']==physical_width,'Algorithm changes must not change the displayed LCD size'
        assert output['width']<=131*6 and output['height']<=80*6
        colors=len(set(output['red']))
        if mode=='nearest':assert output['width']==131 and output['height']==80 and colors==2
        else:assert output['width']>131 and colors>10 and output['css']=='auto',(mode,output['width'],colors)
        assert page.evaluate('Array.from(window.__controller.last.pixels)')==source
        capture=page.evaluate('''async()=>{const bitmap=await createImageBitmap(await window.__captureLCD());const size=[bitmap.width,bitmap.height];bitmap.close();return size}''')
        assert capture==[131,80]
        scaled.append({'method':mode,'width':output['width'],'height':output['height'],'colors':colors})
    # Settings apply/cancel through the real controls, including narrow layouts.
    page.get_by_role('button',name='Settings',exact=True).click()
    page.get_by_role('combobox',name='Appearance',exact=True).click();page.get_by_role('option',name='Traditional (landscape)',exact=True).click()
    page.get_by_role('combobox',name='Screen scaling',exact=True).click();page.get_by_role('option',name='Bicubic',exact=True).click()
    page.get_by_role('combobox',name='LCD response',exact=True).click();page.get_by_role('option',name='Smooth (35 ms)',exact=True).click()
    page.screenshot(path=str(OUT/'settings-desktop.png'))
    page.get_by_role('button',name='Apply',exact=True).click();settled()
    assert page.evaluate('window.__controller.state.prefs.screenScaling')=='cubic'
    assert page.evaluate('window.__controller.state.prefs.lcdResponse')=='smooth'
    page.get_by_role('button',name='Settings',exact=True).click()
    page.get_by_role('combobox',name='Screen scaling',exact=True).click();page.get_by_role('option',name='Nearest neighbor',exact=True).click()
    page.get_by_role('button',name='Cancel',exact=True).click()
    assert page.evaluate('window.__controller.state.prefs.screenScaling')=='cubic'
    # Pause is conspicuous and its direct action resumes through the controller.
    page.evaluate('window.__controller.patch({running:false})');settled()
    page.get_by_role('button',name='Resume simulation',exact=True).wait_for()
    assert page.locator('.traditional-key[data-scan="40"]').get_attribute('aria-disabled')=='true'
    page.screenshot(path=str(OUT/'paused-desktop.png'))
    page.evaluate('window.__messages.length=0');page.get_by_role('button',name='Resume simulation',exact=True).click()
    assert page.evaluate('window.__messages.some(m=>m.type==="run")')
    frame();preferences(zoom=100)
    page.set_viewport_size({'width':390,'height':844});settled()
    page.get_by_role('button',name='Actions',exact=True).click()
    page.get_by_role('menuitem',name='Save',exact=True).wait_for()
    assert page.get_by_role('menuitem',name='Restore',exact=True).is_visible()
    assert page.get_by_role('menuitem',name='Enter self-test',exact=True).is_visible()
    page.keyboard.press('Escape')
    page.get_by_role('button',name='Connections',exact=True).click();settled()
    assert page.get_by_role('tab',name='SD card',exact=True).is_visible()
    assert page.get_by_role('button',name='SD card',exact=True).count()==0
    assert page.get_by_role('tab',name='Local device',exact=True).count()==0
    page.get_by_role('tab',name='Infrared',exact=True).click();settled()
    assert page.get_by_role('button',name='Connect USB',exact=True).count()==0
    page.get_by_role('tab',name='Files',exact=True).click();settled()
    assert page.get_by_role('button',name='Connect USB',exact=True).is_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'connections-mobile.png'))
    page.get_by_role('button',name='Close sidebar',exact=True).click()
    page.get_by_role('button',name='Settings',exact=True).click();settled()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'settings-mobile.png'))
    page.get_by_role('button',name='Cancel',exact=True).click()
    assert not errors,errors
    report={'passed':True,'scope':'Real Chromium with production UI/controller/capture and synthetic LCD pixels; no ROM execution implied','layouts':results,'scaling':scaled,'pause_resume':True,'settings_apply_cancel':True,'mobile_actions_sidebar':True,'page_errors':errors}
    (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));browser.close()
