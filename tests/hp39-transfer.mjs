// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {KermitSession,PacketReader,packet,PARAMETERS,encodeData,MAX_RECEIVE_BYTES} from '../web/kermit.js';
import {Hp39FileServer,prepareHp39Files} from '../web/hp39-transfer.js';
import {createHp39Directory,parseHp39Directory} from '../web/hp39-files.js';
import {FileTransfer,transferCapabilities,validateUpload} from '../web/file-transfer.js';
import {CalculatorController} from '../web/controller.js';
const text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const program=text('HP39AscD 4 TEST\nDISP 1;"Hello";');
const library=Uint8Array.from([...text('HP39BinH'),3,...text('Lib'),0,127,128,255]);
const files=[{name:'TEST.000',bytes:program},{name:'LIB.000',bytes:library}];
const prepared=prepareHp39Files(files);
const maximum=prepareHp39Files(Array.from({length:16},(_,i)=>({name:`OBJ${i}.000`,bytes:program})));
assert.equal(maximum.length,18);assert.equal(prepareHp39Files(maximum).length,18);
assert.throws(()=>prepareHp39Files(Array.from({length:17},(_,i)=>({name:`OBJ${i}.000`,bytes:program}))),/16/);
assert.equal(prepared.length,4);
assert.deepEqual(parseHp39Directory(prepared[3].bytes).map(f=>f.title),['TEST','Lib']);
assert.throws(()=>prepareHp39Files([...files,{name:'test.000',bytes:program}]),/Duplicate/);
assert.throws(()=>prepareHp39Files([{name:'../evil',bytes:program}]),/basename/);
assert.throws(()=>prepareHp39Files([{name:'ROM.bin',bytes:text('123456789')}]),/HP39/);
assert.throws(()=>prepareHp39Files([{name:'A.000',bytes:createHp39Directory([])}]),/HP39/);
const alias=[...files,{name:'HP39DIR.CUR',bytes:createHp39Directory([{kind:'A',file:'HP39DIR.000',title:'Root'}])},
 {name:'HP39DIR.000',bytes:createHp39Directory([{kind:'D',file:'TEST.000',title:'Menu alias'},{kind:'H',file:'LIB.000',title:'Library alias'}])}];
assert.deepEqual(prepareHp39Files(alias).map(f=>f.bytes),alias.map(f=>f.bytes),'Explicit directory aliases and object bytes are preserved');
for(const model of [1,2,3])for(const transport of ['usb','serial']){
 assert.equal(transferCapabilities(model,transport).serve,model!==1||transport==='usb');assert.equal(transferCapabilities(model,transport).get,false);validateUpload(model,'TEST.000',program);
}
for(const model of [4,5]){assert(transferCapabilities(model,'usb').get);assert(!transferCapabilities(model).serve);}
assert.equal(transferCapabilities(5,'serial').send,false);

