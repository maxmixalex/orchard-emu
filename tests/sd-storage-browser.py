# SPDX-License-Identifier: MIT
"""Real-browser binary autosave transactions, without firmware or mock IndexedDB."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, shutil, threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
ALLOWED={'/web/'+p for p in ('autosave.js','preferences.js','session.js','hp48.js')}
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path=self.path.split('?',1)[0]
        if path=='/': data=b'<!doctype html><title>Orchard storage regression</title>';kind='text/html'
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
          const {AutoSaveStore}=await import('/web/autosave.js');
          const {writeAuto,AUTO_PREFIX}=await import('/web/preferences.js');
          const check=(ok,message)=>{if(!ok)throw new Error(message);};
          const hash='a'.repeat(64),small=new Uint8Array([1,2,3]);
          writeAuto(localStorage,hash,5,small,null,'legacy');
          const a=new AutoSaveStore(localStorage),b=new AutoSaveStore(localStorage);
          await a.write('b'.repeat(64),2,small,null,'hp39gs');
          check((await b.read('b'.repeat(64))).model===2,'HP39gs binary autosave is accepted and readable');
          check((await a.read(hash)).token==='legacy','Legacy save remains readable');
          const file=new Uint8Array(16*1024*1024+500000);file[0]=23;file[file.length-1]=97;
          const start=performance.now();await a.write(hash,5,file,'legacy','binary');
          const writeMs=performance.now()-start,got=await b.read(hash);
          check(got.file.length===file.length&&got.file[0]===23&&got.file.at(-1)===97,'Complete binary save survives a separate reader');
          check(localStorage.getItem(AUTO_PREFIX+hash)===null,'Legacy copy removed only after successful replacement');
          const writes=await Promise.allSettled([a.write(hash,5,file,'binary','writer-a'),b.write(hash,5,file,'binary','writer-b')]);
          check(writes.filter(r=>r.status==='fulfilled').length===1,'Concurrent transactions must have one winner');
          check(writes.filter(r=>r.status==='rejected').length===1,'Stale writer must be rejected');
          const winner=await a.read(hash),before=winner.token;
          check(await b.write(hash,5,small,before,'cancelled',()=>false)===null,'Stale generation cancels its transaction');
          check((await a.read(hash)).token===before,'Cancelled write keeps previous complete data');
          window.store=a;window.expected=before;
          return {bytes:file.length,writeMs,concurrentWinners:1,legacyMigration:true,staleGeneration:true};
        }''')
        page.reload()
        persisted=page.evaluate('''async()=>{const {AutoSaveStore}=await import('/web/autosave.js');const s=new AutoSaveStore(localStorage);const r=await s.read('a'.repeat(64));if(!r||r.file.length!==16*1024*1024+500000||r.file.at(-1)!==97)throw Error('Binary save lost on reload');await s.clear();if(await s.read('a'.repeat(64)))throw Error('Clear did not remove binary save');return true;}''')
        result['reloadAndClear']=persisted;print(json.dumps(result))
        browser.close()
finally:
    server.shutdown();server.server_close();thread.join()
