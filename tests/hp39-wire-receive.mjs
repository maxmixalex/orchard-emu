// SPDX-License-Identifier: MIT
// Self-authored typed objects. The original-ROM witness is separate.
import assert from 'node:assert/strict';
import {Hp39WireReceiver,inspectHp39WireObject} from '../web/hp39-wire-receive.js';
import {hp39WireBlock,hp39WireCrc} from '../web/hp39-wire.js';
import {FileTransfer,canReceiveHp39Wire} from '../web/file-transfer.js';
import {MAX_RECEIVE_FILES,MAX_RECEIVE_BYTES,MAX_FILE_BYTES} from '../web/kermit.js';

const word=(value,count=5)=>Array.from({length:count},(_,i)=>Math.floor(value/16**i)&15);
const text=value=>Array.from(value,c=>c.charCodeAt(0));
const bytesToNibbles=bytes=>bytes.flatMap(byte=>word(byte,2));
function typed(kind,title,body){
  const nibbles=[...bytesToNibbles([...text('HP39Bin'+kind),title.length,...text(title)]),...body];
  return Uint8Array.from({length:Math.ceil(nibbles.length/2)},(_,i)=>nibbles[2*i]|(nibbles[2*i+1]??0)<<4);
}
const string=bytes=>[...word(0x02a2c),...word(5+2*bytes.length),...bytesToNibbles(bytes)];
const list=body=>[...word(0x02a74),...body,...word(0x0312b)];
const note=(title,body)=>typed('C',title,string(Array.from(body)));
function library(id){
  const title='Library',inner=[...word(title.length,2),...bytesToNibbles(text(title)),...word(title.length,2),...word(id,3)];
  return typed('H','LIB'+id,[...word(0x02b40),...word(5+inner.length),...inner]);
}
function aplet(title,first=list([...word(0x12345),...string([0,255,0])]),second=string([0,1,2,0])){
  const a=[0,0,...first],b=[0,0,...second],last=18+a.length+5;
  return typed('B',title,[...word(0x02a96),...word(0x7ff,3),...word(last-8),...word(0),...a,...word(a.length),...b]);
}
function index(title,libraries){
  return typed('I','',list([...word(0x10cd1),...word(0x02e48),...word(title.length,2),...bytesToNibbles(text(title)),...libraries.flatMap(id=>[...word(0x02911),...word(id)])]));
}
const response=ids=>typed('I','',list(ids.flatMap(id=>[...word(0x02911),...word(id)])));
const pad=(bytes,size=128)=>{const out=new Uint8Array(Math.ceil(bytes.length/size)*size).fill(0xa5);out.set(bytes);return out;};

