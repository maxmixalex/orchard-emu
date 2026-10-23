// SPDX-License-Identifier: MIT
// Real HTTP -> BrowserHostBridge -> production WASM -> guest USB -> USB/IP.
// Generated guest, no HP code; OS enumeration/driver/Conn3x are separate gates.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {tcpClient,operation,urb,unlink,importDevice,completion,until} from './host-bridge-helpers.mjs';
const root=resolve(process.env.ORCHARD_HOST_ROOT||'.');
const {createHostBridge}=await import(pathToFileURL(resolve(root,'host/bridge.mjs')));
const {BrowserHostBridge}=await import(pathToFileURL(resolve(root,'web/host-bridge-client.js')));
const {BRIDGE_MAX_BODY,bridgeAddress,bridgeToken,encodeBridgeBytes,decodeBridgeBytes}=await import(pathToFileURL(resolve(root,'web/host-bridge-protocol.js')));
const origin='http://127.0.0.1:8123',token='1'.repeat(64),temp=await mkdtemp(resolve(tmpdir(),'orchard-bridge-'));
let bridge,client,pump;const sockets=[];
for(const address of ['https://127.0.0.1:8125','http://localhost:8125','http://127.1:8125','http://127.0.0.1:0','http://127.0.0.1:65536','http://127.0.0.1:8125/a','http://127.0.0.1:8125?x','http://user@127.0.0.1:8125','http://127.0.0.1:8125/#x'])assert.throws(()=>bridgeAddress(address));
assert.equal(bridgeAddress('http://127.0.0.1:8125/'),'http://127.0.0.1:8125');
assert.equal(bridgeAddress('http://127.0.0.1:80'),'http://127.0.0.1:80');
assert.throws(()=>bridgeToken('short'));assert.throws(()=>bridgeToken(token+'\n'));
const allBytes=Uint8Array.from({length:65536},(_,i)=>i&255);assert.deepEqual(decodeBridgeBytes(encodeBridgeBytes(allBytes)),allBytes);
assert.throws(()=>decodeBridgeBytes('%%%%'));assert.throws(()=>decodeBridgeBytes('AAAA',1));
try{
 const cc=spawnSync(process.env.CLANG||'clang',['--target=armv4t-none-eabi','-DORCHARD_BRIDGE_TEST','-nostdlib','-fuse-ld=lld','-Wl,-Ttext=0,-e,_start,--oformat=binary','tests/usb-guest.S','-o',resolve(temp,'guest.bin')],{encoding:'utf8'});if(cc.error)throw cc.error;assert.equal(cc.status,0,cc.stderr);
 const wasm=await readFile(process.env.ORCHARD_BRIDGE_WASM||resolve(root,'dist/orchard.wasm')),{instance:{exports:core}}=await WebAssembly.instantiate(wasm,{});
 const rom=new Uint8Array(2097152).fill(255);rom.set(await readFile(resolve(temp,'guest.bin')));assert.equal(core.create(6),0);new Uint8Array(core.memory.buffer,core.rom_buffer(),rom.length).set(rom);assert.equal(core.load(rom.length),0);
 let tick=5000;assert.equal(core.run(tick),0);
 bridge=createHostBridge({token});const ports=await bridge.listen({http:0,usbip:0}),address='http://127.0.0.1:'+ports.httpPort;
 assert.equal(bridge.server.address().address,'127.0.0.1');assert.equal(bridge.usb.server.address().address,'127.0.0.1');
 const request=(path,{method='GET',body,headers={}}={})=>fetch(address+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 const expectHTTP=async(expected,path,options)=>{const response=await request(path,options);assert.equal(response.status,expected,await response.text());return response;};
 await expectHTTP(401,'/v1/session',{method:'POST',body:{protocol:1},headers:{Authorization:'Bearer wrong'}});
 await expectHTTP(403,'/v1/session',{method:'POST',body:{protocol:1},headers:{Origin:'https://unlisted.invalid'}});
 await expectHTTP(403,'/v1/session',{method:'POST',body:{protocol:1},headers:{Origin:'null'}});
 const badHost=await new Promise((resolve,reject)=>{http.get(address+'/v1/session',{headers:{Host:'example.invalid',Origin:origin,Authorization:'Bearer '+token}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});assert.equal(badHost,403);
 const preflight=await expectHTTP(204,'/v1/events',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,x-orchard-session'}});assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 await expectHTTP(403,'/v1/events',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-unexpected'}});
 await expectHTTP(400,'/v1/session',{method:'POST',body:{protocol:99}});
 await expectHTTP(413,'/v1/session',{method:'POST',body:' '.repeat(BRIDGE_MAX_BODY+1)});
 const statuses=[],newClient=()=>new BrowserHostBridge(core,{tick:()=>tick,notify:s=>statuses.push(s),fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});client=newClient();
 await client.start(address,token);assert.equal(client.phase,'enumerating');
 let coreError=null;
 pump=setInterval(()=>{try{for(let i=0;i<12;i++){assert.equal(core.run(256),0);tick+=256;client.poll(tick);}}catch(error){coreError=error;clearInterval(pump);}},1);
 const ready=()=>until(()=>{if(coreError)throw coreError;if(client.errorCode)throw Error(client.errorCode);return client.ready&&bridge.device.available;},'real guest enumeration');
 await ready();assert.equal(Buffer.from(bridge.device.device).toString('hex'),'12011001ff00000834127856000100000001');
 await expectHTTP(409,'/v1/session',{method:'POST',body:{protocol:1}});
 await expectHTTP(409,'/v1/events',{headers:{'X-Orchard-Session':client.session}});
 const list=await tcpClient(ports.usbipPort);sockets.push(list.socket);const query=operation(0x8005);list.socket.write(query.subarray(0,3));list.socket.write(query.subarray(3));const record=await list.read(328);assert.equal(record.readUInt32BE(8),1);assert.equal(record.readUInt16BE(312),0x1234);assert.equal(record.readUInt16BE(314),0x5678);
 let owner=await importDevice(ports.usbipPort);sockets.push(owner.socket);await until(()=>client.attached,'client attached status');
 const second=await tcpClient(ports.usbipPort);sockets.push(second.socket);second.socket.write(operation(0x8003));assert.equal((await second.read(8)).readUInt32BE(4),1);
 const get=urb(10);owner.socket.write(get.subarray(0,17));owner.socket.write(get.subarray(17));let result=await completion(owner);assert.equal(result.status,0);assert.equal(result.seq,10);assert.deepEqual(result.data,Buffer.from(bridge.device.device));
 owner.socket.write(urb(11,{direction:0,length:0,setup:[0,9,1,0,0,0,0,0]}));assert.equal((await completion(owner,false)).status,0);
 owner.socket.write(urb(12,{length:1,setup:[128,8,0,0,0,0,1,0]}));result=await completion(owner);assert.equal(result.status,0);assert.deepEqual(result.data,Buffer.from([1]));
 owner.socket.write(urb(13,{length:1,setup:[192,0x7f,0,0,0,0,1,0]}));assert.equal((await completion(owner)).status,-32,'The guest STALL must remain EPIPE');
 // A real NAK stays pending. UNLINK never emits a canceled RET_SUBMIT, and a
 // reused USB/IP seq has an independent bridge request identity.
 owner.socket.write(urb(20,{ep:1,length:64}));await until(()=>client.device.jobs.size===1,'guest NAK pending');const oldId=bridge.device.jobs.get(20).id;
 assert.equal(owner.buffered,0);owner.socket.write(unlink(21,20));const canceled=await owner.read(48);assert.equal(canceled.readUInt32BE(0),4);assert.equal(canceled.readInt32BE(20),-104);await until(()=>client.device.jobs.size===0,'guest unlink');
 owner.socket.write(urb(20,{ep:1,length:64}));await until(()=>client.device.jobs.size===1&&bridge.device.jobs.get(20)?.id!==oldId,'sequence reuse');
 await expectHTTP(204,'/v1/results',{method:'POST',body:{results:[{id:oldId,status:0,length:0,data:''}]},headers:{'X-Orchard-Session':client.session}});assert(bridge.device.jobs.has(20));assert.equal(owner.buffered,0);
 owner.socket.write(unlink(22,20));assert.equal((await owner.read(48)).readInt32BE(20),-104);await until(()=>client.device.jobs.size===0,'second unlink');
 // End-to-end multi-packet binary echo uses EP3 OUT and EP1 IN guest FIFOs.
 const payload=Buffer.from(Array.from({length:129},(_,i)=>(i*13)&255));owner.socket.write(urb(30,{ep:3,direction:0,length:payload.length,data:payload}));owner.socket.write(urb(31,{ep:1,length:payload.length}));
 const replies=new Map();for(let i=0;i<2;i++){const h=await owner.read(48),seq=h.readUInt32BE(4),n=h.readUInt32BE(24);assert.equal(h.readUInt32BE(0),3);assert.equal(h.readInt32BE(20),0);replies.set(seq,{length:n,data:seq===31?await owner.read(n):null});}
 assert.equal(replies.get(30).length,129);assert.deepEqual(replies.get(31).data,payload);
 // Explicit zero-length OUT is a real packet and creates a short IN result.
 owner.socket.write(urb(32,{ep:3,direction:0,length:0}));assert.equal((await completion(owner,false)).status,0);owner.socket.write(urb(33,{ep:1,length:64}));result=await completion(owner);assert.equal(result.status,0);assert.equal(result.length,0);
 // The guest, not the test host, writes WTCON and restarts through vector 0.
 const resetClosed=once(owner.socket,'close'),beforeEpoch=client.epoch;owner.socket.write(urb(40,{direction:0,length:0,setup:[64,0x5a,0,0,0,0,0,0]}));await resetClosed;await until(()=>client.epoch>beforeEpoch,'WDT releases old OS import');await ready();assert(client.active&&!client.attached);assert.equal(new Uint32Array(core.memory.buffer,core.usb_snapshot(),44)[10],1);
 owner=await importDevice(ports.usbipPort);sockets.push(owner.socket);owner.socket.write(urb(41));assert.equal((await completion(owner)).status,0);
 // Natural client detach resets the same core and makes a fresh import possible.
 const detachEpoch=client.epoch;owner.socket.destroy();await until(()=>client.epoch>detachEpoch,'USB/IP detach re-enumeration');await ready();owner=await importDevice(ports.usbipPort);sockets.push(owner.socket);
 const browserClosed=once(owner.socket,'close');await client.stop();await browserClosed;await until(()=>!bridge.connected,'explicit browser disconnect');assert.equal(new Uint32Array(core.memory.buffer,core.usb_snapshot(),44)[10],0);assert.equal(bridge.device.jobs.size,0);
 assert(statuses.some(s=>s.phase==='ready'));assert(statuses.some(s=>s.phase==='attached'));assert.equal(client.phase,'disconnected');
 console.log('Live bridge: real HTTP authentication/CORS, exclusive session/import, fragmented USB/IP, guest descriptors/configuration/bulk echo, NAK/STALL, unlink/seq reuse, guest WDT reset and detach passed. No OS driver attachment tested.');
 // Lost pages terminate their long poll; abrupt process loss fails pending
 // requests and disconnects the physical USB link without waiting for a URB.
 client=newClient();await client.start(address,token);await ready();owner=await importDevice(ports.usbipPort);sockets.push(owner.socket);owner.socket.write(urb(50,{ep:1,length:64}));await until(()=>bridge.device.jobs.size===1,'pending request before bridge loss');
 clearInterval(pump);pump=null;await bridge.close();await until(()=>!client.active,'HTTP process loss');assert.equal(new Uint32Array(core.memory.buffer,core.usb_snapshot(),44)[10],0);assert.equal(client.phase,'error');
}finally{clearInterval(pump);await client?.stop();for(const socket of sockets)socket.destroy();await bridge?.close();await rm(temp,{recursive:true,force:true});}
// Lease expiry also releases a session that vanished before opening its poll.
{
 const leased=createHostBridge({token,leaseTimeout:75,pollTimeout:25});try{const {httpPort}=await leased.listen({http:0,usbip:0});const response=await fetch(`http://127.0.0.1:${httpPort}/v1/session`,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{"protocol":1}'});assert.equal(response.status,201);await response.json();assert(leased.connected);await until(()=>!leased.connected,'abandoned session lease',1000);}finally{await leased.close();}
}
console.log('Bridge lifecycle: page/process loss, bounded lease, loopback-only addresses and binary size validation passed.');

// Controlled real HTTP delays reproduce rapid reconnect and Stop during the
// allocated-but-unanswered session POST. The USB data path is covered above.
function lifetimeClient(waitFor){
 const client=new BrowserHostBridge({timebase_hz:()=>12000000},{waitFor,fetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
 client.device={starts:0,start(){++this.starts;},detach(){},poll(){},cancelAll(){}};return client;
}
{
 const server=createHostBridge({token}),handlers=server.server.listeners('request');server.server.removeAllListeners('request');
 const held=[];let hold=true,posts=0;
 server.server.on('request',(req,res)=>{
  if(req.url==='/v1/session'&&req.method==='POST')++posts;
  if(hold&&(req.url==='/v1/events'||req.method==='DELETE')){held.push({req,res});return;}
  for(const handler of handlers)handler.call(server.server,req,res);
 });
 const a=lifetimeClient();let b;
 try{
  const {httpPort}=await server.listen({http:0,usbip:0}),url='http://127.0.0.1:'+httpPort;
  await a.start(url,token);await until(()=>held.some(item=>item.req.url==='/v1/events'),'old poll delayed');
  const stopping=a.stop();await until(()=>held.some(item=>item.req.method==='DELETE'),'old DELETE delayed');
  b=lifetimeClient(stopping);const starting=b.start(url,token);await new Promise(resolve=>setImmediate(resolve));
  assert(b.active&&b.phase==='connecting');assert.equal(posts,1,'New session must wait for the old DELETE');
  hold=false;for(const {req,res} of held)if(req.method==='DELETE')for(const handler of handlers)handler.call(server.server,req,res);
  await stopping;await starting;assert(b.active);assert.notEqual(a.session,b.session);assert.equal(posts,2);assert(server.connected);
 }finally{hold=false;await a.stop();await b?.stop();await server.close();}
}
{
 const server=createHostBridge({token}),handlers=server.server.listeners('request');server.server.removeAllListeners('request');
 let hold=true,releaseReply=null,posts=0;
 server.server.on('request',(req,res)=>{
  if(req.url==='/v1/session'&&req.method==='POST'){
   ++posts;if(hold){const end=res.end;res.end=function(...args){releaseReply=()=>end.apply(this,args);return this;};}
  }
  for(const handler of handlers)handler.call(server.server,req,res);
 });
 const a=lifetimeClient();let b;
 try{
  const {httpPort}=await server.listen({http:0,usbip:0}),url='http://127.0.0.1:'+httpPort;
  const opening=a.start(url,token);await until(()=>releaseReply&&server.connected,'POST assigned a session before delivering its ID');
  let cleaned=false;const stopping=a.stop().then(()=>{cleaned=true;});b=lifetimeClient(stopping);const starting=b.start(url,token);await new Promise(resolve=>setImmediate(resolve));
  assert(!cleaned);assert.equal(posts,1);assert(!a.active&&b.active);assert.equal(a.device.starts,0);
  hold=false;releaseReply();await opening;await stopping;await starting;
  assert(a.session&&b.session&&a.session!==b.session);assert.equal(a.device.starts,0,'Canceled handshake must never enumerate the guest');assert.equal(b.device.starts,1);assert(b.active&&!b.errorCode);
  await b.stop();assert(!server.connected,'Canceled old handshake and its successor both release their sessions');
 }finally{hold=false;releaseReply?.();await a.stop();await b?.stop();await server.close();}
}
console.log('Bridge HTTP cancellation races: delayed DELETE serializes reconnect; Stop waits for allocated session ID, deletes it and allows immediate clean reconnect without the lease fallback.');
