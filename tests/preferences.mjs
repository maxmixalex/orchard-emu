// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULTS,validatePreferences,readPreferences,writePreferences,defaultBindings,bindings,keyCode,
  validBinding,sessionName,toBase64,fromBase64,readAuto,writeAuto,autoKey } from '../dist/preferences.js';
import { Pacer } from '../dist/pacing.js';
import { TapQueue } from '../dist/hp48.js';
import { bindLifecycle } from '../dist/lifecycle.js';
const defaults=()=>({...DEFAULTS,mappings:{}});
assert.deepEqual(validatePreferences(defaults()),defaults());
const legacy=defaults();delete legacy.transferUnlimited;delete legacy.sound;delete legacy.volume;
assert.deepEqual(validatePreferences(legacy),defaults());
assert.equal(validatePreferences({...defaults(),view:'immersive-landscape',transferUnlimited:true,sound:false,volume:0}).view,'immersive-landscape');
assert.deepEqual(validatePreferences({...defaults(),mappings:{'2':{KeyA:[58,28]}}}).mappings,{'2':{KeyA:[58,28]}});
assert.deepEqual(validatePreferences({...defaults(),mappings:{'5':{KeyA:[57,35]}}}).mappings,{'5':{KeyA:[57,35]}});
for(const update of [{version:2},{zoom:NaN},{zoom:181},{zoom:0},{view:'hidden'},{speed:Infinity},{speed:3},{interval:1},{autosave:1},
 {transferUnlimited:1},{sound:null},{volume:NaN},{volume:Infinity},{volume:'0.5'},{volume:-0.1},{volume:1.1},
 {mappings:[]},{mappings:{'6':{KeyA:[58]}}},{mappings:{'1':{KeyA:[55]}}},{mappings:{'1':{KeyA:Array(9).fill(6)}}}])assert.throws(()=>validatePreferences({...defaults(),...update}));
