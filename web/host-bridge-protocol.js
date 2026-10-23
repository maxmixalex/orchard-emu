// SPDX-License-Identifier: MIT
// The HTTP bridge transports bounded USB requests, never ROMs or guest state.
export const BRIDGE_PROTOCOL=1,BRIDGE_MAX_URB=65536,BRIDGE_MAX_BODY=262144,BRIDGE_MAX_EVENTS=8,BRIDGE_MAX_PENDING=64;
export const BRIDGE_DEFAULT_URL='http://127.0.0.1:8125';
export function bridgeError(code,detail=''){const error=new Error(detail||code);error.code=code;return error;}
export function bridgeAddress(value){
 const match=typeof value==='string'&&/^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/.exec(value);
 if(!match||Number(match[1])<1||Number(match[1])>65535)throw bridgeError('hostBridgeInvalidAddress');return 'http://127.0.0.1:'+Number(match[1]);
}
export function bridgeToken(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(value))throw bridgeError('hostBridgeInvalidToken');return value;}
export function encodeBridgeBytes(bytes,max=BRIDGE_MAX_URB){
 if(!(bytes instanceof Uint8Array)||bytes.length>max)throw bridgeError('hostBridgeProtocol');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
}
export function decodeBridgeBytes(text,max=BRIDGE_MAX_URB){
 if(typeof text!=='string'||text.length>Math.ceil(max/3)*4||text.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))throw bridgeError('hostBridgeProtocol');
 const binary=atob(text);if(binary.length>max)throw bridgeError('hostBridgeProtocol');return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
