// SPDX-License-Identifier: MIT
// Offline component verification fixture only. No Worker, ROM, network or CPU.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Root} from '../web/App.jsx';
import {CalculatorController} from '../web/controller.js';
import {DEFAULTS} from '../web/preferences.js';
crypto.randomUUID=()=> 'offline-test-writer';
const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
const messages=[];window.__messages=messages;window.__manifestRequests=[];window.__cancelBarriers=[];
window.fetch=async url=>{if(String(url).endsWith('skins/manifest.json')){
 const response=()=>new Response(JSON.stringify(window.__manifest));
 return window.__deferManifest?new Promise(resolve=>window.__manifestRequests.push(()=>resolve(response()))):response();
}throw Error('Offline fixture forbids network');};
// Static build assets, injected by the test runner. Not a live HTTP-origin test.
const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){const name=String(value).split('/').pop();descriptor.set.call(this,'data:image/svg+xml;base64,'+window.__skins[name]);}});
const c=new CalculatorController({storage,worker:{postMessage:d=>{
 messages.push(d);
 if(d.type==='file-transfer-cancel'){
  const confirm=()=>queueMicrotask(()=>c.receive({type:'file-transfer-cancelled',generation:d.generation,request:d.request}));
  if(window.__deferCancel)window.__cancelBarriers.push(confirm);else confirm();
 }
},terminate(){}},download:(data,name)=>{window.__downloadName=name;window.__downloadBytes=Array.from(data);}});
c.patch({ready:true,prefs:{...DEFAULTS,view:window.__fixtureView||'traditional',mappings:{}}});window.__controller=c;
const root=createRoot(document.getElementById('root'));root.render(<Root controller={c}/>);window.__unmount=()=>root.unmount();
