// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {PC_KEYS,PC_SIZE} from '../web/pc-keyboard-view.js';
import {DEFAULTS,defaultBindings,resolveKeyBinding,validBinding,validatePreferences} from '../web/preferences.js';
import {bindingCode,bindingLabel,capturedKey,keyLabel,previewBindings,readKeyboardLayout} from '../web/pc-keyboard.js';
assert.equal(PC_KEYS.length,104);assert.equal(new Set(PC_KEYS.map(k=>k.id)).size,104);
for(const k of PC_KEYS){assert(k.x>=0&&k.y>=0&&k.w>0&&k.h>0);assert(k.x+k.w<=PC_SIZE.width&&k.y+k.h<=PC_SIZE.height);if(!k.token.startsWith('{'))assert(validBinding(bindingCode(k.token),[6]),k.token);}
for(let i=0;i<PC_KEYS.length;i++)for(let j=i+1;j<PC_KEYS.length;j++){const a=PC_KEYS[i],b=PC_KEYS[j];assert(!(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h),`${a.id} overlaps ${b.id}`);}
const key=id=>PC_KEYS.find(k=>k.id===id);
assert.equal(key('Space').w,6.25);assert.equal(key('KeyQ').x,1.5);assert.equal(key('KeyA').x,1.75);assert.equal(key('KeyZ').x,2.25);
assert.equal(key('NumpadEnter').h,2);assert.equal(key('NumpadAdd').h,2);assert.equal(key('Numpad0').w,2);
assert.equal(key('ArrowUp').x,key('ArrowDown').x);assert.equal(key('ArrowUp').y+1,key('ArrowDown').y);
assert.equal(key('ShiftLeft').token,key('ShiftRight').token);
console.log('Keyboard: 104 unique physical keys, no overlap, ANSI offsets, inverted-T, numpad and normalized binding codes passed');

// OS-resolved characters are independent of the physical code. The French
// number row, German Y/Z and an unavailable Layout Map must type the same text.
const prefs={...DEFAULTS,mappings:{}},azerty={KeyQ:'a',KeyA:'q',KeyW:'z',KeyZ:'w',Semicolon:'m',Digit1:'&',Digit8:'_',Equal:'=',IntlBackslash:'<'};
const press=(code,key,extra={})=>({code,key,...extra});
assert.deepEqual(resolveKeyBinding(prefs,1,press('KeyQ','a')),[58,28]);
assert.deepEqual(resolveKeyBinding(prefs,1,press('KeyA','q')),[58,17]);
assert.deepEqual(resolveKeyBinding(prefs,1,press('KeyY','z')),[58,12]);
assert.deepEqual(resolveKeyBinding(prefs,1,press('KeyZ','y')),[58,19]);
assert.deepEqual(resolveKeyBinding(prefs,1,press('Digit1','1',{shiftKey:true})),[26]);
assert.equal(resolveKeyBinding(prefs,1,press('Digit1','&')),null);
assert.equal(resolveKeyBinding(prefs,1,press('Digit8','_')),null);
assert.deepEqual(resolveKeyBinding(prefs,1,press('BracketRight','+')),[5]);
assert.deepEqual(resolveKeyBinding(prefs,1,press('KeyQ','A',{shiftKey:true})),[58,28]);
assert.deepEqual(resolveKeyBinding(prefs,4,press('KeyQ','a')),[57,35]);
assert.deepEqual(resolveKeyBinding(prefs,5,press('Semicolon','m')),[57,28]);
assert.deepEqual(resolveKeyBinding(prefs,4,press('NumpadDecimal',',')),[20]);
assert.equal(resolveKeyBinding(prefs,4,press('Numpad1','End')),null);
assert.deepEqual(resolveKeyBinding(prefs,4,press('Numpad1','1')),[26]);
for(const key of ['Dead','Process','Unidentified',''])assert.equal(resolveKeyBinding(prefs,1,press('KeyQ',key)),null);
assert.equal(resolveKeyBinding(prefs,1,press('KeyQ','a',{isComposing:true})),null);
assert.equal(resolveKeyBinding(prefs,1,press('KeyQ','a',{ctrlKey:true})),null);
assert.equal(resolveKeyBinding(prefs,1,press('KeyQ','a',{metaKey:true})),null);
assert.deepEqual(resolveKeyBinding(prefs,1,press('KeyQ','+',{ctrlKey:true,altKey:true,getModifierState:k=>k==='AltGraph'})),[5]);
assert.deepEqual(resolveKeyBinding(prefs,1,press('ArrowLeft','ArrowLeft')),[43]);

