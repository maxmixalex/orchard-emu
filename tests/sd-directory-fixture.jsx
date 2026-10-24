// SPDX-License-Identifier: MIT
// Actual browser filesystem handles (origin-private test storage) with a small
// explicit Worker acknowledgement adapter. No firmware/OS-mount claim is made.
import React,{useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Button,MantineProvider} from '@mantine/core';
import '@mantine/core/styles.css';
import i18n from '../web/i18n.js';
import {SDCard} from '../web/SDCard.jsx';
import {CalculatorController} from '../web/controller.js';
import {CALCULATORS} from '../web/catalog.js';
import {addSDFiles,deleteSDEntry,listSDDirectory,readSDFile} from '../web/sd-filesystem.js';
import {createSDImage} from '../web/sd-card.js';
import {DirectoryStore} from '../web/directory-storage.js';
let card=null;
const messages=[];window.__messages=messages;window.__i18n=i18n;
const worker={terminate(){},postMessage(data){
  const message=structuredClone(data);messages.push(message);
  queueMicrotask(()=>{
    if(message.type==='run'||message.type==='pause')controller.patch({running:message.type==='run'});
    else if(message.type==='sd-insert'){
      if(window.__rejectInsertOnce){window.__rejectInsertOnce=false;
        controller.receive({type:'sd-error',generation:message.generation,message:'Injected insertion rejection'});return;}
      card=message.bytes;
      controller.patch({sd:{present:true,bytes:card.length,writeProtected:message.writeProtected,dirty:false,readBlocks:0,writtenBlocks:0}});
      controller.receive({type:'sd-complete',action:'insert',name:message.name,generation:message.generation});
    }else if(message.type==='sd-edit'){
      listSDDirectory(card);const copy=new Uint8Array(card);card=null;
      controller.receive({type:'sd-edited',bytes:copy,generation:message.generation});
    }
  });
}};
const controller=new CalculatorController({database:null,worker,download(bytes,name){
  const url=URL.createObjectURL(new Blob([bytes])),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}});
controller.patch({model:CALCULATORS.find(model=>model.id===5),ready:true,loaded:true,prefs:{...controller.state.prefs,autosave:false}});
window.__controller=controller;
window.__storedDirectory=()=>new DirectoryStore().read(controller.state.model.hash);
window.__cardFile=path=>Array.from(readSDFile(card,path));
window.__cardHash=async()=>card?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',card)),value=>value.toString(16).padStart(2,'0')).join(''):null;
window.__saveCard=async()=>{
  const origin=await navigator.storage.getDirectory(),file=await origin.getFileHandle('saved-card.img',{create:true}),stream=await file.createWritable();
  await stream.write(card);await stream.close();
};
window.__restoreCard=async(blank=false)=>{
  const origin=await navigator.storage.getDirectory();window.__directoryRoot=await origin.getDirectoryHandle('fixture-source');
  card=blank?createSDImage():new Uint8Array(await(await(await origin.getFileHandle('saved-card.img')).getFile()).arrayBuffer());
  controller.sdDirectory=null;controller.patch({sd:{present:true,bytes:card.length,writeProtected:false,dirty:false,readBlocks:0,writtenBlocks:0}});
};
window.__setHostFile=async(path,bytes)=>{
  const names=path.split('/');let parent=window.__directoryRoot;
  for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name,{create:true});
  const file=await parent.getFileHandle(names.at(-1),{create:true}),stream=await file.createWritable();
  await stream.write(new Uint8Array(bytes));await stream.close();
};
window.__getHostFile=async path=>{
  const names=path.split('/');let parent=window.__directoryRoot;
  for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name);
  const file=await(await parent.getFileHandle(names.at(-1))).getFile();return Array.from(new Uint8Array(await file.arrayBuffer()));
};
window.__prepareDirectory=async()=>{
  const origin=await navigator.storage.getDirectory();window.__directoryRoot=await origin.getDirectoryHandle('fixture-source',{create:true});
  await window.__setHostFile('ANSWER',[0,255,13,10]);await window.__setHostFile('PROGRAMS/NESTED',[1,2,3]);
  await window.__setHostFile('notes long.随意',[4,5]);await window.__setHostFile('README',[6]);
  await window.__directoryRoot.getDirectoryHandle('Empty folder',{create:true});
  window.showDirectoryPicker=async options=>{window.__pickerOptions=options;return window.__directoryRoot;};
};
window.__guestChanges=()=>{
  const path=controller.sdDirectory.mappings.find(entry=>entry.source==='notes long.随意').card;
  card=addSDFiles(deleteSDEntry(card,'/ANSWER'),'/',[{name:'ANSWER',bytes:new Uint8Array([42])}]);
  card=addSDFiles(deleteSDEntry(card,path),'/',[{name:path.slice(1),bytes:new Uint8Array([99])}]);
  card=deleteSDEntry(card,'/README');card=addSDFiles(card,'/',[{name:'GUEST.ANY',bytes:new Uint8Array([8,0,255])}]);
  controller.patch({sd:{...controller.state.sd,dirty:true,writtenBlocks:5}});
};
function Fixture(){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot),[open,setOpen]=useState(true);
  return <MantineProvider><Button onClick={()=>setOpen(true)}>Open SD sidebar</Button>
    <aside aria-label="SD tools" hidden={!open} style={{width:'100%',maxWidth:560,boxSizing:'border-box'}}>
      <Button onClick={()=>setOpen(false)}>Close</Button><SDCard controller={controller} state={state}/>
    </aside></MantineProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
