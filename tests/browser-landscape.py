# SPDX-License-Identifier: MIT
"""Real Chromium layout/input checks with synthetic LCD data, no ROM or Worker."""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'build/landscape'
OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e', '''import {build} from 'esbuild'; await build({entryPoints:['tests/ui-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/landscape/fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});'''],cwd=ROOT,check=True)
models=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {CALCULATORS} from './web/catalog.js'; console.log(JSON.stringify(CALCULATORS));"],cwd=ROOT))
manifest=json.loads((ROOT/'dist/skins/manifest.json').read_text())
with sync_playwright() as p:
 chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser','google-chrome-stable'] if (path:=shutil.which(name))),None)
 if not chrome:raise RuntimeError('Set CHROMIUM to a real Chrome/Chromium executable')
 browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1360,'height':940});page.set_default_timeout(6000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<div id="root"></div>')
 page.evaluate("window.__fixtureView='immersive';window.__deferManifest=true")
 page.evaluate('(m)=>window.__manifest=m',manifest)
 page.evaluate('(m)=>window.__skins=m',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
 page.add_style_tag(content=(OUT/'fixture.css').read_text());page.add_script_tag(content=(OUT/'fixture.js').read_text())
 def settled():page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
 def view(name,zoom=100):
  page.evaluate('([view,zoom])=>{const c=window.__controller;c.patch({prefs:{...c.state.prefs,view,zoom}})}',[name,zoom])
  page.wait_for_function('(view)=>document.querySelector("#calculator")?.dataset.view===view',arg=name);settled()
 def frame():
  page.evaluate("""()=>{const c=window.__controller,height=c.state.model.id>=5?80:64;
   c.receive({type:'snapshot',generation:c.generation,loaded:true,running:true,stopped:false,width:131,height,frameStatus:0,
   pixels:Uint8Array.from({length:131*height},(_,i)=>Math.floor(i/131)%9===0||i%131%13===0?255:0),
   active:26,annunciators:new Uint8Array([0,255,0,0,0,255]),annunciatorStatus:0});}""");settled()
 def pixels():return page.locator('#lcd').evaluate('(c)=>c.toDataURL()')
 def geometry():
  return page.evaluate("""()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
   const stage=document.querySelector('#skin-stage'),screen=document.querySelector('.skin-screen'),keyboard=document.querySelector('.skin-keyboard'),
    m=document.querySelector('.skin-keyboard .skin-keys').getScreenCTM(),s=document.querySelector('.skin-screen-keys').getScreenCTM();
   return {stage:rect(stage),screen:rect(screen),keyboard:rect(keyboard),glass:rect(document.querySelector('.glass-overlay')),canvas:rect(document.querySelector('#lcd')),
    matrix:[m.a,m.b,m.c,m.d,m.e,m.f],screenMatrix:[s.a,s.b,s.c,s.d,s.e,s.f],keys:[...document.querySelectorAll('.skin-key')].map(e=>({scan:Number(e.dataset.scan),...rect(e)})),
    outerWidth:document.documentElement.scrollWidth,viewport:innerWidth,workspace:rect(document.querySelector('#workspace'))};}""")
 def check_landscape(spec):
  g=geometry();screen,keypad=g['screen'],g['keyboard'];scale=screen['w']/spec['viewBox'][2]
  assert screen['right']<keypad['x'] and abs(screen['w']-keypad['w'])<.05,g
  assert abs(screen['h']-spec['splitY']*scale)<.1,g
  assert abs(keypad['h']-(spec['viewBox'][3]-spec['splitY'])*scale)<.1,g
  a,b,c,d,e,f=g['matrix'];assert abs(a-scale)<.0001 and abs(a-d)<.0001 and b==0 and c==0,g
  assert abs(e-keypad['x'])<.1 and abs(f-(keypad['y']-spec['splitY']*scale))<.1,g
  a,b,c,d,e,f=g['screenMatrix'];assert abs(a-scale)<.0001 and abs(a-d)<.0001 and b==0 and c==0,g
  assert abs(e-screen['x'])<.1 and abs(f-screen['y'])<.1,g
  soft=[k for k in g['keys'] if 35<=k['scan']<=40];regular=[k for k in g['keys'] if not 35<=k['scan']<=40]
  def inside(k,pane):return k['y']>=pane['y']-.1 and k['bottom']<=pane['bottom']+.1 and k['x']>=pane['x']-.1 and k['right']<=pane['right']+.1
  assert len(soft)==6 and len(regular)==45 and len({k['scan'] for k in g['keys']})==51,g
  assert all(inside(k,screen) and k['y']>g['canvas']['bottom'] for k in soft),g
  assert all(inside(k,keypad) for k in regular),g
  assert page.locator('.skin-screen .skin-key').count()==6 and page.locator('.skin-keyboard .skin-key').count()==45
  assert g['canvas']['x']>=screen['x'] and g['canvas']['right']<=screen['right'] and g['canvas']['bottom']<screen['bottom'],g
  assert g['outerWidth']<=g['viewport'],g
  assert page.locator('#lcd').count()==1 and page.locator('.skin-key').count()==51
  assert page.locator('.traditional-keypad').evaluate('(e)=>getComputedStyle(e).display')=='none'
  return g
 # Loading races must honor the latest preference without rebuilding the canvas.
 page.wait_for_function('window.__manifestRequests.length===1');view('immersive-landscape')
 page.evaluate('window.__manifestRequests[0]();window.__deferManifest=false')
 page.wait_for_function('document.querySelectorAll(".skin-key").length===51');settled()
 results=[]
 for model in models:
  page.evaluate('(id)=>{const c=window.__controller;c.patch({loaded:false});c.select(id)}',model['id'])
  page.wait_for_function('(name)=>document.querySelector(".skin-image")?.alt===name&&document.querySelectorAll(".skin-key").length===51',arg=model['name'])
  page.wait_for_function('[...document.querySelectorAll(".skin-image,.skin-keyboard-image")].every(i=>i.complete&&i.naturalWidth>0)')
  frame();slug=page.locator('#skin-stage').get_attribute('data-model');spec=manifest['models'][slug];before=pixels()
  page.evaluate('window.__lcd=document.querySelector("#lcd");window.__key=document.querySelector(".skin-key[data-scan=\\"26\\"]");window.__softKey=document.querySelector(".skin-key[data-scan=\\"40\\"]")')
  for width,height in [(1360,940),(1360,500),(844,390),(390,844)]:
   page.set_viewport_size({'width':width,'height':height});view('immersive-landscape');g=check_landscape(spec)
   assert g['stage']['h']<=g['workspace']['h']+.1 and g['stage']['w']<=g['workspace']['w']+.1,g
   assert pixels()==before
   if (width,height) in [(1360,940),(844,390)]:page.screenshot(path=str(OUT/f'{slug}-{width}x{height}.png'))
  page.set_viewport_size({'width':1360,'height':940});view('immersive-landscape');check_landscape(spec)
  for scan in [35,36,37,38,39,40,26]:
   page.evaluate('window.__messages.length=0');page.locator(f'.skin-key[data-scan="{scan}"]').click()
   assert page.evaluate('window.__messages.filter(m=>m.type==="tap-sequence").map(m=>m.scans)')==[[scan]]
   assert page.locator('#calculator').evaluate('(e)=>document.activeElement===e')
  for scan in [40,26]:
   page.evaluate('window.__messages.length=0');page.locator(f'.skin-key[data-scan="{scan}"]').focus();page.keyboard.press('Enter')
   assert page.evaluate('window.__messages.filter(m=>m.type==="tap-sequence").map(m=>m.scans)')==[[scan]]
  for mode in ['immersive','traditional','immersive-landscape']:
   view(mode);assert pixels()==before
   assert page.evaluate('window.__lcd===document.querySelector("#lcd")&&window.__key===document.querySelector(".skin-key[data-scan=\\"26\\"]")&&window.__softKey===document.querySelector(".skin-key[data-scan=\\"40\\"]")')
   if mode=='immersive':
    g=geometry();a=g['stage']
    assert all(k['x']>=a['x']-.1 and k['right']<=a['right']+.1 and k['y']>=a['y']-.1 and k['bottom']<=a['bottom']+.1 for k in g['keys']),g
    assert abs(g['matrix'][5]-g['screenMatrix'][5])<.1,g
  for zoom in [50,180]:
   view('immersive-landscape',zoom);g=check_landscape(spec);assert pixels()==before
   assert g['stage']['x']>=g['workspace']['x']-.1,g
  page.locator('#workspace').evaluate('(e)=>e.scrollLeft=e.scrollWidth');settled()
  g=geometry();assert g['stage']['right']<=g['workspace']['right']+.1,g
  page.locator('#workspace').evaluate('(e)=>e.scrollLeft=0')
  view('immersive-landscape');results.append({'model':model['name'],'splitY':spec['splitY'],'screenKeys':6,'keyboardKeys':45,'viewports':4})
 # The public selector persists layout and audio preferences through Apply.
 page.get_by_role('button',name='Settings',exact=True).click()
 page.get_by_role('combobox',name='Appearance',exact=True).click();page.get_by_role('option',name='Immersive (landscape)',exact=True).click()
 assert page.get_by_role('slider',name='Volume',exact=True).is_enabled()
 page.get_by_role('switch',name='Firmware buzzer').uncheck()
 # Mantine hides the thumb when disabled; the underlying slider remains inert.
 assert page.locator('[role="slider"][aria-label="Volume"]').get_attribute('aria-disabled')=='true'
 page.get_by_role('tab',name='Transfer',exact=True).click()
 assert not page.get_by_role('switch',name='Use Unlimited during transfers',exact=False).is_checked()
 page.get_by_role('switch',name='Use Unlimited during transfers',exact=False).check()
 page.get_by_role('button',name='Apply',exact=True).click()
 page.get_by_role('dialog',name='Settings',exact=True).wait_for(state='hidden')
 assert page.evaluate('window.__controller.state.prefs.view')=='immersive-landscape'
 assert page.evaluate('window.__controller.state.prefs.sound') is False
 assert page.evaluate('window.__controller.state.prefs.transferUnlimited') is True
 # Transfer preferences share the Settings draft: Cancel must leave the saved
 # value and the Worker's active configuration unchanged.
 page.get_by_role('button',name='Settings',exact=True).click();page.get_by_role('tab',name='Transfer',exact=True).click()
 page.get_by_role('switch',name='Use Unlimited during transfers',exact=False).uncheck()
 page.get_by_role('button',name='Cancel',exact=True).click()
 assert page.evaluate('window.__controller.state.prefs.transferUnlimited') is True
 # Captured gestures unlock audio once per event and remove listeners on unmount.
 page.evaluate('''window.__audioUnlocks=0;window.__gestures=[];window.__controller.unlockAudio=()=>window.__audioUnlocks++;
  window.__observeGesture=e=>window.__gestures.push(e.type);
  window.addEventListener('pointerdown',window.__observeGesture,true);window.addEventListener('keydown',window.__observeGesture,true)''')
 # Shift alone has no calculator binding, so this isolates App's gesture hook
 # from the controller's additional unlock when dispatching calculator taps.
 page.locator('#calculator').click(position={'x':1,'y':1});page.keyboard.press('Shift')
 gestures=page.evaluate('window.__gestures');unlocks=page.evaluate('window.__audioUnlocks')
 assert 'pointerdown' in gestures and 'keydown' in gestures and unlocks==len(gestures),(gestures,unlocks)
 page.evaluate("window.removeEventListener('pointerdown',window.__observeGesture,true);window.removeEventListener('keydown',window.__observeGesture,true)")
 page.evaluate('window.__unmount();window.dispatchEvent(new Event("pointerdown"));window.dispatchEvent(new Event("keydown"))')
 assert page.evaluate('window.__audioUnlocks')==unlocks
 assert not errors,errors
 (OUT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 browser.close()
print(f'Landscape: {len(models)} admitted models, original art/crop geometry, 4 viewports, 50–180% zoom, unique canvas/keys, pointer/focus/keyboard input and audio preference lifecycle pass. Synthetic frames only; no ROM E2E implied.')
