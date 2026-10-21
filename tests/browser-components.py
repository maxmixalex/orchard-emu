# SPDX-License-Identifier: MIT
"""Offline React/Mantine interaction test. Not real HTTP/ROM/Worker E2E."""
from pathlib import Path
import base64,json,subprocess,os,shutil
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
subprocess.run(['node','--input-type=module','-e', '''import {build} from 'esbuild'; await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/ui-fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
with sync_playwright() as p:
 chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser','google-chrome-stable'] if (path:=shutil.which(name))),None)
 if not chrome:raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')
 b=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1360,'height':940});page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<div id="root"></div>')
 page.evaluate("window.__fixtureView='immersive';window.__deferManifest=true")
 manifest=json.loads((ROOT/'dist/skins/manifest.json').read_text())
 page.evaluate('(m)=>window.__manifest=m',manifest)
 page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
 page.add_style_tag(content=(ROOT/'build/ui-fixture.css').read_text());page.add_script_tag(content=(ROOT/'build/ui-fixture.js').read_text())
 def view(name):
  page.evaluate('(view)=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view}})}',name)
  page.wait_for_function('(view)=>document.querySelector("#calculator")?.dataset.view===view',arg=name)
 def resolve_manifest(index):
  page.wait_for_function('(n)=>window.__manifestRequests.length>n',arg=index)
  page.evaluate('(n)=>window.__manifestRequests[n]()',index)
 def keys_ready(slug):
  page.wait_for_function('(slug)=>document.querySelector("#skin-stage")?.dataset.model===slug&&document.querySelectorAll(".traditional-key").length===51',arg=slug)
 def select_model(model):
  page.evaluate('(id)=>{const c=window.__controller;c.patch({loaded:false});c.select(id)}',model)
 def canvas_pixels():
  page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  return page.locator('#lcd').evaluate('(canvas)=>({width:canvas.width,height:canvas.height,pixels:Array.from(canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data)})')
 # A request made while a skin is loading must follow the latest view.
 page.wait_for_function('window.__manifestRequests.length===1')
 assert page.locator('.traditional-key').count()==0
 view('traditional');view('immersive');resolve_manifest(0)
 page.wait_for_function('document.querySelectorAll(".skin-key").length===51')
 assert page.locator('.traditional-key').count()==0
 # Frame state can arrive before the first traditional keypad is constructed.
 page.evaluate("""()=>{const c=window.__controller;c.receive({type:'snapshot',generation:c.generation,loaded:true,running:true,stopped:false,width:131,height:64,frameStatus:0,pixels:new Uint8Array(131*64),active:26,annunciators:new Uint8Array([0,255,0,0,0,255]),annunciatorStatus:0})}""")
 page.wait_for_function('document.querySelector(".skin-key[data-scan=\\"26\\"]")?.getAttribute("aria-pressed")==="true"')
 view('traditional');keys_ready('hp39gplus')
 assert page.locator('.traditional-key[data-scan="26"]').get_attribute('aria-pressed')=='true'
 assert page.locator('[data-segment="5"]').evaluate('(e)=>e.style.opacity')=='1'
 assert page.locator('.traditional-key[data-scan="26"]').get_attribute('aria-disabled')=='false'
 page.evaluate('window.__keypad=document.querySelector(".traditional-geometry")')
 page.locator('#calculator').focus();page.keyboard.press('1')
 assert page.evaluate('window.__messages.some(m=>m.type==="tap-sequence"&&m.scans.length===1&&m.scans[0]===26)')
 view('immersive')
 assert page.locator('.traditional-key[data-scan="26"]').get_attribute('aria-disabled')=='true'
 view('traditional')
 assert page.evaluate('window.__keypad===document.querySelector(".traditional-geometry")')
 # Dispose a model whose manifest is pending, then resolve it after its successor.
 select_model(4);page.wait_for_function('window.__manifestRequests.length===2')
 assert page.locator('.traditional-key').count()==0
 assert page.evaluate('!window.__keypad.isConnected')
 select_model(1);resolve_manifest(2);keys_ready('hp39gplus')
 page.evaluate('window.__keypad=document.querySelector(".traditional-geometry")')
 resolve_manifest(1)
 page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
 assert page.evaluate('window.__keypad===document.querySelector(".traditional-geometry")')
 assert page.locator('#skin-stage').get_attribute('data-model')=='hp39gplus'
 # A fresh immersive model still avoids construction; switching builds its keys.
 view('immersive');select_model(4);resolve_manifest(3)
 page.wait_for_function('document.querySelector("#skin-stage").dataset.model==="hp48gii"')
 assert page.locator('.traditional-key').count()==0
 view('traditional');keys_ready('hp48gii')
 assert page.locator('.traditional-key[data-scan="41"] .key-shift').text_content()=='FILES'
 select_model(1);resolve_manifest(4);keys_ready('hp39gplus')
 page.wait_for_timeout(400);print('UI',page.locator('body').inner_text()[:700],errors,flush=True);page.screenshot(path=str(ROOT/'build/offline-initial.png'));page.get_by_role('button',name='Settings',exact=True).wait_for()
 page.get_by_role('button',name='Settings',exact=True).click()
 page.get_by_role('combobox',name='Language',exact=True).click();page.get_by_role('option',name='简体中文').click()
 page.get_by_role('button',name='Apply',exact=True).click()
 page.get_by_role('button',name='设置',exact=True).wait_for()
 assert page.locator('html').get_attribute('lang')=='zh-CN'
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('tab',name='键盘',exact=True).click()
 page.locator('button[data-code="KeyA"]').click()
 assert page.get_by_label('PC 按键',exact=True).input_value()=='KeyA'
 assert page.get_by_role('dialog').inner_text().count('ALPHA')>=1
 page.locator('button[data-code="ShiftLeft"]').click()
 assert page.get_by_label('PC 按键',exact=True).input_value()=='Shift+KeyA'
 page.get_by_role('button',name='添加按键').click()
 page.screenshot(path=str(ROOT/'build/ui-keyboard-zh.png'))
 page.get_by_role('button',name='取消',exact=True).click()
 assert 'Shift+KeyA' not in page.evaluate('window.__controller.state.prefs.mappings[1] || {}')
 # Native legends are independently derived from the pinned skin manifest.
 assert page.locator('.traditional-key[data-scan="28"] .key-shift').text_content()=='CHARS'
 assert page.locator('.traditional-key[data-scan="28"] .key-alpha').text_content()=='A'
 # Check the actual canvas against independent endpoint colors and every pixel.
 # This synthetic local frame is also used for PNG download; it is not HP firmware.
 page.evaluate("""()=>{const c=window.__controller;c.receive({type:'snapshot',generation:c.generation,loaded:true,running:false,stopped:false,width:131,height:64,frameStatus:0,pixels:new Uint8Array(131*64).map((_,i)=>i%2?255:0),active:null,annunciators:new Uint8Array(6),annunciatorStatus:0});}""")
 background=[*bytes.fromhex(manifest['models']['hp39gplus']['background'].removeprefix('#')),255]
 ink=[31,47,42,255]
 pixels=canvas_pixels();assert (pixels['width'],pixels['height'])==(131,64)
 assert pixels['pixels']==[v for i in range(131*64) for v in (ink if i%2 else background)]
 page.get_by_role('button',name='屏幕抓取').click()
 with page.expect_download() as info:page.get_by_role('menuitem',name='4 倍像素').click()
 download=info.value;assert download.suggested_filename.endswith('.png');download.save_as(ROOT/'build/test-capture.png')
 page.evaluate('()=>{const c=window.__controller;c.receive({...c.last,pixels:new Uint8Array(131*64).map((_,i)=>i%2?0:255)})}')
 assert canvas_pixels()['pixels']==[v for i in range(131*64) for v in (background if i%2 else ink)]
 page.evaluate('()=>{const c=window.__controller;c.receive({...c.last,pixels:null,frameStatus:1})}')
 assert canvas_pixels()['pixels']==background*(131*64)
 page.wait_for_timeout(250);assert page.locator('.traditional-key[data-scan="28"]').bounding_box()['y'] < 750;page.screenshot(path=str(ROOT/'build/ui-traditional-zh.png'))
 page.get_by_role('button',name='连接',exact=True).click();page.get_by_role('button',name='关闭',exact=True).click()
 # The file UI uses the production controller. Packet/stock validation is a
 # separate Worker test; this fixture only supplies explicit protocol events.
 select_model(4);resolve_manifest(5);keys_ready('hp48gii')
 page.evaluate("""()=>{const c=window.__controller;c.patch({loaded:true,running:false,busy:false,serial:true,usb:true,usbReady:true});}""")
 page.get_by_role('button',name='连接',exact=True).click()
 page.locator('[data-testid="transfer-file"]').set_input_files({'name':'TEST.hp','mimeType':'application/octet-stream','buffer':b'HPHP49-C\x00\xff\r\n'})
 assert page.get_by_label('计算器内文件名',exact=True).input_value()=='TEST.hp'
 page.get_by_role('button',name='上传到计算器',exact=True).click()
 page.wait_for_function('window.__messages.some(m=>m.type==="file-transfer-start")')
 start=page.evaluate('()=>{const m=window.__messages.filter(m=>m.type==="file-transfer-start").at(-1);return {request:m.request,mode:m.mode,bytes:Array.from(m.bytes)}}')
 assert start['mode']=='send' and start['bytes']==list(b'HPHP49-C\x00\xff\r\n')
 assert page.get_by_role('button',name='上传到计算器',exact=True).is_disabled()
 page.get_by_role('tab',name='原始数据',exact=True).click()
 assert page.get_by_role('button',name='发送',exact=True).is_disabled()
 assert page.get_by_role('button',name='接收',exact=True).is_disabled()
 page.get_by_role('tab',name='文件',exact=True).click()
 page.get_by_role('button',name='取消传输',exact=True).click()
 page.evaluate('(request)=>{const c=window.__controller;c.receive({type:"file-transfer-received",generation:c.generation,request,name:"STALE",bytes:new Uint8Array([1])})}',start['request'])
 assert page.get_by_role('button',name='下载',exact=True).count()==0
 page.get_by_role('button',name='接收计算器文件',exact=True).click()
 page.evaluate('()=>{const c=window.__controller,request=c.transferRequest;c.receive({type:"file-transfer-received",generation:c.generation,request,name:"RESULT.hp",bytes:new Uint8Array([0,255,13,10])});c.receive({type:"file-transfer-status",generation:c.generation,request,active:false,phase:"complete"})}')
 page.get_by_role('button',name='下载',exact=True).click()
 page.wait_for_function('window.__downloadName==="RESULT.hp"')
 assert page.evaluate('window.__downloadBytes')==[0,255,13,10]
 page.screenshot(path=str(ROOT/'build/ui-files-zh.png'))
 page.get_by_role('button',name='清空列表',exact=True).click()
 assert page.get_by_role('button',name='下载',exact=True).count()==0
 page.get_by_label('计算器内文件名',exact=True).fill('RESULT')
 page.get_by_role('button',name='按名称取回对象',exact=True).click()
 page.wait_for_function('window.__messages.filter(m=>m.type==="file-transfer-start").at(-1).mode==="get"')
 assert page.evaluate('window.__messages.filter(m=>m.type==="file-transfer-start").at(-1).name')=='RESULT'
 page.get_by_role('button',name='取消传输',exact=True).click()
 page.get_by_role('combobox',name='连接类型',exact=True).click();page.get_by_role('option',name='串口',exact=True).click()
 assert page.get_by_role('button',name='上传到计算器',exact=True).is_enabled()
 assert page.get_by_role('button',name='按名称取回对象',exact=True).is_enabled()
 for name in ['接收计算器文件','读取计算器目录','退出计算器 SERVER']:
  assert page.get_by_role('button',name=name,exact=True).count()==0
 assert '串口支持上传和按名称取回对象' in page.get_by_role('dialog').inner_text()
 assert 'SF(-78)' in page.get_by_role('dialog').inner_text()
 page.locator('[data-testid="transfer-file"]').set_input_files({'name':'SERIAL.hp','mimeType':'application/octet-stream','buffer':b'HPHP49-C\x00\xff\r\n'})
 page.get_by_label('计算器内文件名',exact=True).fill('SERIAL')
 page.get_by_role('button',name='上传到计算器',exact=True).click()
 page.wait_for_function('()=>{const m=window.__messages.filter(m=>m.type==="file-transfer-start").at(-1);return m.mode==="send"&&m.transport==="serial"}')
 assert page.evaluate('Array.from(window.__messages.filter(m=>m.type==="file-transfer-start").at(-1).bytes)')==list(b'HPHP49-C\x00\xff\r\n')
 page.get_by_role('button',name='取消传输',exact=True).click()
 page.get_by_role('button',name='按名称取回对象',exact=True).click()
 page.wait_for_function('()=>{const m=window.__messages.filter(m=>m.type==="file-transfer-start").at(-1);return m.mode==="get"&&m.transport==="serial"&&m.name==="SERIAL"}')
 page.get_by_role('button',name='取消传输',exact=True).click()
 page.get_by_role('combobox',name='连接类型',exact=True).click();page.get_by_role('option',name='USB',exact=True).click()
 for name in ['接收计算器文件','读取计算器目录','退出计算器 SERVER']:
  assert page.get_by_role('button',name=name,exact=True).count()==1
 page.get_by_role('button',name='关闭',exact=True).click()
 for width in [320,390,720,1360]:
  page.set_viewport_size({'width':width,'height':900})
  page.wait_for_timeout(100)
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),width
 # Unmount also invalidates an outstanding load and removes frame/resize work.
 select_model(1);page.wait_for_function('window.__manifestRequests.length===7')
 page.evaluate('window.__unmount()');resolve_manifest(6)
 page.evaluate('window.dispatchEvent(new Event("resize"))')
 assert page.locator('.traditional-geometry').count()==0
 assert page.evaluate('window.__controller.frames.size')==0
 assert not errors,errors
 print('Offline components: lazy keypad load/view/model races, reuse, active key/segments, PC input and unmount; exact full canvas RGBA, changed and blank frames; bilingual Apply/Cancel, PC key + modifier selection, printed legends, PNG download, file upload/cancel/stale receive/download/raw exclusion, four viewport widths pass. No HTTP/ROM/Worker E2E.')
 b.close()
