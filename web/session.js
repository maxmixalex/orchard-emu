// SPDX-License-Identifier: MIT
// Portable local file envelope. Integrity checks are not a signature/authentication.
const MAGIC=new TextEncoder().encode('ORCHARD1');
export const MAX_STATE=600000+32*1024*1024;
const MAX_META=4096;
export const MAX_SESSION_BYTES=12+MAX_META+MAX_STATE;
export const MAX_LEGACY_SESSION_BYTES=12+MAX_META+600000;
export async function sha256(bytes){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
function metadata(m){
  if(!m||m.schema!==1||![1,2,3,4,5,6].includes(m.model)||
     !/^[0-9a-f]{64}$/.test(m.romHash)||!/^[0-9a-f]{64}$/.test(m.stateHash)||
     !['strict','hp39-home','hp48-home','hp49-home'].includes(m.preset)||![0,1].includes(m.frameView)||
     (m.preset==='hp39-home'&&m.model!==1)||(m.preset==='hp48-home'&&m.model!==4)||(m.preset==='hp49-home'&&m.model!==5))
    throw new Error('This is not a compatible Orchard session.');
}
export async function encodeSession({model,romHash,preset,frameView,state}){
  if(!(state instanceof Uint8Array)||!state.length||state.length>([5,6].includes(model)?MAX_STATE:600000))throw new Error('Invalid session size.');
  const m={schema:1,model,romHash,preset,frameView,stateHash:await sha256(state)};metadata(m);
  const text=new TextEncoder().encode(JSON.stringify(m));
  const out=new Uint8Array(12+text.length+state.length);
  out.set(MAGIC);new DataView(out.buffer).setUint32(8,text.length,true);out.set(text,12);out.set(state,12+text.length);
  return out;
}
export async function decodeSession(buffer){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<12||buffer.byteLength>MAX_SESSION_BYTES)throw new Error('Invalid session file size.');
  const bytes=new Uint8Array(buffer);
  if(!MAGIC.every((b,i)=>b===bytes[i]))throw new Error('Choose an Orchard session file, not a ROM.');
  const n=new DataView(buffer).getUint32(8,true);
  if(n===0||n>MAX_META||12+n>=bytes.length||bytes.length-12-n>MAX_STATE)throw new Error('Invalid session header.');
  let m;
  try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+n)));}
  catch{throw new Error('The session header is damaged.');}
  metadata(m);
  if(bytes.length-12-n>([5,6].includes(m.model)?MAX_STATE:600000))throw new Error('Invalid session size for this calculator.');
  const state=bytes.slice(12+n);
  if(await sha256(state)!==m.stateHash)throw new Error('The session file is damaged or incomplete.');
  return {...m,state};
}
