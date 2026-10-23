#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Exercise real HP39g+ Wire error recovery and transfer-only Unlimited.

Cold boots the admitted private ROM in the production browser. Errors are
provoked with the calculator's ON key, never injected into the protocol or
controller. All screenshots, downloaded files and sessions remain in a new
caller-selected private output directory. This is a functional witness, not
a performance benchmark.
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
import time
import zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
ROM_HASH = '95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67'
ASSETS = ('orchard.wasm', 'calculator.js', 'worker.js', 'virtual-usb.js',
          'file-transfer.js', 'kermit.js', 'hp39-files.js', 'hp39-transfer.js',
          'hp39-archive.js', 'hp39-wire.js', 'buzzer-worker.js', 'buzzer-audio.js')
sha = lambda data: hashlib.sha256(data).hexdigest()
OBSERVE = r"""(() => {
  const NativeWorker=window.Worker;
  window.__recovery={events:[],snapshot:null,snapshots:0,errors:[],commands:[],configurations:[]};
  window.Worker=class extends NativeWorker {
    constructor(...args){super(...args);this.addEventListener('message',({data:d})=>{
      const p=window.__recovery,at=performance.now();
      if(d.type==='snapshot'){
        p.snapshot={at,loaded:d.loaded,running:d.running,stopped:d.stopped,model:d.model,
          pending:d.pending,active:d.active,tick:d.tick,effectiveSpeed:d.effectiveSpeed,
          transferBoosted:d.transferBoosted,...(d.diagnosticState?{diagnosticState:Array.from(d.diagnosticState),diagnosticReason:d.diagnosticReason}:{})};++p.snapshots;
      }else if(d.type==='file-transfer-received'){
        p.events.push({type:d.type,name:d.name,size:d.bytes.length,at,tick:p.snapshot?.tick});
      }else if(['file-transfer-status','file-transfer-listing','usb-status'].includes(d.type)){
        if(p.events.length<8192)p.events.push({...d,at,tick:p.snapshot?.tick});
      }else if(d.type==='error'||d.type==='fatal')p.errors.push({at,message:d.message});
    });}
    postMessage(data,...args){
      const p=window.__recovery,at=performance.now();
      if(data?.type==='configure')p.configurations.push({at,speed:data.speed,
        transferUnlimited:data.transferUnlimited,sound:data.sound});
      else if(data?.type?.startsWith('file-transfer-'))p.commands.push({at,type:data.type,
        request:data.request,name:data.name,bytes:data.bytes?.length,protocol:data.protocol,mode:data.mode});
      else if(data?.type==='tap-sequence')p.commands.push({at,type:data.type,scans:data.scans});
      else if(['pause','run','release'].includes(data?.type))p.commands.push({at,type:data.type});
      return super.postMessage(data,...args);
    }
  };
})();"""


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--dist', type=Path, default=ROOT/'dist')
    parser.add_argument('--expected-wasm', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--roundtrip', action='store_true')
    parser.add_argument('--diagnostic-stop', action='store_true', help='Publish the already-read core snapshot only if the CPU stops; no extra core reads or run calls')
    parser.add_argument('--timeout', type=float, default=180)
    args = parser.parse_args()
    assert sha(args.rom.read_bytes()) == ROM_HASH, 'Use the admitted complete HP39g+ D1.55 NOR'
    assets = {name:sha((args.dist/name).read_bytes()) for name in ASSETS}
    assert assets['orchard.wasm'] == args.expected_wasm
    args.output.mkdir(parents=True, exist_ok=False)
    inputs = args.output/'input';inputs.mkdir()
    package = inputs/'ORIGINAL_PACKAGE.data';package.write_bytes(args.archive.read_bytes())
    with zipfile.ZipFile(args.archive) as archive:
        sources = {name:archive.read(next(n for n in archive.namelist()
                   if n.endswith('/calculator/'+name) or n=='calculator/'+name or n==name))
                   for name in ('HPGCC000.000','LIB275L.000')}
    aplet = inputs/'APLET.unlisted-suffix';aplet.write_bytes(sources['HPGCC000.000'])
    report = {'schema':'orchard-hp39-transfer-recovery-v1','passed':False,
              'rom_sha256':ROM_HASH,'archive_sha256':sha(args.archive.read_bytes()),
              'production_assets':assets,'cold_boot':True,'user_speed':1,
              'transfer_unlimited':'off for first interruption, enabled for retry','functional_witness':True,'roundtrip':args.roundtrip,
              'diagnostic_stop':args.diagnostic_stop,'stages':[],'heartbeat':[],'tool_sha256':sha(Path(__file__).read_bytes())}
    started = time.monotonic()
    server = ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(args.dist)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    page = None

    def observe():
        return page.evaluate('window.__recovery')

    def stage(name, **extra):
        entry = {'name':name,'elapsed_seconds':time.monotonic()-started,
                 'snapshot':observe()['snapshot'] if page else None,**extra}
        report['stages'].append(entry);print('STAGE',json.dumps(entry),flush=True)

    def wait(condition, *, arg=None, label='wait'):
        begin=time.monotonic();last_print=begin
        while not page.evaluate('(arg)=>('+condition+')',arg):
            status=observe()
            errors=status['errors']+[e for e in status['events'] if e['type']=='usb-status' and e.get('error')]
            if errors or status['snapshot'] and status['snapshot'].get('stopped'):
                raise RuntimeError(json.dumps({'errors':errors,'snapshot':status['snapshot']}))
            if time.monotonic()-begin>=args.timeout:raise TimeoutError(label)
            if time.monotonic()-last_print>=5:
                entry={'label':label,'elapsed_seconds':time.monotonic()-started,'snapshot':status['snapshot'],
                       'transfer':next((e for e in reversed(status['events']) if e['type']=='file-transfer-status'),None)}
                report['heartbeat'].append(entry);print('PROGRESS',json.dumps(entry),flush=True);last_print=time.monotonic()
            page.wait_for_timeout(50)

    def ticks(delta):
        wait('window.__recovery.snapshot?.tick>=arg',arg=observe()['snapshot']['tick']+delta,label='guest-time')

    def keys(scans):
        for scan in scans:page.locator(f'.skin-key[data-scan="{scan}"]').click()
        count=observe()['snapshots']
        wait('window.__recovery.snapshots>arg&&window.__recovery.snapshot?.pending===0&&'
             'window.__recovery.snapshot?.active===null&&window.__recovery.snapshot?.running',arg=count,label='physical-keys')

    def status(request, phase):
        terminal=('error','complete','cancelled')
        wait('window.__recovery.events.some(e=>e.type==="file-transfer-status"&&e.request===arg[0]&&'
             '(e.phase===arg[1]||!e.active))',arg=[request,phase],label=f'{request}-{phase}')
        found=[e for e in observe()['events'] if e.get('request')==request and e.get('phase')==phase]
        if not found:
            actual=[e for e in observe()['events'] if e.get('request')==request and e.get('phase') in terminal]
            raise AssertionError(f'Expected {phase} for request {request}; received {actual}')
        return found[-1]

    def request():
        return next(e['request'] for e in reversed(observe()['commands']) if e['type']=='file-transfer-start')

    def normal(label):
        wait('window.__recovery.snapshot?.effectiveSpeed===1&&!window.__recovery.snapshot?.transferBoosted',label=label)

    menu_number=0
    def menu(recover=False):
        nonlocal menu_number
        menu_number+=1
        if recover:
            keys((56,));ticks(12000000)
            page.screenshot(path=str(args.output/f'menu-{menu_number}-after-on.png'))
            keys((49,));ticks(12000000)
            page.screenshot(path=str(args.output/f'menu-{menu_number}-after-aplet.png'))
        keys((39,));ticks(3000000)
        page.screenshot(path=str(args.output/f'menu-{menu_number}-before-down.png'))
        keys((44,))
        page.screenshot(path=str(args.output/f'menu-{menu_number}-after-down.png'))

    def interrupt(request_id, label):
        # These are ordinary PC gestures and the usual guest TapQueue timing.
        # The first interruption uses the default Normal speed, then retry
        # enables the optional data-phase Unlimited setting through the UI.
        page.get_by_role('dialog').wait_for(state='hidden')
        page.locator('#calculator').focus()
        page.keyboard.press('Enter')
        status(request_id,'sending')
        page.keyboard.press('Escape')
        error=status(request_id,'error')
        assert error['effectiveSpeed']==1 and not error['transferBoosted'],error
        normal(label+'-restored');stage(label,error=error)
        page.screenshot(path=str(args.output/(label+'-calculator.png')))
        page.get_by_role('button',name='Connections',exact=True).click()
        page.get_by_role('button',name='Retry this file',exact=True).wait_for()
        page.screenshot(path=str(args.output/(label+'.png')))

    try:
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            try:
                report['browser_version']=browser.version
                page=browser.new_page(viewport={'width':1360,'height':1000},locale='en-US')
                page_errors=[];page.on('pageerror',lambda e:page_errors.append(str(e)))
                if args.diagnostic_stop:
                    original=(args.dist/'worker.js').read_text()
                    needle='stopped:s[28]!==0,frameStatus'
                    assert original.count(needle)==1
                    diagnostic=original.replace(needle,'...(s[28]!==0?{diagnosticState:s,diagnosticReason:errors[s[28]]}:{}),'+needle)
                    report['diagnostic_worker_sha256']=sha(diagnostic.encode())
                    page.route('**/worker.js',lambda route:route.fulfill(status=200,content_type='text/javascript',body=diagnostic))
                page.add_init_script(OBSERVE);page.goto(f'http://127.0.0.1:{server.server_port}/')
                stage('open-rom')
                with page.expect_file_chooser() as picker:page.get_by_role('button',name='Open ROM',exact=True).click()
                picker.value.set_files(str(args.rom.resolve()))
                wait('window.__recovery.snapshot?.loaded&&window.__recovery.snapshot?.running',label='rom-load')
                assert observe()['snapshot']['model']==1
                ticks(50000000);keys((40,));ticks(70000000);stage('cold-home')
                keys((49,));ticks(20000000);menu()
                page.screenshot(path=str(args.output/'receive-wire-menu.png'));stage('receive-wire-menu')
                page.get_by_role('button',name='Settings',exact=True).click()
                page.get_by_role('tab',name='Transfer',exact=True).click()
                assert not page.get_by_role('switch',name='Use Unlimited during transfers',exact=False).is_checked()
                page.get_by_role('button',name='Cancel',exact=True).click()
                page.get_by_role('button',name='Connections',exact=True).click()
                page.get_by_role('button',name='Connect USB',exact=True).click()
                wait('window.__recovery.events.some(e=>e.type==="usb-status"&&e.phase==="Connected")',label='usb-enumeration')
                page.get_by_label('Calculator transfer menu',exact=True).select_option('wire')
                assert page.get_by_role('switch',name='Use Unlimited during transfers',exact=False).count()==0
                assert page.get_by_test_id('transfer-file').get_attribute('accept') is None
                with page.expect_file_chooser() as picker:page.get_by_role('button',name='Choose file',exact=True).click()
                picker.value.set_files(str(package.resolve()))
                page.get_by_role('button',name='Upload through Wire',exact=True).click()
                wait('window.__recovery.commands.some(e=>e.type==="file-transfer-start")',label='queue-library')
                library_first=request();status(library_first,'negotiating');normal('initial-wait-normal')
                page.get_by_role('button',name='Close',exact=True).click();stage('library-waiting-normal')
                interrupt(library_first,'library-interrupted')
                page.get_by_role('button',name='Close',exact=True).click()
                page.get_by_role('button',name='Settings',exact=True).click()
                page.get_by_role('tab',name='Transfer',exact=True).click()
                page.get_by_role('switch',name='Use Unlimited during transfers',exact=False).check()
                page.get_by_role('button',name='Apply',exact=True).click()
                page.get_by_role('button',name='Connections',exact=True).click()
                page.get_by_role('button',name='Retry this file',exact=True).click()
                wait('window.__recovery.commands.filter(e=>e.type==="file-transfer-start").length===2',label='retry-library')
                library_retry=request();assert library_retry!=library_first
                status(library_retry,'negotiating');normal('retry-wait-normal')
                page.get_by_role('button',name='Close',exact=True).click();menu(recover=True);keys((6,))
                done=status(library_retry,'complete');assert done['effectiveSpeed']==1 and not done['transferBoosted']
                wait('window.__recovery.commands.filter(e=>e.type==="file-transfer-start").length===3',label='queue-aplet')
                aplet_first=request();status(aplet_first,'negotiating');normal('between-files-normal')
                stage('library-retry-complete');ticks(12000000);menu()
                interrupt(aplet_first,'aplet-interrupted')
                page.get_by_role('button',name='Skip this file',exact=True).click()
                page.get_by_role('button',name='Upload through Wire',exact=True).wait_for(state='visible')
                assert 'Skipped' in page.get_by_test_id('upload-batch').inner_text()
                normal('skip-restored');stage('aplet-skipped')
                with page.expect_file_chooser() as picker:page.get_by_role('button',name='Choose file',exact=True).click()
                picker.value.set_files(str(aplet.resolve()))
                page.get_by_role('button',name='Upload through Wire',exact=True).click()
                wait('window.__recovery.commands.filter(e=>e.type==="file-transfer-start").length===4',label='queue-renamed-aplet')
                aplet_retry=request();status(aplet_retry,'negotiating');normal('new-queue-wait-normal')
                page.get_by_role('button',name='Close',exact=True).click();menu(recover=True);keys((6,))
                done=status(aplet_retry,'complete');assert done['effectiveSpeed']==1 and not done['transferBoosted']
                normal('completion-restored');ticks(24000000)
                page.screenshot(path=str(args.output/'installed-aplet.png'));stage('renamed-aplet-complete')
                # Explicit cancellation while awaiting the next RECV leaves
                # the completed library/aplet installed and clears the queue.
                page.get_by_role('button',name='Connections',exact=True).click()
                with page.expect_file_chooser() as picker:page.get_by_role('button',name='Choose file',exact=True).click()
                picker.value.set_files(str(aplet.resolve()))
                page.get_by_role('button',name='Upload through Wire',exact=True).click()
                wait('window.__recovery.commands.filter(e=>e.type==="file-transfer-start").length===5',label='queue-cancel')
                cancelled=request();status(cancelled,'negotiating')
                page.get_by_role('button',name='Cancel transfer',exact=True).click()
                done=status(cancelled,'cancelled');assert done['effectiveSpeed']==1 and not done['transferBoosted']
                normal('cancel-restored');stage('cancel-restored')
                page.get_by_role('button',name='Close',exact=True).click()
                if args.roundtrip:
                    stage('stock-send');keys((38,));ticks(3000000);keys((44,44,6));ticks(3000000)
                    page.get_by_role('button',name='Connections',exact=True).click()
                    page.get_by_label('Calculator transfer menu',exact=True).select_option('disk')
                    page.get_by_role('button',name='Receive from calculator',exact=True).click()
                    page.get_by_role('button',name='Close',exact=True).click();keys((6,))
                    wait('window.__recovery.events.filter(e=>e.type==="file-transfer-received").length===3',label='stock-send-files')
                    ticks(12000000);page.get_by_role('button',name='Connections',exact=True).click()
                    returned={}
                    for index in range(3):
                        with page.expect_download() as pending:page.get_by_role('button',name='Download',exact=True).nth(index).click()
                        download=pending.value;path=args.output/download.suggested_filename;download.save_as(path)
                        returned[download.suggested_filename]=path.read_bytes()
                    source=sources['LIB275L.000'];library=returned['LIB275L0.000']
                    assert returned['H39ROMUS.000']==sources['HPGCC000.000']
                    assert library[9+library[8]:]==source[9+source[8]:]
                    assert library[9:9+library[8]]==b'LIB275L'
                    report['returned']={name:{'bytes':len(data),'sha256':sha(data)} for name,data in returned.items()}
                    report.update(aplet_file_equal=True,library_body_equal=True,library_alias_preserved=True)
                    page.get_by_role('button',name='Stop file server',exact=True).click();normal('receive-server-cancel-restored')
                    page.get_by_role('button',name='Close',exact=True).click();stage('roundtrip-equal')
                keys((48,));ticks(10000000);keys((26,5,26,6));ticks(30000000)
                page.screenshot(path=str(args.output/'home-arithmetic.png'));stage('home-arithmetic')
                report['observation']=observe();report['page_errors']=page_errors
                assert not page_errors and not report['observation']['errors']
                configs=report['observation']['configurations']
                assert all(e.get('speed',1)==1 for e in configs)
                events=report['observation']['events']
                assert any(e.get('request')==library_first and e.get('phase')=='sending' and e.get('effectiveSpeed')==1 and not e.get('transferBoosted') for e in events)
                for req in (library_retry,aplet_first,aplet_retry):
                    assert any(e.get('request')==req and e.get('phase')=='sending' and e.get('effectiveSpeed')==0 and e.get('transferBoosted') for e in events),req
                starts=[e for e in report['observation']['commands'] if e['type']=='file-transfer-start' and e.get('mode')=='send']
                assert [e['name'] for e in starts]==['LIB275L.000','LIB275L.000','HPGCC000.000','APLET.unlisted-suffix','APLET.unlisted-suffix']
                assert sum(e.get('name')=='LIB275L.000' and e.get('phase')=='complete' for e in events)==1
                assert {name:sha((args.dist/name).read_bytes()) for name in assets}==assets
                report.update(requests={'library_interrupted':library_first,'library_retry':library_retry,
                                        'aplet_interrupted':aplet_first,'renamed_aplet':aplet_retry,'cancelled':cancelled},
                              speed_restored=True,successful_library_not_resent=True,passed=True)
            except Exception as error:
                report['error']=str(error)
                if page:report['observation']=observe();page.screenshot(path=str(args.output/'failure.png'))
                # Preserve a real UI-exported stopped state for independent
                # native diagnosis. Never serialize ROM/RAM into the report.
                if page and observe()['snapshot'] and observe()['snapshot'].get('stopped'):
                    try:
                        if page.get_by_role('button',name='OK',exact=True).count():page.get_by_role('button',name='OK',exact=True).click()
                        if page.get_by_role('button',name='Save',exact=True).is_enabled():
                            with page.expect_download() as pending:page.get_by_role('button',name='Save',exact=True).click()
                            pending.value.save_as(args.output/'failure.ord')
                            report['failure_session_sha256']=sha((args.output/'failure.ord').read_bytes())
                    except Exception as export_error:report['failure_session_error']=str(export_error)
                raise
            finally:
                report['elapsed_seconds']=time.monotonic()-started
                (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()
