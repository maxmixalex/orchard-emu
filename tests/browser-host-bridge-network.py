# SPDX-License-Identifier: MIT
"""Chrome module Worker -> authenticated HTTP/CORS -> real TCP USB/IP.

Generated ARM guest + frozen production WASM; no ROM/OS driver/Conn3x claims.
The page is a local secure context, so HTTPS public-origin LNA permission UI
remains a separate browser-policy acceptance case.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json,os,select,shutil,socket,struct,subprocess,tempfile,threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
PAGE=b'''<!doctype html><meta charset="utf-8"><title>Orchard live bridge test</title>
<script type="module">
window.messages=[];window.worker=new Worker('/web/worker.js',{type:'module'});
worker.onmessage=({data})=>messages.push(data);
worker.onerror=e=>messages.push({type:'fixture-error',message:e.message});
window.send=data=>worker.postMessage({generation:1,...data});
</script>'''

class Handler(BaseHTTPRequestHandler):
    rom=b''
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path=='/':body,mime=PAGE,'text/html'
        elif self.path=='/guest.bin':body,mime=self.rom,'application/octet-stream'
        elif self.path=='/web/orchard.wasm':body,mime=(ROOT/'dist/orchard.wasm').read_bytes(),'application/wasm'
        elif self.path.startswith('/web/') and '..' not in self.path and self.path.endswith('.js'):
            path=ROOT/self.path.lstrip('/')
            if not path.is_file():self.send_error(404);return
            body,mime=path.read_bytes(),'text/javascript'
        else:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

def exact(peer,n):
    data=b''
    while len(data)<n:
        part=peer.recv(n-len(data))
        if not part:raise AssertionError('USB/IP closed early')
        data+=part
    return data

def urb(seq,ep=0,direction=1,length=18,setup=None,data=b''):
    header=struct.pack('!IIIIIIIIII',1,seq,0x10001,direction,ep,0,length,0,0xffffffff,0)
    return header+bytes(setup if setup is not None else [128,6,0,1,0,0,length&255,length>>8])+(data if direction==0 else b'')

def result(peer,has_data=True):
    header=exact(peer,48);command,seq=struct.unpack_from('!II',header);status,length=struct.unpack_from('!iI',header,20)
    assert command==3
    return seq,status,length,exact(peer,length) if has_data and length else b''

with tempfile.TemporaryDirectory(prefix='orchard-browser-bridge-') as temp:
    guest=Path(temp)/'guest.bin'
    subprocess.run([os.environ.get('CLANG','clang'),'--target=armv4t-none-eabi','-DORCHARD_BRIDGE_TEST','-nostdlib','-fuse-ld=lld','-Wl,-Ttext=0,-e,_start,--oformat=binary',str(ROOT/'tests/usb-guest.S'),'-o',str(guest)],check=True)
    binary=guest.read_bytes();Handler.rom=binary+b'\xff'*(2097152-len(binary))
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    origin=f'http://127.0.0.1:{server.server_port}'
    bridge=subprocess.Popen(['node','--input-type=module','-e',"""import {createHostBridge} from './host/bridge.mjs';
