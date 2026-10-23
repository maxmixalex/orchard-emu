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
 assert(dropped&&now>5000);assert.equal(client.phase,'complete');assert.equal(server.phase,'serving');
 assert.equal(received.length,1);assert.deepEqual(received[0].bytes,program);
 const expiry=server.lingerUntil,count=ba.length;server.receive(packet(4,'B'),expiry);server.poll(expiry);
 assert.equal(ba.length,count);assert.equal(received.length,1);server.cancel();assert.equal(server.pending,false);
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
// Controller reads/validates every file before publishing the private catalog.
const browserFile=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
function controller(){const sent=[];const c=new CalculatorController({worker:{postMessage:x=>sent.push(x),terminate(){}}});c.patch({model:{id:1},ready:true,loaded:true,running:false,usbReady:true,serial:true});return {c,sent};}
for(const transport of ['usb','serial']){
 const {c,sent}=controller();if(transport==='serial')c.patch({model:{id:2}});await c.startHp39Server(transport,files.map(f=>({file:browserFile(f.name,f.bytes)})));
 assert.equal(sent.at(-1).mode,'serve');assert.equal(sent.at(-1).files.length,4);assert.equal(sent.at(-2).type,'run');c.dispose();
 const bad=controller();if(transport==='serial')bad.c.patch({model:{id:2}});await bad.c.startHp39Server(transport,[{file:browserFile('TEST.000',program)},{file:browserFile('BAD.000',text('not hp39'))}]);assert(!bad.sent.some(m=>m.type==='file-transfer-start'));assert.equal(bad.c.state.transfer.phase,'error');bad.c.dispose();
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
