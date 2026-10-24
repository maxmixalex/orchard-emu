// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {IrDALink,irdaCode,newIrdaCode} from '../web/irda-link.js';
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
 assert.equal(a.link.send(Uint8Array.of(1)),false);assert.equal(a.states.at(-1).error,'overflow');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>new Promise(()=>{}));await settle();
 a.link.send(Uint8Array.of(1));h.advance(5001);a.link.heartbeat();assert.equal(a.states.at(-1).error,'timeout');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>0);await settle();
 a.link.send(Uint8Array.of(1,2));await settle();assert.equal(a.link.sent,2);assert.equal(b.link.received,0,'Inactive IR receiver discards, not delayed re-injection');
 b.link.close();await settle();assert.equal(a.states.at(-1).error,'gone');h.dispose();
}
{
 const h=harness(),a=h.make('a'),b=h.make('b',()=>1,'OTHER1');await settle();assert.equal(a.link.phase,'waiting');assert.equal(b.link.phase,'waiting');h.dispose();
}
console.log('IrDA tab transport: pairing, exact ordered octets, duplicate isolation, stale/foreign packets, third peer, bounded queue, timeout, inactive receive, disconnect and distinct codes pass.');
