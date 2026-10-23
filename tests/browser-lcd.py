# SPDX-License-Identifier: MIT
"""Offline real-browser LCD burst/PNG/recording test; synthetic pixels only."""
from pathlib import Path
import base64,json,os,shutil,subprocess
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'build/lcd-browser';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--input-type=module','-e',"""import {build} from 'esbuild';
await build({entryPoints:['tests/lcd-browser-fixture.jsx'],bundle:true,format:'iife',target:'es2022',outfile:'build/lcd-browser/fixture.js',define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});"""],cwd=ROOT,check=True)
manifest=json.loads((ROOT/'dist/skins/manifest.json').read_text())
background=[*bytes.fromhex(manifest['models']['hp39gplus']['background'].removeprefix('#')),255]
ink=[31,47,42,255]
with sync_playwright() as p:
 chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser','google-chrome-stable'] if (path:=shutil.which(name))),None)
 if not chrome:raise RuntimeError('Set CHROMIUM to a real Chrome/Chromium executable')
 browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1360,'height':940});page.set_default_timeout(5000)
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.set_content('<div id="root"></div>')
 page.evaluate('(m)=>{window.__manifest=m;window.__fixtureView="immersive"}',manifest)
 page.evaluate('(skins)=>window.__skins=skins',{x.name:base64.b64encode(x.read_bytes()).decode() for x in (ROOT/'dist/skins').glob('*.svg')})
 page.evaluate("""()=>{
  window.__lcdPaints=[];window.__lcdResizes=0;
  const paint=CanvasRenderingContext2D.prototype.putImageData;
  CanvasRenderingContext2D.prototype.putImageData=function(image,...args){
    if(this.canvas.id==='lcd')window.__lcdPaints.push(Array.from(image.data));
    return paint.call(this,image,...args);
  };
  for(const name of ['width','height']){
    const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name);
    Object.defineProperty(HTMLCanvasElement.prototype,name,{...descriptor,set(value){if(this.id==='lcd')window.__lcdResizes++;descriptor.set.call(this,value);}});
  }
 }""")
 page.add_style_tag(content=(OUT/'fixture.css').read_text());page.add_script_tag(content=(OUT/'fixture.js').read_text())
 page.wait_for_function('document.querySelector("#skin-stage")?.dataset.model==="hp39gplus"')
 def settled():page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
 def pixels():
  settled()
  return page.locator('#lcd').evaluate('(canvas)=>Array.from(canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data)')
 def publish(pattern,status=0):
  page.evaluate("""({pattern,status})=>{const c=window.__controller;c.receive({type:'snapshot',generation:c.generation,
   loaded:true,running:true,stopped:false,width:131,height:64,frameStatus:status,
   pixels:status?null:Uint8Array.from({length:131*64},(_,i)=>pattern==='white'?0:pattern==='black'?255:(i%2?255:0)),
   active:null,annunciators:new Uint8Array(6),annunciatorStatus:0});}""",{'pattern':pattern,'status':status})
 publish('alternating');expected=[v for i in range(131*64) for v in (ink if i%2 else background)]
 assert pixels()==expected
 page.evaluate('window.__recordLCD()')
 # 300 queued messages before the next compositor frame produce exactly one
 # canvas paint with the newest pixels. No canvas resize or clear is inserted.
 before=page.evaluate('({paints:window.__lcdPaints.length,resizes:window.__lcdResizes})')
 page.evaluate("""()=>{const c=window.__controller;for(let n=0;n<300;n++){
  const level=n===299?255:n%2?127:0;c.receive({...c.last,pixels:new Uint8Array(131*64).fill(level)});
 }}""")
 assert pixels()==ink*(131*64)
 after=page.evaluate('({paints:window.__lcdPaints.length,resizes:window.__lcdResizes})')
 assert after['paints']==before['paints']+1
 assert after['resizes']==before['resizes']
 # Each legitimate new RAF gets its own frame; white content is never hidden.
 for pattern,color in [('white',background),('black',ink),('white',background),('alternating',None)]:
  publish(pattern);assert pixels()==(color*(131*64) if color else expected)
 # The production recorder's actual pre-encode canvas and a decoded PNG are
 # byte-identical to the display for healthy, unavailable and recovered frames.
 for pattern,status in [('alternating',0),('white',12),('black',0)]:
  publish(pattern,status);live=pixels()
  recorded=page.evaluate("""()=>{const r=window.__recording;r.paint();return Array.from(r.native.getContext('2d').getImageData(0,0,r.width,r.height).data)}""")
  assert recorded==live
  capture=page.evaluate("""async()=>{const blob=await window.__captureLCD(),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
   canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return Array.from(context.getImageData(0,0,canvas.width,canvas.height).data)}""")
  assert capture==live
  assert page.evaluate('window.__controller.last.frameStatus')==status
 result=page.evaluate("""async()=>{const result=await window.__recording.stop();return {bytes:result.blob.size,width:result.width,height:result.height,type:result.type}}""")
 assert result['bytes']>0 and result['width']==131 and result['height']==64
 page.evaluate('window.__unmount()');assert not errors,errors
 report={'passed':True,'scope':'Offline real Chromium, production React/canvas/controller/capture/MediaRecorder; all pixels synthetic','burst_messages':300,'burst_canvas_paints':after['paints']-before['paints'],'burst_canvas_resizes':after['resizes']-before['resizes'],'valid_white_visible':True,'png_and_recorder_preencode_exact':True,'encoded_recording':result,'page_errors':errors}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report));browser.close()
