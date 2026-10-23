// SPDX-License-Identifier: MIT
// Local ROM references are separate from calculator state. Handles reopen the
// original file; the portable fallback is explicitly labelled as a local copy.
import {CALCULATORS} from './catalog.js';

export const ROM_DATABASE='orchard-roms';
export class ROMAccessError extends Error {
  constructor(code,cause=null){super(code,{cause});this.code=code;}
}
export function romRecordInfo(record){
  return {model:record.model,hash:record.hash,name:record.name,kind:record.kind,savedAt:record.savedAt};
}
function validRecord(record){
  if(!record)return null;
  const model=CALCULATORS.find(c=>c.id===record.model&&c.hash===record.hash);
  if(record.version!==1||!model||typeof record.name!=='string'||record.name.length>255||
     !Number.isFinite(record.savedAt)||!['handle','copy'].includes(record.kind)||
     (record.kind==='handle'?record.handle?.kind!=='file'||typeof record.handle.getFile!=='function':
       !(record.file instanceof Blob)||record.file.size!==model.bytes))throw new ROMAccessError('storage');
  return record;
}
export async function readRememberedROM(record,{request=false}={}){
  validRecord(record);
  if(!record)throw new ROMAccessError('missing');
  if(record.kind==='copy')return new File([record.file],record.name);
  try{
    // requestPermission is only called by the explicit Continue/Open button.
    const permission=request?await record.handle.requestPermission({mode:'read'}):
      await record.handle.queryPermission({mode:'read'});
    if(permission!=='granted')throw new ROMAccessError('permission');
    return await record.handle.getFile();
  }catch(error){
    if(error instanceof ROMAccessError)throw error;
    if(error?.name==='NotAllowedError'||error?.name==='SecurityError')throw new ROMAccessError('permission',error);
    throw new ROMAccessError('missing',error);
  }
}
export class ROMStore {
  constructor(database=globalThis.indexedDB){this.database=database;this.opening=null;}
  open(){
    if(!this.database)return Promise.reject(new ROMAccessError('storage'));
    if(!this.opening)this.opening=new Promise((resolve,reject)=>{
      const request=this.database.open(ROM_DATABASE,1);let failed=false;
      request.onupgradeneeded=()=>request.result.createObjectStore('roms');
      request.onblocked=()=>{failed=true;this.opening=null;reject(new ROMAccessError('storage'));};
      request.onerror=()=>{failed=true;this.opening=null;reject(new ROMAccessError('storage',request.error));};
      request.onsuccess=()=>{const db=request.result;if(failed){db.close();return;}
        db.onversionchange=()=>{db.close();this.opening=null;};resolve(db);};
    });
    return this.opening;
  }
  async list(){
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('roms','readonly'),store=tx.objectStore('roms');
      const entries=store.getAll(),last=store.get('last');
      tx.oncomplete=()=>{try{
        const records=entries.result.filter(r=>r&&typeof r==='object').map(validRecord);
        resolve({records,last:records.find(r=>r.model===last.result)??null});
      }catch(error){reject(error);}};
      tx.onabort=()=>reject(new ROMAccessError('storage',tx.error));
    });
  }
  async remember(model,file,handle=null,current=()=>true){
    const record=validRecord({version:1,model:model.id,hash:model.hash,
      name:String(file.name||handle?.name||model.name+'.bin').slice(0,255),savedAt:Date.now(),
      ...(handle?{kind:'handle',handle}:{kind:'copy',file})});
    const db=await this.open();if(!current())return null;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('roms','readwrite'),store=tx.objectStore('roms');
      store.put(record,model.id);store.put(model.id,'last');
      tx.oncomplete=()=>resolve(record);tx.onabort=()=>reject(new ROMAccessError('storage',tx.error));
    });
  }
  async clear(){
    const db=await this.open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('roms','readwrite');tx.objectStore('roms').clear();
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new ROMAccessError('storage',tx.error));
    });
  }
}
