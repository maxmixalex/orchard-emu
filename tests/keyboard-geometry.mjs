// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {PC_KEYS,PC_SIZE} from '../web/pc-keyboard-view.js';
import {validBinding} from '../web/preferences.js';
import {bindingCode} from '../web/pc-keyboard.js';
assert.equal(PC_KEYS.length,104);assert.equal(new Set(PC_KEYS.map(k=>k.id)).size,104);
for(const k of PC_KEYS){assert(k.x>=0&&k.y>=0&&k.w>0&&k.h>0);assert(k.x+k.w<=PC_SIZE.width&&k.y+k.h<=PC_SIZE.height);if(!k.token.startsWith('{'))assert(validBinding(bindingCode(k.token),[6]),k.token);}
for(let i=0;i<PC_KEYS.length;i++)for(let j=i+1;j<PC_KEYS.length;j++){const a=PC_KEYS[i],b=PC_KEYS[j];assert(!(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h),`${a.id} overlaps ${b.id}`);}
const key=id=>PC_KEYS.find(k=>k.id===id);
assert.equal(key('Space').w,6.25);assert.equal(key('KeyQ').x,1.5);assert.equal(key('KeyA').x,1.75);assert.equal(key('KeyZ').x,2.25);
assert.equal(key('NumpadEnter').h,2);assert.equal(key('NumpadAdd').h,2);assert.equal(key('Numpad0').w,2);
assert.equal(key('ArrowUp').x,key('ArrowDown').x);assert.equal(key('ArrowUp').y+1,key('ArrowDown').y);
assert.equal(key('ShiftLeft').token,key('ShiftRight').token);
console.log('Keyboard: 104 unique physical keys, no overlap, ANSI offsets, inverted-T, numpad and normalized binding codes passed');
