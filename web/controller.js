// SPDX-License-Identifier: MIT
// Owns one Worker. React receives only changed controls; pixels use a separate
// subscription so LCD refresh never rerenders settings or the PC keyboard.
import { CALCULATORS, identifyROM } from './catalog.js';
import { MAX_SESSION_BYTES } from './session.js';
import { AUTO_PREFIX, readPreferences, writePreferences, validatePreferences,
  readAuto, writeAuto, sessionName } from './preferences.js';
import { MAX_FILE_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename, validateUpload, transferCapabilities } from './file-transfer.js';
export class CalculatorController {
  constructor({worker, storage=null, locks=null, mayRun=()=>true, download=()=>{}, now=()=>new Date()}={}) {
    this.worker=worker; this.storage=storage; this.locks=locks; this.mayRun=mayRun;
    this.download=download; this.now=now; this.listeners=new Set(); this.frames=new Set();
    this.generation=0; this.selection=0; this.dead=false; this.pending=null; this.last=null;
    this.autoRequest=0; this.autoPending=null; this.autoBlocked=false; this.autoToken=null;
    this.writer=crypto.randomUUID(); this.dialogs=[]; this.dialogId=0;
    this.transferRequest=0;this.received=new Map();this.receivedId=0;
    this.state={model:CALCULATORS[0],prefs:readPreferences(storage),ready:false,loaded:false,running:false,
      busy:false,stopped:false,note:null,dialog:null,serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:'',
      transfer:null,receivedFiles:[],transferListing:''};
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
  linksReset(){++this.transferRequest;this.received.clear();this.patch({serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:'',transfer:null,receivedFiles:[],transferListing:''});}
  create(model=this.state.model,rom=null){
    ++this.generation;clearTimeout(this.autoTimer);this.autoPending=null;this.autoBlocked=false;this.autoToken=null;this.awaitingRestore=false;
    this.pending=rom;this.last=null;this.linksReset();this.patch({model,loaded:false,running:false,stopped:false,busy:Boolean(rom),note:null});
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
  setPreferences(value){const previous=this.state.prefs;const prefs=validatePreferences(value);this.patch({prefs});this.send('configure',{speed:prefs.speed});
    try{writePreferences(this.storage,prefs);}catch(e){this.report('storageError',e.message);}
    if(prefs.autosave&&!previous.autosave)this.autoBlocked=false;
    this.scheduleAuto();
  }
  async loadedROM(){const token=this.generation;this.awaitingRestore=true;
    try{const {prefs,model}=this.state;const saved=prefs.autosave&&this.storage?readAuto(this.storage,model.hash):null;this.autoToken=saved?.token??null;
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
  requestAuto(){const s=this.state;if(!s.prefs.autosave||!this.storage||!s.loaded||s.busy||s.stopped||this.autoBlocked||this.awaitingRestore){this.scheduleAuto();return;}
    if(this.autoPending)return;this.autoPending={request:++this.autoRequest,generation:this.generation,model:s.model};this.send('checkpoint-auto',{request:this.autoRequest});}
  async acceptAuto(data){const r=this.autoPending;if(!r||r.request!==data.request||r.generation!==this.generation)return;
    try{const put=()=>{if(this.dead||!this.state.prefs.autosave||r.generation!==this.generation||this.autoPending!==r)return;
      this.autoToken=writeAuto(this.storage,r.model.hash,r.model.id,data.file,this.autoToken,`${this.writer}:${r.request}`);this.patch({note:'autoSaved'});};
      if(this.locks)await this.locks.request('orchard-autosave:'+r.model.hash,put);else put();
    }catch(e){this.autoBlocked=true;this.patch({note:'autoStopped'});this.report('storageError',e.message);}
    finally{if(this.autoPending===r){this.autoPending=null;this.scheduleAuto();}}
  }
  foreignSave(key){if(key===AUTO_PREFIX+this.state.model.hash&&this.state.loaded&&this.state.prefs.autosave){this.autoBlocked=true;this.autoPending=null;clearTimeout(this.autoTimer);this.patch({note:'foreignSave'});}}
  async clearSaves(){if(!await this.ask('deleteSaves','deleteSavesConfirm','delete','cancel'))return;
    try{this.autoPending=null;for(let i=this.storage.length-1;i>=0;--i){const key=this.storage.key(i);if(key?.startsWith(AUTO_PREFIX))this.storage.removeItem(key);}
      this.autoToken=null;this.autoBlocked=false;this.patch({note:'savesDeleted'});this.scheduleAuto();
    }catch(e){this.report('storageError',e.message);}}
  log(text){this.patch({log:(this.state.log+text+'\n').slice(-16000)});}
  connectLink(transport,connected){
    if(!['serial','usb'].includes(transport)||!this.state.ready||!this.state.loaded||this.state.busy)return;
    if(!connected&&this.state.transfer?.transport===transport)this.cancelTransfer();
    if(connected&&!this.state.running&&!this.state.stopped)this.send('run');
    this.send(transport==='usb'?'usb-connect':'serial-connect',{connected});
  }
  async startTransfer(mode,transport,{file=null,name=''}={}){
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active)return;
    const token=this.generation,request=++this.transferRequest;
    try{
      if(!['send','receive','get','directory','finish'].includes(mode)||!['serial','usb'].includes(transport))throw Error('Invalid file transfer.');
      if(!transferCapabilities(s.model.id,transport)[mode])throw Error('This file operation is not available for the selected calculator and connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw Error('Connect the selected link first.');
      if(mode==='send'){
        if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw Error(`Choose a file of 1–${MAX_FILE_BYTES} bytes.`);
        name=validateFilename(name||file.name);
      }else if(mode==='get')name=validateFilename(name);
      this.patch({transfer:{request,active:true,phase:'preparing',transport,direction:mode,name,transferred:0,total:file?.size??0,error:null},transferListing:''});
      const bytes=mode==='send'?new Uint8Array(await file.arrayBuffer()):undefined;
      if(this.dead||token!==this.generation||request!==this.transferRequest)return;
      if(bytes&&bytes.length!==file.size)throw Error('The file changed while being read.');
      if(bytes)validateUpload(this.state.model.id,name,bytes);
      if(!this.state.ready||!this.state.loaded||this.state.busy||this.state.stopped)throw Error('The calculator is not ready for transfer.');
      if(transport==='usb'?!this.state.usbReady:!this.state.serial)throw Error('The selected link disconnected while preparing the transfer.');
      // Choosing a local file can blur the page and pause the calculator.
      // An explicit transfer action resumes it before starting the protocol.
      if(!this.state.running)this.send('run');
      this.send('file-transfer-start',{request,mode,transport,name,...(bytes?{bytes}:{})});
    }catch(error){
      if(this.dead||token!==this.generation||request!==this.transferRequest)return;
      this.patch({transfer:{request,active:false,phase:'error',transport,direction:mode,name,transferred:0,total:0,error:String(error.message||error)}});
    }
  }
  cancelTransfer(){const current=this.state.transfer;if(!current?.active)return;
    this.send('file-transfer-cancel',{request:current.request});
    this.endTransfer('cancelled');
  }
  endTransfer(phase,error=null){const current=this.state.transfer;if(!current?.active)return;
    // Invalidate a pending File.arrayBuffer() and any late messages immediately.
    ++this.transferRequest;this.patch({transfer:{...current,active:false,phase,error}});
  }
  transferStatus(data){
    if(data.request!==this.transferRequest||this.state.transfer?.request!==data.request||!this.state.transfer.active)return;
    const {type,generation,...status}=data;
    this.patch({transfer:{...this.state.transfer,...status}});
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
        this.patch({loaded:data.loaded,running:data.running,stopped:data.stopped});for(const f of this.frames)f(data);
        if(stopped)this.report('compatibilityError');break;}
      case 'checkpoint-auto-saved':void this.acceptAuto(data);break;
      case 'checkpoint-skipped':if(data.request===this.autoPending?.request){this.autoPending=null;this.scheduleAuto(5000);}break;
      case 'autosave-error':this.autoPending=null;this.autoBlocked=true;this.patch({note:'autoStopped'});this.report('storageError',data.message);break;
      case 'checkpoint-saved':this.autoPending=null;this.patch({busy:false,running:false,note:'exported'});
        Promise.resolve(this.download(data.file,sessionName(this.state.model.id,this.now()))).catch(e=>this.report('saveError',e.message));this.scheduleAuto();break;
      case 'checkpoint-restored':this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false,note:'restored'});this.scheduleAuto();break;
      case 'error':this.endTransfer('error','The calculator operation stopped.');if(this.awaitingRestore)this.autoBlocked=true;this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false});this.report('operationFailed',data.message);this.scheduleAuto();break;
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
    ++this.transferRequest;this.received.clear();this.worker.terminate();this.listeners.clear();this.frames.clear();}
}
