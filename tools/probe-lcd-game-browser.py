#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run the LCD publication game witness in real Chromium.

Private ROM/checkpoint bytes enter an isolated browser page; the local server
only serves a generated probe bundle. No firmware, game or checkpoint is copied
into the repository's public assets. This measures core/publication throughput,
not the production Worker/canvas/compositor pipeline.
"""
import argparse,base64,functools,hashlib,json,os,shutil,subprocess,threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
sha=lambda data:hashlib.sha256(data).hexdigest()

class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom',type=Path,required=True)
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--model',type=int,required=True)
    parser.add_argument('--preset',required=True)
    parser.add_argument('--program-variant',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--ticks',type=int,default=12000000)
    parser.add_argument('--repeats',type=int,default=3)
    args=parser.parse_args();args.output=args.output.resolve();args.output.mkdir()
    wasm=Path(os.environ.get('ORCHARD_WASM',str(ROOT/'dist/orchard.wasm'))).read_bytes()
    payload={name:base64.b64encode(data).decode() for name,data in [('rom',args.rom.read_bytes()),('checkpoint',args.checkpoint.read_bytes()),('wasm',wasm)]}
    payload.update(model=args.model,preset=args.preset,ticks=args.ticks,repeats=args.repeats)
    subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),str(ROOT/'tools/lcd-game-sample.js'),'--bundle','--format=iife','--global-name=LCDGame',f'--outfile={args.output}/probe.js'],check=True,cwd=ROOT)
    (args.output/'index.html').write_text('<!doctype html><meta charset="utf-8"><script src="probe.js"></script>')
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(args.output)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as p:
            executable=os.environ.get('CHROMIUM') or shutil.which('chromium') or shutil.which('google-chrome')
            if not executable:raise RuntimeError('Set CHROMIUM to an installed Chrome/Chromium')
            browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            report=page.evaluate('''async args=>{for(const name of ['rom','wasm','checkpoint'])args[name]=Uint8Array.from(atob(args[name]),x=>x.charCodeAt(0));return await LCDGame.measureLCDGame(args)}''',payload)
            report.update(execution_host='Chromium '+browser.version,production_worker=False,
                          program_variant=args.program_variant,page_errors=errors,
                          tool_sha256={name:sha((ROOT/'tools'/name).read_bytes()) for name in ['probe-lcd-game-browser.py','lcd-game-sample.js']})
            assert not errors,errors
            (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps({k:report[k] for k in ['passed','program_variant','guest_state_equal','median_ms','page_errors']}))
            browser.close()
    finally:server.shutdown()

if __name__=='__main__':main()