function fixture(hostFiles=files){
 let now=0;const a=[],b=[],received=[],clientFiles=[],status=[];
 const server=new Hp39FileServer({hz:1000,write:bytes=>{const n=Math.min(7,bytes.length);a.push(bytes.slice(0,n));return n;},file:f=>received.push(f),notify:s=>status.push(s)});
 const client=new KermitSession({hz:1000,write:bytes=>{const n=Math.min(5,bytes.length);b.push(bytes.slice(0,n));return n;},file:f=>clientFiles.push(f)});
 server.start({files:hostFiles},now);
 const pump=(until=()=>!client.active)=>{for(let i=0;i<30000;i++){++now;while(b.length)server.receive(b.shift(),now);while(a.length)client.receive(a.shift(),now);server.poll(now);client.poll(now);if(until())return;}throw Error('test stalled '+server.phase+' '+client.phase);};
 return {server,client,received,clientFiles,status,pump,now:()=>now,send:p=>server.receive(p,now)};
}
{
 const f=fixture(alias);
 for(const name of ['HP39DIR.CUR','HP39DIR.000','test.000','LIB.000']){
  f.client.start({mode:'get',name},f.now());f.pump();assert.equal(f.client.phase,'complete');assert.equal(f.server.active,true);
 }
 assert.equal(f.clientFiles.length,4);assert.deepEqual(f.clientFiles[2].bytes,program);assert.deepEqual(f.clientFiles[3].bytes,library);
 assert.equal(f.server.transferred,program.length+library.length);
 // Repeated gets do not inflate completed-object progress.
 f.client.start({mode:'get',name:'TEST.000'},f.now());f.pump();assert.equal(f.server.transferred,program.length+library.length);
 f.client.start({mode:'get',name:'MISSING'},f.now());f.pump();assert.equal(f.client.phase,'error');assert.equal(f.server.active,true);
 f.client.start({mode:'finish'},f.now());f.pump();assert.equal(f.client.phase,'complete');assert.equal(f.server.phase,'complete');
}
{
 const f=fixture([]);
 f.client.start({mode:'send',name:'TEST.000',bytes:program},f.now());f.pump();assert.equal(f.client.phase,'complete');assert.equal(f.received.length,1);assert.deepEqual(f.received[0].bytes,program);
 f.client.start({mode:'get',name:'test.000'},f.now());f.pump();assert.deepEqual(f.clientFiles[0].bytes,program);
 f.client.start({mode:'send',name:'LIB.000',bytes:library},f.now());f.pump();assert.equal(f.received.length,2);assert.deepEqual(f.received[1].bytes,library);
 f.server.cancel();assert.equal(f.server.active,false);assert.equal(f.server.pending,false);
}
// A steadily progressing stock SEND may exceed the generic Kermit five-minute
// transaction default. It inherits the HP39 server's bounded fifteen minutes;
// a late child cannot restart or extend that total service budget.
{
 let now=0;const ab=[],ba=[],received=[],states=[];
 const payload=Uint8Array.from([...program,...text('A'.repeat(30000))]);
 const server=new Hp39FileServer({hz:1000,write:b=>{ba.push(b.slice());return b.length;},
   file:f=>received.push(f),notify:s=>states.push(s)});
 const client=new KermitSession({hz:1000,duration:900,write:b=>{ab.push(b.slice());return b.length;}});
 server.start({files:[]},0);client.start({mode:'send',name:'SLOW.000',bytes:payload},0);
 while(client.active&&now<900000){
   now+=1000;
   while(ab.length)server.receive(ab.shift(),now);while(ba.length)client.receive(ba.shift(),now);
   server.poll(now);client.poll(now);
 }
 assert(now>300000&&now<900000);assert.equal(client.phase,'complete');
 assert.equal(received.length,1);assert.deepEqual(received[0].bytes,payload);
 server.receive(packet(0,'S',PARAMETERS),899000);server.poll(899000);assert(server.active);
 server.poll(900000);assert.equal(server.phase,'error');assert.match(states.at(-1).error,/15-minute/);
 assert.equal(received.length,1,'The expired partial child must publish no file');
}
// A lost Init-Info ACK recovers before the client's ordinary five-second
// timeout. The complete transaction still returns exactly one original file.
// Stock SEND can likewise miss the receiver's S/D ACK. Retry the exact ACK,
// including S's negotiation data, without waiting for the sender to resend.
{
 let now=0;const ab=[],ba=[],received=[],dropped=new Set(),fromClient=[],hostPackets=[];
 const server=new Hp39FileServer({hz:1000,write:b=>{const p=new PacketReader().feed(b)[0];hostPackets.push({now,...p});
   if(p?.type==='Y'&&[0,2].includes(p.sequence)&&!dropped.has(p.sequence))dropped.add(p.sequence);else ba.push(b.slice());return b.length;},file:f=>received.push(f)});
 const client=new KermitSession({hz:1000,write:b=>{fromClient.push(...new PacketReader().feed(b));ab.push(b.slice());return b.length;}});
 server.start({files:[]},0);client.start({mode:'send',name:'NOTE.000',bytes:program},0);
 for(;now<5000&&client.active;now++){
   while(ab.length)server.receive(ab.shift(),now);while(ba.length)client.receive(ba.shift(),now);server.poll(now);client.poll(now);
 }
 assert.equal(client.phase,'complete');assert.deepEqual([...dropped],[0,2]);assert(now>=2000&&now<5000);
 for(const type of ['S','F','D','Z','B'])assert.equal(fromClient.filter(p=>p.type===type).length,1,'ACK recovery must precede sender retransmission');
 assert.equal(received.length,1);assert.deepEqual(received[0].bytes,program);
 const initial=hostPackets.filter(p=>p.type==='Y'&&p.sequence===0);assert.equal(initial.length,2);
 assert.deepEqual(initial[0].data,PARAMETERS);assert.deepEqual(initial[1].data,PARAMETERS);
 assert.equal(initial[1].now-initial[0].now,1000);
}
// Backpressure cannot consume the ACK retry timer before the complete frame
// is written. A newly received packet supersedes an unsent preceding retry.
{
 let allowance=0;const wire=[],server=new Hp39FileServer({hz:1000,write:b=>{const n=Math.min(allowance,b.length);wire.push(...b.subarray(0,n));return n;}});
 server.start({files:[]},0);server.receive(packet(0,'S',PARAMETERS),0);server.poll(10000);
 assert.equal(server.child.deadline,Infinity);assert.equal(server.child.retries,0);
 allowance=1;server.poll(10001);assert.equal(server.child.deadline,Infinity);
 allowance=128;server.poll(10002);assert.equal(server.child.deadline,11002);
 const before=wire.length;allowance=0;server.poll(11002);assert.equal(server.child.retries,1);
 server.receive(packet(1,'F',text('NOTE.000')),11003);assert.equal(server.child.queue.length,1);
 allowance=128;server.poll(11004);
 const next=new PacketReader().feed(Uint8Array.from(wire.slice(before)));assert.equal(next.length,1);assert.equal(next[0].sequence,1);
 const limit=wire.length;server.cancel();server.poll(12000);
 assert(!new PacketReader().feed(Uint8Array.from(wire.slice(limit))).some(p=>p.type==='Y'),'Cancellation must discard old ACK timers');
}
// A silent peer remains bounded by the retry count; a fresh server cannot
// inherit a retained acknowledgement or publish an incomplete receive.
{
 const wire=[],received=[],server=new Hp39FileServer({hz:1000,write:b=>{wire.push(...new PacketReader().feed(b));return b.length;},file:f=>received.push(f)});
 server.start({files:[]},0);server.receive(packet(0,'S',PARAMETERS),0);server.poll(0);
 while(server.active)server.poll(server.child.deadline);
 assert.equal(server.phase,'error');assert.equal(wire.length,5);assert(wire.every(p=>p.type==='Y'&&p.sequence===0));assert.equal(received.length,0);
 server.start({files:[]},30000);server.poll(40000);assert.equal(wire.length,5);assert.equal(server.child,null);
}
{
 let now=0,dropped=false;const ab=[],ba=[],received=[];
 const server=new Hp39FileServer({hz:1000,write:b=>{const p=new PacketReader().feed(b)[0];
  if(!dropped&&p?.type==='Y'&&p.sequence===0)dropped=true;else ba.push(b.slice());return b.length;}});
 const client=new KermitSession({hz:1000,write:b=>{ab.push(b.slice());return b.length;},file:f=>received.push(f)});
 server.start({files},0);client.start({mode:'get',name:'TEST.000'},0);
 for(;now<5000&&client.active;now++){
  while(ab.length)server.receive(ab.shift(),now);while(ba.length)client.receive(ba.shift(),now);
  server.poll(now);client.poll(now);
 }
 assert(dropped&&now>=1000&&now<5000);assert.equal(client.phase,'complete');
 assert.equal(server.infoAck,null);assert.equal(received.length,1);assert.deepEqual(received[0].bytes,program);
}
// Start the retry timer only after the complete ACK is written. A following
// command removes an unsent old ACK, so it cannot poison the new child exchange.
{
 let allowance=0;const sent=[],server=new Hp39FileServer({hz:1000,write:b=>{
  const n=Math.min(allowance,b.length);if(n)sent.push(b.slice(0,n));return n;}});
 server.start({files},0);server.receive(packet(0,'I',PARAMETERS),0);
 server.poll(5000);assert.equal(server.infoAck.deadline,Infinity);assert.equal(server.infoAck.retries,0);
 allowance=1;server.poll(5001);assert.equal(server.infoAck.deadline,Infinity);
 allowance=128;server.poll(5002);assert.equal(server.infoAck.deadline,6002);
 allowance=0;server.poll(6002);assert.equal(server.infoAck.retries,1);assert.equal(server.queue.length,1);
 server.receive(packet(0,'R',text('TEST.000')),6003);assert.equal(server.infoAck,null);assert.equal(server.queue.length,0);
 allowance=128;server.poll(6004);assert.equal(new PacketReader().feed(sent.at(-1))[0].type,'S');
}
// A silent peer exhausts a bounded retry budget. Cancellation and a fresh
// server cannot inherit or emit a former initialization ACK.
{
 const sent=[],server=new Hp39FileServer({hz:1000,write:b=>{sent.push(b.slice());return b.length;}});
 server.start({files:[]},0);server.receive(packet(0,'I',PARAMETERS),0);server.poll(0);
 while(server.active)server.poll(server.infoAck.deadline);
 assert.equal(server.phase,'error');assert.equal(sent.length,5);assert.equal(server.infoAck,null);assert.equal(server.pending,false);
 server.start({files:[]},40000);server.receive(packet(0,'I',PARAMETERS),40000);server.poll(40000);server.cancel();
 const n=sent.length;server.poll(100000);assert.equal(sent.length,n);assert.equal(server.infoAck,null);
 server.start({files:[]},100000);server.poll(200000);assert.equal(sent.length,n);
}
// FINISH has a bounded final-ACK grace period, keyed to the exact command.
{
 let now=0,dropped=false;const ab=[],ba=[],status=[];
 const server=new Hp39FileServer({hz:1000,write:b=>{const p=new PacketReader().feed(b)[0];
  if(!dropped&&p?.type==='Y'&&!p.data.length)dropped=true;else ba.push(b.slice());return b.length;},notify:s=>status.push(s)});
 const client=new KermitSession({hz:1000,write:b=>{ab.push(b.slice());return b.length;}});
 server.start({files:[]},0);client.start({mode:'finish'},0);
 for(;now<30000&&client.active;now++){
  while(ab.length)server.receive(ab.shift(),now);while(ba.length)client.receive(ba.shift(),now);
  server.poll(now);client.poll(now);
 }
 assert(dropped&&now>5000);assert.equal(client.phase,'complete');assert.equal(server.phase,'complete');
 assert.equal(status.filter(s=>s.phase==='complete').length,1);
 const count=ba.length;
 server.receive(packet(0,'G',text('L')),now);server.poll(now);
 server.receive(packet(1,'G',text('F')),now);server.poll(now);assert.equal(ba.length,count);
 const expiry=server.lingerUntil;server.receive(packet(0,'G',text('F')),expiry);server.poll(expiry);
 assert.equal(ba.length,count);assert.equal(server.pending,false);
}
// A completed receive child hands its final-ACK retry to the persistent host.
{
 let now=0,dropped=false;const ab=[],ba=[],received=[];
 const server=new Hp39FileServer({hz:1000,write:b=>{const p=new PacketReader().feed(b)[0];
  if(!dropped&&p?.type==='Y'&&p.sequence===4)dropped=true;else ba.push(b.slice());return b.length;},file:f=>received.push(f)});
 const client=new KermitSession({hz:1000,write:b=>{ab.push(b.slice());return b.length;}});
 server.start({files:[]},0);client.start({mode:'send',name:'TEST.000',bytes:program},0);
 for(;now<30000&&client.active;now++){
  while(ab.length)server.receive(ab.shift(),now);while(ba.length)client.receive(ba.shift(),now);server.poll(now);client.poll(now);
 }
 assert(dropped&&now>=1000&&now<5000);assert.equal(client.phase,'complete');assert.equal(server.phase,'serving');
 assert.equal(received.length,1);assert.deepEqual(received[0].bytes,program);
 const expiry=server.lingerUntil,count=ba.length;server.receive(packet(4,'B'),expiry);server.poll(expiry);
 assert.equal(ba.length,count);assert.equal(received.length,1);server.cancel();assert.equal(server.pending,false);
}
// A new stock SEND cancels an unsent final-B retry from the previous file.
// Reusing sequence zero must neither leak that old ACK nor publish a file twice.
{
 let allowance=128;const wire=[],received=[],server=new Hp39FileServer({hz:1000,write:b=>{
   const n=Math.min(allowance,b.length);wire.push(...b.subarray(0,n));return n;},file:f=>received.push(f)});
 server.start({files:[]},0);
 for(const [sequence,type,data] of [[0,'S',PARAMETERS],[1,'F',text('FIRST.000')],[2,'D',encodeData(program).data],[3,'Z'],[4,'B']]){
   server.receive(packet(sequence,type,data),sequence);server.poll(sequence);
 }
 assert.equal(received.length,1);const deadline=server.finalAckRetry.deadline,before=wire.length;
 allowance=0;server.poll(deadline);assert.equal(server.queue.length,1);
 server.receive(packet(0,'S',PARAMETERS),deadline+1);assert.equal(server.finalAckRetry,null);assert.equal(server.queue.length,0);
 allowance=128;server.poll(deadline+2);
 const sent=new PacketReader().feed(Uint8Array.from(wire.slice(before)));assert.equal(sent.length,1);assert.equal(sent[0].sequence,0);
 assert.equal(received.length,1);server.cancel();
}
// A final-ACK retry still blocked by the transport at grace expiry is dropped;
// later writable transport must not emit an obsolete confirmation.
{
 let writable=true;const wire=[],server=new Hp39FileServer({hz:1000,write:b=>{if(!writable)return 0;wire.push(b.slice());return b.length;}});
 server.start({files:[]},0);
 for(const [sequence,type,data] of [[0,'S',PARAMETERS],[1,'F',text('FIRST.000')],[2,'D',encodeData(program).data],[3,'Z'],[4,'B']]){
   server.receive(packet(sequence,type,data),sequence);server.poll(sequence);
 }
 const before=wire.length;writable=false;server.poll(server.finalAckRetry.deadline);assert.equal(server.queue.length,1);
 server.poll(server.lingerUntil);assert.equal(server.finalAckRetry,null);assert.equal(server.queue.length,0);
 writable=true;server.poll(server.lingerUntil+1);assert.equal(wire.length,before);server.cancel();
}
{
 const f=fixture();f.send(packet(0,'I',PARAMETERS));f.server.poll(1);f.send(packet(0,'R',text('../escape')));assert.equal(f.server.phase,'error');
}
{
 const f=fixture();f.client.start({mode:'send',name:'BAD',bytes:text('not hp39')},f.now());f.pump(()=>!f.server.active);assert.equal(f.server.phase,'error');assert.equal(f.received.length,0);
}
// A full host catalog rejects at EOF, before the calculator can finish SEND.
{
 const f=fixture(maximum);f.client.start({mode:'send',name:'NEW.000',bytes:program},f.now());f.pump(()=>!f.server.active);
 assert.equal(f.server.phase,'error');assert.equal(f.client.stage,'send-eof');assert.equal(f.received.length,0);
}
{
 const wire=[],received=[],server=new Hp39FileServer({write:b=>{wire.push(...new PacketReader().feed(b));return b.length;},
  receiveBudget:{files:2,bytes:program.length-1},file:f=>received.push(f)});
 server.start({files:[]},0);
 for(const p of [packet(0,'S',PARAMETERS),packet(1,'F',text('TEST.000')),packet(2,'D',encodeData(program).data),packet(3,'Z')]){server.receive(p,1);server.poll(1);}
 assert.equal(server.phase,'error');assert.equal(received.length,0);assert(!wire.some(p=>p.type==='Y'&&p.sequence===3));
}
{
 const f=fixture(maximum);f.client.start({mode:'send',name:'obj0.000',bytes:program},f.now());f.pump();
 assert.equal(f.client.phase,'complete');assert.equal(f.received.length,1);assert.equal(f.server.files.size,18);
}
{
 const large=new Uint8Array(2*1024*1024-128);large.set(program);
 const f=fixture(Array.from({length:4},(_,i)=>({name:`BIG${i}.000`,bytes:large})));
 const extra=new Uint8Array(1024);extra.set(program);
 f.client.start({mode:'send',name:'EXTRA.000',bytes:extra},f.now());f.pump(()=>!f.server.active);
 assert.equal(f.server.phase,'error');assert.equal(f.client.stage,'send-eof');assert.equal(f.received.length,0);
}
{
 const f=fixture([]);
 for(let i=0;i<15;i++){f.client.start({mode:'send',name:'TEST.000',bytes:program},f.now());f.pump();}
 assert.equal(f.received.length,15);
 // Two files in one S...B must share the remaining one-file session capacity.
 const encoded=encodeData(program).data;
 for(const [sequence,type,data] of [[0,'S',PARAMETERS],[1,'F',text('A.000')],[2,'D',encoded],[3,'Z'],[4,'F',text('B.000')],[5,'D',encoded],[6,'Z']])f.send(packet(sequence,type,data));
 assert.equal(f.server.phase,'error');assert.equal(f.received.length,15);
 assert(!f.server.files.has('A.000'));assert(!f.server.files.has('B.000'));
}
// USB IN completion and dependent OUT response occupy distinct guest turns.
{
 const writes=[],incoming=[packet(0,'I',PARAMETERS)];
 const usb={endpoint:()=>({maxPacket:64}),send:bytes=>{writes.push(bytes.slice());return {result:0,accepted:bytes.length};},read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1}};
 const transfer=new FileTransfer({core:{timebase_hz:()=>1000},usb,model:1,notify:()=>{}});
 transfer.start({request:1,mode:'serve',transport:'usb',files:[]},0);
 transfer.poll(1);assert.equal(writes.length,0);transfer.poll(1);assert.equal(writes.length,0);
 transfer.poll(2);assert.equal(writes.length,1);assert.equal(writes[0][3],89);
 transfer.cancel(3);assert(!transfer.active);
}
// A slow library below 4 KiB must show acknowledged progress before its final
// packet, while fast successive packets remain coalesced for the React UI.
{
 let wall=0,tick=0;const incoming=[],outgoing=[],status=[],received=[];
 const body=new Uint8Array(1489).fill(65);body.set(library);
 const usb={endpoint:()=>({maxPacket:64}),send:bytes=>{outgoing.push(bytes.slice());return {result:0,accepted:bytes.length};},
  read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1}};
 const host=new FileTransfer({core:{timebase_hz:()=>1000},usb,model:1,now:()=>wall,notify:s=>status.push({...s,wall})});
 const client=new KermitSession({hz:1000,write:bytes=>{incoming.push(bytes.slice());return bytes.length;},file:f=>received.push(f)});
 host.start({request:1,mode:'serve',transport:'usb',files:[{name:'LIB.000',bytes:body}]},tick);
 client.start({mode:'get',name:'LIB.000'},tick);
 for(let n=0;n<1000&&client.active;n++){
  ++tick;wall+=50;while(outgoing.length)client.receive(outgoing.shift(),tick);client.poll(tick);host.poll(tick);
 }
 assert.equal(client.phase,'complete');assert.deepEqual(received[0].bytes,body);
 const sending=status.filter(s=>s.phase==='sending');
 assert(sending.filter(s=>s.transferred>0&&s.transferred<body.length).length>=3,'Small HP39 libraries must publish live progress');
 for(let i=1;i<sending.length;i++){
  assert(sending[i].transferred>sending[i-1].transferred);
  assert(sending[i].transferred===body.length||sending[i].wall-sending[i-1].wall>=250,'Packet progress is coalesced');
 }
 assert(sending.every(s=>s.hostedTotal===body.length&&s.hostedTransferred===s.transferred));
 const complete=status.filter(s=>s.phase==='serving').at(-1);
 assert.equal(complete.filesCompleted,1);assert.equal(complete.filesTotal,1);
 assert.equal(complete.hostedTransferred,body.length);assert.equal(complete.hostedTotal,body.length);
}
const browserFile=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
function controller(){const sent=[];const c=new CalculatorController({worker:{postMessage:x=>sent.push(x),terminate(){}}});c.patch({model:{id:1},ready:true,loaded:true,running:false,usbReady:true,serial:true});return {c,sent};}
// Controller reads/validates every file before publishing the private catalog.
for(const transport of ['usb','serial']){
 const {c,sent}=controller();if(transport==='serial')c.patch({model:{id:2}});await c.startHp39Server(transport,files.map(f=>({file:browserFile(f.name,f.bytes)})));
 assert.equal(sent.at(-1).mode,'serve');assert.equal(sent.at(-1).files.length,4);assert.equal(sent.at(-2).type,'run');c.dispose();
 const bad=controller();if(transport==='serial')bad.c.patch({model:{id:2}});await bad.c.startHp39Server(transport,[{file:browserFile('TEST.000',program)},{file:browserFile('BAD.000',text('not hp39'))}]);assert(!bad.sent.some(m=>m.type==='file-transfer-start'));assert.equal(bad.c.state.transfer.phase,'error');bad.c.dispose();
}
// Wire reuses complete-package preflight, sends libraries first, preserves
// every object byte, and waits for the current file's final acknowledgement.
{
 const {c,sent}=controller(),aplet=text('HP39BinB\x04TESTopaque-body');
 const packageFiles=prepareHp39Files([{name:'APLET.000',bytes:aplet},{name:'LIB.000',bytes:library}]);
 await c.startHp39Server('usb',packageFiles.map(f=>({file:browserFile(f.name,f.bytes)})),{protocol:'wire'});
 let start=sent.filter(e=>e.type==='file-transfer-start').at(-1);
 assert.equal(start.protocol,'hp39-wire');assert.equal(start.mode,'send');assert.equal(start.name,'LIB.000');assert.deepEqual(start.bytes,library);
 assert.equal(c.state.uploadBatch.items.length,2);assert.equal(c.state.uploadBatch.completed,0);
 c.receive({type:'file-transfer-status',generation:c.generation,request:start.request,active:true,phase:'sending',transferred:library.length,total:library.length});
 assert.equal(sent.filter(e=>e.type==='file-transfer-start').length,1,'Payload progress alone cannot start the next object');
 c.receive({type:'file-transfer-status',generation:c.generation,request:start.request,active:false,phase:'complete',transferred:library.length,total:library.length});
 start=sent.filter(e=>e.type==='file-transfer-start').at(-1);assert.equal(start.name,'APLET.000');assert.deepEqual(start.bytes,aplet);assert.equal(c.state.uploadBatch.completed,1);
 c.cancelTransfer();assert.equal(c.state.uploadBatch.active,false);assert.equal(c.state.uploadBatch.items[0].phase,'complete');assert.equal(c.state.uploadBatch.items[1].phase,'cancelled');c.dispose();
 const invalid=controller();await invalid.c.startHp39Server('usb',[{file:browserFile('LIB.000',library)},{file:browserFile('TEST.000',program)}],{protocol:'wire'});
 assert.equal(invalid.c.state.transfer.phase,'error');assert(!invalid.sent.some(e=>e.type==='file-transfer-start'),'Unsupported ASCII files fail before sending the library');invalid.c.dispose();
}
// A failed Wire object retains its exact bytes and the later queue. Successful
// objects are never resent by retry/skip, including late ACKs from old attempts.
for(const recovery of ['retry','skip','replace']){
 const {c,sent}=controller(),aplet=text('HP39BinB\x04TESTopaque-body'),note=text('HP39BinC\x04NOTEnote-body');
 const emit=data=>c.receive({generation:c.generation,type:'file-transfer-status',request:c.transferRequest,...data});
 const starts=()=>sent.filter(e=>e.type==='file-transfer-start');
 await c.startHp39Server('usb',[{file:browserFile('A.any-suffix',aplet)},{file:browserFile('LIB',library)},{file:browserFile('NOTE.zip',note)}],{protocol:'wire'});
 assert.equal(starts().at(-1).name,'LIB','Libraries are installed before dependent aplets');
 emit({active:false,phase:'complete'});assert.equal(starts().at(-1).name,'A.any-suffix');
 const failed=c.transferRequest;emit({active:false,phase:'error',error:'Calculator cancelled',transferred:4});
 assert.equal(c.state.transfer.name,'A.any-suffix');assert(c.state.uploadBatch.recoverable);
 assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['complete','error','queued']);
 assert.deepEqual(c.uploadQueue.entries[1].bytes,aplet);assert.equal(c.uploadQueue.entries[0].bytes,undefined);
 emit({request:failed,active:false,phase:'complete'});assert.equal(starts().length,2,'Old final ACK cannot advance an interrupted file');
 if(recovery==='replace'){
   c.cancelTransfer();assert.equal(c.uploadQueue,null);assert.equal(c.state.uploadBatch.recoverable,false);
   await c.startHp39Server('usb',[{file:browserFile('NEW',note)}],{protocol:'wire'});
   assert.equal(starts().at(-1).name,'NEW');c.dispose();continue;
 }
 if(recovery==='retry'){
   await c.retryUploadFile();assert(starts().at(-1).request>failed);
   assert.equal(starts().at(-1).name,'A.any-suffix');assert.deepEqual(starts().at(-1).bytes,aplet);
   emit({request:failed,active:false,phase:'complete'});assert.equal(starts().at(-1).name,'A.any-suffix');
   emit({active:false,phase:'complete'});
 }else c.skipUploadFile();
 assert.equal(starts().at(-1).name,'NOTE.zip','A typed file named .zip is not parsed as an archive');
 assert.deepEqual(starts().at(-1).bytes,note);emit({active:false,phase:'complete'});
 assert.equal(c.uploadQueue,null);assert.equal(c.state.uploadBatch.active,false);
 assert.equal(c.state.uploadBatch.completed,recovery==='retry'?3:2);
 assert.deepEqual(c.state.uploadBatch.items.map(i=>i.phase),['complete',recovery==='retry'?'complete':'skipped','complete']);
 assert.equal(starts().filter(e=>e.name==='LIB').length,1);c.dispose();
}
// Preflight still checks the entire selection before the first transaction,
// but a bad loose file has its own recoverable error instead of discarding good
// objects. A later local read retry may recover; cancellation wins its await.
for(const recovery of ['skip','retry','cancel-retry']){
 const {c,sent}=controller(),aplet=text('HP39BinB\x04TESTopaque-body');let reads=0,release;
 const bad=browserFile('BROKEN.unknown',aplet);
 bad.arrayBuffer=async()=>{if(++reads===1)throw Error('Local read failed');
   return recovery==='cancel-retry'?new Promise(resolve=>{release=resolve;}):aplet.slice().buffer;};
 await c.startHp39Server('usb',[{file:browserFile('LIB.no-extension-needed',library)},{file:bad}],{protocol:'wire'});
 assert.equal(c.state.transfer.name,'BROKEN.unknown');assert(c.state.uploadBatch.recoverable);
 assert.match(c.state.transfer.error,/Local read failed/);assert(!sent.some(e=>e.type==='file-transfer-start'));
 if(recovery==='skip')c.skipUploadFile();
 else{
   const retry=c.retryUploadFile();
   if(recovery==='cancel-retry'){c.cancelTransfer();release(aplet.slice().buffer);await retry;
     assert.equal(c.uploadQueue,null);assert(!sent.some(e=>e.type==='file-transfer-start'));c.dispose();continue;}
   await retry;
 }
 assert.equal(sent.filter(e=>e.type==='file-transfer-start').at(-1).name,'LIB.no-extension-needed');
 c.receive({type:'file-transfer-status',generation:c.generation,request:c.transferRequest,active:false,phase:'complete'});
 if(recovery==='retry')assert.equal(sent.filter(e=>e.type==='file-transfer-start').at(-1).name,'BROKEN.unknown');
 else assert.equal(c.uploadQueue,null);
 c.dispose();
}
{
 const {c,sent}=controller();
 await c.startHp39Server('usb',[{file:browserFile('BROKEN.000',text('not hp39'))},{file:browserFile('LIB.custom',library)}],{protocol:'wire'});
 assert(c.state.uploadBatch.recoverable);assert.match(c.state.transfer.error,/typed file/);
 await c.retryUploadFile();assert(c.state.uploadBatch.recoverable);assert(!sent.some(e=>e.type==='file-transfer-start'));
 c.skipUploadFile();assert.equal(sent.filter(e=>e.type==='file-transfer-start').at(-1).name,'LIB.custom');c.dispose();
}
{
 const {c,sent}=controller();let release;const slow=browserFile('TEST.000',program);slow.arrayBuffer=()=>new Promise(r=>release=r);
 const wait=c.startHp39Server('usb',[{file:slow}]);c.cancelTransfer();release(program.slice().buffer);await wait;assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
{
 const {c,sent}=controller();const unsubscribe=c.subscribe(()=>{if(c.state.transfer?.phase==='preparing')c.cancelTransfer();});
 await c.startHp39Server('usb',[]);assert(!sent.some(m=>m.type==='file-transfer-start'));unsubscribe();c.dispose();
}
// The browser keeps earlier downloads when a new host session starts. Its
// remaining capacity reaches both protocol families before any EOF is ACKed.
for(const model of [1,4]){
 const {c,sent}=controller();c.patch({model:{id:model},running:true});
 await c.startTransfer('receive','usb');let request=c.transferRequest;
 for(let i=0;i<15;i++)c.receive({type:'file-transfer-received',generation:c.generation,request,name:`OLD${i}.000`,bytes:program});
 c.receive({type:'file-transfer-status',generation:c.generation,request,active:false,phase:'complete'});
 await c.startTransfer('receive','usb');const start=sent.at(-1);request=start.request;
 assert.deepEqual(start.receiveBudget,{files:1,bytes:MAX_RECEIVE_BYTES-15*program.length});
 const incoming=[],wire=[];
 const usb={endpoint:()=>({maxPacket:64}),send:b=>{wire.push(...new PacketReader().feed(b));return {result:0,accepted:b.length};},
  read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1}};
 const transfer=new FileTransfer({core:{timebase_hz:()=>1000},usb,model,notify:e=>c.receive({generation:c.generation,...e})});
 transfer.start(start,0);let tick=0;
 for(const [sequence,type,data] of [[0,'S',PARAMETERS],[1,'F',text('A.000')],[2,'D',encodeData(program).data],[3,'Z'],[4,'F',text('B.000')],[5,'D',encodeData(program).data],[6,'Z']]){
  incoming.push(packet(sequence,type,data));transfer.poll(++tick);transfer.poll(++tick);
 }
 assert.equal(transfer.session.phase,'error');assert(!wire.some(p=>p.type==='Y'&&p.sequence===6));
 assert.equal(c.state.transfer.phase,'error');assert.equal(c.received.size,15,'Keep old files and publish no partial new transaction');c.dispose();
}
console.log('HP39 disk server: catalogs, aliases, bidirectional typed files, fragmented/backpressured Kermit, limits, missing files, FINISH and controller cancellation pass');
