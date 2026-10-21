#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Default-Chrome Worker throughput for six fixed guest workloads."""
from __future__ import annotations
import argparse
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('baseline_wasm',type=Path)
    ap.add_argument('candidate_wasm',type=Path)
    ap.add_argument('rom_directory',type=Path)
    ap.add_argument('fixtures',type=Path)
    ap.add_argument('endpoints',type=Path)
    ap.add_argument('new_report',type=Path)
    ap.add_argument('--chrome',type=Path,
        default=Path(os.environ['CHROMIUM']) if os.environ.get('CHROMIUM') else None,
        help='Chrome/Chromium executable (or set CHROMIUM)')
    args=ap.parse_args()
    if args.chrome is None:
        ap.error('Pass --chrome or set CHROMIUM to a Chrome/Chromium executable')
    root=Path(__file__).resolve().parents[1]
    worker_path=Path(__file__).with_suffix('.mjs')
    fixture_bytes=args.fixtures.read_bytes();fixtures=json.loads(fixture_bytes)
    endpoint_bytes=args.endpoints.read_bytes();endpoints=json.loads(endpoint_bytes)
    baseline=args.baseline_wasm.read_bytes();candidate=args.candidate_wasm.read_bytes()
    assert endpoints['fixture_sha256']==digest(fixture_bytes)
    assert endpoints['baseline_wasm_sha256']==digest(baseline)
    assert fixtures['baseline_wasm_sha256']==digest(baseline)
    identities={'baseline_wasm_sha256':digest(baseline),'candidate_wasm_sha256':digest(candidate),
        'fixture_sha256':digest(fixture_bytes),'endpoint_report_sha256':digest(endpoint_bytes),
        'endpoint_source_candidate_sha256':endpoints['candidate_wasm_sha256'],
        'worker_probe_sha256':digest(worker_path.read_bytes()),'driver_sha256':digest(Path(__file__).read_bytes()),
        'node_probe_sha256':digest((root/'tools/benchmark-scenes.mjs').read_bytes()),
        'hp48_module_sha256':digest((root/'web/hp48.js').read_bytes()),
        'session_module_sha256':digest((root/'web/session.js').read_bytes())}
    b64=lambda b:base64.b64encode(b).decode('ascii')
    payload={'fixtures':fixtures,'endpoints':endpoints,'identities':identities,'roms':{},'sessions':{}}
    for model in fixtures['models']:
        rom=(args.rom_directory/model['name']).read_bytes()
        assert digest(rom)==model['rom_sha256']
        payload['roms'][str(model['model'])]=b64(rom)
        for frame in model['frames']:
            payload['sessions'][frame['session']]=b64(Path(frame['session']).read_bytes())
    # Firmware and checkpoints travel only through the local automation pipe,
    # never through this HTTP server. Only these exact public/source assets exist.
    routes={'/':('text/html',b'<!doctype html><meta charset="utf-8"><title>Fixed-work scene benchmark</title>'),
        '/worker.mjs':('text/javascript',worker_path.read_bytes()),
        '/hp48.js':('text/javascript',(root/'web/hp48.js').read_bytes()),
        '/session.js':('text/javascript',(root/'web/session.js').read_bytes()),
        '/baseline.wasm':('application/wasm',baseline),'/candidate.wasm':('application/wasm',candidate)}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*unused): pass
        def do_GET(self):
            item=routes.get(urlsplit(self.path).path)
            if item is None:
                self.send_error(404);return
            mime,body=item;self.send_response(200)
            self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    report={'passed':False,'identities':identities,'browser_args':['--no-sandbox'],
        'v8_flags':[],'host_timing_only':True,'cpu_time_available':False}
    # Refuse to replace an earlier measurement, including a failed one.
    with args.new_report.open('x') as output:
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=str(args.chrome),headless=True,args=['--no-sandbox'])
                try:
                    report['browser']=browser.version
                    page=browser.new_page()
                    page.on('console',lambda msg:print(msg.text,flush=True))
                    page.goto(f'http://127.0.0.1:{server.server_port}/')
                    page.evaluate('''data=>{
                      const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
                      const transfers=[];
                      for(const group of ['roms','sessions'])for(const key of Object.keys(data[group])){
                        data[group][key]=decode(data[group][key]);transfers.push(data[group][key]);
                      }
                      globalThis.benchmarkResult=null;
                      const w=new Worker('/worker.mjs',{type:'module'});globalThis.benchmarkWorker=w;
                      w.onerror=e=>{globalThis.benchmarkResult={passed:false,error:e.message};};
                      w.onmessage=({data:r})=>{
                        if(r.type==='progress')console.log(JSON.stringify(r));
                        else if(r.type==='done')globalThis.benchmarkResult=r.report;
                      };
                      w.postMessage(data,transfers);
                    }''',payload)
                    page.wait_for_function('globalThis.benchmarkResult!==null',timeout=900000)
                    report.update(page.evaluate('globalThis.benchmarkResult'))
                    page.evaluate('globalThis.benchmarkWorker.terminate()')
                finally:
                    browser.close()
        except Exception as exc:
            report['passed']=False;report['error']=str(exc)
        finally:
            server.shutdown();server.server_close()
            json.dump(report,output,indent=2);output.write('\n')
    if not report['passed']:
        raise SystemExit(report.get('error','Benchmark failed'))


if __name__=='__main__':main()
