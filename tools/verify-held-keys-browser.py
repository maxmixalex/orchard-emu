#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original game hold/release and stock return through the production UI.

Requires an unchanged admitted HP39 ROM and a game checkpoint produced by
verify-hp39-programs.mjs from original stock-installed Arkalite or Tetris+.
The observer reads messages only; all input uses real browser keys/pointers.
Private checkpoints, ROMs and screenshots remain in the supplied output folder.
"""
import argparse,functools,hashlib,json,os,shutil,struct,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
sha=lambda data:hashlib.sha256(data).hexdigest()
MODELS={'95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67':(1,'hp39-home'),
        'a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff':(2,'hp39gs-home')}
ARITHMETIC_SHA='59a6894b2f4bd4cad5e07a5310e3cbb5a46ccaf521c4b25b3dbe08012ee13015'
OBSERVE=r"""(()=>{const Native=Worker;window.__hold={snapshot:null,inputSerial:0,commands:[],errors:[],restored:0,keyFrames:[]};
window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data:d})=>{
 const p=window.__hold;if(d.type==='snapshot'){p.snapshot={loaded:d.loaded,model:d.model,running:d.running,stopped:d.stopped,activeKeys:d.activeKeys,pending:d.pending,ticks:d.tick??d.state[22]+d.state[23]*4294967296};
 if(d.pending||d.active!==null)p.inputSerial++;
 if(JSON.stringify(d.activeKeys)!==JSON.stringify(p.keyFrames.at(-1)?.keys))p.keyFrames.push({restore:p.restored,tick:p.snapshot.ticks,keys:d.activeKeys,pending:d.pending});
 if(d.pixels)p.pixels=Array.from(d.pixels);}
 else if(d.type==='checkpoint-restored')p.restored++;else if(d.type==='error'||d.type==='fatal')p.errors.push(d.message);});}
 postMessage(d,...args){if(['key-down','key-up','tap-sequence','release','pause','run'].includes(d.type))window.__hold.commands.push({...d});return super.postMessage(d,...args);}};})();"""

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*_args):pass

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom',required=True,type=Path);parser.add_argument('--game-checkpoint',required=True,type=Path)
    parser.add_argument('--scenario',choices=['arkalite','tetris'],default='arkalite')
    parser.add_argument('--exit-hold-ticks',type=int,default=0,help='Explicitly hold DEL/ON for this many observed guest ticks; zero retains an ordinary short click')
    parser.add_argument('--expected-wasm',required=True);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();rom=args.rom.read_bytes();digest=sha(rom)
    if not 0<=args.exit_hold_ticks<=120000000:parser.error('--exit-hold-ticks must be 0–120000000')
    if digest not in MODELS:parser.error('Use an unchanged admitted HP39g+ or HP39gs ROM')
    model,preset=MODELS[digest];state=args.game_checkpoint.read_bytes();assert state[:8]==b'ORCHST01'
    if args.scenario=='tetris' and model!=1:parser.error('The original Tetris+ program supports HP39g+ only')
    assets={name:sha((ROOT/'dist'/name).read_bytes()) for name in ['orchard.wasm','calculator.js','worker.js','hp48.js','key-input.js']}
    assert assets['orchard.wasm']==args.expected_wasm
    args.output.mkdir();meta=json.dumps({'schema':1,'model':model,'romHash':digest,'preset':preset,'frameView':1,'stateHash':sha(state)},separators=(',',':')).encode()
    session=args.output/'game.ord';session.write_bytes(b'ORCHARD1'+struct.pack('<I',len(meta))+meta+state)
    report={'schema':'orchard-held-game-browser-v1','passed':False,'model':model,'scenario':args.scenario,'rom_sha256':digest,'checkpoint_sha256':sha(state),'assets':assets,
            'production_worker':True,'guest_memory_patched':False,'performance_sample':False,'holds':[],
            'exit_input':{'mode':'hold' if args.exit_hold_ticks else 'short-click','requested_hold_ticks':args.exit_hold_ticks},'physical_inputs':[]}
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT/'dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start();page=None;errors=[]
    def snapshot():return page.evaluate('window.__hold.snapshot')
    def ticks(n):
        page.wait_for_function('n=>window.__hold.snapshot?.stopped||window.__hold.snapshot?.ticks>=n',arg=n,timeout=300000)
        assert not snapshot()['stopped'],snapshot()
    def settle(n=2000000):ticks(snapshot()['ticks']+n)
    def idle():page.wait_for_function('()=>window.__hold.snapshot?.pending===0&&window.__hold.snapshot?.activeKeys.length===0',timeout=300000)
    def physical(scan,hold=0):
        before=page.evaluate('window.__hold.inputSerial');floor=page.evaluate('window.__hold.commands.length');frame_floor=page.evaluate('window.__hold.keyFrames.length')
        pressed_at=snapshot()['ticks'];target=page.locator(f'#calculator .traditional-key[data-scan="{scan}"]');held_ticks=None
        if hold:
            target.scroll_into_view_if_needed();box=target.bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
            page.wait_for_function('scan=>window.__hold.snapshot.activeKeys.includes(scan)',arg=scan,timeout=300000)
            started=snapshot()['ticks'];ticks(started+hold);held_ticks=snapshot()['ticks']-started;page.mouse.up()
        else:target.click()
        page.wait_for_function('n=>window.__hold.inputSerial>n',arg=before,timeout=300000);idle();settle()
        commands=page.evaluate('n=>window.__hold.commands.slice(n)',floor)
        assert [(m['type'],m.get('scan')) for m in commands]==[('key-down',scan),('key-up',None)],commands
        assert commands[-1]['cancel'] is False,commands
        report['physical_inputs'].append({'scan':scan,'mode':'hold' if hold else 'short-click','held_ticks':held_ticks,
          'before_tick':pressed_at,'after_tick':snapshot()['ticks'],'commands':commands,'observed_contacts':page.evaluate('n=>window.__hold.keyFrames.slice(n)',frame_floor)})
    def capture(name):
        page.screenshot(path=str(args.output/(name+'.png')));pixels=page.evaluate('window.__hold.pixels')
        result={'sha256':sha(bytes(pixels)),'arithmetic_area_sha256':sha(bytes(pixels[16*131:56*131]))}
        if args.scenario=='arkalite':result['paddle_x']=sum(xs)/len(xs) if (xs:=[x for x,v in enumerate(pixels[58*131:59*131]) if v>=128]) else None
        else:result['piece_x']=sum(xs)/len(xs) if (xs:=[i%131 for i,v in enumerate(pixels[:60*131]) if 4<=i%131<48 and v>=128]) else None
        return result
    try:
        with sync_playwright() as p:
            chrome=os.environ.get('CHROMIUM') or shutil.which('chromium') or shutil.which('google-chrome')
            if not chrome:raise RuntimeError('Set CHROMIUM to an installed Chromium')
            browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox']);report['browser']=browser.version
            page=browser.new_page(viewport={'width':1360,'height':940},locale='en-US',has_touch=True);page.set_default_timeout(30000)
            page.on('pageerror',lambda e:errors.append(str(e)));page.add_init_script(OBSERVE)
            page.goto(f'http://127.0.0.1:{server.server_port}/');page.get_by_role('button',name='Open ROM',exact=True).wait_for()
            page.locator('#rom').set_input_files(str(args.rom.resolve()));page.wait_for_function('window.__hold.snapshot?.loaded===true')
            assert snapshot()['model']==model
            page.get_by_role('button',name='Settings',exact=True).click()
            page.get_by_role('combobox',name='Appearance',exact=True).click();page.get_by_role('option',name='Traditional (landscape)',exact=True).click()
            page.get_by_role('switch',name='Pause when focus is lost',exact=True).uncheck()
            page.get_by_role('button',name='Apply',exact=True).click()
            def restore():
                before=page.evaluate('window.__hold.restored');page.locator('#session-file').set_input_files([])
                page.locator('#session-file').set_input_files(str(session.resolve()))
                page.get_by_role('dialog').get_by_role('button',name='Restore',exact=True).click()
                page.wait_for_function('n=>window.__hold.restored>n&&window.__hold.snapshot.running',arg=before,timeout=300000);settle()
            cases=[('keyboard',43,'left'),('touch',45,'right')]
            if args.scenario=='tetris':cases.extend([('touch',59,'shift'),('touch',58,'alpha')])
            for source,scan,name in cases:
                page.set_viewport_size({'width':1360,'height':940});restore();before=capture(name+'-before');command_start=page.evaluate('window.__hold.commands.length')
                if source=='keyboard':page.locator('#calculator').focus();page.keyboard.down('ArrowLeft')
                else:
                    page.set_viewport_size({'width':844,'height':390});target=page.locator(f'#calculator .traditional-key[data-scan="{scan}"]');target.scroll_into_view_if_needed()
                    box=target.bounding_box();cdp=page.context.new_cdp_session(page)
                    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2,'id':7}]})
                page.wait_for_function('scan=>window.__hold.snapshot.activeKeys.includes(scan)',arg=scan,timeout=300000)
                start=snapshot()['ticks'];ticks(start+12000000);held=snapshot();assert scan in held['activeKeys'],held
                played=capture(name+'-held');assert played['sha256']!=before['sha256']
                if args.scenario=='arkalite':
                    assert before['paddle_x'] is not None and played['paddle_x'] is not None,(before,played)
                    assert played['paddle_x']<before['paddle_x'] if scan==43 else played['paddle_x']>before['paddle_x'],(before,played)
                elif scan in [43,45]:
                    assert before['piece_x'] is not None and played['piece_x'] is not None,(before,played)
                    assert played['piece_x']<before['piece_x'] if scan==43 else played['piece_x']>before['piece_x'],(before,played)
                if source=='keyboard':page.keyboard.up('ArrowLeft')
                else:cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                idle();released=snapshot();commands=page.evaluate('n=>window.__hold.commands.slice(n)',command_start)
                assert [m['type'] for m in commands]==['key-down','key-up'],commands
                report['holds'].append({'source':source,'key':name,'scan':scan,'held_ticks':held['ticks']-start,'released_ticks':released['ticks'],'before':before,'held':played,'commands':commands})
                print('HELD',name,report['holds'][-1],flush=True)
            page.set_viewport_size({'width':1360,'height':940});physical(0 if args.scenario=='arkalite' else 56,args.exit_hold_ticks);settle(60000000)
            report['game_return']=capture('del-return');physical(48);settle(12000000);report['home_return']=capture('home-return')
            for scan in [26,5,26,6]:physical(scan)
            settle(12000000);report['stock_return']=capture('one-plus-one')
            report['final_snapshot']=snapshot();report['errors']=page.evaluate('window.__hold.errors')+errors
            assert report['stock_return']['arithmetic_area_sha256']==ARITHMETIC_SHA,report['stock_return']
            expected='82cb43f44987c6388c3d41cb8f2944e60e9da50a6ddb47c8ff185e7e63c791d0' if args.scenario=='arkalite' else '191b93f122faf489989d0f139ea843c43d6e3309a14b27de4e546720c63c37ba'
            assert report['stock_return']['sha256']==expected,report['stock_return']
            report['stock_return']['matches_original_native_one_plus_one']=True
            assert not report['errors'],report['errors'];report['passed']=True;browser.close()
    except Exception as error:
        report['error']=str(error)
        if page:
            try:report['failure_snapshot']=snapshot();page.screenshot(path=str(args.output/'failure.png'))
            except Exception:pass
        raise
    finally:
        report['tool_sha256']=sha(Path(__file__).read_bytes());(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');server.shutdown()
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
