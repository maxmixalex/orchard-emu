// SPDX-License-Identifier: MIT
// Owns one Worker. React receives only changed controls; pixels use a separate
// subscription so LCD refresh never rerenders settings or the PC keyboard.
import {prepareHp39Files,MAX_HP39_HOST_FILES} from './hp39-transfer.js';
import {readHp39Archive,writeHp39Archive,MAX_HP39_ARCHIVE_BYTES} from './hp39-archive.js';
import {inspectHp39File,validateHp39Filename} from './hp39-files.js';
import {validateHp39WireFile} from './hp39-wire.js';
import { CALCULATORS, identifyROM } from './catalog.js';
import { MAX_SESSION_BYTES } from './session.js';
import { createSDImage, validateSDSize, sdImageName } from './sd-card.js';
import { AutoSaveStore, AUTO_SIGNAL_PREFIX } from './autosave.js';
import { AUTO_PREFIX, readPreferences, writePreferences, validatePreferences,
  readAuto, writeAuto, sessionName } from './preferences.js';
import { MAX_FILE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename, validateUpload, transferCapabilities } from './file-transfer.js';
export class CalculatorController {
  constructor({worker, storage=null, database=globalThis.indexedDB, locks=null, mayRun=()=>true, download=()=>{}, now=()=>new Date()}={}) {
    this.worker=worker; this.storage=storage;this.autoStore=database?new AutoSaveStore(storage,database):null; this.locks=locks; this.mayRun=mayRun;
    this.download=download; this.now=now; this.listeners=new Set(); this.frames=new Set();
    this.generation=0; this.selection=0; this.dead=false; this.pending=null; this.last=null;
    this.autoRequest=0; this.autoPending=null; this.autoBlocked=false; this.autoToken=null;
    this.writer=crypto.randomUUID(); this.dialogs=[]; this.dialogId=0;
    this.transferRequest=0;this.received=new Map();this.receivedId=0;this.uploadQueue=null;
    this.state={model:CALCULATORS[0],prefs:readPreferences(storage),ready:false,loaded:false,running:false,
      busy:false,stopped:false,note:null,dialog:null,sd:null,sdName:'orchard-sd.img',serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:'',
      transfer:null,uploadBatch:null,receivedFiles:[],transferListing:''};
    worker.onmessage=({data})=>this.receive(data);
    worker.onerror=()=>{this.endTransfer('error','The calculator worker stopped.');this.patch({ready:false,running:false,busy:false});this.report('workerFailure');};
  }
  subscribe=(fn)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  getSnapshot=()=>this.state;
  onFrame(fn){this.frames.add(fn);if(this.last)fn(this.last);return()=>this.frames.delete(fn);}
  patch(update){if(this.dead)return; if(Object.entries(update).every(([k,v])=>this.state[k]===v))return;
    this.state={...this.state,...update};for(const fn of this.listeners)fn();}
  send(type,extra={}){if(!this.dead)this.worker.postMessage({type,generation:this.generation,...extra});}
  ask(title,message,ok='ok',cancel=null,values={}){if(this.dead)return Promise.resolve(null);
    return new Promise(resolve=>{this.dialogs.push({id:++this.dialogId,title,message,ok,cancel,values,resolve});this.nextDialog();});}
  nextDialog(){if(!this.state.dialog&&this.dialogs.length)this.patch({dialog:this.dialogs.shift()});}
  answer(value){const d=this.state.dialog;if(!d)return;this.patch({dialog:null});d.resolve(value);this.nextDialog();}
  report(message='operationFailed',detail=''){return this.ask('error',message,'ok',null,{detail:String(detail)});}
  linksReset(){++this.transferRequest;this.uploadQueue=null;this.received.clear();this.patch({serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:'',transfer:null,uploadBatch:null,receivedFiles:[],transferListing:''});}
  create(model=this.state.model,rom=null){
    ++this.generation;clearTimeout(this.autoTimer);this.autoPending=null;this.autoBlocked=false;this.autoToken=null;this.awaitingRestore=false;
    this.pending=rom;this.last=null;this.linksReset();this.patch({model,loaded:false,running:false,stopped:false,busy:Boolean(rom),note:null,sd:null,sdName:'orchard-sd.img'});
    this.send('create',{model:model.id,preset:model.preset,audience:'calculator'});this.send('configure',{speed:this.state.prefs.speed});
  }
  async open(file){if(!file||!this.state.ready||this.state.busy)return;
    if(this.state.loaded){this.send('pause');if(!await this.ask('open','replaceMemory','open','cancel'))return;}
    const token=++this.selection;this.patch({busy:true});this.send('pause');
    try{if(!CALCULATORS.some(c=>c.bytes===file.size))throw Error('Expected a complete 1 MiB or 2 MiB NOR.');
      const rom=await file.arrayBuffer(),model=await identifyROM(rom);
      if(this.dead||token!==this.selection)return;this.create(model,rom);
    }catch(e){if(!this.dead&&token===this.selection){this.patch({busy:false});this.report('romError',e.message);}}
  }
  async select(id){const model=CALCULATORS.find(c=>c.id===Number(id));if(!model||this.state.busy)return;
    if(this.state.loaded){this.pause();if(!await this.ask('model','replaceMemory','switch','cancel'))return;}
    ++this.selection;this.create(model);
  }
  toggle(){if(!this.state.loaded||this.state.busy||this.state.stopped)return;if(this.state.running)this.pause();else this.send('run');}
  pause(){if(this.state.loaded){this.cancelTransfer();this.send('pause');}}
  release(){if(this.state.loaded)this.send('release');}
  tap(scans){if(this.state.loaded&&this.state.running&&!this.state.busy&&!this.state.stopped)this.send('tap-sequence',{scans});}
  async restart(){if(!this.state.loaded||this.state.busy)return;this.pause();
    if(await this.ask('restart','clearMemory','restart','cancel')){this.autoPending=null;this.send('reset');this.send('configure',{speed:this.state.prefs.speed});if(this.mayRun(this.state.prefs))this.send('run');}}
  save(){if(!this.state.loaded||this.state.busy)return;this.cancelTransfer();this.autoPending=null;this.patch({busy:true});this.send('checkpoint-save');}
  async restore(file){if(!file||!this.state.loaded||this.state.busy)return;this.pause();
    if(!await this.ask('restore','replaceMemory','restore','cancel'))return;
    const token=this.generation;this.autoPending=null;this.patch({busy:true});
    try{if(file.size>MAX_SESSION_BYTES)throw Error('Session too large.');const bytes=await file.arrayBuffer();
      if(!this.dead&&token===this.generation)this.send('checkpoint-load',{file:bytes});
    }catch(e){if(!this.dead&&token===this.generation){this.patch({busy:false});this.report('sessionError',e.message);}}
  }
  async insertSD(file=null,writeProtected=false){
    const s=this.state;if(this.dead||!s.loaded||s.busy||![5,6].includes(s.model.id)||s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return;
    const token=this.generation;this.autoPending=null;this.patch({busy:true});
    try{
      if(file)validateSDSize(file.size);
      const bytes=file?new Uint8Array(await file.arrayBuffer()):createSDImage();
      validateSDSize(bytes.length);
      if(this.dead||token!==this.generation)return;
      this.send('sd-insert',{bytes,writeProtected:Boolean(writeProtected),name:sdImageName(file?.name)});
    }catch(e){if(!this.dead&&token===this.generation){this.patch({busy:false});this.report('sdError',e.message);}}
  }
  exportSD(){
    const s=this.state;if(!s.loaded||s.busy||!s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return;
    this.patch({busy:true});this.send('sd-export');
  }
  async ejectSD(){
    const s=this.state;if(!s.loaded||s.busy||!s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return;
    const token=this.generation;
    if(s.sd.dirty&&!await this.ask('sdEject','sdEjectConfirm','sdEject','cancel'))return;
    if(this.dead||token!==this.generation)return;
    this.autoPending=null;this.patch({busy:true});this.send('sd-eject');
  }
  setPreferences(value){const previous=this.state.prefs;const prefs=validatePreferences(value);this.patch({prefs});this.send('configure',{speed:prefs.speed});
    try{writePreferences(this.storage,prefs);}catch(e){this.report('storageError',e.message);}
    if(prefs.autosave&&!previous.autosave)this.autoBlocked=false;
    this.scheduleAuto();
  }
  async loadedROM(){const token=this.generation;this.awaitingRestore=true;
    try{const {prefs,model}=this.state;const saved=prefs.autosave?(this.autoStore?await this.autoStore.read(model.hash):this.storage?readAuto(this.storage,model.hash):null):null;
      if(this.dead||token!==this.generation)return;this.autoToken=saved?.token??null;
      if(saved){const restore=await this.ask('restoreLocal','localSaveTime','restore','startNew',{time:new Date(saved.savedAt).toLocaleString()});
        if(this.dead||token!==this.generation)return;
        if(restore===null){this.awaitingRestore=false;this.autoBlocked=true;this.patch({note:'localKept'});return;}
        if(restore){this.patch({busy:true});this.send('checkpoint-load',{file:saved.file.buffer});return;}}
      this.awaitingRestore=false;if(this.mayRun(this.state.prefs))this.send('run');this.scheduleAuto();
    }catch(e){if(!this.dead&&token===this.generation){this.autoBlocked=true;this.awaitingRestore=false;this.report('storageError',e.message);}}
  }
  scheduleAuto(delay=this.state.prefs.interval*1000){clearTimeout(this.autoTimer);
    if(!this.dead&&this.state.prefs.autosave&&this.state.loaded&&!this.autoBlocked&&!this.awaitingRestore)
      this.autoTimer=setTimeout(()=>this.requestAuto(),delay);}
  requestAuto(){const s=this.state;if(!s.prefs.autosave||(!this.storage&&!this.autoStore)||!s.loaded||s.busy||s.stopped||this.autoBlocked||this.awaitingRestore){this.scheduleAuto();return;}
    if(this.autoPending)return;this.autoPending={request:++this.autoRequest,generation:this.generation,model:s.model};this.send('checkpoint-auto',{request:this.autoRequest});}
  async acceptAuto(data){const r=this.autoPending;if(!r||r.request!==data.request||r.generation!==this.generation)return;
    const valid=()=>!this.dead&&this.state.prefs.autosave&&r.generation===this.generation&&this.autoPending===r;
    try{
      const put=async()=>{if(!valid())return;
        const token=this.autoStore?await this.autoStore.write(r.model.hash,r.model.id,data.file,this.autoToken,`${this.writer}:${r.request}`,valid):
          writeAuto(this.storage,r.model.hash,r.model.id,data.file,this.autoToken,`${this.writer}:${r.request}`);
        if(valid()&&token!==null){this.autoToken=token;this.patch({note:'autoSaved'});}};
      if(this.locks)await this.locks.request('orchard-autosave:'+r.model.hash,put);else await put();
    }catch(e){if(valid()){this.autoBlocked=true;this.patch({note:'autoStopped'});this.report('storageError',e.message);}}
    finally{if(this.autoPending===r){this.autoPending=null;this.scheduleAuto();}}
  }
  foreignSave(key){if((key===AUTO_PREFIX+this.state.model.hash||key===AUTO_SIGNAL_PREFIX+this.state.model.hash||key==='orchard:autosave-clear:v2')&&this.state.loaded&&this.state.prefs.autosave){this.autoBlocked=true;this.autoPending=null;clearTimeout(this.autoTimer);this.patch({note:'foreignSave'});}}
  async clearSaves(){if(!await this.ask('deleteSaves','deleteSavesConfirm','delete','cancel'))return;
    try{this.autoPending=null;if(this.autoStore)await this.autoStore.clear();
      for(let i=(this.storage?.length??0)-1;i>=0;--i){const key=this.storage.key(i);if(key?.startsWith(AUTO_PREFIX)||key?.startsWith(AUTO_SIGNAL_PREFIX))this.storage.removeItem(key);}
      this.storage?.setItem('orchard:autosave-clear:v2',crypto.randomUUID());
      this.autoToken=null;this.autoBlocked=false;this.patch({note:'savesDeleted'});this.scheduleAuto();
    }catch(e){this.report('storageError',e.message);}}
  log(text){this.patch({log:(this.state.log+text+'\n').slice(-16000)});}
  connectLink(transport,connected){
    if(!['serial','usb'].includes(transport)||!this.state.ready||!this.state.loaded||this.state.busy)return;
    if(!connected&&this.state.transfer?.transport===transport)this.cancelTransfer();
    if(connected&&!this.state.running&&!this.state.stopped)this.send('run');
    this.send(transport==='usb'?'usb-connect':'serial-connect',{connected});
  }
  remainingReceiveBudget(){
    return {files:MAX_RECEIVE_FILES-this.received.size,
      bytes:MAX_RECEIVE_BYTES-[...this.received.values()].reduce((n,f)=>n+f.bytes.length,0)};
  }
  async startTransfer(mode,transport,{file=null,name=''}={}){
    if(transferCapabilities(this.state.model.id,transport).serve&&['send','receive'].includes(mode))return this.startHp39Server(transport,mode==='send'?[{file,name:name||file?.name}]:[]);
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active)return;
    const token=this.generation,request=++this.transferRequest;
    try{
      if(!['send','receive','get','directory','finish'].includes(mode)||!['serial','usb'].includes(transport))throw Error('Invalid file transfer.');
      if(!transferCapabilities(s.model.id,transport)[mode])throw Error('This file operation is not available for the selected calculator and connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw Error('Connect the selected link first.');
      if(mode==='send'){
        if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw Error(`Choose a file of 1–${MAX_FILE_BYTES} bytes.`);
        name=validateFilename(name||file.name);
      }else if(mode==='get')name=validateFilename(name);
      this.patch({transfer:{request,active:true,phase:'preparing',transport,direction:mode,name,transferred:0,total:file?.size??0,error:null},uploadBatch:null,transferListing:''});
      const bytes=mode==='send'?new Uint8Array(await file.arrayBuffer()):undefined;
      if(this.dead||token!==this.generation||request!==this.transferRequest)return;
      if(bytes&&bytes.length!==file.size)throw Error('The file changed while being read.');
      if(bytes)validateUpload(this.state.model.id,name,bytes);
      if(!this.state.ready||!this.state.loaded||this.state.busy||this.state.stopped)throw Error('The calculator is not ready for transfer.');
      if(transport==='usb'?!this.state.usbReady:!this.state.serial)throw Error('The selected link disconnected while preparing the transfer.');
      // Choosing a local file can blur the page and pause the calculator.
      // An explicit transfer action resumes it before starting the protocol.
      if(!this.state.running)this.send('run');
      this.send('file-transfer-start',{request,mode,transport,name,receiveBudget:this.remainingReceiveBudget(),...(bytes?{bytes}:{})});
    }catch(error){
      if(this.dead||token!==this.generation||request!==this.transferRequest)return;
      this.patch({transfer:{request,active:false,phase:'error',transport,direction:mode,name,transferred:0,total:0,error:String(error.message||error)}});
    }
  }
  async startHp39Server(transport,files=[],{protocol='disk'}={}){
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active)return;
    const generation=this.generation,request=++this.transferRequest;
    try{
      if(!['disk','wire'].includes(protocol))throw Error('Choose a valid HP39 transfer mode.');
      if(!transferCapabilities(s.model.id,transport).serve)throw Error('HP39 file serving is unavailable on this connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw Error('Connect the selected link first.');
      if(!Array.isArray(files)||files.length>MAX_HP39_HOST_FILES+2)throw Error('Choose at most 16 HP39 objects and their two directory files, or one ZIP package.');
      const archive=files.some(entry=>/\.zip$/i.test(entry?.file?.name||''));
      if(archive&&files.length!==1)throw Error('Select one HP39 ZIP package, or select its extracted calculator files together.');
      const seen=new Set();let total=0;
      const selected=files.map(entry=>{const file=entry?.file,name=archive?file.name:validateHp39Filename(entry?.name||file?.name),key=name.toUpperCase();
        if(!archive&&(name.length>64||seen.has(key)))throw Error('Use unique HP39 filenames of at most 64 bytes.');seen.add(key);
        if(!file||!Number.isSafeInteger(file.size)||file.size<8||file.size>(archive?MAX_HP39_ARCHIVE_BYTES:MAX_FILE_BYTES))throw Error(archive?'Choose an HP39 ZIP package of at most 32 MiB.':'Choose HP39 typed files of 8 bytes to 2 MiB.');
        total+=file.size;if(!archive&&total>MAX_UPLOAD_BYTES)throw Error('The selected HP39 files exceed 8 MiB.');return {file,name};});
      this.patch({uploadBatch:null,transferListing:'',transfer:{request,active:true,phase:'preparing',transport,direction:'serve',name:'',transferred:0,total,error:null}});
      const loaded=[];
      for(const entry of selected){
        if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
        const bytes=new Uint8Array(await entry.file.arrayBuffer());
        if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
        if(bytes.length!==entry.file.size)throw Error('An HP39 file changed while being read.');loaded.push({name:entry.name,bytes});
      }
      const prepared=archive?await readHp39Archive(loaded[0].bytes,{cancelled:()=>this.dead||generation!==this.generation||request!==this.transferRequest}):prepareHp39Files(loaded);
      if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
      if(!this.state.ready||!this.state.loaded||this.state.busy||this.state.stopped||(transport==='usb'?!this.state.usbReady:!this.state.serial))throw Error('The selected calculator connection is no longer ready.');
      if(protocol==='wire'){
        const entries=prepared.filter(entry=>inspectHp39File(entry.bytes).kind!=='A').map(entry=>{
          const info=validateHp39WireFile(entry.name,entry.bytes);
          return {...entry,size:entry.bytes.length,library:info.kind==='H'};
        }).sort((a,b)=>Number(b.library)-Number(a.library));
        if(!entries.length)throw Error('Choose at least one binary HP39 object for Wire upload.');
        const total=entries.reduce((sum,entry)=>sum+entry.size,0);
        const queue={generation,request,transport,protocol:'hp39-wire',entries,index:0,completedBytes:0};
        this.uploadQueue=queue;
        this.patch({uploadBatch:{active:true,protocol:'hp39-wire',completed:0,total,transferred:0,
          items:entries.map(entry=>({name:entry.name,size:entry.size,phase:'queued',transferred:0}))}});
        this.sendNextUpload(queue);return;
      }
      if(!this.state.running)this.send('run');
      this.send('file-transfer-start',{request,mode:'serve',transport,files:prepared,receiveBudget:this.remainingReceiveBudget()});
    }catch(error){
      if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
      this.patch({transfer:{request,active:false,phase:'error',transport,direction:'serve',name:'',transferred:0,total:0,error:String(error.message||error)}});
    }
  }
  async startUploadBatch(transport,files){
    if(transferCapabilities(this.state.model.id,transport).serve)return this.startHp39Server(transport,files);
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active)return;
    const generation=this.generation,request=++this.transferRequest;let queue=null;
    try{
      if(!['serial','usb'].includes(transport)||!transferCapabilities(s.model.id,transport).send)throw Error('This file operation is not available for the selected calculator and connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw Error('Connect the selected link first.');
      if(!Array.isArray(files)||files.length<1||files.length>MAX_UPLOAD_FILES)throw Error(`Choose 1–${MAX_UPLOAD_FILES} files.`);
      const names=new Set();let total=0;
      const entries=files.map(entry=>{
        const file=entry?.file,name=validateFilename(entry?.name||file?.name);
        if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw Error(`Each file must contain 1–${MAX_FILE_BYTES} bytes.`);
        if(names.has(name))throw Error('Choose a different calculator name for each file.');
        names.add(name);total+=file.size;
        if(total>MAX_UPLOAD_BYTES)throw Error('The selected files exceed the 8 MiB upload limit.');
        return {file,name,size:file.size};
      });
      queue={generation,request,transport,entries,index:-1,completedBytes:0};this.uploadQueue=queue;
      this.patch({transfer:{request,active:true,phase:'preparing',transport,direction:'send',name:'',transferred:0,total,error:null},
        uploadBatch:{active:true,completed:0,total,transferred:0,items:entries.map(e=>({name:e.name,size:e.size,phase:'queued',transferred:0}))},transferListing:''});
      // Validate every complete file before the first calculator transaction.
      // Reading sequentially also lets cancellation stop unstarted local reads.
      for(let i=0;i<entries.length;i++){
        if(this.dead||this.uploadQueue!==queue||generation!==this.generation||request!==this.transferRequest)return;
        const entry=entries[i];this.updateUploadItem(i,{phase:'preparing'});
        if(this.dead||this.uploadQueue!==queue||generation!==this.generation||request!==this.transferRequest)return;
        try{
          const bytes=new Uint8Array(await entry.file.arrayBuffer());
          if(this.dead||this.uploadQueue!==queue||generation!==this.generation||request!==this.transferRequest)return;
          if(bytes.length!==entry.size)throw Error('A file changed while being read.');
          validateUpload(s.model.id,entry.name,bytes);entry.bytes=bytes;delete entry.file;
        }catch(error){throw Error(`${entry.name}: ${String(error.message||error)}`);}
        this.updateUploadItem(i,{phase:'queued'});
      }
      queue.index=0;this.sendNextUpload(queue);
    }catch(error){
      if(this.dead||generation!==this.generation||request!==this.transferRequest||queue&&this.uploadQueue!==queue)return;
      const message=String(error.message||error);
      if(queue)this.endTransfer('error',message);
      else this.patch({uploadBatch:null,transfer:{request,active:false,phase:'error',transport,direction:'send',name:'',transferred:0,total:0,error:message}});
    }
  }
  updateUploadItem(index,update){
    const batch=this.state.uploadBatch;if(!batch?.active)return;
    this.patch({uploadBatch:{...batch,items:batch.items.map((item,i)=>i===index?{...item,...update}:item)}});
  }
  sendNextUpload(queue){
    if(this.dead||this.uploadQueue!==queue||queue.generation!==this.generation)return;
    const s=this.state;
    if(!s.ready||!s.loaded||s.busy||s.stopped||(queue.transport==='usb'?!s.usbReady:!s.serial)){
      this.endTransfer('error','The calculator connection is not ready for the next file.');return;
    }
    if(queue.index>0)queue.request=++this.transferRequest;
    const entry=queue.entries[queue.index],bytes=entry.bytes;
    this.patch({transfer:{request:queue.request,active:true,phase:'negotiating',transport:queue.transport,protocol:queue.protocol,direction:'send',name:entry.name,transferred:0,total:entry.size,error:null},
      uploadBatch:{...s.uploadBatch,items:s.uploadBatch.items.map((item,i)=>i===queue.index?{...item,phase:'sending',transferred:0}:item)}});
    // Subscribers may cancel or replace the machine while the state is posted.
    if(this.dead||this.uploadQueue!==queue||queue.generation!==this.generation)return;
    if(!this.state.running)this.send('run');
    this.send('file-transfer-start',{request:queue.request,mode:'send',transport:queue.transport,...(queue.protocol?{protocol:queue.protocol}:{}),name:entry.name,bytes,receiveBudget:this.remainingReceiveBudget()});
    // The Worker owns a structured clone; pending files stay bounded locally.
    delete entry.bytes;
  }
  stopUploadBatch(phase,error){
    const queue=this.uploadQueue,batch=this.state.uploadBatch;if(!queue||!batch?.active)return;
    this.uploadQueue=null;
    this.patch({uploadBatch:{...batch,active:false,items:batch.items.map((item,i)=>{
      if(item.phase==='complete')return item;
      const started=i===queue.index&&item.phase==='sending';
      return {...item,phase:started?phase:'not-sent',...(started&&error?{error}:{})};
    })}});
  }
  cancelTransfer(){const current=this.state.transfer;if(!current?.active&&!this.uploadQueue)return;
    if(current?.active)this.send('file-transfer-cancel',{request:current.request});
    this.endTransfer('cancelled');
  }
  endTransfer(phase,error=null){const current=this.state.transfer;if(!current?.active&&!this.uploadQueue)return;
    // Invalidate a pending File.arrayBuffer() and any late messages immediately.
    ++this.transferRequest;this.stopUploadBatch(phase,error);this.patch({transfer:{...current,active:false,phase,error}});
  }
  transferStatus(data){
    if(data.request!==this.transferRequest||this.state.transfer?.request!==data.request||!this.state.transfer.active)return;
    const previous=this.state.transfer,{type,generation,...status}=data,now=Number(this.now());
    const changed=previous.phase!==status.phase||previous.name!==status.name||previous.transferred!==status.transferred;
    const transfer={...previous,...status,startedAt:previous.startedAt??now,
      fileStartedAt:previous.name!==status.name||previous.phase==='serving'?now:previous.fileStartedAt??now,
      progressAt:changed?now:previous.progressAt??now};
    const queue=this.uploadQueue,batch=this.state.uploadBatch;
    if(!queue||queue.request!==data.request||!batch?.active){this.patch({transfer});return;}
    const index=queue.index,item=batch.items[index];if(!item){this.patch({transfer});return;}
    const transferred=Number.isFinite(data.transferred)?Math.max(0,Math.min(item.size,data.transferred)):item.transferred;
    const update={transferred,...(data.name?{storedName:data.name}:{})};
    if(data.active){
      this.patch({transfer,uploadBatch:{...batch,transferred:queue.completedBytes+transferred,
        items:batch.items.map((entry,i)=>i===index?{...entry,...update,phase:'sending'}:entry)}});return;
    }
    if(data.phase!=='complete'){
      this.uploadQueue=null;
      this.patch({transfer,uploadBatch:{...batch,active:false,transferred:queue.completedBytes+transferred,items:batch.items.map((entry,i)=>{
        if(i<index)return entry;
        return i===index?{...entry,...update,phase:data.phase==='cancelled'?'cancelled':'error',error:data.error}:{...entry,phase:'not-sent'};
      })}});return;
    }
    queue.completedBytes+=item.size;queue.index++;
    const active=queue.index<queue.entries.length;if(!active)this.uploadQueue=null;
    this.patch({transfer,uploadBatch:{...batch,active,completed:queue.index,transferred:queue.completedBytes,
      items:batch.items.map((entry,i)=>i===index?{...entry,...update,phase:'complete',transferred:item.size}:entry)}});
    if(active)this.sendNextUpload(queue);
  }
  acceptTransferredFile(data){
    if(data.request!==this.transferRequest||this.state.transfer?.request!==data.request||!this.state.transfer.active)return;
    try{
      if(!(data.bytes instanceof Uint8Array)||data.bytes.length>MAX_FILE_BYTES||typeof data.name!=='string')throw Error('Invalid received file.');
      const bytes=[...this.received.values()].reduce((n,f)=>n+f.bytes.length,0);
      if(this.received.size>=MAX_RECEIVE_FILES||bytes+data.bytes.length>MAX_RECEIVE_BYTES)throw Error('Download and clear received files before receiving more.');
      // A calculator name is a label, never a host filesystem path.
      const name=data.name.replace(/[\\/\x00-\x1f\x7f]/g,'_').replace(/^\.+$/,'_').slice(0,128)||'calculator-file';
      const id=++this.receivedId;this.received.set(id,{name,bytes:data.bytes.slice()});
      this.patch({receivedFiles:[...this.state.receivedFiles,{id,name,size:data.bytes.length}]});
    }catch(error){this.send('file-transfer-cancel',{request:data.request});++this.transferRequest;
      this.patch({transfer:{...this.state.transfer,active:false,phase:'error',error:String(error.message||error)}});}
  }
  downloadTransferredFile(id){const f=this.received.get(id);if(!f)return;
    Promise.resolve().then(()=>this.download(f.bytes,f.name)).catch(e=>this.report('saveError',e.message));
  }
  async downloadHp39Package(){
    if(this.dead||!transferCapabilities(this.state.model.id).serve||!this.received.size)return;
    try{
      // A disk replaces a repeated name. Keep individual earlier downloads in
      // the list while the exported package uses each name's latest version.
      const latest=new Map();for(const file of this.received.values())latest.set(file.name.toUpperCase(),file);
      const bytes=writeHp39Archive([...latest.values()]);
      await this.download(bytes,'orchard-hp39-files.zip');
    }catch(e){this.report('saveError',e.message);}
  }
  acceptTransferListing(data){
    if(data.request!==this.transferRequest||this.state.transfer?.request!==data.request||!this.state.transfer.active)return;
    if(typeof data.text!=='string'||data.text.length>MAX_LISTING_BYTES){
      this.send('file-transfer-cancel',{request:data.request});
      this.endTransfer('error','The calculator directory exceeds the 64 KiB limit.');return;
    }
    this.patch({transferListing:data.text});
  }
  clearTransferredFiles(){if(this.state.transfer?.active)return;this.received.clear();this.patch({receivedFiles:[],transferListing:''});}
  receive(data){if(this.dead||!data)return;
    if(data.type==='ready'){this.patch({ready:true});this.create();return;}
    if(data.type==='fatal'){this.endTransfer('error','The calculator worker stopped.');this.patch({ready:false,loaded:false,running:false,busy:false});this.report('workerFailure',data.message);return;}
    if(data.generation!==this.generation)return;
    switch(data.type){
      case 'created':if(this.pending){const rom=this.pending;this.pending=null;this.send('load',{rom});}else this.patch({busy:false});break;
      case 'loaded':this.patch({loaded:true,busy:false});void this.loadedROM();break;
      case 'snapshot':{const stopped=!this.state.stopped&&data.stopped;this.last=data;
        if(data.stopped)this.endTransfer('error','The calculator stopped.');
        const sd=data.sd===undefined?this.state.sd:JSON.stringify(data.sd)===JSON.stringify(this.state.sd)?this.state.sd:data.sd;
        this.patch({loaded:data.loaded,running:data.running,stopped:data.stopped,sd});for(const f of this.frames)f(data);
        if(stopped)this.report('compatibilityError');break;}
      case 'checkpoint-auto-saved':void this.acceptAuto(data);break;
      case 'checkpoint-skipped':if(data.request===this.autoPending?.request){this.autoPending=null;this.scheduleAuto(5000);}break;
      case 'autosave-error':this.autoPending=null;this.autoBlocked=true;this.patch({note:'autoStopped'});this.report('storageError',data.message);break;
      case 'checkpoint-saved':this.autoPending=null;this.patch({busy:false,running:false,note:'exported'});
        Promise.resolve(this.download(data.file,sessionName(this.state.model.id,this.now()))).catch(e=>this.report('saveError',e.message));this.scheduleAuto();break;
      case 'checkpoint-restored':this.patch({sdName:'orchard-sd.img'});this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false,note:'restored'});this.scheduleAuto();break;
      case 'error':this.endTransfer('error','The calculator operation stopped.');if(this.awaitingRestore)this.autoBlocked=true;this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false});this.report('operationFailed',data.message);this.scheduleAuto();break;
      case 'sd-complete':this.patch({busy:false,note:data.action==='insert'?'sdInserted':'sdEjected',...(data.action==='insert'?{sdName:sdImageName(data.name)}:{})});this.scheduleAuto();break;
      case 'sd-exported':this.patch({busy:false,note:'sdExported'});Promise.resolve(this.download(data.bytes,sdImageName(this.state.sdName))).catch(e=>this.report('saveError',e.message));break;
      case 'sd-error':this.patch({busy:false});this.report('sdError',data.message);this.scheduleAuto();break;
      case 'links-reset':this.linksReset();break;
      case 'serial-status':this.patch({serial:data.connected});if(!data.connected&&this.state.transfer?.transport==='serial')this.cancelTransfer();break;
      case 'uart-output':this.log('RX '+Array.from(data.bytes,b=>b.toString(16).padStart(2,'0')).join(' '));break;
      case 'uart-sent':this.log(`TX ${data.accepted}/${data.requested}`);break;
      case 'usb-status':this.patch({usb:data.connected,usbReady:data.phase==='Connected',usbPhase:data.phase,usbInfo:data.info||this.state.usbInfo});if(!data.connected&&this.state.transfer?.transport==='usb')this.cancelTransfer();if(data.error)this.report('usbError',data.error);break;
      case 'usb-packet':this.log(`USB ${data.direction}: ${data.status} ${data.bytes?Array.from(data.bytes,b=>b.toString(16).padStart(2,'0')).join(' '):data.accepted??''}`);break;
      case 'file-transfer-status':this.transferStatus(data);break;
      case 'file-transfer-received':this.acceptTransferredFile(data);break;
      case 'file-transfer-listing':this.acceptTransferListing(data);break;
    }
  }
  dispose(){if(this.dead)return;this.dead=true;++this.selection;clearTimeout(this.autoTimer);this.autoPending=null;
    this.state.dialog?.resolve(null);for(const d of this.dialogs)d.resolve(null);this.dialogs=[];
    ++this.transferRequest;this.uploadQueue=null;this.received.clear();this.worker.terminate();this.listeners.clear();this.frames.clear();}
}
