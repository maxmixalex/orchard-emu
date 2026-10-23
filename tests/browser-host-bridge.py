# SPDX-License-Identifier: MIT
"""Real App/controller local-device panel. Network and OS attachment are not
claimed here; the real HTTP/USB/IP path has a separate generated-guest test.
"""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
subprocess.run(['node','--input-type=module','-e','''import {build} from 'esbuild';await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/host-bridge-ui-fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
with sync_playwright() as p:
    chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser'] if (path:=shutil.which(name))),None)
    if not chrome:raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')
    browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1320,'height':1000});page.set_default_timeout(7000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="root"></div>')
    page.evaluate('(m)=>window.__manifest=m',json.loads((ROOT/'dist/skins/manifest.json').read_text()))
    page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
    page.add_style_tag(content=(ROOT/'build/host-bridge-ui-fixture.css').read_text());page.add_script_tag(content=(ROOT/'build/host-bridge-ui-fixture.js').read_text())
    page.evaluate('()=>window.__controller.patch({ready:true,loaded:true,running:true,busy:false})')
    page.get_by_role('button',name='Connections',exact=True).click()
    page.get_by_role('tab',name='Local device',exact=True).click()
    panel=page.get_by_test_id('host-bridge')
    assert panel.is_visible() and page.get_by_role('dialog').count()==0
    assert page.get_by_role('button',name='Connect local device',exact=True).is_disabled()
    assert page.get_by_label('Local bridge address',exact=True).input_value()=='http://127.0.0.1:8125'
    token='3'*64
    page.get_by_label('Access token',exact=True).fill(token)
    page.get_by_label('Local bridge address',exact=True).fill('http://remote.invalid:8125')
    page.get_by_role('button',name='Connect local device',exact=True).click()
    assert 'Use an address of the form http://127.0.0.1:8125' in panel.inner_text()
    assert not page.evaluate('window.__messages.some(m=>m.type==="host-bridge-start")')
    page.get_by_label('Local bridge address',exact=True).fill('http://127.0.0.1:8125')
    page.get_by_role('button',name='Connect local device',exact=True).click()
    page.wait_for_function('window.__controller.state.hostBridge.active')
    assert page.evaluate('window.__messages.filter(m=>m.type==="host-bridge-start").at(-1).token')==token
    assert page.get_by_label('Access token',exact=True).is_disabled()
    assert page.get_by_label('Local bridge address',exact=True).is_disabled()
    assert page.get_by_role('button',name='Connect USB',exact=True).is_disabled()
    assert page.get_by_role('button',name='Connect Serial',exact=True).is_disabled()
    assert page.get_by_role('button',name='Enter self-test',exact=True).is_disabled()
    # Focus must be able to move to the desktop USB client without pausing it.
    before=page.evaluate('window.__messages.filter(m=>m.type==="pause").length')
    page.evaluate('()=>window.dispatchEvent(new Event("blur"))')
    assert page.evaluate('window.__messages.filter(m=>m.type==="pause").length')==before
    page.evaluate('()=>window.__controller.receive({type:"host-bridge-status",generation:0,active:true,ready:true,attached:true,phase:"attached",usbipPort:3240})')
    assert 'USB/IP client attached' in panel.inner_text()
    assert '127.0.0.1:3240' in panel.inner_text()
    page.get_by_role('tab',name='Files',exact=True).click()
    assert page.get_by_role('button',name='Receive from calculator',exact=True).is_disabled()
    page.get_by_role('tab',name='Local device',exact=True).click()
    page.get_by_role('button',name='Connections',exact=True).click();assert not panel.is_visible()
    assert page.evaluate('window.__controller.state.hostBridge.active')
    page.get_by_role('button',name='Connections',exact=True).click();assert page.get_by_label('Access token',exact=True).input_value()==token
    page.get_by_role('button',name='Disconnect local device',exact=True).click()
    assert page.evaluate('window.__messages.at(-1).type')=='host-bridge-stop'
    assert not page.evaluate('window.__controller.state.hostBridge.active')
    assert not page.get_by_label('Local bridge address',exact=True).is_disabled()
    # All status/error messages switch with the rest of the interface.
    page.get_by_role('button',name='Settings',exact=True).click()
    page.get_by_role('combobox',name='Language',exact=True).click();page.get_by_role('option',name='简体中文',exact=True).click();page.get_by_role('button',name='Apply',exact=True).click()
    page.evaluate('()=>window.__controller.receive({type:"host-bridge-status",generation:0,active:false,phase:"error",errorCode:"hostBridgeNetwork"})')
    assert '无法连接本机桥接' in panel.inner_text() and '本地网络访问权限' in panel.inner_text()
    assert 'hostBridge' not in panel.inner_text()
    assert page.get_by_role('button',name='连接本机设备',exact=True).is_enabled()
    assert not page.evaluate('(token)=>JSON.stringify(window.__controller.state.prefs).includes(token)',token)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(ROOT/'build/host-bridge-r22-mobile.png'),full_page=True)
    assert not errors,errors
    browser.close()
print('Local-device UI: persistent sidebar, explicit authenticated connect/disconnect, link/self-test exclusion, focus continuity, translated retry, token privacy and narrow layout passed')
