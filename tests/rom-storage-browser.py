# SPDX-License-Identifier: MIT
"""Real Chromium IndexedDB and FileSystemFileHandle persistence, no firmware.

The handle is an actual OPFS file handle, not a mocked native file picker. This
checks structured cloning, reload and re-reading changed source bytes. Native
file-picker permission decisions are separately bounded by controller tests.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, shutil, threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
ALLOWED={'/web/'+p for p in ('rom-storage.js','catalog.js','hp48.js')}
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path=='/': data=b'<!doctype html><title>Orchard remembered ROM regression</title>';kind='text/html'
        elif path in ALLOWED: data=(ROOT/path.lstrip('/')).read_bytes();kind='text/javascript'
        else: self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def log_message(self,*args): pass

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    with sync_playwright() as p:
        chrome=os.environ.get('CHROMIUM') or next((path for name in ('google-chrome','chromium','chromium-browser','google-chrome-stable') if (path:=shutil.which(name))),None)
        if not chrome: raise RuntimeError('Set CHROMIUM to a real Chrome/Chromium executable')
        browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
        context=browser.new_context();page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/')
        result=page.evaluate('''async()=>{
          const {ROMStore,readRememberedROM}=await import('/web/rom-storage.js'),{CALCULATORS}=await import('/web/catalog.js');
          const check=(ok,message)=>{if(!ok)throw Error(message);},store=new ROMStore();
          const bytes=new Uint8Array(1048576);bytes[0]=31;bytes[bytes.length-1]=97;
          const copy=new File([bytes],'copy.unusual');await store.remember(CALCULATORS[0],copy);
          const dir=await navigator.storage.getDirectory(),handle=await dir.getFileHandle('original.unusual',{create:true});
          let stream=await handle.createWritable();await stream.write(bytes);await stream.close();
          await store.remember(CALCULATORS[1],await handle.getFile(),handle);
          check((await store.list()).records.length===2,'Per-model records coexist');
          check(await store.remember(CALCULATORS[0],copy,null,()=>false)===null,'Stale write cancels');
          check((await store.list()).last.model===CALCULATORS[1].id,'Cancelled write does not change last-opened ROM');
          // Read-through must observe the file itself, not the File snapshot
          // from the time the handle was first stored.
          bytes[0]=63;stream=await handle.createWritable();await stream.write(bytes);await stream.close();
          return {storedModels:2,actualFileHandle:true,staleWriteCancelled:true};
        }''')
        page.reload()
        result.update(page.evaluate('''async()=>{
          const {ROMStore,readRememberedROM}=await import('/web/rom-storage.js');
          const check=(ok,message)=>{if(!ok)throw Error(message);},store=new ROMStore(),{records,last}=await store.list();
          check(records.length===2&&last.kind==='handle','Metadata and handle survive a reload');
          const original=new Uint8Array(await (await readRememberedROM(last)).arrayBuffer());
          const copy=new Uint8Array(await (await readRememberedROM(records.find(r=>r.kind==='copy'))).arrayBuffer());
          check(original[0]===63&&original.at(-1)===97,'Stored handle rereads changed original bytes');
          check(copy[0]===31&&copy.at(-1)===97,'Portable local copy retains its own bytes');
          await store.clear();check((await store.list()).records.length===0,'Forget clears local references and copies');
          const dir=await navigator.storage.getDirectory();check((await (await dir.getFileHandle('original.unusual')).getFile()).size===1048576,'Forget never deletes original file');
          return {reload:true,originalReadThrough:true,copyIndependent:true,forgetKeepsOriginal:true};
        }'''))
        result['browser']=browser.version
        (ROOT/'build').mkdir(exist_ok=True)
        (ROOT/'build/rom-storage-browser.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result));browser.close()
finally:
    server.shutdown();server.server_close();thread.join()
