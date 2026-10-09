# SPDX-License-Identifier: MIT
"""Offline React/Mantine interaction test. Not real HTTP/ROM/Worker E2E."""
from pathlib import Path
import base64,json,subprocess,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
subprocess.run(['node','--input-type=module','-e', '''import {build} from 'esbuild'; await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/ui-fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1360,'height':940});page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<div id="root"></div>')
 page.evaluate('(m)=>window.__manifest=m',json.loads((ROOT/'dist/skins/manifest.json').read_text()))
 page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
 page.add_style_tag(content=(ROOT/'build/ui-fixture.css').read_text());page.add_script_tag(content=(ROOT/'build/ui-fixture.js').read_text())
 page.wait_for_timeout(400);print('UI',page.locator('body').inner_text()[:700],errors,flush=True);page.screenshot(path=str(ROOT/'build/offline-initial.png'));page.get_by_role('button',name='Settings',exact=True).wait_for()
 page.get_by_role('button',name='Settings',exact=True).click()
 page.get_by_role('combobox',name='Language',exact=True).click();page.get_by_role('option',name='简体中文').click()
 page.get_by_role('button',name='Apply',exact=True).click()
 page.get_by_role('button',name='设置',exact=True).wait_for()
 assert page.locator('html').get_attribute('lang')=='zh-CN'
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('tab',name='键盘',exact=True).click()
 page.locator('button[data-skbtn=KeyA]').click()
 assert page.get_by_label('PC 按键',exact=True).input_value()=='KeyA'
 assert page.get_by_role('dialog').inner_text().count('ALPHA')>=1
 page.locator('button[data-skbtn="{Shift}"]').first.click()
 assert page.get_by_label('PC 按键',exact=True).input_value()=='Shift+KeyA'
 page.get_by_role('button',name='添加按键').click()
 page.screenshot(path=str(ROOT/'build/ui-keyboard-zh.png'))
 page.get_by_role('button',name='取消',exact=True).click()
 assert 'Shift+KeyA' not in page.evaluate('window.__controller.state.prefs.mappings[1] || {}')
 # Native legends are independently derived from the pinned skin manifest.
 assert page.locator('.traditional-key[data-scan="28"] .left-legend').inner_text()=='CHARS'
 assert page.locator('.traditional-key[data-scan="28"] .alpha-legend').inner_text()=='A'
 # A synthetic local frame exercises PNG download without presenting it as HP firmware.
 page.evaluate("""()=>{const c=window.__controller;c.receive({type:'snapshot',generation:0,loaded:true,running:false,stopped:false,width:131,height:64,frameStatus:0,pixels:new Uint8Array(131*64).map((_,i)=>i%2?255:0),active:null,annunciators:new Uint8Array(6),annunciatorStatus:0});}""")
 page.get_by_role('button',name='屏幕抓取').click()
 with page.expect_download() as info:page.get_by_role('menuitem',name='4 倍像素').click()
 download=info.value;assert download.suggested_filename.endswith('.png');download.save_as(ROOT/'build/test-capture.png')
 page.wait_for_timeout(250);assert page.locator('.traditional-key[data-scan="28"]').bounding_box()['y'] < 750;page.screenshot(path=str(ROOT/'build/ui-traditional-zh.png'))
 page.get_by_role('button',name='连接',exact=True).click();page.get_by_role('button',name='关闭',exact=True).click()
 for width in [320,390,720,1360]:
  page.set_viewport_size({'width':width,'height':900})
  page.wait_for_timeout(100)
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),width
 assert not errors,errors
 print('Offline components: bilingual Apply/Cancel, PC key + modifier selection, printed legends, PNG download, connections modal, four viewport widths pass. No HTTP/ROM/Worker E2E.')
 b.close()
