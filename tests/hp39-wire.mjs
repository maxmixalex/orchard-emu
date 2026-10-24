// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {Hp39WireSender,hp39WireCrc,hp39WireBlock,validateHp39WireFile,prepareHp39WireFile} from '../web/hp39-wire.js';
import {FileTransfer} from '../web/file-transfer.js';
const text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
assert.equal(hp39WireCrc(text('123456789')),0x2189,'CRC-16/KERMIT independent check value');
assert.equal(hp39WireCrc(text('123456789'),false),0x31c3,'CRC-16/XMODEM independent check value');
assert.deepEqual(hp39WireBlock(255,new Uint8Array(128),68),Uint8Array.from([1,255,0,...new Uint8Array(128),0,0]));
assert.equal(hp39WireBlock(1,new Uint8Array(128).fill(1),21).at(-1),128);
for(const bad of [text('HP39AscD 1 Pabc'),text('HP39BinI\x00abc'),text('HPHP49-Cabc')])assert.throws(()=>validateHp39WireFile('A.000',bad));
function payload(size){const p=Uint8Array.from({length:size},(_,i)=>(i*73)&255);p.set(text('HP39BinB\x01A'));return p;}

// Independently witnessed by stock 39gs Wire install -> EDIT -> Disk SEND.
// The complete wire string, rather than an encoding helper, fixes both nibble
// order and the self-inclusive Saturn size field in this regression vector.
{
  const source=text('HP39AscC 11 Wire Binary\nWire note test.\nSecond line: 0123456789.\n'),before=source.slice();
  const expected=Uint8Array.from(Buffer.from('4850333942696e430b576972652042696e6172792c2a70050057697265206e6f746520746573742e0a5365636f6e64206c696e653a20303132333435363738392e0a','hex'));
  const prepared=prepareHp39WireFile('NOTE.unknown',source);
  assert.deepEqual(prepared.bytes,expected);assert.deepEqual(source,before,'Source file must remain unchanged');
  assert.equal(prepared.noteConverted,true);assert.equal(prepared.sourceBytes,source.length);
  const exported=text('HP39AscC 11 Wire BinaryWire note test.\r\nSecond line: 0123456789.\r\n');
  assert.deepEqual(prepareHp39WireFile('NOTE',exported).bytes,expected,'Stock export has no title newline');
  assert.deepEqual(prepareHp39WireFile('NOTE',text('HP39AscC 11 Wire Binary\r\nWire note test.\r\nSecond line: 0123456789.\r\n')).bytes,expected);
  const pass=prepareHp39WireFile('NOTE',expected);assert.equal(pass.bytes,expected);assert.equal(pass.noteConverted,false);
  const states=[],sender=new Hp39WireSender({hz:1000,write:b=>b.length,notify:s=>states.push(s)});
  sender.start({name:'NOTE',bytes:source},0);
  assert.deepEqual(sender.bytes,expected);assert.equal(sender.total,expected.length);
  assert.equal(states[0].objectKind,'C');assert.equal(states[0].noteConverted,true);
}
// Preserve calculator charset bytes, backslashes, trailing blanks and the
// empty string. Conversion never interprets Note text as a program or UTF-8.
{
  const body=text('A\xe9\x80\xff\\123\rB\n \t');
  const prepared=prepareHp39WireFile('NOTE',text('HP39AscC 1 \xe9A\xe9\x80\xff\\\\123\rB\n \t'));
  assert.equal(prepared.bytes[9],0xe9);assert.deepEqual(prepared.bytes.subarray(15),body);
  assert.deepEqual(prepareHp39WireFile('NOTE',text('HP39AscC 0 \n')).bytes,text('HP39BinC\0\x2c\x2a\x50\0\0'));
  const prefix=text('HP39AscC 0 '),max=new Uint8Array(prefix.length+524285);max.set(prefix);max.fill(65,prefix.length);
  const packed=prepareHp39WireFile('NOTE',max).bytes;
  assert.deepEqual(packed.subarray(9,14),Uint8Array.of(0x2c,0x2a,0xf0,0xff,0xff));
  const oversized=new Uint8Array(max.length+1);oversized.set(max);oversized[oversized.length-1]=65;
  assert.throws(()=>prepareHp39WireFile('NOTE',oversized),error=>error.errorCode==='hp39NoteSize');
}
// Stock 39gs Disk import's stored string was independently read from a private
// unmodified-guest checkpoint. Leading whitespace is skipped, CRLF alone is
// collapsed, valid translations decode once, and unknown escapes stay literal.
{
  const input=text('HP39AscC 8 Esc Note \t\r\n\nA\\000|\\010|\\013|\\032|\\065|\\128|\\159|\\255|\\256|\\999|\\12|\\foo|\\Ga|\\->|\\\\END\n\rTAIL');
  const expected=text('A\0|\n|\r| |A|\x80|\x9f|\xff|\\256|\\999|\\12|\\foo|\x8c|\x8d|\\END\n\rTAIL');
  assert.deepEqual(prepareHp39WireFile('NOTE',input).bytes.subarray(22),expected);
  assert.deepEqual(prepareHp39WireFile('NOTE',text('HP39AscC 1 N\n\\032\\010A\r\nB\n\rC')).bytes.subarray(15),text(' \nA\nB\n\rC'));
}

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
  s.start({name:'A',bytes:payload(11)},0);s.receive(Uint8Array.of(68,24),1);assert.equal(s.phase,'error');
  s.start({name:'A',bytes:payload(11)},0);s.cancel();assert.equal(s.phase,'cancelled');assert.equal(s.pending,false);
}
// Original-ROM ON cancellation emits a tail of CAN bytes. A new attempt must
// wait for its own handshake rather than fail immediately on the old tail;
// fresh D/C/NAK is preserved even when it shares a packet with that tail.
for(const check of [21,67,68]){
  const sent=[],s=new Hp39WireSender({hz:1000,write:b=>{sent.push(b.slice());return b.length;}});
  s.start({name:'A',bytes:payload(11)},0);s.receive(Uint8Array.of(check),1);s.poll(1);
  s.receive(Uint8Array.of(24,24),2);assert.equal(s.phase,'error');assert.equal(sent.length,1);
  s.start({name:'A',bytes:payload(11)},3);
  for(let t=4;t<20;t++){s.receive(Uint8Array.of(24,6,4,24),t);s.poll(t);}
  assert.equal(s.phase,'negotiating');assert.equal(sent.length,1);assert.equal(s.deadline,120003);
  s.receive(Uint8Array.of(24,6,24,check),20);assert.equal(s.phase,'sending');s.poll(20);
  assert.equal(sent.length,2);assert.equal(sent[1][1],1,'A retry starts its first object block');
  s.receive(Uint8Array.of(6),21);s.poll(21);assert.deepEqual(sent.at(-1),Uint8Array.of(4));
  s.receive(Uint8Array.of(6),22);assert.equal(s.phase,'complete');assert.equal(s.transferred,11);
  s.start({name:'A',bytes:payload(11)},30);s.receive(Uint8Array.of(24,check,24),31);
  assert.equal(s.phase,'error','CAN after the current handshake is still an immediate remote cancellation');
}
{
  const s=new Hp39WireSender({hz:1000,write:b=>b.length});s.start({name:'A',bytes:payload(11)},0);
  for(let t=1;t<120000;t+=1000){s.receive(Uint8Array.of(24,6,4),t);s.poll(t);}
  s.poll(120000);assert.equal(s.phase,'error');assert.equal(s.pending,false,'Stale control traffic cannot extend the initial budget');
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
  f.start({request:2,mode:'receive',transport:'usb',protocol:'hp39-wire'},32000);assert.equal(f.session.phase,'listening');f.cancel(32001);
}
// Exercise the same recovery through the real adapter with CANs remaining in
// separate USB IN packets. No blanket drain may discard the following D.
{
  const incoming=[],sent=[],usb={endpoint:()=>({maxPacket:64}),read:()=>incoming.length?{result:0,bytes:incoming.shift()}:{result:1},
    send:b=>{sent.push(b.slice());return{result:0,accepted:b.length};}};
  const f=new FileTransfer({core:{timebase_hz:()=>1000},usb,model:1,notify:()=>{}});
  const start=request=>f.start({request,mode:'send',transport:'usb',protocol:'hp39-wire',name:'A',bytes:payload(11)},request*100);
  start(1);incoming.push(Uint8Array.of(68));f.poll(101);f.poll(102);
  incoming.push(Uint8Array.of(24),Uint8Array.of(24,24),Uint8Array.of(6,24,68));f.poll(103);
  assert.equal(f.session.phase,'error');const before=sent.length;start(2);f.poll(201);
  assert.equal(f.session.phase,'negotiating');assert.equal(sent.length,before);
  f.poll(202);assert.equal(f.session.phase,'sending');f.poll(203);
  assert.equal(sent.length,before+1);assert.equal(sent.at(-1)[1],1);f.cancel(204);
}
console.log('HP39 Wire: independent CRC check values; D/C/NAK, 128/1024-byte blocks, exact payload/padding, fragmented/backpressured writes, sequence wrap, rejected block/lost ACK recovery, EOT completion, bounded waits and cancellation pass.');