for(const original of [note('N',[255,0,127,0]),typed('D','P',string([65,0])),aplet('Test'),library(275),index('Test',[275])]){
  assert.deepEqual(inspectHp39WireObject(pad(original)).bytes,original,'Nonzero final padding must not enter the host file');
  assert.deepEqual(inspectHp39WireObject(original,{paddingLimit:0}).bytes,original);
  assert.throws(()=>inspectHp39WireObject(pad(original,1024),{paddingLimit:127}));
  for(let n=0;n<original.length;n++)assert.throws(()=>inspectHp39WireObject(original.subarray(0,n),{paddingLimit:0}),'Truncated object must fail');
}
{
  const odd=typed('I','',list(word(0x12345)));odd[odd.length-1]|=0xf0;
  const result=inspectHp39WireObject(pad(odd));assert.equal(result.bytes.at(-1)&0xf0,0,'Unused high nibble has no object data');
  assert.throws(()=>inspectHp39WireObject(typed('C','N',word(0x12345))));
  assert.throws(()=>inspectHp39WireObject(typed('C','N',[...word(0x02a2c),...word(6),0])),'Odd byte-string payload');
  assert.throws(()=>inspectHp39WireObject(typed('B','B',[...word(0x02a96),...word(0x7ff,3),...word(5),...word(0)])),'Back-link enters header');
  assert.throws(()=>inspectHp39WireObject(typed('B','B',[...word(0x02a96),...word(0x7ff,3),...word(0xfffff),...word(0)])),'Back-link extends beyond input');
  const nested=typed('I','',[...Array.from({length:34},()=>word(0x02a74)).flat(),...Array.from({length:34},()=>word(0x0312b)).flat()]);
  assert.throws(()=>inspectHp39WireObject(nested),'Depth is bounded');
  assert.throws(()=>inspectHp39WireObject(new Uint8Array(MAX_FILE_BYTES+1025)));
}
function fixture(options={}){
  const output=[],files=[],statuses=[];let tick=0,calls=0;
  const s=new Hp39WireReceiver({hz:1000,receiveId:7,...options,notify:e=>statuses.push(e),file:f=>files.push(f),write:bytes=>{
    if(++calls%7===0)return 0;const n=Math.min(bytes.length,13);output.push(...bytes.subarray(0,n));return n;
  }});
  const receive=bytes=>s.receive(bytes,++tick);
  const drain=()=>{for(let i=0;s.queue.length&&i<20000;i++)s.poll(++tick);assert.equal(s.queue.length,0);return Uint8Array.from(output.splice(0));};
  const block=(bytes,sequence=1,size=128)=>{
    const data=new Uint8Array(size).fill(0xa5);data.set(bytes);
    const frame=hp39WireBlock(sequence,data);for(let at=0;at<frame.length;at+=17)receive(frame.subarray(at,at+17));return frame;
  };
  const send=(bytes,{size=128,end=true}={})=>{
    for(let at=0,sequence=1;at<bytes.length;at+=size,sequence=(sequence+1)&255){block(bytes.subarray(at,at+size),sequence,size);assert.deepEqual(drain(),Uint8Array.of(6));}
    if(end)receive(Uint8Array.of(4));
  };
  s.start({},tick);assert.deepEqual(drain(),Uint8Array.of(68));
  return {s,files,statuses,receive,drain,block,send,get tick(){return tick;},advance(n){tick+=n;s.poll(tick);}};
}
{
  const f=fixture(),one=note('First',[65,0,255,0]),two=aplet('Second');
  f.send(one);assert.equal(f.files.length,1);assert.equal(f.s.phase,'listening');assert(f.s.active);
  assert.deepEqual(f.files[0].bytes,one);assert.deepEqual(f.drain(),Uint8Array.of(6,68));
  f.receive(Uint8Array.of(4));assert.deepEqual(f.drain(),Uint8Array.of(6),'Lost final ACK does not publish the object twice');
  f.send(two);assert.equal(f.files.length,2);assert.deepEqual(f.files[1].bytes,two);f.drain();
  assert.equal(f.files[0].name,'First-7-1.note');assert.equal(f.files[1].name,'Second-7-2.apt');
  f.send(one);f.drain();assert.equal(f.files.length,3);assert.equal(f.files[2].name,'First-7-3.note');
  f.s.cancel();assert.equal(f.s.phase,'cancelled');assert.equal(f.s.pending,false);assert.equal(f.files.length,3);
}
{
  const f=fixture(),one=note('One',Array.from({length:34000},(_,i)=>i&255));f.send(one);f.drain();
  assert.deepEqual(f.files[0].bytes,one,'Sequence wraps at 256');f.s.cancel();
}
{
  const f=fixture(),one=note('One',Array.from({length:2500},(_,i)=>i&255));f.send(one,{size:1024});f.drain();
  assert.deepEqual(f.files[0].bytes,one,'1024-byte blocks preserve all original bytes');f.s.cancel();
}
{
  const f=fixture(),bytes=note('Again',[1,2,0]),frame=f.block(bytes);assert.deepEqual(f.drain(),Uint8Array.of(6));
  f.receive(frame);assert.deepEqual(f.drain(),Uint8Array.of(6));assert.equal(f.s.transferred,128,'Repeated block acknowledged without duplicating bytes');
  f.receive(Uint8Array.of(4));f.drain();assert.deepEqual(f.files[0].bytes,bytes);
  const broken=frame.slice();broken[10]^=1;f.receive(broken);assert.deepEqual(f.drain(),Uint8Array.of(21));assert.equal(f.s.transferred,0);
  f.receive(frame);assert.deepEqual(f.drain(),Uint8Array.of(6));f.receive(Uint8Array.of(4));f.drain();assert.equal(f.files.length,2);
  f.receive(frame.subarray(0,7));f.advance(10001);assert.deepEqual(f.drain(),Uint8Array.of(21),'Partial first frame is retried with NAK');
  for(let i=0;i<10&&f.s.active;i++){f.advance(10001);f.drain();}
  assert.equal(f.s.phase,'error');assert.equal(f.statuses.at(-1).errorCode,'wireReceiveTimeout');assert.equal(f.files.length,2);
}
// The stock multipart peer reverses sender/receiver after its I index and
// after each requested library. Both nonempty and empty responses are real
// XMODEM objects, including final EOT acknowledgement.
for(const check of [21,67,68]){
  const f=fixture(),main=aplet('Dependent');f.send(index('Dependent',[7,9]));assert.equal(f.files.length,0);
  assert.equal(f.s.stage,'reply-wait');assert.deepEqual(f.drain(),Uint8Array.of(6));
  for(const ids of [[7,9],[9],[]]){
    f.receive(Uint8Array.of(4));assert.deepEqual(f.drain(),Uint8Array.of(6),'Lost index/library EOT ACK');
    f.receive(Uint8Array.of(check));const first=f.drain();assert.equal(first[0],1);assert.equal(first[1],1);
    const data=first.subarray(3,131);assert.deepEqual(inspectHp39WireObject(data,{paddingLimit:127}).bytes,response(ids));
    if(check===21)assert.equal(first.at(-1),data.reduce((sum,n)=>(sum+n)&255,0));
    else assert.equal((first.at(-2)<<8)|first.at(-1),hp39WireCrc(data,check===68));
    f.receive(Uint8Array.of(21));assert.deepEqual(f.drain(),first,'Requested dependency reply can be retransmitted');
    f.receive(Uint8Array.of(6));assert.deepEqual(f.drain(),Uint8Array.of(4));
    f.advance(10001);assert.deepEqual(f.drain(),Uint8Array.of(4),'Lost reply EOT ACK retried');
    f.receive(Uint8Array.of(6));assert.deepEqual(f.drain(),Uint8Array.of(68));
    if(ids.length){f.send(library(ids[0]));assert.deepEqual(f.drain(),Uint8Array.of(6));}
  }
  f.send(main);assert.deepEqual(f.drain(),Uint8Array.of(6,68));assert.equal(f.files.length,3);
  assert.deepEqual(f.files.map(f=>f.bytes),[library(7),library(9),main]);f.s.cancel();
}
{
  const f=fixture();f.send(note('Keep',[1]));f.drain();
  f.send(index('Unexpected',[7]));f.drain();f.receive(Uint8Array.of(24));
  assert.equal(f.s.phase,'error');assert.equal(f.files.length,1,'Remote cancellation keeps completed files');
}
{
  const f=fixture();f.receive(Uint8Array.of(24,24));assert(f.s.active,'Old cancellation tail is ignored before an object starts');
  f.send(note('Keep',[1]));f.drain();f.send(new Uint8Array(16).fill(65));
  assert.equal(f.s.phase,'error');assert.equal(f.files.length,1,'Malformed next object cannot erase prior file');
}
{
  const f=fixture();f.advance(900001);assert.equal(f.s.phase,'error');assert.equal(f.statuses.at(-1).errorCode,'wireReceiveDuration');assert.equal(f.s.pending,false);
}
// A full receive budget closes the listener, but a lost final ACK must still
// recover. The fixed two host retry intervals are a protocol policy, not a
// measured calculator timeout. Retries never publish a second file or extend
// USB ownership indefinitely.
for(const boundary of ['files','bytes']){
  const original=note('Last',[1]),f=fixture({receiveBudget:{files:boundary==='files'?1:MAX_RECEIVE_FILES,bytes:boundary==='bytes'?original.length:MAX_RECEIVE_BYTES}});
  f.send(original);assert.equal(f.s.phase,'complete');assert.equal(f.s.active,false);assert(f.s.pending,'Final ACK still drains');
  const until=f.s.lingerUntil,statuses=f.statuses.length;
  assert.equal(until,f.tick+20000);assert.deepEqual(f.drain(),Uint8Array.of(6));assert(f.s.pending);
  f.advance(10000);f.receive(Uint8Array.of(4));assert.deepEqual(f.drain(),Uint8Array.of(6),'Lost final ACK is retried at capacity');
  assert.equal(f.s.lingerUntil,until);assert.equal(f.files.length,1);assert.equal(f.statuses.length,statuses);
  assert.equal(f.s.active,false);assert.equal(f.s.phase,'complete');
  f.advance(until-f.tick);assert.equal(f.s.pending,false);assert.equal(f.s.lingerUntil,0);
  f.receive(Uint8Array.of(4));assert.deepEqual(f.drain(),new Uint8Array(),'Expired final ACK is not retried');
}
{
  const original=note('Blocked',[1]),f=fixture({receiveBudget:{files:1,bytes:MAX_RECEIVE_BYTES}});
  f.send(original);f.s.write=()=>0;const until=f.s.lingerUntil;
  f.advance(10000);f.receive(Uint8Array.of(4));assert.equal(f.s.queue.length,1,'Unsent final ACK retries are deduplicated');
  f.advance(until-f.tick);assert.equal(f.s.pending,false);assert.equal(f.s.queue.length,0,'Permanent backpressure cannot retain terminal ownership');
  assert.equal(f.s.phase,'complete');assert.equal(f.files.length,1);
}
for(const next of [1,2,21,24,67,68]){
  const f=fixture({receiveBudget:{files:1,bytes:MAX_RECEIVE_BYTES}});f.send(note('Full',[1]));f.drain();
  f.receive(Uint8Array.of(next,4,4));assert.equal(f.s.pending,false);
  f.receive(Uint8Array.of(4));assert.deepEqual(f.drain(),new Uint8Array(),'New traffic cannot make payload 0x04 acknowledge an unretained object');
  assert.equal(f.files.length,1);assert.equal(f.s.phase,'complete');
}
for(const ending of ['cancel','fail','restart']){
  const f=fixture({receiveBudget:{files:1,bytes:MAX_RECEIVE_BYTES}});f.send(note('Keep',[1]));
  if(ending==='restart'){f.s.start({},f.tick);assert.deepEqual(f.drain(),Uint8Array.of(68));}
  else f.s[ending]();
  assert.equal(f.s.lingerUntil,0);f.receive(Uint8Array.of(4));assert.deepEqual(f.drain(),new Uint8Array());
  assert.equal(f.files.length,1);assert.equal(f.s.pending,ending==='restart');
}
{
  const original=note('Big',[1]),f=fixture({receiveBudget:{files:2,bytes:original.length-1}});
  f.send(original);assert.equal(f.files.length,0);assert.equal(f.s.phase,'error');assert.deepEqual(f.drain(),new Uint8Array(),'Oversize object never receives successful EOT ACK');
}
{
  const f=fixture({receiveBudget:{files:2,bytes:100000}});f.send(index('TooMany',[1,2]));
  assert.equal(f.s.phase,'error');assert.equal(f.statuses.at(-1).errorCode,'receiveCapacity');assert.equal(f.files.length,0);
}
for(const receiveBudget of [{files:MAX_RECEIVE_FILES+1,bytes:MAX_RECEIVE_BYTES},{files:1,bytes:MAX_RECEIVE_BYTES+1}])assert.throws(()=>fixture({receiveBudget}));
assert.throws(()=>fixture({receiveBudget:{files:0,bytes:100}}));
assert.throws(()=>fixture({receiveId:0}));

