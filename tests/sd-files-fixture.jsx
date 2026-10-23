// SPDX-License-Identifier: MIT
// ROM-free component gate: real controller and downloads, explicit Worker ack.
import React,{useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {Button,MantineProvider} from '@mantine/core';
import '@mantine/core/styles.css';
import i18n from '../web/i18n.js';
import {SDCard} from '../web/SDCard.jsx';
import {CalculatorController} from '../web/controller.js';
import {CALCULATORS} from '../web/catalog.js';

crypto.randomUUID=()=> 'sd-files-offline-test';
const messages=[];window.__messages=messages;window.__i18n=i18n;
const controller=new CalculatorController({database:null,worker:{postMessage:data=>messages.push(data),terminate(){}},
  download(bytes,name){
    if(window.__failDownload)throw new Error('Fixture download failure');
    const url=URL.createObjectURL(new Blob([bytes])),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }});
controller.patch({model:CALCULATORS.find(model=>model.id===5),ready:true,loaded:true});
window.__controller=controller;
window.__ackInsert=()=>{
  const message=messages.filter(item=>item.type==='sd-insert').at(-1);
  controller.patch({sd:{present:true,bytes:message.bytes.length,writeProtected:message.writeProtected,dirty:false,readBlocks:0,writtenBlocks:0}});
  controller.receive({type:'sd-complete',action:'insert',generation:controller.generation,name:message.name});
};
function Fixture(){
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot),[open,setOpen]=useState(true);
  return <MantineProvider><Button onClick={()=>setOpen(true)}>Open SD sidebar</Button>
    <aside aria-label="SD tools" hidden={!open} style={{width:'100%',maxWidth:560,boxSizing:'border-box'}}>
      <Button onClick={()=>setOpen(false)}>Close</Button>
      <SDCard controller={controller} state={state} onClose={()=>setOpen(false)}/>
    </aside></MantineProvider>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
