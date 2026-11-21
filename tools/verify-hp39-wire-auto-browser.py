#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Cold Arkalite auto-RECV, reverse files and game return in the production UI.

All calculator input uses visible controls and real keyboard/pointer events.
The Worker observer records messages and forwards existing commands unchanged;
it does not inject protocol replies, keys, checkpoints or guest memory.
Private ROMs, downloaded files and screenshots stay in the requested directory.
"""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sha = lambda data: hashlib.sha256(data).hexdigest()
MODELS = {
    '95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67': 1,
    'a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff': 2,
    '9041a8c187667833b220281bee1311c97cf2a0297d483882684ebd166a85c311': 3,
}
LIBRARY_SHA = '8f49c8b596a9d126f253f1fdb9ae8e4bc6a76d607b0ffd4eac1f0a6c734a060c'
APLET_SHA = '1f4cda18268ba3be4e60fd4044770a38696c26b85f26aed911580243e1c82312'
ARITHMETIC_SHA = '59a6894b2f4bd4cad5e07a5310e3cbb5a46ccaf521c4b25b3dbe08012ee13015'
OBSERVE = r'''(() => {
 const Native=window.Worker;
 const p=window.__autoWire={snapshot:null,snapshots:0,input:0,events:[],commands:[],errors:[],pixels:null};
 window.Worker=class extends Native {
  constructor(...args){super(...args);this.addEventListener('message',({data:d})=>{
   if(d.type==='snapshot'){
    p.snapshot={model:d.model,loaded:d.loaded,running:d.running,stopped:d.stopped,
     width:d.width,height:d.height,tick:d.tick,pending:d.pending,active:d.active,activeKeys:d.activeKeys};
    p.snapshots++;if(d.pending||d.active!==null)p.input++;
    if(d.pixels)p.pixels=Array.from(d.pixels);
   }else if(d.type==='file-transfer-received'){
    p.events.push({type:d.type,request:d.request,name:d.name,bytes:d.bytes.length});
   }else if(d.type.startsWith('file-transfer-')||d.type==='usb-status'){
    if(p.events.length<4096)p.events.push(d);
   }else if(d.type==='error'||d.type==='fatal')p.errors.push(d.message);
  });}
  postMessage(d,...args){
   if(['key-down','key-up','tap-sequence','release'].includes(d.type))
    p.commands.push({...d,observed_tick:p.snapshot?.tick});
   return super.postMessage(d,...args);
  }
 };
})();'''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--aplet', type=Path, required=True)
    parser.add_argument('--dist', type=Path, default=ROOT/'dist')
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rom, library, aplet = (path.read_bytes() for path in (args.rom,args.library,args.aplet))
    digest = sha(rom)
    if digest not in MODELS:
        parser.error('Use an exact admitted HP39g+, HP39gs or labelled HP40gs hardware-mod ROM')
    assert sha(library)==LIBRARY_SHA and sha(aplet)==APLET_SHA, 'Use the unchanged published Arkalite library and aplet'
    model = MODELS[digest]
    dist = args.dist.resolve()
    def assets():
        return {p.relative_to(dist).as_posix():sha(p.read_bytes()) for p in sorted(dist.rglob('*')) if p.is_file()}
    initial_assets=assets()
    assert initial_assets['orchard.wasm']==args.expected_wasm
    args.output.mkdir(parents=True, exist_ok=False)
    report={'schema':'orchard-hp39-auto-wire-browser-v1','passed':False,'model':model,
      'rom_sha256':digest,'experimental_hardware_mod':model==3,'original_stock_image':model!=3,
      'cold_boot':True,'production_worker':True,'guest_memory_patched':False,
      'synthetic_worker_messages':False,'hardware_validated':False,'performance_sample':False,
      'source_url':'https://www.hpcalc.org/hp39/games/arkalite40.zip',
      'library_sha256':sha(library),'aplet_sha256':sha(aplet),'assets':initial_assets,
      'physical_keys':[],'frames':[],'tool_sha256':sha(Path(__file__).read_bytes())}
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(dist)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base=f'http://127.0.0.1:{server.server_port}/'
    page=None;errors=[];received_assets={};report['browser_assets']=received_assets
    def stage(name):
        report['stage']=name;print('STAGE',name,flush=True)
    def observation():
        return page.evaluate('()=>{const {pixels,...rest}=window.__autoWire;return rest}')
    def wait(expression,arg=None):
        failure='window.__autoWire.errors.length||window.__autoWire.snapshot?.stopped||window.__autoWire.events.some(e=>e.type==="file-transfer-status"&&e.phase==="error")'
        page.wait_for_function(f'arg=>({expression})||({failure})',arg=arg,timeout=300000)
        assert page.evaluate(f'arg=>({expression})',arg) and not page.evaluate(f'Boolean({failure})'),observation()
    def settle(amount):
        tick=page.evaluate('window.__autoWire.snapshot.tick')
        wait('window.__autoWire.snapshot.tick>=arg',tick+amount)
    def key(scan):
        before=page.evaluate('window.__autoWire.input');start=page.evaluate('window.__autoWire.snapshot.tick')
        page.locator(f'.skin-key[data-scan="{scan}"]').click()
        wait('window.__autoWire.input>arg&&window.__autoWire.snapshot.pending===0&&window.__autoWire.snapshot.active===null',before)
        settle(2000000)
        report['physical_keys'].append({'scan':scan,'before_tick':start,'after_tick':page.evaluate('window.__autoWire.snapshot.tick')})
    def capture(name):
        page.screenshot(path=str(args.output/(name+'.png')))
        pixels=bytes(page.evaluate('window.__autoWire.pixels'))
        frame={'name':name,'sha256':sha(pixels),'arithmetic_area_sha256':sha(pixels[16*131:56*131]),
               'tick':page.evaluate('window.__autoWire.snapshot.tick')}
        report['frames'].append(frame);return frame
    def finished(request):
        if request.url.startswith(base):
            name=request.url[len(base):] or 'index.html'
            if name in initial_assets:
                response=request.response()
                if response.status==200:received_assets[name]=sha(response.body())
    try:
        with sync_playwright() as playwright:
            executable=os.environ.get('CHROMIUM') or shutil.which('chromium') or shutil.which('google-chrome')
            assert executable,'Set CHROMIUM to an installed Chromium browser'
            browser=playwright.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            report['browser_version']=browser.version
            try:
                page=browser.new_page(viewport={'width':1360,'height':1000},locale='en-US')
                page.set_default_timeout(30000);page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('requestfinished',finished);page.add_init_script(OBSERVE);page.goto(base)
                stage('cold-open-rom')
                page.get_by_role('button',name='Settings',exact=True).click()
                page.get_by_role('combobox',name='Speed',exact=True).click()
                page.get_by_role('option',name='Unlimited',exact=True).click()
                page.get_by_role('switch',name='Pause when focus is lost',exact=True).uncheck()
                page.get_by_role('tab',name='Storage',exact=True).click()
                page.get_by_role('switch',name='Save automatically on this device',exact=True).uncheck()
                page.get_by_role('button',name='Apply',exact=True).click()
                page.locator('#rom').set_input_files(str(args.rom.resolve()))
                wait('window.__autoWire.snapshot?.loaded===true')
                assert page.evaluate('window.__autoWire.snapshot.model')==model
                settle(60000000);key(40);settle(70000000)
                key(49);settle(20000000);capture('catalog-before')
                key(39);settle(3000000)
                if model!=3:key(44)
                capture('first-usb-menu')

                stage('arm-first-recv-and-auto-batch')
                page.get_by_role('button',name='Connections',exact=True).click()
                page.get_by_role('button',name='Connect USB',exact=True).click()
                wait('window.__autoWire.events.some(e=>e.type==="usb-status"&&e.phase==="Connected")')
                page.get_by_role('combobox',name='Calculator transfer menu',exact=True).select_option('wire')
                page.get_by_role('switch',name='Continue aplet and library reception automatically',exact=False).check()
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button',name='Choose file',exact=True).click()
                assert picker.value.is_multiple()
                # Deliberately select aplet first: production preflight orders its dependency first.
                picker.value.set_files([str(args.aplet.resolve()),str(args.library.resolve())])
                key(6)  # First RECV is manual, before starting the automatic batch.
                command_start=page.evaluate('window.__autoWire.commands.length')
                event_start=page.evaluate('window.__autoWire.events.length')
                page.get_by_role('button',name='Upload through Wire',exact=True).click()
                wait('window.__autoWire.events.slice(arg).filter(e=>e.type==="file-transfer-status"&&!e.active&&e.phase==="complete").length===2',event_start)
                commands=page.evaluate('n=>window.__autoWire.commands.slice(n)',command_start)
                automatic=[c['scans'] for c in commands if c['type']=='tap-sequence']
                assert automatic==([[39],[6]] if model==3 else [[39],[44],[6]]),commands
                assert not any(c['type'] in ('key-down','key-up') for c in commands),commands
                report['automatic_commands']=commands;report['automatic_scans']=automatic
                terminal=page.evaluate('n=>window.__autoWire.events.slice(n).filter(e=>e.type==="file-transfer-status"&&!e.active)',event_start)
                assert [e['phase'] for e in terminal]==['complete','complete'],terminal
                assert [e['name'] for e in terminal]==[args.library.name,args.aplet.name],terminal
                report['upload_terminal_events']=terminal
                page.get_by_test_id('upload-batch').get_by_text('2 / 2 files uploaded',exact=True).wait_for()
                settle(120000000);capture('auto-installed')

                stage('reverse-disk-downloads')
                page.get_by_role('combobox',name='Calculator transfer menu',exact=True).select_option('disk')
                page.get_by_role('button',name='Receive from calculator',exact=True).click()
                key(38);settle(3000000)
                for _ in range(3 if model==2 else 2):key(44)
                capture('send-disk-menu');key(6);settle(3000000);key(6)
                wait('window.__autoWire.events.filter(e=>e.type==="file-transfer-received").length===3')
                settle(12000000)
                page.get_by_role('button',name='Stop file server',exact=True).click()
                wait('window.__autoWire.events.some(e=>e.type==="file-transfer-cancelled")')
                assert page.get_by_role('button',name='Download',exact=True).count()==3
                report['downloads']=[];returned={}
                for index in range(3):
                    with page.expect_download() as pending:
                        page.get_by_role('button',name='Download',exact=True).nth(index).click()
                    path=args.output/f'returned-{index}.hp';pending.value.save_as(path);data=path.read_bytes()
                    kind=chr(data[7]);assert kind not in returned;returned[kind]=data
                    report['downloads'].append({'name':pending.value.suggested_filename,'kind':kind,'bytes':len(data),'sha256':sha(data)})
                assert set(returned)=={'A','B','H'} and returned['B']==aplet
                payload=lambda data:data[9+data[8]:]
                assert returned['H'][:8]==b'HP39BinH' and payload(returned['H'])==payload(library)
                report['aplet_bytes_equal']=True;report['library_body_equal']=True
                page.get_by_role('button',name='Disconnect USB',exact=True).click()
                page.get_by_role('button',name='Close sidebar',exact=True).click()

                stage('arkalite-play-return-and-arithmetic')
                key(40);settle(20000000);capture('title');key(6);settle(24000000)
                game=capture('game')
                for name,scan in [('ArrowLeft',43),('ArrowRight',45)]:
                    page.locator('#calculator').focus();page.keyboard.down(name)
                    wait('window.__autoWire.snapshot.activeKeys.includes(arg)',scan)
                    settle(12000000);page.keyboard.up(name)
                    wait('window.__autoWire.snapshot.activeKeys.length===0')
                    settle(1200000)
                played=capture('played');assert played['sha256']!=game['sha256']
                key(0);settle(60000000);capture('returned');key(48);settle(12000000)
                for scan in (26,5,26,6):key(scan)
                settle(30000000);arithmetic=capture('one-plus-one')
                assert arithmetic['arithmetic_area_sha256']==ARITHMETIC_SHA,arithmetic
                expected='6e23de5c0516c316f6ac4b71a08e55dcdfcc118b3736546301c7d6555d9eed8a' if model==3 else '82cb43f44987c6388c3d41cb8f2944e60e9da50a6ddb47c8ff185e7e63c791d0'
                assert arithmetic['sha256']==expected,arithmetic
                report['arithmetic_result_verified']=True
                report['worker_observation']=observation();report['page_errors']=errors
                assert not errors and not report['worker_observation']['errors']
                assert assets()==initial_assets,'Production assets changed'
                for name in ('index.html','calculator.js','worker.js','orchard.wasm','hp48.js','hardware-mod.js','file-transfer.js'):
                    assert received_assets.get(name)==initial_assets[name],name
                for name,value in received_assets.items():assert value==initial_assets[name],name
                report['browser_assets']=received_assets
                assert sha(args.rom.read_bytes())==digest and sha(args.library.read_bytes())==LIBRARY_SHA and sha(args.aplet.read_bytes())==APLET_SHA
                report['inputs_unchanged']=True;report['passed']=True;stage('complete')
            except Exception as error:
                report['error']=str(error)
                if page:
                    try:
                        report['worker_observation']=observation();page.screenshot(path=str(args.output/'failure.png'))
                    except Exception as secondary:report['observation_error']=str(secondary)
                raise
            finally:
                browser.close()
    finally:
        server.shutdown();server.server_close()
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({k:report.get(k) for k in ('passed','model','stage','error')}),flush=True)


if __name__=='__main__':
    main()