const scoped=validatePreferences({...prefs,mappings:{1:{KeyQ:[6],KeyA:[], 'Ctrl+KeyQ':[58,28]},2:{KeyQ:[59,6]},4:{KeyQ:[57,35]}}});
assert.deepEqual(resolveKeyBinding(scoped,1,press('KeyQ','a')),[6]);
assert.deepEqual(resolveKeyBinding(scoped,2,press('KeyQ','a')),[59,6]);
assert.deepEqual(resolveKeyBinding(scoped,5,press('KeyQ','a')),[57,35]);
assert.deepEqual(resolveKeyBinding(scoped,1,press('KeyA','q')),[]);
assert.deepEqual(resolveKeyBinding(scoped,2,press('KeyA','q')),[58,17]);
assert.deepEqual(resolveKeyBinding(scoped,1,press('KeyQ','a',{ctrlKey:true})),[58,28]);
const copied=validatePreferences(scoped);copied.mappings[1].KeyQ.push(56);
assert.deepEqual(scoped.mappings[1].KeyQ,[6]);assert.deepEqual(copied.mappings[2].KeyQ,[59,6]);
const projected=defaultBindings(1,azerty);
assert.deepEqual(projected.KeyQ,[58,28]);assert.deepEqual(projected.KeyA,[58,17]);assert.deepEqual(projected.Semicolon,[58,9]);
assert(!Object.hasOwn(projected,'Digit1'));assert(!Object.hasOwn(projected,'Shift+Equal'));
assert.deepEqual(projected['Shift+KeyQ'],[58,28]);
assert(!Object.hasOwn(defaultBindings(1,{}),'KeyA'));assert.deepEqual(defaultBindings(1,{}).Numpad1,[26]);
const observed={'Shift+Digit1':{key:'1',altGraph:false}};
assert.deepEqual(previewBindings(prefs,1,azerty,observed)['Shift+Digit1'],[26]);
assert.deepEqual(previewBindings({...prefs,mappings:{1:{'Shift+Digit1':[]}}},1,azerty,observed)['Shift+Digit1'],[]);
assert.equal(keyLabel('KeyQ'),'KeyQ');assert.equal(keyLabel('KeyQ',azerty),'A');assert.equal(keyLabel('Digit1',azerty),'&');
assert.equal(bindingLabel('Shift+KeyQ',azerty),'Shift+A');assert.equal(bindingLabel('Numpad1',azerty),'Num 1');
for(const code of ['IntlBackslash','IntlYen','IntlRo','NumpadEqual','NumpadComma'])assert(validBinding(code,[6]));
assert.deepEqual(capturedKey(press('IntlYen','¥')),{code:'IntlYen',key:'¥',altGraph:false});
assert.equal(capturedKey(press('KeyQ','Dead')),null);
assert.deepEqual(await readKeyboardLayout(undefined),{status:'unavailable',labels:{}});
assert.deepEqual(await readKeyboardLayout({getLayoutMap:async()=>{throw Error('Denied');}}),{status:'unavailable',labels:{}});
assert.deepEqual(await readKeyboardLayout({getLayoutMap:async()=>new Map(Object.entries({...azerty,__bad__:'x'}))}),{status:'ready',labels:azerty});
console.log('Keyboard: AZERTY/QWERTZ character dispatch, model isolation, explicit unassignment, modifiers/AltGraph/IME, layout previews and denied-API fallback passed');
