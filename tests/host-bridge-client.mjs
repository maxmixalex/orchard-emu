// SPDX-License-Identifier: MIT
// Deliberately delayed HTTP responses at device-generation boundaries.
import assert from 'node:assert/strict';
import {BrowserHostBridge} from '../web/host-bridge-client.js';
const address='http://127.0.0.1:8125',token='4'.repeat(64),session='a'.repeat(48);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const ok=()=>new Response(null,{status:204});
function fixture(fetch){
 const memory={buffer:new ArrayBuffer(4096)},core={memory,timebase_hz:()=>12000000,usb_snapshot:()=>1024,usb_connect:()=>0};
 const words=new Uint32Array(memory.buffer,1024,44);words[36]=1;
 const statuses=[],client=new BrowserHostBridge(core,{notify:s=>statuses.push(s),fetch});
 const device={available:true,device:new Uint8Array(18),config:new Uint8Array(9),starts:0,detaches:0,start(){this.starts++;},detach(){this.detaches++;},poll(){},cancelAll(){}};client.device=device;
 Object.assign(client,{url:address,token,session,active:true,abort:new AbortController(),resets:1n});
 return {client,device,words,statuses};
}
{
 const held=[];const {client}=fixture(async url=>{if(url.endsWith('/v1/device')){const d=deferred();held.push(d);return d.promise;}return ok();});
 client.poll(100);assert.equal(held.length,1);client.event({type:'release',epoch:1});client.poll(200);assert.equal(held.length,2);
 held[1].resolve(ok());await settle();assert(client.ready&&client.active);
 held[0].reject(new TypeError('The old publication response was lost'));await settle();assert(client.ready&&client.active);assert.equal(client.epoch,1);
 await client.stop();
}
{
 const oldReset=deferred();const {client,words}=fixture(async url=>url.endsWith('/v1/reset')?oldReset.promise:ok());words[36]=0;
 client.poll(100);assert(client.resetPending);client.event({type:'release',epoch:1});client.poll(200);await settle();assert(client.ready);
 oldReset.reject(new TypeError('Old reset response lost after release arrived'));await settle();assert(client.ready&&client.active&&!client.resetPending);
 await client.stop();
}
{
 const held=[];const {client}=fixture(async url=>{if(url.endsWith('/v1/results')){const d=deferred();held.push(d);return d.promise;}return ok();});
 client.result({id:1,status:0,length:0,data:''});assert.equal(held.length,1);
 client.event({type:'release',epoch:1});client.result({id:2,status:0,length:0,data:''});assert.equal(held.length,1);
 held[0].reject(new TypeError('Old result response lost after detach'));await settle();assert.equal(held.length,2);assert(client.active);
 held[1].resolve(ok());await settle();assert.equal(client.pending.length,0);assert(!client.flushing&&client.active);
 await client.stop();
}
{
 const opening=deferred(),calls=[];let enumerated=0;
 const core={timebase_hz:()=>12000000},client=new BrowserHostBridge(core,{fetch:async(url,options)=>{calls.push(options.method);return options.method==='POST'?opening.promise:ok();}});
 client.device={detach(){},start(){++enumerated;}};
 const starting=client.start(address,token);assert(client.active);await settle();let stopped=false;const stopping=client.stop().then(()=>{stopped=true;});await settle();assert(!stopped,'Stop must await an allocated-but-unanswered session');
 opening.resolve(new Response(JSON.stringify({protocol:1,session,usbipPort:3240,epoch:0}),{headers:{'Content-Type':'application/json'}}));await starting;await stopping;
 assert(!client.active);assert.equal(enumerated,0);assert.deepEqual(calls,['POST','DELETE'],'A session reply arriving after Stop is released without connecting USB');
 await assert.rejects(client.start(address,token),e=>e.code==='hostBridgeBusy');
}
{
 const cleaning=deferred();let requests=0;
 const client=new BrowserHostBridge({timebase_hz:()=>12000000},{waitFor:cleaning.promise,fetch:async()=>{requests++;return ok();}});client.device={detach(){}};
 const starting=client.start(address,token);await settle();assert(client.active&&client.phase==='connecting');assert.equal(requests,0);
 await client.stop();cleaning.resolve();await starting;assert.equal(requests,0,'Cancel while awaiting the previous connection cleanup must not open a new session');assert(!client.active);
}
console.log('Bridge async lifetime: late old-epoch publish/reset/result failures cannot stop a replacement device; queued new results resume; stopped handshake replies release their session without connecting USB.');
