// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {frameRGBA,captureName} from '../web/capture.js';
import {en,zh,initialLanguage} from '../web/i18n.js';
import {PC_LAYOUT,PC_DISPLAY,bindingCode} from '../web/pc-keyboard.js';
import {validBinding} from '../web/preferences.js';
assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());for(const k of Object.keys(en)){assert(en[k].length&&zh[k].length);assert.deepEqual(en[k].match(/{{\w+}}/g),zh[k].match(/{{\w+}}/g));}
assert.equal(initialLanguage(null,'zh-Hans'),'zh');assert.equal(initialLanguage({getItem:()=> 'en'},'zh'),'en');
const tokens=new Set(PC_LAYOUT.default.join(' ').split(' '));for(const key of tokens){if(key.startsWith('{'))continue;assert(validBinding(bindingCode(key,['Ctrl','Shift']),[58,28]),key);}
assert(PC_DISPLAY.KeyA==='A');assert(tokens.has('NumpadEnter'));assert.equal(bindingCode('KeyA',['Shift','Ctrl']),'Ctrl+Shift+KeyA');
const f={width:2,height:1,pixels:new Uint8Array([0,255]),frameStatus:0};assert.deepEqual([...frameRGBA(f)],[194,208,202,255,31,47,42,255]);
for(const bad of [null,{...f,width:0},{...f,pixels:new Uint8Array(1)},{...f,frameStatus:1}])assert.throws(()=>frameRGBA(bad));
assert.equal(captureName(4,new Date(2026,9,9,1,2,3)),'hp48gii-20261009-010203.png');
const manifest=JSON.parse(await readFile('dist/skins/manifest.json'));const vars=manifest.models.hp39gplus.keys.find(k=>k.scan===28);assert.equal(vars.alpha,'A');assert.equal(vars.shift,'CHARS');const apps=manifest.models.hp48gii.keys.find(k=>k.scan===41);assert.equal(apps.shift,'FILES');assert.equal(apps.right,'BEGIN');
console.log('Frontend: bilingual key parity/interpolation, physical PC layout, native-size capture pixels/names and artwork-derived Shift/Alpha legends pass.');

await import('./model-support.mjs');
