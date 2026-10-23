// SPDX-License-Identifier: MIT
import {AUTO_PREFIX,autoKey,readAuto} from './preferences.js';
import {MAX_SESSION_BYTES} from './session.js';
export const AUTO_SIGNAL_PREFIX='orchard:autosave-signal:v2:';
const conflict=()=>new Error('Another tab updated this save. Reload the ROM before saving automatically.');
function validate(record,hash){
  if(!record)return null;
  if(record.version!==2||record.romHash!==hash||![1,4,5].includes(record.model)||
     typeof record.token!=='string'||record.token.length>100||!Number.isFinite(record.savedAt)||
     !(record.file instanceof Uint8Array)||!record.file.length||record.file.length>MAX_SESSION_BYTES)
    throw new Error('Damaged local save.');
  return record;
}
// IndexedDB stores complete binary sessions, including SD media. The read of
// the prior token and replacement are one transaction, also without Web Locks.
// Legacy small localStorage saves remain readable until successfully replaced.
export class AutoSaveStore{
  constructor(storage,database=globalThis.indexedDB){this.storage=storage;this.database=database;this.opening=null;}
  open(){
    if(!this.opening)this.opening=new Promise((resolve,reject)=>{
      const request=this.database.open('orchard-sessions',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'romHash'});
      request.onerror=()=>{this.opening=null;reject(request.error);};
      request.onblocked=()=>{this.opening=null;reject(new Error('Close older Orchard tabs to open local session storage.'));};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.opening=null;};resolve(db);};
    });
    return this.opening;
  }
  legacy(hash){return this.storage?readAuto(this.storage,hash):null;}
  async read(hash){
    autoKey(hash);const db=await this.open();
    const record=await new Promise((resolve,reject)=>{
      const tx=db.transaction('sessions','readonly'),request=tx.objectStore('sessions').get(hash);
      tx.oncomplete=()=>resolve(request.result);tx.onabort=()=>reject(tx.error||new Error('Local save could not be read.'));
    });
    return validate(record,hash)||this.legacy(hash);
  }
  async write(hash,model,file,expectedToken,token,valid=()=>true){
    autoKey(hash);const record=validate({version:2,romHash:hash,model,file,token,savedAt:Date.now()},hash);
    const db=await this.open();
    const written=await new Promise((resolve,reject)=>{
      const tx=db.transaction('sessions','readwrite'),store=tx.objectStore('sessions'),request=store.get(hash);
      let reason=null,cancelled=false;
      request.onsuccess=()=>{
        try{
          if(!valid()){cancelled=true;tx.abort();return;}
          const current=validate(request.result,hash)||this.legacy(hash);
          if((current?.token??null)!==expectedToken)throw conflict();
          store.put(record);
        }catch(error){reason=error;tx.abort();}
      };
      tx.oncomplete=()=>resolve(true);
      tx.onabort=()=>cancelled?resolve(false):reject(reason||tx.error||new Error('Local save could not be written.'));
    });
    if(written){
      // This is notification metadata only; the binary save already committed.
      try{this.storage?.removeItem(AUTO_PREFIX+hash);this.storage?.setItem(AUTO_SIGNAL_PREFIX+hash,token);}catch{}
    }
    return written?token:null;
  }
  async clear(){
    const db=await this.open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').clear();
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('Local saves could not be deleted.'));
    });
  }
}
