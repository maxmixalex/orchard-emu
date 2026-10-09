// SPDX-License-Identifier: MIT
// Physical KeyboardEvent.code tokens, never layout-dependent typed characters.
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