const bridge=createHostBridge({origins:[process.argv[1]]});const ports=await bridge.listen({http:0,usbip:0});
bridge.server.on('request',(req,res)=>res.once('finish',()=>console.error(JSON.stringify({method:req.method,url:req.url,origin:req.headers.origin,preflight:req.headers['access-control-request-headers'],status:res.statusCode}))));
console.log(JSON.stringify({...ports,token:bridge.token}));process.once('SIGTERM',()=>void bridge.close());""",origin],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    peer=None
    try:
        connection=json.loads(bridge.stdout.readline())
        with sync_playwright() as p:
            chrome=os.environ.get('CHROMIUM') or next((path for name in ['google-chrome','chromium','chromium-browser'] if (path:=shutil.which(name))),None)
            if not chrome:raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')
            browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
            page=browser.new_page();page.set_default_timeout(12000);console=[];page.on('console',lambda m:console.append(m.text) if m.type=='error' else None);page.on('requestfailed',lambda r:console.append(r.url+' '+str(r.failure)));page.goto(origin)
            page.wait_for_function('messages.some(m=>m.type==="ready")')
            page.evaluate('()=>send({type:"create",model:6,preset:"strict",audience:"debug"})')
            page.wait_for_function('messages.some(m=>m.type==="created")')
            page.evaluate('async()=>send({type:"load",rom:await (await fetch("/guest.bin")).arrayBuffer()})')
            page.wait_for_function('messages.some(m=>m.type==="loaded")')
            page.evaluate('(v)=>{send({type:"run"});send({type:"host-bridge-start",address:"http://127.0.0.1:"+v.httpPort,token:v.token,request:1});}',connection)
            try:page.wait_for_function('messages.some(m=>m.type==="host-bridge-status"&&m.ready)')
            except Exception:
                print(json.dumps(page.evaluate('messages.filter(m=>m.type!=="snapshot").slice(-12)')))
                print(json.dumps(page.evaluate('(()=>{const s=messages.filter(m=>m.type==="snapshot").at(-1);return s?{tick:s.tick,running:s.running,loaded:s.loaded,stopped:s.stopped,reason:s.reason}:null})()')))
                print(json.dumps(console))
                if select.select([bridge.stderr],[],[],0)[0]:print(os.read(bridge.stderr.fileno(),8192).decode())
                raise
            assert not page.evaluate('messages.some(m=>["error","fatal","fixture-error"].includes(m.type))')
            peer=socket.create_connection(('127.0.0.1',connection['usbipPort']),timeout=5);peer.settimeout(8)
            peer.sendall(struct.pack('!HHI',0x111,0x8003,0)+b'1-1'+b'\0'*29)
            imported=exact(peer,320);assert struct.unpack_from('!I',imported,4)[0]==0
            page.wait_for_function('messages.some(m=>m.type==="host-bridge-status"&&m.attached)')
            peer.sendall(urb(1));seq,status,length,data=result(peer);assert status==0 and data.hex()=='12011001ff00000834127856000100000001'
            # These packets traverse Chrome fetch/CORS and the actual Worker pump.
            payload=bytes([0,255,65,13,10,127,128,42])
            peer.sendall(urb(2,ep=3,direction=0,length=len(payload),data=payload));assert result(peer,False)[1]==0
            peer.sendall(urb(3,ep=1,length=64));seq,status,length,data=result(peer);assert status==0 and data==payload
            # Pause is authoritative even while an external IN is waiting.
            peer.sendall(urb(4,ep=1,length=64));page.evaluate('()=>send({type:"pause"})')
            page.wait_for_function('messages.filter(m=>m.type==="host-bridge-status").at(-1)?.phase==="disconnected"')
            assert peer.recv(1)==b'';peer.close();peer=None
            # A fresh request resumes the same calculator and recreates the bridge.
            page.evaluate('(v)=>{send({type:"run"});send({type:"host-bridge-start",address:"http://127.0.0.1:"+v.httpPort,token:v.token,request:2});}',connection)
            page.wait_for_function('messages.some(m=>m.type==="host-bridge-status"&&m.request===2&&m.ready)')
            peer=socket.create_connection(('127.0.0.1',connection['usbipPort']),timeout=5);peer.settimeout(8)
            peer.sendall(struct.pack('!HHI',0x111,0x8003,0)+b'1-1'+b'\0'*29);assert struct.unpack_from('!I',exact(peer,320),4)[0]==0
            peer.sendall(urb(5));assert result(peer)[1]==0
            page.evaluate('()=>worker.terminate()');assert peer.recv(1)==b''
            browser.close()
    finally:
        if peer:peer.close()
        bridge.terminate()
        try:bridge.wait(timeout=10)
        except subprocess.TimeoutExpired:bridge.kill();bridge.wait(timeout=5)
        server.shutdown();server.server_close();thread.join(timeout=5)
print('Live browser bridge: production module Worker/raw imports, real CORS+HTTP, guest EP0 and binary bulk, pause/reconnect and Worker-termination release passed; no OS driver attached')
