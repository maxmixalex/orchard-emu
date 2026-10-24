# SPDX-License-Identifier: MIT
"""The cancelled local-device feature has no application UI entry point.
Historical transport helpers have separate regression tests.
"""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
subprocess.run(['node','--input-type=module','-e','''import {build} from 'esbuild';await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/host-bridge-ui-fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser'] if (path:=shutil.which(name))),None)
    if not chrome:raise RuntimeError('Set CHROMIUM to a real Chrome/Chromium executable')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1320,'height':1000});page.set_default_timeout(7000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="root"></div>')
    page.evaluate('(m)=>window.__manifest=m',json.loads((ROOT/'dist/skins/manifest.json').read_text()))
    page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
    page.add_style_tag(content=(ROOT/'build/host-bridge-ui-fixture.css').read_text());page.add_script_tag(content=(ROOT/'build/host-bridge-ui-fixture.js').read_text())
    page.evaluate('()=>window.__controller.patch({ready:true,loaded:true,running:true,busy:false})')
    page.get_by_role('button',name='Connections',exact=True).click()
    page.get_by_role('tab',name='Files',exact=True).wait_for()
    assert page.get_by_role('dialog').count()==0
    assert page.get_by_role('tab',name='Local device',exact=True).count()==0
    assert page.get_by_test_id('host-bridge').count()==0
    assert page.get_by_label('Access token',exact=True).count()==0
    assert page.get_by_role('button',name='Connect USB',exact=True).is_enabled()
    assert page.get_by_role('button',name='Connect Serial',exact=True).is_enabled()
    page.get_by_role('button',name='Settings',exact=True).click()
    page.get_by_role('combobox',name='Language',exact=True).click();page.get_by_role('option',name='简体中文',exact=True).click();page.get_by_role('button',name='Apply',exact=True).click()
    page.set_viewport_size({'width':390,'height':844})
    assert page.get_by_role('tab',name='本机设备',exact=True).count()==0
    assert page.get_by_test_id('host-bridge').count()==0
    assert not page.evaluate('window.__messages.some(m=>m.type==="host-bridge-start")')
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    browser.close()
print('Retired local-device UI is absent in desktop/mobile and both languages; normal connection controls remain usable.')
