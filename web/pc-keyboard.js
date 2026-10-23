// SPDX-License-Identifier: MIT
// Physical key identity stays stable; visible characters come from the OS layout.
import {bindings,keyCode,resolveKeyBinding,validBinding} from './preferences.js';
export const PC_LAYOUT={default:[
  'Escape F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12',
  'Backquote Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace',
  'Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Backslash',
  'CapsLock KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Enter',
  '{Shift} KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash {Shift}',
  '{Ctrl} {Meta} {Alt} Space {Alt} {Meta} {Ctrl}',
  'Insert Home PageUp Delete End PageDown ArrowLeft ArrowDown ArrowUp ArrowRight',
  'Numpad7 Numpad8 Numpad9 NumpadDivide Numpad4 Numpad5 Numpad6 NumpadMultiply Numpad1 Numpad2 Numpad3 NumpadSubtract Numpad0 NumpadDecimal NumpadEnter NumpadAdd'
]};
export const PC_DISPLAY={Escape:'Esc',Backquote:'`',Minus:'−',Equal:'=',Backspace:'⌫',Tab:'Tab',CapsLock:'Caps',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Enter:'Enter',Comma:',',Period:'.',Slash:'/',Space:'Space',Insert:'Ins',Delete:'Del',PageUp:'PgUp',PageDown:'PgDn',ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓','{Ctrl}':'Ctrl','{Alt}':'Alt','{Meta}':'Win / ⌘','{Shift}':'Shift',NumpadDivide:'÷',NumpadMultiply:'×',NumpadSubtract:'−',NumpadAdd:'+',NumpadDecimal:'.',NumpadEnter:'↵'};
for(let i=0;i<26;i++)PC_DISPLAY['Key'+String.fromCharCode(65+i)]=String.fromCharCode(65+i);
for(let i=0;i<10;i++){PC_DISPLAY['Digit'+i]=String(i);PC_DISPLAY['Numpad'+i]=String(i);}
export function bindingCode(token,modifiers=[]){return ['Ctrl','Alt','Meta','Shift'].filter(x=>modifiers.includes(x)).map(x=>x+'+').join('')+token;}

export function keyLabel(token,layout={}){
  const known=layout[token];
  if(typeof known==='string'&&known.trim())return /^[a-z]$/.test(known)?known.toUpperCase():known;
  // Unknown writing-system keys use their physical code, not a guessed US glyph.
  if(/^(?:Key|Digit|Intl)/.test(token)||['Backquote','Minus','Equal','BracketLeft','BracketRight','Backslash','Semicolon','Quote','Comma','Period','Slash'].includes(token))return token;
  return ({PrintScreen:'PrtSc',ScrollLock:'Scroll',Pause:'Pause',NumLock:'Num',ContextMenu:'Menu',NumpadEqual:'=',NumpadComma:','})[token]??PC_DISPLAY[token]??token;
}
export function bindingLabel(code,layout={}){
  const parts=code.split('+'),token=parts.pop(),label=keyLabel(token,layout);
  return [...parts,token.startsWith('Numpad')?'Num '+label:label].join('+');
}
export async function readKeyboardLayout(keyboard=globalThis.navigator?.keyboard){
  if(typeof keyboard?.getLayoutMap!=='function')return {status:'unavailable',labels:{}};
  try{
    const map=await keyboard.getLayoutMap(),labels={};
    for(const [code,key] of map){
      if(validBinding(code,[])&&!code.includes('+')&&typeof key==='string'&&key.length>0&&key.length<=16)labels[code]=key;
    }
    return {status:Object.keys(labels).length?'ready':'unavailable',labels};
  }catch{return {status:'unavailable',labels:{}};}
}
export function capturedKey(event){
  const code=keyCode(event);
  if(!code||typeof event.key!=='string'||event.key==='Dead'||event.key==='Process'||event.key==='Unidentified')return null;
  return {code,key:event.key,altGraph:event.getModifierState?.('AltGraph')===true};
}
export function previewBindings(p,model,layout={},observed={}){
  const map=bindings(p,model,layout);
  for(const [code,{key,altGraph}] of Object.entries(observed)){
    const parts=code.split('+'),token=parts.pop();
    const event={code:token,key,getModifierState:name=>name==='AltGraph'&&altGraph};
    for(const mod of ['Ctrl','Alt','Meta','Shift'])event[mod.toLowerCase()+'Key']=parts.includes(mod);
    const sequence=resolveKeyBinding(p,model,event);map[code]=sequence??[];
  }
  return map;
}
