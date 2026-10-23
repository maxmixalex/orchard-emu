#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Measure the ordinary HP39g+ ZIP upload without changing browser pacing.

Uses the admitted private full ROM and real production UI, physical keys and
file choosers. The passive Worker observer records wall time, guest ticks and
published progress only. It does not inject guest state or protocol traffic.
Screenshots/session files stay in the caller's new private output directory.
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
          'file-transfer.js', 'kermit.js', 'hp39-files.js', 'hp39-transfer.js', 'hp39-archive.js', 'hp39-wire.js')
sha = lambda data: hashlib.sha256(data).hexdigest()
OBSERVE = r"""(() => {
  const NativeWorker=window.Worker;
  window.__hp39Timing={events:[],snapshot:null,snapshots:0,errors:[],configurations:[]};
  window.Worker=class extends NativeWorker {
    constructor(...args){
      super(...args);
      this.addEventListener('message',({data:d})=>{
        const p=window.__hp39Timing,at=performance.now();
        if(d.type==='snapshot'){
          p.snapshot={at,loaded:d.loaded,running:d.running,stopped:d.stopped,
            model:d.model,width:d.width,height:d.height,pending:d.pending,
            active:d.active,tick:d.tick};++p.snapshots;
        }else if(d.type==='file-transfer-received'){
          p.events.push({type:d.type,name:d.name,size:d.bytes.length,at,tick:p.snapshot?.tick});
        }else if(['file-transfer-status','file-transfer-listing','usb-status'].includes(d.type)){
          if(p.events.length<8192)p.events.push({...d,at,tick:p.snapshot?.tick});
        }else if(d.type==='error'||d.type==='fatal')p.errors.push({at,message:d.message});
      });
    }
    postMessage(data,...args){
      if(data?.type==='configure')window.__hp39Timing.configurations.push({at:performance.now(),speed:data.speed});
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
    parser.add_argument('--protocol', choices=('disk','wire'), default='disk')
    parser.add_argument('--roundtrip', action='store_true', help='Export the installed objects with stock SEND and compare their bytes')
    parser.add_argument('--timeout', type=float, default=600)
    args = parser.parse_args()
    assert sha(args.rom.read_bytes()) == ROM_HASH, 'Use the admitted complete HP39g+ D1.55 NOR'
    assets = {name:sha((args.dist/name).read_bytes()) for name in ASSETS if (args.dist/name).is_file()}
    assert assets['orchard.wasm'] == args.expected_wasm
    args.output.mkdir(parents=True, exist_ok=False)
    report = {'schema':'orchard-hp39-normal-transfer-timing-v1','passed':False,
              'rom_sha256':ROM_HASH,'archive_sha256':sha(args.archive.read_bytes()),
              'production_assets':assets,'normal_speed':True,'cold_boot':True,'protocol':args.protocol,'roundtrip':args.roundtrip,
              'host_timing_sample':True,'isolated_host':False,
              'stages':[],'heartbeat':[],'tool_sha256':sha(Path(__file__).read_bytes())}
    started = time.monotonic()
    server = ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(args.dist)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    page = None

    def observe():
        return page.evaluate('window.__hp39Timing')

    def stage(name):
        entry = {'name':name,'elapsed_seconds':time.monotonic()-started,
                 'snapshot':observe()['snapshot'] if page else None}
        report['stages'].append(entry)
        print('STAGE',json.dumps(entry),flush=True)

    def wait(condition, *, arg=None, label='wait'):
        begin = time.monotonic(); last_print = begin; next_screen = 30
        while True:
            if page.evaluate('(arg)=>('+condition+')',arg):
                return
            status = observe()
            errors = status['errors'] + [e for e in status['events'] if e.get('phase')=='error']
            if errors or status['snapshot'] and status['snapshot'].get('stopped'):
                raise RuntimeError(json.dumps({'errors':errors,'snapshot':status['snapshot']}))
            elapsed = time.monotonic()-begin
            if elapsed >= args.timeout:
                raise TimeoutError(f'{label} did not complete within {args.timeout}s')
            if time.monotonic()-last_print >= 5:
                latest = next((e for e in reversed(status['events']) if e['type']=='file-transfer-status'),None)
                entry = {'label':label,'elapsed_seconds':time.monotonic()-started,
                         'wait_seconds':elapsed,'snapshot':status['snapshot'],'transfer':latest}
                report['heartbeat'].append(entry)
                print('PROGRESS',json.dumps(entry),flush=True);last_print=time.monotonic()
            if label=='object-upload' and elapsed >= next_screen:
                page.screenshot(path=str(args.output/f'upload-{next_screen}s.png'))
                next_screen += 30
            page.wait_for_timeout(100)

    def ticks(delta):
        start = observe()['snapshot']['tick']
        wait('window.__hp39Timing.snapshot?.tick>=arg',arg=start+delta,label='guest-time')

    def keys(scans):
        for scan in scans:
            page.locator(f'.skin-key[data-scan="{scan}"]').click()
        count = observe()['snapshots']
        wait('window.__hp39Timing.snapshots>arg&&window.__hp39Timing.snapshot?.pending===0&&'
             'window.__hp39Timing.snapshot?.active===null&&window.__hp39Timing.snapshot?.running',arg=count,label='physical-keys')

    try:
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            browser = p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            try:
                report['browser_version'] = browser.version
                page = browser.new_page(viewport={'width':1360,'height':1000},locale='en-US')
                page_errors=[];page.on('pageerror',lambda e:page_errors.append(str(e)))
                page.add_init_script(OBSERVE)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                stage('open-rom')
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button',name='Open ROM',exact=True).click()
                picker.value.set_files(str(args.rom.resolve()))
                wait('window.__hp39Timing.snapshot?.loaded&&window.__hp39Timing.snapshot?.running',label='rom-load')
                assert observe()['snapshot']['model']==1
                ticks(50000000);keys((40,));ticks(70000000)
                stage('home-ready')
                keys((49,));ticks(20000000);keys((39,));ticks(3000000);keys((44,) if args.protocol=='wire' else (44,44))
                page.screenshot(path=str(args.output/'receive-menu.png'))
                page.get_by_role('button',name='Connections',exact=True).click()
                page.get_by_role('button',name='Connect USB',exact=True).click()
                wait("window.__hp39Timing.events.some(e=>e.type==='usb-status'&&e.phase==='Connected')",label='usb-enumeration')
                with page.expect_file_chooser() as picker:
                    page.get_by_role('button',name='Choose file',exact=True).click()
                picker.value.set_files(str(args.archive.resolve()))
                if args.protocol=='wire':page.get_by_label('Calculator transfer menu',exact=True).select_option('wire')
                page.get_by_role('button',name='Upload through Wire' if args.protocol=='wire' else 'Host selected files',exact=True).click()
                page.get_by_role('button',name='Close',exact=True).click()
                if args.protocol=='disk':
                    stage('request-directory');keys((6,))
                    wait("window.__hp39Timing.events.some(e=>e.type==='file-transfer-status'&&e.phase==='serving'&&e.name==='HP39DIR.000')",label='directory-upload')
                    ticks(30000000)
                    page.screenshot(path=str(args.output/'host-directory.png'))
                    stage('select-aplet');keys((6,))
                    wait("window.__hp39Timing.events.some(e=>e.type==='file-transfer-status'&&e.phase==='serving'&&e.transferred===8862&&e.total===8862)",label='object-upload')
                else:
                    for index,name in enumerate(('LIB275L.000','HPGCC000.000')):
                        if index:
                            ticks(12000000);keys((39,));ticks(3000000);keys((44,))
                        stage('wire-select-'+name);keys((6,))
                        wait("window.__hp39Timing.events.some(e=>e.type==='file-transfer-status'&&e.phase==='complete'&&e.name===arg)",arg=name,label='object-upload')
                        stage('wire-acknowledged-'+name)
                        page.screenshot(path=str(args.output/f'wire-complete-{index+1}.png'))
                stage('objects-acknowledged');ticks(120000000)
                page.screenshot(path=str(args.output/'installed-aplet.png'))
                stage('installed-aplet')
                page.get_by_role('button',name='Connections',exact=True).click()
                page.screenshot(path=str(args.output/'completed-transfer-ui.png'))
                if args.protocol=='disk':page.get_by_role('button',name='Stop file server',exact=True).click()
                page.get_by_role('button',name='Close',exact=True).click()
                if args.roundtrip:
                    stage('calculator-send');keys((38,));ticks(3000000);keys((44,44,6));ticks(3000000)
                    page.get_by_role('button',name='Connections',exact=True).click()
                    page.get_by_label('Calculator transfer menu',exact=True).select_option('disk')
                    page.get_by_role('button',name='Receive from calculator',exact=True).click()
                    page.get_by_role('button',name='Close',exact=True).click();keys((6,))
                    wait("window.__hp39Timing.events.filter(e=>e.type==='file-transfer-received').length===3",label='roundtrip-send')
                    ticks(12000000);page.screenshot(path=str(args.output/'after-send.png'))
                    page.get_by_role('button',name='Connections',exact=True).click()
                    returned={}
                    for index in range(3):
                        with page.expect_download() as pending:
                            page.get_by_role('button',name='Download',exact=True).nth(index).click()
                        download=pending.value;path=args.output/download.suggested_filename
                        download.save_as(path);returned[download.suggested_filename]=path.read_bytes()
                    with zipfile.ZipFile(args.archive) as archive:
                        sources={name:archive.read(next(n for n in archive.namelist() if n.endswith('/calculator/'+name) or n=='calculator/'+name or n==name))
                                 for name in ('HPGCC000.000','LIB275L.000')}
                    aplet=returned['H39ROMUS.000'];library=returned['LIB275L0.000'];source=sources['LIB275L.000']
                    assert aplet==sources['HPGCC000.000'],'Original aplet bytes changed during Wire installation or stock SEND'
                    assert library[9+library[8]:]==source[9+source[8]:],'Original library body changed or is missing'
                    assert library[9:9+library[8]]==b'LIB275L','Stock library export must retain the dependency alias'
                    with page.expect_download() as pending:
                        page.get_by_role('button',name='Download package',exact=True).click()
                    download=pending.value;path=args.output/'orchard-hp39-files.zip';download.save_as(path)
                    with zipfile.ZipFile(path) as archive:
                        assert set(archive.namelist())==set(returned)|{'HP39DIR.CUR'}
                        assert all(archive.read(name)==data for name,data in returned.items())
                    report['returned']={name:{'bytes':len(data),'sha256':sha(data)} for name,data in returned.items()}
                    report['aplet_file_equal']=True;report['library_body_equal']=True;report['library_alias_preserved']=True
                    report['downloaded_zip_sha256']=sha(path.read_bytes());stage('roundtrip-verified')
                    page.get_by_role('button',name='Stop file server',exact=True).click()
                    page.get_by_role('button',name='Close',exact=True).click()
                page.get_by_role('button',name='Connections',exact=True).click()
                page.get_by_role('button',name='Disconnect USB',exact=True).click()
                page.get_by_role('button',name='Close',exact=True).click()
                with page.expect_download() as pending:
                    page.get_by_role('button',name='Save',exact=True).click()
                pending.value.save_as(args.output/'installed.ord')
                if page.get_by_role('button',name='Resume',exact=True).count():
                    page.get_by_role('button',name='Resume',exact=True).click()
                keys((48,));ticks(10000000);keys((26,5,26,6));ticks(30000000)
                page.screenshot(path=str(args.output/'home-arithmetic.png'))
                stage('home-arithmetic')
                report['observation']=observe();report['page_errors']=page_errors
                assert not page_errors and not report['observation']['errors']
                assert all(e.get('speed',1)==1 for e in report['observation']['configurations'])
                assert {name:sha((args.dist/name).read_bytes()) for name in assets}==assets
                report['passed']=True
            except Exception as error:
                report['error']=str(error)
                if page:
                    report['observation']=observe()
                    page.screenshot(path=str(args.output/'failure.png'))
                raise
            finally:
                report['elapsed_seconds']=time.monotonic()-started
                (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
                browser.close()
    finally:
        server.shutdown()


if __name__=='__main__':
    main()
