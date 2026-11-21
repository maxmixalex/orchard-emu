// SPDX-License-Identifier: MIT
// Offline component verification fixture only. No Worker, ROM, network or CPU.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Root} from '../web/App.jsx';
import {CalculatorController} from '../web/controller.js';
import {DEFAULTS} from '../web/preferences.js';
import {TapQueue} from '../web/hp48.js';
crypto.randomUUID=()=> 'offline-test-writer';
const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
const messages=[];window.__messages=messages;window.__manifestRequests=[];window.__cancelBarriers=[];
// Optional contact observer for DOM-to-queue input cases. It uses a declared
// synthetic guest clock; original-ROM and production Worker checks are separate.
window.__enableContactFixture=()=>{
 let tick=0;const contacts=[];window.__contactEvents=contacts;
 const queue=new TapQueue((scan,down,at)=>contacts.push({scan,down,tick:at}),1500000,600000);
 window.__advanceContacts=at=>{tick=at;queue.update(tick);};
 window.__contactMessage=m=>{
  if(m.type==='key-down')queue.press(m.source,m.scan,tick);
  else if(m.type==='key-up')queue.release(m.source,tick,m.cancel);
  else if(m.type==='tap-sequence')queue.pushMany(m.scans);
  else if(m.type==='release')queue.clear(tick);
 };
};
window.fetch=async url=>{if(String(url).endsWith('skins/manifest.json')){
 const response=()=>new Response(JSON.stringify(window.__manifest));
 return window.__deferManifest?new Promise(resolve=>window.__manifestRequests.push(()=>resolve(response()))):response();
}throw Error('Offline fixture forbids network');};
// Static build assets, injected by the test runner. Not a live HTTP-origin test.
const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){const name=String(value).split('/').pop();descriptor.set.call(this,'data:image/svg+xml;base64,'+window.__skins[name]);}});
const c=new CalculatorController({storage,worker:{postMessage:d=>{
 messages.push(d);
 window.__contactMessage?.(d);
 if(d.type==='file-transfer-cancel'){
  const confirm=()=>queueMicrotask(()=>c.receive({type:'file-transfer-cancelled',generation:d.generation,request:d.request}));
  if(window.__deferCancel)window.__cancelBarriers.push(confirm);else confirm();
 }
},terminate(){}},download:(data,name)=>{window.__downloadName=name;window.__downloadBytes=Array.from(data);}});
c.patch({ready:true,prefs:{...DEFAULTS,view:window.__fixtureView||'traditional',mappings:{}}});window.__controller=c;
const root=createRoot(document.getElementById('root'));root.render(<Root controller={c}/>);window.__unmount=()=>root.unmount();
