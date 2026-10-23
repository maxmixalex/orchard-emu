# SPDX-License-Identifier: MIT
"""Keyboard editor with OS-layout events and the real React/controller path.

The layout source is controlled explicitly (AZERTY/QWERTZ/denied), not inferred
from the test host's US keyboard. No ROM, Worker or live network is involved.
"""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
subprocess.run(['node','--input-type=module','-e', '''import {build} from 'esbuild'; await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/keyboard-ui-fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser'] if (path:=shutil.which(name))),None)
    if not chrome:raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1360,'height':940});page.set_default_timeout(7000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="root"></div>')
    page.evaluate('(m)=>window.__manifest=m',json.loads((ROOT/'dist/skins/manifest.json').read_text()))
    page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
    page.evaluate('''()=>{
      window.__layout=Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c=>['Key'+c,c.toLowerCase()]));
      Object.assign(window.__layout,{KeyA:'q',KeyQ:'a',KeyW:'z',KeyZ:'w',KeyM:',',Semicolon:'m',Digit1:'&',Digit8:'_',IntlBackslash:'<'});
      const keyboard=new EventTarget();keyboard.getLayoutMap=async()=>{if(window.__denyLayout)throw new DOMException('Denied','SecurityError');return new Map(Object.entries(window.__layout));};
      Object.defineProperty(navigator,'keyboard',{value:keyboard,configurable:true});
    }''')
    page.add_style_tag(content=(ROOT/'build/keyboard-ui-fixture.css').read_text())
    page.add_script_tag(content=(ROOT/'build/keyboard-ui-fixture.js').read_text())
    def open_keyboard():
        page.get_by_role('button',name='Settings',exact=True).click()
        page.get_by_role('tab',name='Keyboard',exact=True).click()
        page.locator('.mapping-calculator .traditional-key').first.wait_for()
    def pc(code):return page.locator(f'.pc-physical-key[data-code="{code}"]')
    def calc(scan):return page.locator(f'.mapping-calculator .traditional-key[data-scan="{scan}"]')
    def model(name):
        page.get_by_role('combobox',name='Mappings for',exact=True).click()
        page.get_by_role('option',name=name.replace('HP','HP '),exact=True).click()
        page.locator('.mapping-calculator svg').get_attribute('aria-label')
    def capture(code,key,**options):
        page.get_by_label('PC key',exact=True).evaluate('(input,args)=>{input.focus();input.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,cancelable:true,...args}));}',{'code':code,'key':key,**options})
    def seq():
        return page.locator('.mapping-sequence-editor input[role="combobox"]').evaluate_all('(inputs)=>inputs.map(input=>input.value)')
    open_keyboard()
    page.wait_for_function('document.querySelector("[data-code=KeyQ]").textContent==="A"')
    assert pc('KeyQ').get_attribute('data-mapped')=='true'
    assert pc('Digit1').get_attribute('data-mapped')=='false'
    assert pc('Numpad1').get_attribute('data-mapped')=='true'
    assert page.get_by_role('button',name='<',exact=True).count()==1
    pc('KeyQ').click();assert seq()==['ALPHA','VARS']
    assert 'KeyQ' in calc(28).get_attribute('data-bindings')
    assert 'A' in calc(28).locator('.mapping-binding-badge').text_content()
    # A physical calculator click selects a target; explicit actions edit only
    # the draft and preserve the existing multi-step editor.
    initial_messages=page.evaluate('window.__messages.length')
    calc(41).click();page.get_by_role('button',name='Assign selected key',exact=True).click()
    assert seq()==['SYMB'] and 'pc-custom' in pc('KeyQ').get_attribute('class')
    calc(58).click();page.get_by_role('button',name='Add to sequence',exact=True).click()
    assert seq()==['SYMB','ALPHA']
    assert page.evaluate('window.__messages.length')==initial_messages
    # The family members share defaults but never share overrides.
    model('HP39gs');assert seq()==['ALPHA','VARS']
    calc(6).click();page.get_by_role('button',name='Assign selected key',exact=True).click()
    model('HP49g+');assert seq()==['ALPHA','F1']
    calc(56).click();page.get_by_role('button',name='Assign selected key',exact=True).click()
    model('HP48gII');assert seq()==['ALPHA','F1']
    model('HP39g+');assert seq()==['SYMB','ALPHA']
    assert page.evaluate('window.__controller.state.model.id')==1
    # Wide layout fits the complete numpad, with a calculator keyboard beside it.
    fit=page.locator('.pc-keyboard').evaluate('(e)=>({client:e.clientWidth,scroll:e.scrollWidth,box:e.getBoundingClientRect().toJSON()})')
    assert fit['scroll']<=fit['client']
    calc_box=page.locator('.mapping-calculator-panel').bounding_box()
    assert calc_box['x']>fit['box']['x']+fit['box']['width']
    page.screenshot(path=str(ROOT/'build/keyboard-r22-wide.png'))
    page.get_by_role('button',name='Apply',exact=True).click()
    assert page.evaluate('window.__controller.state.prefs.mappings')=={'1':{'KeyQ':[41,58]},'2':{'KeyQ':[6]},'5':{'KeyQ':[56]}}

    # The application key handler uses the OS character even without a custom
    # override. This is not merely a label swap in the editor.
    page.evaluate('()=>window.__controller.patch({loaded:true,running:true,busy:false})')
    page.locator('#calculator').evaluate('(e)=>e.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyA",key:"q",bubbles:true,cancelable:true}))')
    page.wait_for_function('window.__messages.some(m=>m.type==="tap-sequence"&&m.scans.join(",")==="58,17")')

    open_keyboard()
    capture('Digit1','1',shiftKey=True)
    assert page.get_by_label('PC key',exact=True).input_value()=='Shift+Digit1'
    assert seq()==['1'] and pc('Digit1').get_attribute('data-mapped')=='true'
    pc('ShiftLeft').click();calc(6).click()
    page.locator('.mapping-target-bindings button[title="NumpadEnter"]').click()
    assert page.get_by_label('PC key',exact=True).input_value()=='NumpadEnter'
    # Bounded macros can be extended and removed through the existing controls.
    for _ in range(7):page.get_by_role('button',name='Add key',exact=True).click()
    assert len(seq())==8
    assert page.get_by_role('button',name='Add key',exact=True).is_disabled()
    assert page.get_by_role('button',name='Add to sequence',exact=True).is_disabled()
    page.get_by_role('button',name='Remove key 8',exact=True).click();assert len(seq())==7
    # A layout-change event updates labels and drops stale captured characters,
    # while the saved physical-key overrides remain attached to the same code.
    page.evaluate('()=>{Object.assign(window.__layout,{KeyQ:"q",KeyA:"a",KeyY:"z",KeyZ:"y"});navigator.keyboard.dispatchEvent(new Event("layoutchange"));}')
    page.wait_for_function('document.querySelector("[data-code=KeyQ]").textContent==="Q"')
    pc('KeyQ').click();assert seq()==['SYMB','ALPHA']
    assert pc('KeyY').text_content()=='Z'
    # A rejected API produces an honest, usable physical-code fallback. Capturing
    # an actual key supplies its glyph and the default character sequence.
    page.evaluate('()=>{window.__denyLayout=true;navigator.keyboard.dispatchEvent(new Event("layoutchange"));}')
    page.wait_for_function('document.querySelector("[data-layout-status]").dataset.layoutStatus==="unavailable"')
    assert pc('KeyA').text_content()=='KeyA'
    assert 'This browser cannot read the layout.' in page.locator('.mapping-layout-status').inner_text()
    capture('KeyA','a');assert pc('KeyA').text_content()=='A' and seq()==['ALPHA','VARS']
    capture('IntlYen','¥');assert page.get_by_role('button',name='¥',exact=True).count()==1
    calc(6).click();page.get_by_role('button',name='Assign selected key',exact=True).click();assert seq()==['ENTER']
    page.get_by_label('PC key',exact=True).focus();page.keyboard.press('Tab')
    assert not page.get_by_label('PC key',exact=True).evaluate('(e)=>document.activeElement===e')
    page.get_by_role('button',name='Cancel',exact=True).click()
    assert page.evaluate('window.__controller.state.prefs.mappings')=={'1':{'KeyQ':[41,58]},'2':{'KeyQ':[6]},'5':{'KeyQ':[56]}}

    page.set_viewport_size({'width':390,'height':844})
    open_keyboard()
    assert page.locator('.pc-keyboard').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    assert page.get_by_role('dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    mobile_pc=page.locator('.pc-keyboard').bounding_box();mobile_calc=page.locator('.mapping-calculator-panel').bounding_box()
    assert mobile_calc['y']>=mobile_pc['y']+mobile_pc['height']
    page.screenshot(path=str(ROOT/'build/keyboard-r22-mobile.png'),full_page=True)
    assert not errors,errors
    browser.close()
print('Keyboard UI: AZERTY/QWERTZ dispatch, layout refresh/fallback, model-specific apply/cancel, calculator targets and badges, eight-step macros, desktop/mobile fit passed')
