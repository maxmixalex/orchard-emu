// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {CALCULATORS} from '../web/catalog.js';
import {prepare4950,readFirmware} from '../web/firmware-install.js';
import {setupHash,isPlayable,applySetup} from '../web/hp48.js';
import {encodeSession,decodeSession} from '../web/session.js';
import {DEFAULTS,validatePreferences,readAuto,writeAuto} from '../web/preferences.js';
assert.deepEqual(CALCULATORS.map(x=>[x.id,x.height]),[[1,64],[4,64],[5,80],[6,80]]);
for(const bad of ['__proto__','constructor','toString',undefined]){assert.equal(setupHash(bad),null);assert(!isPlayable(undefined,bad));}
for(const id of [5,6]){
 const model=CALCULATORS.find(x=>x.id===id);assert.equal(setupHash(model.preset),model.hash);assert(isPlayable(id,model.preset));assert(!isPlayable(id===5?6:5,model.preset));
 const calls=[];const core=new Proxy({},{get:(_,method)=>(...args)=>{calls.push([method,...args]);return 0;}});applySetup(core,id,model.preset);
 assert(calls.some(([m,p,k,l])=>m==='gpio_inputs'&&p===5&&k===0x8e&&l===8));
 assert(calls.some(([m,p,k,l])=>m==='gpio_bias'&&p===4&&k===0xc000&&l===0xc000));
 const file=await encodeSession({model:id,preset:model.preset,romHash:model.hash,frameView:1,state:new Uint8Array([1,2,3])});
 assert.equal((await decodeSession(file.buffer)).model,id);
 await assert.rejects(encodeSession({model:id===5?6:5,preset:model.preset,romHash:model.hash,frameView:1,state:new Uint8Array([1])}));
 assert.deepEqual(validatePreferences({...DEFAULTS,mappings:{[id]:{KeyA:[58,35]}}}).mappings[id].KeyA,[58,35]);
}
for(const pair of [[null,null],[new ArrayBuffer(1),new ArrayBuffer(1)],[new ArrayBuffer(16384),new ArrayBuffer(1294336)]])await assert.rejects(prepare4950(...pair));
for(const input of [[],[{},{}],[{size:4,arrayBuffer(){throw Error('should not read');}}],Array(3).fill({})])await assert.rejects(readFirmware(input));
console.log('49g+/50g admission: explicit board setup, 80-row geometry, versioned sessions, strict two-file size/hash rejection and no prototype-key presets passed; original boot/arithmetic is tested separately with local inputs.');
