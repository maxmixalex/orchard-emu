// SPDX-License-Identifier: MIT
// Directory grants and synchronization baselines stay in browser IndexedDB.
// They are separate from ROM records and portable calculator checkpoints.
import {mapDirectoryNames} from './directory-card.js';
const fail=()=>{throw Object.assign(new Error('directoryStorage'),{code:'directoryStorage'});};
function validate(key,value){
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))fail();
  if(value===null)return null;
  if(value?.version!==1||value.key!==key||!Number.isFinite(value.savedAt)||value.association?.handle?.kind!=='directory'||
    typeof value.association.handle.values!=='function'||typeof value.association.name!=='string'||
    !Number.isInteger(value.association.serial)||value.association.serial<1||value.association.serial>0xffffffff||
    !Array.isArray(value.association.mappings)||!Array.isArray(value.association.baseline))fail();
  const mappings=value.association.mappings;
  if(mappings.length>16000||new Set(mappings.map(entry=>entry.card)).size!==mappings.length||new Set(mappings.map(entry=>entry.source)).size!==mappings.length)fail();
  try{
    mapDirectoryNames({entries:value.association.baseline});
    for(const entry of mappings){
      if(!['directory','file'].includes(entry.type)||typeof entry.source!=='string'||typeof entry.card!=='string'||!entry.card.startsWith('/'))fail();
      mapDirectoryNames({entries:[{source:entry.source,type:entry.type,...(entry.type==='file'?{bytes:new Uint8Array()}:{} )}]});
      if(!/^\/(?:[A-Z0-9!#$%&'()\-@^_`{}~]{1,8}(?:\.[A-Z0-9!#$%&'()\-@^_`{}~]{1,3})?)(?:\/(?:[A-Z0-9!#$%&'()\-@^_`{}~]{1,8}(?:\.[A-Z0-9!#$%&'()\-@^_`{}~]{1,3})?))*$/.test(entry.card))fail();
    }
  }catch{fail();}
  return value;
}
export class DirectoryStore{
  constructor(database=globalThis.indexedDB){this.database=database;this.opening=null;}
  open(){
    if(!this.database)return Promise.reject(Object.assign(new Error('directoryStorage'),{code:'directoryStorage'}));
    if(!this.opening)this.opening=new Promise((resolve,reject)=>{
      const request=this.database.open('orchard-directories',1);let failed=false;
      request.onupgradeneeded=()=>request.result.createObjectStore('bindings');
      request.onerror=request.onblocked=()=>{failed=true;this.opening=null;reject(Object.assign(new Error('directoryStorage'),{code:'directoryStorage'}));};
      request.onsuccess=()=>{const db=request.result;if(failed){db.close();return;}
        db.onversionchange=()=>{db.close();this.opening=null;};resolve(db);};
    });
    return this.opening;
  }
  async read(key){
    validate(key,null);const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('bindings','readonly'),query=tx.objectStore('bindings').get(key);
      tx.oncomplete=()=>{try{resolve(query.result?validate(key,query.result):null);}catch(error){reject(error);}};
      tx.onabort=()=>reject(Object.assign(new Error('directoryStorage'),{code:'directoryStorage'}));
    });
  }
  async write(key,association,current=()=>true){
    const record=validate(key,{version:1,key,association,savedAt:Date.now()}),db=await this.open();
    if(!current())return null;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('bindings','readwrite');tx.objectStore('bindings').put(record,key);
      tx.oncomplete=()=>resolve(record);tx.onabort=()=>reject(Object.assign(new Error('directoryStorage'),{code:'directoryStorage'}));
    });
  }
  async forget(key){
    validate(key,null);const db=await this.open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('bindings','readwrite');tx.objectStore('bindings').delete(key);
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(Object.assign(new Error('directoryStorage'),{code:'directoryStorage'}));
    });
  }
}
