// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { KEYS, keyRows, applySetup, setupHash, HP39_ROM } from '../web/hp48.js';
const root=new URL('../dist/',import.meta.url), read=name=>readFile(new URL(name,root));
const manifest=JSON.parse(await read('skins/manifest.json'));
const lock=JSON.parse(await readFile(new URL('../tools/skin-sources.json',import.meta.url)));
assert.equal(manifest.revision,lock.revision);
assert.equal(Object.keys(manifest.models).length,7);
for(const [model,spec] of Object.entries(manifest.models)){
 const data=await read(`skins/${model}.svg`);
 const expected=lock.files.find(f=>f.path.startsWith(`${model}/`)&&f.path.endsWith('.svg'));
 assert.equal(createHash('sha256').update(data).digest('hex'),expected.sha256);
 assert.equal(spec.keys.length,51);assert.deepEqual(new Set(spec.keys.map(k=>k.scan)),new Set(KEYS.keys()));
 assert(spec.glass.every(Number.isFinite));assert(spec.glass[0]>0&&spec.glass[1]>0);
 assert(spec.glass[0]+spec.glass[2]<spec.viewBox[2]);assert(spec.glass[1]+spec.glass[3]<spec.viewBox[3]);
 for(const k of spec.keys){assert(['path','rect','circle'].includes(k.tag));assert(k.label);assert(!/url|javascript/i.test(k.transform));}
 assert(!/<(?:script|foreignObject|text|image)\b/i.test(data.toString()));
}
const html=(await read('index.html')).toString();
assert.equal((html.match(/data-segment="[0-5]"/g)||[]).length,6);
assert(html.includes('glass-overlay'));assert(html.includes('licenses/hp-calcs-svg/NOTICE.txt'));
assert.equal(keyRows(1).flat().find(k=>k[1]===58)[0],'ALPHA');
assert.equal(keyRows(4).flat().find(k=>k[1]===58)[0],'L SHIFT');
assert.equal(setupHash('hp39-home'),HP39_ROM);
const {instance:{exports:c}}=await WebAssembly.instantiate(await read('orchard.wasm'),{});
assert.equal(c.create(1),0);applySetup(c,1,'hp39-home');assert.equal(c.sram_alias_reads(),0n);
assert.equal(c.annunciators(),0);assert.deepEqual([...new Uint8Array(c.memory.buffer,c.annunciator_buffer(),6)],Array(6).fill(0));
assert.throws(()=>applySetup(c,4,'hp39-home'));
console.log('Skins: seven pinned outlined assets, 51 exact scan regions each, glass bounds, isolated segments, attribution and separate HP39 preset pass. No browser E2E implied.');