assert.deepEqual(defaultBindings(1).KeyA,[58,28]);assert.equal(defaultBindings(4).KeyA,undefined);
assert.deepEqual(defaultBindings(2),defaultBindings(1));
assert.deepEqual(defaultBindings(5).KeyA,[57,35]);assert.deepEqual(defaultBindings(5).KeyZ,[57,2]);
assert.deepEqual(bindings({...defaults(),mappings:{'1':{KeyA:[58,28],Enter:[]}}},1).Enter,[]);
assert.equal(keyCode({code:'KeyA',shiftKey:false}), 'KeyA');assert.equal(keyCode({code:'KeyA',ctrlKey:true,shiftKey:true}),'Ctrl+Shift+KeyA');
assert.equal(keyCode({code:'KeyA',isComposing:true}),null);assert(!validBinding('__proto__',[6]));
assert.equal(sessionName(1,new Date(2026,9,3,1,2,3)), 'hp39gplus-20261003-010203.ord');
assert.equal(sessionName(4,new Date(2026,11,31,23,59,59)), 'hp48gii-20261231-235959.ord');
assert.equal(sessionName(5,new Date(2026,9,23,1,2,3)), 'hp49gplus-20261023-010203.ord');
assert.throws(()=>sessionName(0));
const data=Uint8Array.from({length:600000},(_,i)=>i%256);assert.deepEqual(fromBase64(toBase64(data)),data);
for(const bad of ['%foo','!!!!','a', 'a'.repeat(850000)])assert.throws(()=>fromBase64(bad));
class MemoryStorage {constructor(){this.map=new Map();this.full=false;}getItem(k){return this.map.get(k)??null;}setItem(k,v){if(this.full)throw new Error('quota');this.map.set(k,String(v));}removeItem(k){this.map.delete(k);}}
const store=new MemoryStorage();writePreferences(store,defaults());assert.deepEqual(readPreferences(store),defaults());
const badStore={getItem:()=>{throw Error('blocked');}};assert.deepEqual(readPreferences(badStore),defaults());
const hash='a'.repeat(64);assert.equal(readAuto(store,hash),null);
writeAuto(store,hash,1,data,null,'tab1:1',10);assert.deepEqual(readAuto(store,hash).file,data);
const hp49hash='5'.repeat(64);writeAuto(store,hp49hash,5,data,null,'hp49:1',11);assert.equal(readAuto(store,hp49hash).model,5);
const hp39gshash='2'.repeat(64);writeAuto(store,hp39gshash,2,data,null,'hp39gs:1',12);assert.equal(readAuto(store,hp39gshash).model,2);
const before=store.getItem(autoKey(hash));assert.throws(()=>writeAuto(store,hash,1,data,null,'tab2:1'));assert.equal(store.getItem(autoKey(hash)),before);
store.full=true;assert.throws(()=>writeAuto(store,hash,1,data,'tab1:1','tab1:2'));assert.equal(store.getItem(autoKey(hash)),before);store.full=false;
writeAuto(store,hash,1,data,'tab1:1','tab2:2');assert.equal(readAuto(store,hash).token,'tab2:2');
const events=[],q=new TapQueue((...args)=>events.push(args),600000,360000);
q.pushMany([58,28]);q.update(0);q.update(600000);q.update(960000);q.update(1560000);
assert.deepEqual(events,[[58,true,0],[58,false,600000],[28,true,960000],[28,false,1560000]]);
q.clear(2000000);for(let i=0;i<31;i++)q.push(6);assert.throws(()=>q.pushMany([58,28]));assert.equal(q.pending,31);
for(const bad of [[6,55],[],Array(9).fill(6)])assert.throws(()=>q.pushMany(bad));assert.equal(q.pending,31);
// Simulate different fast-host chunk sizes: wall time, not throughput, controls
// virtual elapsed time. Slow hosts run behind; no instruction skipping/catch-up.
for(const speed of [.5,1,2])for(const cap of [256,1024,4096]){
 const p=new Pacer();p.setSpeed(speed,0);let executed=0;
 for(let ms=1;ms<=1000;ms++){let n;while((n=p.available(ms,cap))>0){p.consume(n);executed+=n;}}
 assert.equal(executed,12000000*speed);
 p.reset(1000);assert.equal(p.available(1000),0);
 assert(p.available(1000000,10000000)<=12000000*speed*.05);
 p.setSpeed(speed,1000000);assert.equal(p.available(1000000),0);
}
const slow=new Pacer();let count=0;for(let t=1;t<=1000;t++){const n=Math.min(1200,slow.available(t));slow.consume(n);count+=n;}assert.equal(count,1200000);
assert.throws(()=>slow.setSpeed(-1,0));slow.setSpeed(0,0);assert.equal(slow.available(0,4096),4096);
// Focus policy changes must never suppress release of a held physical switch.
const page=new EventTarget(),document=new EventTarget();document.hidden=true;let pause=0,release=0,save=0;
let policy={pauseOnBlur:false,pauseOnHidden:false};const unbind=bindLifecycle(page,document,()=>pause++,{preferences:()=>policy,release:()=>release++,save:()=>save++});
page.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('visibilitychange'));assert.equal(pause,0);assert.equal(release,2);assert.equal(save,2);
policy={pauseOnBlur:true,pauseOnHidden:false};page.dispatchEvent(new Event('blur'));assert.equal(pause,1);
page.dispatchEvent(new Event('pagehide'));assert.equal(pause,2);unbind();page.dispatchEvent(new Event('blur'));assert.equal(pause,2);
const html=await readFile(new URL('../web/App.jsx',import.meta.url),'utf8'),js=await readFile(new URL('../web/controller.js',import.meta.url),'utf8');
assert(!/\b(?:alert|confirm|prompt)\s*\(/.test(js));assert(!html.includes('Text keypad'));assert(!html.includes('Getting started'));
for(const component of ['<Modal','<Tabs','<Switch','<Slider','<Keyboard','<Tooltip'])assert(html.includes(component),component);
console.log('Preferences: model-specific macro bindings, atomic queue, .ord names, settings/local save validation, quota/conflict preservation, configurable lifecycle and fixed-rate pacing pass.');