// Production adapter owns USB stream and defers replies until the next guest
// slice. Unsupported models/connections do not silently select the Disk server.
for(const model of [1,2]){
  const incoming=[],written=[],events=[],usb={endpoint:()=>({maxPacket:64}),read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1},send:bytes=>{written.push(...bytes);return {result:0,accepted:bytes.length};}};
  const f=new FileTransfer({core:{timebase_hz:()=>1000},usb,model,notify:e=>events.push(e)});
  f.start({request:12,mode:'receive',protocol:'hp39-wire',transport:'usb'},0);f.poll(1);assert.deepEqual(written.splice(0),[68]);
  const original=note('USB',[0,255,0]),frame=hp39WireBlock(1,pad(original));incoming.push(frame);f.poll(2);assert.equal(written.length,0);
  f.poll(3);assert.deepEqual(written.splice(0),[6]);incoming.push(Uint8Array.of(4));f.poll(4);assert.equal(written.length,0);
  assert.deepEqual(events.find(e=>e.type==='file-transfer-received').bytes,original);assert(f.active);f.poll(5);f.poll(6);assert.deepEqual(written,[6,68]);
  f.cancel(7);assert.equal(f.pending,false);
}
// Real FileTransfer polling, with USB-sized chunks and the normal dependent
// reply deferral. Closing ACKs survive NAK/backpressure while bounded by guest
// ticks. Stop, reconnect and a new request must not inherit old closing ACKs.
for(const model of [1,2])for(const boundary of ['files','bytes'])for(const ending of ['expiry','stop','reset','new-owner']){
  let tick=0,blocked=false;const incoming=[],written=[],events=[];
  const original=note('USB',[0,4,255]),receiveBudget={files:boundary==='files'?1:MAX_RECEIVE_FILES,bytes:boundary==='bytes'?original.length:MAX_RECEIVE_BYTES};
  const usb={endpoint:()=>({maxPacket:64}),read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1},
    send:bytes=>{if(blocked)return {result:1,accepted:0};written.push(...bytes);return {result:0,accepted:bytes.length};}};
  const f=new FileTransfer({core:{timebase_hz:()=>1000},usb,model,notify:e=>events.push(e)});
  f.start({request:12,mode:'receive',protocol:'hp39-wire',transport:'usb',receiveBudget},tick);
  f.poll(++tick);assert.deepEqual(written.splice(0),[68]);
  const frame=hp39WireBlock(1,pad(original));
  for(let at=0;at<frame.length;at+=64){incoming.push(frame.subarray(at,at+64));f.poll(++tick);assert.equal(written.length,0);}
  f.poll(++tick);assert.deepEqual(written.splice(0),[6]);
  incoming.push(Uint8Array.of(4));f.poll(++tick);assert.equal(written.length,0);
  const terminal=f.session,until=terminal.lingerUntil;
  assert.equal(f.active,false);assert(f.pending);assert.equal(events.at(-1).phase,'complete');
  blocked=true;f.poll(++tick);incoming.push(Uint8Array.of(4));f.poll(tick+=10001);
  assert.equal(terminal.lingerUntil,until);assert.equal(written.length,0);assert.equal(terminal.queue.length,1);
  blocked=false;f.poll(++tick);assert.deepEqual(written.splice(0),[6]);
  incoming.push(Uint8Array.of(4));f.poll(++tick);assert.equal(written.length,0,'Repeated EOT still defers the dependent USB ACK');
  if(ending==='expiry'){
    blocked=true;f.poll(++tick);f.poll(tick=until);assert.equal(f.pending,false);assert.equal(terminal.queue.length,0);
  }else if(ending==='stop'){f.cancel(++tick);assert.equal(f.pending,false);assert.equal(terminal.lingerUntil,0);}
  else if(ending==='reset'){f.resetUsb(++tick);assert.equal(f.pending,false);assert.equal(terminal.lingerUntil,0);}
  else{
    f.start({request:13,mode:'receive',protocol:'hp39-wire',transport:'usb',receiveBudget},++tick);
    assert.notEqual(f.session,terminal);assert.equal(f.session.lingerUntil,0);
    f.poll(++tick);assert.deepEqual(written.splice(0),[68],'New owner sends only its new handshake');
  }
  incoming.push(Uint8Array.of(4));f.poll(++tick);f.poll(++tick);assert.deepEqual(written,[],'Old final ACK cannot leak into the next owner');
  const files=events.filter(e=>e.type==='file-transfer-received');assert.equal(files.length,1);assert.deepEqual(files[0].bytes,original);
  if(ending==='new-owner')f.cancel(++tick);
}
for(const [model,transport] of [[1,'serial'],[2,'serial'],[3,'usb'],[4,'usb']]){
  assert.equal(canReceiveHp39Wire(model,transport),false);
  const f=new FileTransfer({core:{timebase_hz:()=>1000},usb:{endpoint:()=>({maxPacket:64})},model,notify:()=>{}});
  assert.throws(()=>f.start({request:1,mode:'receive',protocol:'hp39-wire',transport},0));assert.equal(f.active,false);
}
console.log('HP39 Wire receive: bounded exact Saturn object framing; nonzero padding; continuous files; multipart dependency negotiation; CRC/retries/partial writes; per-file preservation; adapter/mode ownership pass.');
