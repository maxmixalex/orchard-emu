// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {IrDALink,irdaCode,newIrdaCode,IRDA_PROTOCOL} from '../web/irda-link.js';
import {IRDA_SPAN_TICKS,IRDA_WINDOW_PACKETS,IRDA_QUEUE_BYTES} from '../web/irda-input.js';
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
assert.match(newIrdaCode(),/^[A-Z2-9]{8}$/);assert.equal(irdaCode(' abc123 '),'ABC123');
for(const code of ['',null,'a','ab cde','abc123/','a'.repeat(13)])assert.throws(()=>irdaCode(code));
function harness(){
 const channels=new Map(),instances=[],messages=[];let clock=0;
 const channel=name=>{
  const c={name,onmessage:null,postMessage(data){messages.push(data);for(const other of channels.get(name)||[])if(other!==c)queueMicrotask(()=>other.onmessage?.({data:structuredClone(data)}));},close(){channels.get(name).delete(c);}};
  if(!channels.has(name))channels.set(name,new Set());channels.get(name).add(c);return c;
 };
 function make(id,receive=()=>0,code='TEST23'){
  const states=[];const link=new IrDALink({code,label:'HP '+id,id,channel,receive,notify:s=>states.push(s),now:()=>clock,interval:()=>1,clear(){}});instances.push(link);return {link,states};
 }
 return {make,messages,advance:n=>clock+=n,dispose:()=>instances.forEach(c=>c.close())};
}
{
 const h=harness(),rx=[],a=h.make('a'),b=h.make('b',bytes=>{rx.push(...bytes);return bytes.length;});
 await settle();assert.equal(a.link.phase,'paired');assert.equal(b.link.phase,'paired');
 assert(a.link.send(Uint8Array.of(1,2,3)));assert(a.link.send(Uint8Array.of(4,5)));await settle();
 assert.deepEqual(rx,[1,2,3,4,5]);assert.equal(a.link.sent,5);assert.equal(b.link.received,5);assert.equal(a.link.queued,0);
 a.link.message({version:IRDA_PROTOCOL,kind:'ack',from:'b'});assert(a.link.active,'An invalid ACK with an empty window is ignored');
 // A duplicate transport packet is acknowledged but never delivered twice.
 const packet=h.messages.find(m=>m.kind==='bytes');b.link.message(packet);await settle();assert.deepEqual(rx,[1,2,3,4,5]);
 // The old packet was not the most recent sequence, so strict order ends it.
 assert.equal(b.link.active,false);h.dispose();
}
{
 const h=harness(),rx=[],a=h.make('a'),b=h.make('b',bytes=>{rx.push(...bytes);return bytes.length;});await settle();
 a.link.send(Uint8Array.of(7));await settle();const packet=h.messages.find(m=>m.kind==='bytes');b.link.message(packet);await settle();assert.deepEqual(rx,[7]);
 const stranger={...packet,from:'unknown',sequence:2};b.link.message(stranger);assert.deepEqual(rx,[7]);
 const c=h.make('c');await settle();assert.equal(a.link.active,false);assert.equal(b.link.active,false);assert.notEqual(c.link.phase,'paired');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>new Promise(()=>{}));await settle();
 for(let i=0;i<16;i++)assert(a.link.send(new Uint8Array(1024)));
 assert.equal(a.link.pending.length,IRDA_WINDOW_PACKETS);assert.equal(a.link.queued,IRDA_QUEUE_BYTES);
 assert.equal(h.messages.filter(message=>message.kind==='bytes').length,IRDA_WINDOW_PACKETS,'The byte budget includes both in-flight and unsent packets');
 assert.equal(a.link.send(Uint8Array.of(1)),false);assert.equal(a.states.at(-1).error,'overflow');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>new Promise(()=>{}));await settle();
 a.link.send(Uint8Array.of(1));h.advance(5001);a.link.heartbeat();assert.equal(a.states.at(-1).error,'timeout');h.dispose();
}
{
 const h=harness(),rx=[],receivedTicks=[],accept=[],a=h.make('a'),b=h.make('b',(bytes,segments)=>new Promise(resolve=>{
  accept.push(()=>{rx.push(...bytes);for(const [count,tick] of segments)receivedTicks.push(...Array(count).fill(tick));resolve(bytes.length);});
 }));await settle();
 const expected=[99],expectedTicks=[10];a.link.send(Uint8Array.of(99),10);await settle();
 for(const size of [1,511,1024,17,509,1024,3,700,701,702]){
  const tick=1000+expected.length*100;
  const chunk=Uint8Array.from({length:size},(_,i)=>(expected.length+i)&255);
  expected.push(...chunk);expectedTicks.push(...Array(size).fill(tick));assert(a.link.send(chunk,tick));chunk.fill(0);
 }
 assert.equal(a.link.queued,expected.length,'No progress is acknowledged while delivery is pending');
 assert.equal(h.messages.filter(message=>message.kind==='bytes').length,IRDA_WINDOW_PACKETS);
 await settle();assert.equal(accept.length,IRDA_WINDOW_PACKETS,'The whole window reaches the receiver before the first ACK');
 let completed=0;
 while(a.link.queued){
  assert(accept.length>0&&accept.length<=IRDA_WINDOW_PACKETS);accept.shift()();await settle();completed++;
  if(completed===1){
   const remaining=a.link.queued;
   a.link.message({version:IRDA_PROTOCOL,kind:'ack',from:'b',sequence:1});
   assert.equal(a.link.queued,remaining,'An old ACK cannot release the coalesced packet');
  }
 }
 assert.deepEqual(rx,expected);assert.equal(a.link.sent,expected.length);assert.equal(b.link.received,expected.length);
 assert.deepEqual(receivedTicks,expectedTicks,'Coalescing and packet splits preserve each source clock stamp');
 const lengths=h.messages.filter(message=>message.kind==='bytes').map(message=>message.bytes.length);
 assert.deepEqual(lengths,[1,1,511,1024,17,509,1024,3,1024,1024,55]);assert.equal(a.link.queue.length,0);h.dispose();
}
{
 const h=harness(),a=h.make('a');let progress,finish;
 const b=h.make('b',(bytes,_segments,advance)=>new Promise(resolve=>{progress=advance;finish=()=>resolve(bytes.length);}));await settle();
 a.link.send(Uint8Array.of(1),400);await settle();h.advance(4000);progress();await settle();
 h.advance(4000);a.link.heartbeat();assert(a.link.active,'Real receiver progress extends the pending deadline');
 a.link.message({version:IRDA_PROTOCOL,kind:'progress',from:'b',sequence:999});
 h.advance(1001);a.link.heartbeat();assert.equal(a.states.at(-1).error,'timeout');await settle();
 const count=h.messages.length;progress();finish();await settle();
 assert.equal(h.messages.slice(count).some(message=>message.kind==='ack'||message.kind==='progress'),false,'Closed receive cannot extend or ACK a new connection');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>new Promise(()=>{}));await settle();
 a.link.send(Uint8Array.of(1),100);assert.equal(a.link.send(Uint8Array.of(2),101+IRDA_SPAN_TICKS),false);
 assert.equal(a.states.at(-1).error,'overflow','Queue time span is bounded as well as byte count');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',bytes=>bytes.length);await settle();
 a.link.send(Uint8Array.of(1),100);await settle();
 b.link.message({version:IRDA_PROTOCOL,kind:'bytes',from:'a',sequence:2,bytes:Uint8Array.of(2),segments:[[1,99]]});
 assert.equal(b.states.at(-1).error,'sequence','Peer timestamps cannot move backwards');h.dispose();
}
{
 const h=harness(),a=h.make('a');let finish;
 const b=h.make('b',bytes=>new Promise(resolve=>{finish=()=>resolve(bytes.length);}));await settle();
 a.link.send(Uint8Array.of(1));await settle();a.link.send(Uint8Array.of(2,3));a.link.close();await settle();
 assert.equal(a.link.queued,0);assert.equal(a.link.queue.length,0);assert.equal(b.link.active,false);
 const rx=[],nextA=h.make('next-a'),nextB=h.make('next-b',bytes=>{rx.push(...bytes);return bytes.length;});await settle();
 finish();await settle();assert.deepEqual(rx,[],'Old asynchronous completion cannot replay into a re-paired channel');
 assert.equal(h.messages.filter(message=>message.kind==='ack'&&message.from==='b').length,0);
 nextA.link.send(Uint8Array.of(8,9));await settle();assert.deepEqual(rx,[8,9]);assert(nextB.link.active);h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>0);await settle();
 a.link.send(Uint8Array.of(1,2));await settle();assert.equal(a.link.sent,2);assert.equal(b.link.received,0,'Inactive IR receiver discards, not delayed re-injection');
 b.link.close();await settle();assert.equal(a.states.at(-1).error,'gone');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>1,'OTHER1');await settle();assert.equal(a.link.phase,'waiting');assert.equal(b.link.phase,'waiting');h.dispose();
}
{
 const h=harness(),a=h.make('a'),received=[],finish=[];
 const b=h.make('b',bytes=>new Promise(resolve=>{received.push(...bytes);finish.push(()=>resolve(bytes.length));}));await settle();
 for(let value=1;value<=IRDA_WINDOW_PACKETS;value++)a.link.send(Uint8Array.of(value),value*1024);
 await settle();assert.equal(finish.length,IRDA_WINDOW_PACKETS);
 const packets=h.messages.filter(message=>message.kind==='bytes');
 b.link.message(packets[0]);b.link.message(packets.at(-1));await settle();
 assert.equal(finish.length,IRDA_WINDOW_PACKETS,'Duplicate in-flight sequences are never delivered twice');
 assert.equal(h.messages.filter(message=>message.kind==='ack').length,0);
 a.link.message({version:IRDA_PROTOCOL,kind:'ack',from:'b',sequence:2});
 assert.equal(a.link.sent,0,'An out-of-order ACK cannot release a window slot');
 for(let index=IRDA_WINDOW_PACKETS-1;index>0;index--)finish[index]();
 await settle();assert.equal(h.messages.filter(message=>message.kind==='ack').length,0,'Later completion cannot ACK an unfinished prefix');
 finish[0]();await settle();
 assert.deepEqual(h.messages.filter(message=>message.kind==='ack').map(message=>message.sequence),Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>index+1));
 assert.deepEqual(received,Array.from({length:IRDA_WINDOW_PACKETS},(_,index)=>index+1));
 assert.equal(a.link.queued,0);assert.equal(b.link.incomingBytes,0);h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>new Promise(()=>{}));await settle();
 a.link.send(Uint8Array.of(1),100);await settle();
 b.link.message({version:IRDA_PROTOCOL,kind:'bytes',from:'a',sequence:2,bytes:Uint8Array.of(2),segments:[[1,99]]});
 assert.equal(b.states.at(-1).error,'sequence','Source order is checked against the queued tail, not just completed packets');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>new Promise(()=>{}));await settle();
 for(let value=1;value<=IRDA_WINDOW_PACKETS;value++)a.link.send(Uint8Array.of(value),value);
 await settle();
 b.link.message({version:IRDA_PROTOCOL,kind:'bytes',from:'a',sequence:IRDA_WINDOW_PACKETS+1,bytes:Uint8Array.of(99),segments:[[1,100]]});
 assert.equal(b.states.at(-1).error,'overflow','The receiver independently bounds the window');
 assert.equal(b.link.incoming.length,0);assert.equal(b.link.incomingBytes,0);h.dispose();
}
{
 const h=harness(),a=h.make('a');
 assert.equal(a.link.channel.name,'orchard-irda-v3-TEST23');
 a.link.message({version:2,kind:'hello',from:'old-v2',label:'old'});
 assert.equal(a.link.phase,'waiting','Old single-flight peers cannot join the pipelined protocol');h.dispose();
}
console.log('IrDA tab transport: bounded eight-packet window, ordered ACKs, source stamps, coalescing, duplicate/stale isolation, timeout, disconnect and v2 separation pass.');
