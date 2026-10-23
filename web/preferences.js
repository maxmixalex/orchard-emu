// SPDX-License-Identifier: MIT
import { KEYS, keyRows } from './hp48.js';
import { MAX_LEGACY_SESSION_BYTES } from './session.js';
export const SETTINGS_KEY = 'orchard:preferences:v1';
export const AUTO_PREFIX = 'orchard:autosave:v1:';
export const DEFAULTS = Object.freeze({ version:1, view:'immersive', zoom:100,
  pauseOnBlur:true, pauseOnHidden:true, speed:1, autosave:false, interval:30, mappings:{} });
const CODE = /^(?:(?:Ctrl|Alt|Meta|Shift)\+)*(?:Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|F(?:[1-9]|1[0-2])|Enter|Escape|Backspace|Delete|Space|Period|Comma|Slash|Minus|Equal|Tab|Backquote|CapsLock|BracketLeft|BracketRight|Backslash|Semicolon|Quote|PrintScreen|ScrollLock|Pause|NumLock|ContextMenu|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/;
export function validBinding(code, sequence) {
  return typeof code==='string' && code.length<=80 && CODE.test(code) &&
    Array.isArray(sequence) && sequence.length<=8 && sequence.every(s=>Number.isInteger(s)&&KEYS.has(s));
}
export function validatePreferences(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) || value.version!==1) throw new Error('Invalid settings.');
  const p={...DEFAULTS};
  for(const k of ['pauseOnBlur','pauseOnHidden','autosave']) {
    if(typeof value[k]!=='boolean')throw new Error('Invalid settings.'); p[k]=value[k];
  }
  if(!['immersive','traditional'].includes(value.view)||!Number.isInteger(value.zoom)||value.zoom<50||value.zoom>180||
    ![0,0.5,1,2].includes(value.speed)||![15,30,60,120].includes(value.interval))throw new Error('Invalid settings.');
  Object.assign(p,{view:value.view,zoom:value.zoom,speed:value.speed,interval:value.interval});
  if(!value.mappings || typeof value.mappings!=='object'||Array.isArray(value.mappings))throw new Error('Invalid keyboard mappings.');
  p.mappings={};
  for(const [model,map] of Object.entries(value.mappings)) {
    if(!['1','4','5'].includes(model)||!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length>160)throw new Error('Invalid keyboard mappings.');
    p.mappings[model]={};
    for(const [code,sequence] of Object.entries(map)) {
      if(!validBinding(code,sequence))throw new Error('Invalid key sequence.');
      p.mappings[model][code]=[...sequence];
    }
  }
  return p;
}
export function readPreferences(storage) {
  try {const text=storage.getItem(SETTINGS_KEY);return text&&text.length<40000?validatePreferences(JSON.parse(text)):{...DEFAULTS,mappings:{}};}
  catch {return {...DEFAULTS,mappings:{}};}
}
export function writePreferences(storage, p) {storage.setItem(SETTINGS_KEY,JSON.stringify(validatePreferences(p)));}
export function keyCode(event) {
  if(event.isComposing)return null;
  const code=['Ctrl','Alt','Meta','Shift'].filter(k=>event[k.toLowerCase()+'Key']).join('+');
  const full=(code?code+'+':'')+event.code;
  return CODE.test(full)?full:null;
}
export function defaultBindings(model) {
  const map={};
  for(const [label,scan] of keyRows(model).flat())if(/^\d$/.test(label)){map['Digit'+label]=[scan];map['Numpad'+label]=[scan];}
  Object.assign(map,{Enter:[6],NumpadEnter:[6],Backspace:[0],Escape:[56],Period:[20],NumpadDecimal:[20],
    'Shift+Equal':[5],Minus:[4],Slash:[2],'Shift+Digit8':[3],NumpadAdd:[5],NumpadSubtract:[4],NumpadMultiply:[3],NumpadDivide:[2],
    ArrowUp:[42],ArrowLeft:[43],ArrowDown:[44],ArrowRight:[45],Space:model===1?[58,5]:[13]});
  for(let n=1;n<=6;n++)map['F'+n]=[34+n];
  // HP39g+ printed alpha legends, pinned hp-calcs-svg resolved_design.json.
  if(model===1){const alpha=[28,21,14,7,29,22,15,8,1,30,23,16,9,2,57,24,17,10,3,25,18,11,4,26,19,12];
    for(let i=0;i<26;i++){const code='Key'+String.fromCharCode(65+i);map[code]=[58,alpha[i]];}}
  if(model===5){
    // HP49g+ printed alpha legends; A-F are the six menu keys.
    const alpha=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
    for(let i=0;i<26;i++)map['Key'+String.fromCharCode(65+i)]=[57,alpha[i]];
  }
  return map;
}
export function bindings(p,model){return {...defaultBindings(model),...(p.mappings[String(model)]||{})};}
export function sessionName(model,now=new Date()) {
  const slug={1:'hp39gplus',2:'hp39gs',3:'hp40gs',4:'hp48gii',5:'hp49gplus',6:'hp50g'}[model];
  if(!slug||!Number.isFinite(now.getTime()))throw new Error('Invalid session identity.');
  const pad=n=>String(n).padStart(2,'0');
  return `${slug}-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.ord`;
}
export function toBase64(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX_LEGACY_SESSION_BYTES)throw new Error('Invalid saved session.');
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
}
export function fromBase64(text){
  if(typeof text!=='string'||text.length>Math.ceil(MAX_LEGACY_SESSION_BYTES/3)*4||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error('Damaged local save.');
  const raw=atob(text);if(raw.length>MAX_LEGACY_SESSION_BYTES)throw new Error('Local save too large.');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function autoKey(hash) {if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid ROM identity.');return AUTO_PREFIX+hash;}
// A single setItem replaces the complete envelope, never half a session. Calls
// are serialized with Web Locks by the UI when available. A changed foreign
// token is rejected rather than silently overwriting another tab's latest save.
export function readAuto(storage,hash) {
  const text=storage.getItem(autoKey(hash));if(text===null)return null;
  if(text.length>850000)throw new Error('Local save too large.');
  const r=JSON.parse(text);
  if(r?.version!==1||r.romHash!==hash||typeof r.token!=='string'||r.token.length>100||
    !Number.isFinite(r.savedAt)||!Number.isInteger(r.model)||!['1','4','5'].includes(String(r.model)))throw new Error('Damaged local save.');
  return {...r,file:fromBase64(r.data)};
}
export function writeAuto(storage,hash,model,file,expectedToken,token,now=Date.now()) {
  const current=readAuto(storage,hash);
  if((current?.token??null)!==expectedToken)throw new Error('Another tab updated this save. Reload the ROM before saving automatically.');
  if(typeof token!=='string'||token.length>100)throw new Error('Invalid save token.');
  if(file?.length>MAX_LEGACY_SESSION_BYTES)throw new Error('SD card automatic saves require IndexedDB. Export a session file to keep this state.');
  const text=JSON.stringify({version:1,romHash:hash,model,token,savedAt:now,data:toBase64(file)});
  if(text.length>850000)throw new Error('SD card automatic saves require IndexedDB. Export a session file to keep this state.');
  storage.setItem(autoKey(hash),text);
  return token;
}
