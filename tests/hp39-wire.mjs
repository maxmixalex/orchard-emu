// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {Hp39WireSender,hp39WireCrc,hp39WireBlock,validateHp39WireFile} from '../web/hp39-wire.js';
import {FileTransfer} from '../web/file-transfer.js';
const text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
assert.equal(hp39WireCrc(text('123456789')),0x2189,'CRC-16/KERMIT independent check value');
assert.equal(hp39WireCrc(text('123456789'),false),0x31c3,'CRC-16/XMODEM independent check value');
assert.deepEqual(hp39WireBlock(255,new Uint8Array(128),68),Uint8Array.from([1,255,0,...new Uint8Array(128),0,0]));
assert.equal(hp39WireBlock(1,new Uint8Array(128).fill(1),21).at(-1),128);
for(const bad of [text('HP39AscD 1 Pabc'),text('HP39BinI\x00abc'),text('HPHP49-Cabc')])assert.throws(()=>validateHp39WireFile('A.000',bad));
function payload(size){const p=Uint8Array.from({length:size},(_,i)=>(i*73)&255);p.set(text('HP39BinB\x01A'));return p;}

function transfer(size,check,{dropAck=false,rejectBlock=false}={}){
  const original=payload(size),received=[],states=[],fragments=[],controls=[];
  let now=0,calls=0,expected=1,dropped=false,rejected=false,frame=[];
  const s=new Hp39WireSender({hz:1000,notify:x=>states.push(x),write:bytes=>{
    if(++calls%7===0)return 0;const n=Math.min(7,bytes.length);fragments.push(bytes.slice(0,n));return n;
  }});
  s.start({name:'APLET.000',bytes:original},now);assert.equal(s.phase,'negotiating');assert.equal(fragments.length,0);
  s.receive(Uint8Array.of(check),++now);
  for(;now<200000&&s.active;now++){
    s.poll(now);
    for(const part of fragments.splice(0)){
      frame.push(...part);
      if(frame[0]===4){
        assert.equal(frame.length,1);assert.equal(s.transferred,size);assert(s.active,'All bytes sent is not final EOT acknowledgement');
        frame=[];controls.push(6);continue;
      }
      assert([1,2].includes(frame[0]));const blockSize=frame[0]===1?128:1024,full=blockSize+(check===21?4:5);
      if(frame.length<full)continue;
      assert.equal(frame.length,full);assert.equal(frame[1]+frame[2],255);
      const sequence=frame[1],data=frame.slice(3,3+blockSize);frame=[];
      if(rejectBlock&&!rejected){rejected=true;controls.push(21);continue;}
      if(sequence===expected){received.push(...data);expected=(expected+1)&255;}
      else assert.equal(sequence,(expected+255)&255,'Only the preceding block can be retried');
      if(dropAck&&!dropped){dropped=true;continue;}
      controls.push(6);
    }
    if(controls.length)s.receive(Uint8Array.from(controls.splice(0)),now);
  }
  assert.equal(s.phase,'complete',JSON.stringify(states.at(-1)));assert.equal(s.pending,false);
  assert.deepEqual(Uint8Array.from(received.slice(0,size)),original);
  assert(received.slice(size).every(byte=>byte===0),'Padding never changes object bytes');
  assert.equal(states.filter(x=>x.phase==='complete').length,1);
  if(dropAck)assert(dropped&&now>10000);if(rejectBlock)assert(rejected);
}
for(const check of [21,67,68])for(const size of [11,127,128,129,1023,1024,1025,7373])transfer(size,check);
transfer(32769,21); // sequence wraps at 256
transfer(2200,68,{dropAck:true,rejectBlock:true});
{
  const s=new Hp39WireSender({hz:1000,write:b=>b.length});s.start({name:'A',bytes:payload(11)},0);
  s.poll(119999);assert(s.active);s.poll(120000);assert.equal(s.phase,'error');assert.equal(s.pending,false);
  s.start({name:'A',bytes:payload(11)},0);s.receive(Uint8Array.of(68),1);s.poll(1);
  for(let t=10001;t<120000&&s.active;t+=10000){s.poll(t);s.poll(t);}
  assert.equal(s.phase,'error');assert.equal(s.pending,false);
  s.start({name:'A',bytes:payload(11)},0);s.receive(Uint8Array.of(24),1);assert.equal(s.phase,'error');
  s.start({name:'A',bytes:payload(11)},0);s.cancel();assert.equal(s.phase,'cancelled');assert.equal(s.pending,false);
}
// The native handshake belongs to Wire, not the Kermit first-packet gate.
{
  const incoming=[],sent=[],events=[],usb={endpoint:()=>({maxPacket:64}),read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1},
    send:b=>{sent.push(b.slice());return{result:0,accepted:b.length};}};
  const f=new FileTransfer({core:{timebase_hz:()=>1000},usb,model:1,notify:e=>events.push(e)});
  f.start({request:1,mode:'send',transport:'usb',protocol:'hp39-wire',name:'A',bytes:payload(11)},0);
  f.poll(31000);assert(f.active,'User has two guest minutes to choose the native menu');assert.equal(sent.length,0);
  incoming.push(Uint8Array.of(68));f.poll(31001);assert.equal(sent.length,0,'Guest must see the IN completion first');
  f.poll(31002);assert.equal(sent[0][0],1);assert.equal(sent[0][1],1);
  f.cancel(31003);assert.equal(f.pending,false);assert.equal(events.at(-1).phase,'cancelled');
  assert.throws(()=>f.start({request:2,mode:'receive',transport:'usb',protocol:'hp39-wire'},32000));
}
console.log('HP39 Wire: independent CRC check values; D/C/NAK, 128/1024-byte blocks, exact payload/padding, fragmented/backpressured writes, sequence wrap, rejected block/lost ACK recovery, EOT completion, bounded waits and cancellation pass.');
