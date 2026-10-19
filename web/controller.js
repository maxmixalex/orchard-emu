// SPDX-License-Identifier: MIT
// Owns one Worker. React receives only changed controls; pixels use a separate
// subscription so LCD refresh never rerenders settings or the PC keyboard.
import { CALCULATORS } from './catalog.js';
import {readFirmware} from './firmware-install.js';
import { MAX_SESSION_BYTES } from './session.js';
import { AUTO_PREFIX, readPreferences, writePreferences, validatePreferences,
  readAuto, writeAuto, sessionName } from './preferences.js';
export class CalculatorController {
  constructor({worker, storage=null, locks=null, mayRun=()=>true, download=()=>{}, now=()=>new Date()}={}) {
    this.worker=worker; this.storage=storage; this.locks=locks; this.mayRun=mayRun;
    this.download=download; this.now=now; this.listeners=new Set(); this.frames=new Set();
    this.generation=0; this.selection=0; this.dead=false; this.pending=null; this.last=null;
    this.autoRequest=0; this.autoPending=null; this.autoBlocked=false; this.autoToken=null;
    this.writer=crypto.randomUUID(); this.dialogs=[]; this.dialogId=0;
    this.state={model:CALCULATORS[0],prefs:readPreferences(storage),ready:false,loaded:false,running:false,
      busy:false,stopped:false,note:null,dialog:null,serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:''};
    worker.onmessage=({data})=>this.receive(data);
    worker.onerror=()=>{this.patch({ready:false,running:false,busy:false});this.report('workerFailure');};
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
  linksReset(){this.patch({serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:''});}
  create(model=this.state.model,rom=null){
    ++this.generation;clearTimeout(this.autoTimer);this.autoPending=null;this.autoBlocked=false;this.autoToken=null;this.awaitingRestore=false;
    this.pending=rom;this.last=null;this.linksReset();this.patch({model,loaded:false,running:false,stopped:false,busy:Boolean(rom),note:null});
    this.send('create',{model:model.id,preset:model.preset,audience:'calculator'});this.send('configure',{speed:this.state.prefs.speed});
  }
  async open(file){if(!file||(Array.isArray(file)&&!file.length)||!this.state.ready||this.state.busy)return;
    if(this.state.loaded){this.send('pause');if(!await this.ask('open','replaceMemory','open','cancel'))return;}
    const token=++this.selection;this.patch({busy:true});this.send('pause');
    try{const {rom,model}=await readFirmware(file);
      if(this.dead||token!==this.selection)return;this.create(model,rom);
    }catch(e){if(!this.dead&&token===this.selection){this.patch({busy:false});this.report('romError',e.message);}}
  }
  async select(id){const model=CALCULATORS.find(c=>c.id===Number(id));if(!model||this.state.busy)return;
    if(this.state.loaded){this.send('pause');if(!await this.ask('model','replaceMemory','switch','cancel'))return;}
    ++this.selection;this.create(model);
  }
  toggle(){if(!this.state.loaded||this.state.busy||this.state.stopped)return;this.send(this.state.running?'pause':'run');}
  pause(){if(this.state.loaded)this.send('pause');}
  release(){if(this.state.loaded)this.send('release');}
  tap(scans){if(this.state.loaded&&this.state.running&&!this.state.busy&&!this.state.stopped)this.send('tap-sequence',{scans});}
  async restart(){if(!this.state.loaded||this.state.busy)return;this.pause();
    if(await this.ask('restart','clearMemory','restart','cancel')){this.autoPending=null;this.send('reset');this.send('configure',{speed:this.state.prefs.speed});if(this.mayRun(this.state.prefs))this.send('run');}}
  save(){if(!this.state.loaded||this.state.busy)return;this.autoPending=null;this.patch({busy:true});this.send('checkpoint-save');}
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
    }catch(e){if(this.dead||token!==this.generation)return;this.autoBlocked=true;this.awaitingRestore=false;this.report('storageError',e.message);}
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
  receive(data){if(this.dead||!data)return;
    if(data.type==='ready'){this.patch({ready:true});this.create();return;}
    if(data.type==='fatal'){this.patch({ready:false,loaded:false,running:false,busy:false});this.report('workerFailure',data.message);return;}
    if(data.generation!==this.generation)return;
    switch(data.type){
      case 'created':if(this.pending){const rom=this.pending;this.pending=null;this.send('load',{rom});}else this.patch({busy:false});break;
      case 'loaded':this.patch({loaded:true,busy:false});void this.loadedROM();break;
      case 'snapshot':{const stopped=!this.state.stopped&&data.stopped;this.last=data;
        this.patch({loaded:data.loaded,running:data.running,stopped:data.stopped});for(const f of this.frames)f(data);
        if(stopped)this.report('compatibilityError');break;}
      case 'checkpoint-auto-saved':void this.acceptAuto(data);break;
      case 'checkpoint-skipped':if(data.request===this.autoPending?.request){this.autoPending=null;this.scheduleAuto(5000);}break;
      case 'autosave-error':this.autoPending=null;this.autoBlocked=true;this.patch({note:'autoStopped'});this.report('storageError',data.message);break;
      case 'checkpoint-saved':this.autoPending=null;this.patch({busy:false,running:false,note:'exported'});
        Promise.resolve(this.download(data.file,sessionName(this.state.model.id,this.now()))).catch(e=>this.report('saveError',e.message));this.scheduleAuto();break;
      case 'checkpoint-restored':this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false,note:'restored'});this.scheduleAuto();break;
      case 'error':if(this.awaitingRestore)this.autoBlocked=true;this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false});this.report('operationFailed',data.message);this.scheduleAuto();break;
      case 'links-reset':this.linksReset();break;
      case 'serial-status':this.patch({serial:data.connected});break;
      case 'uart-output':this.log('RX '+Array.from(data.bytes,b=>b.toString(16).padStart(2,'0')).join(' '));break;
      case 'uart-sent':this.log(`TX ${data.accepted}/${data.requested}`);break;
      case 'usb-status':this.patch({usb:data.connected,usbReady:data.phase==='Connected',usbPhase:data.phase,usbInfo:data.info||this.state.usbInfo});if(data.error)this.report('usbError',data.error);break;
      case 'usb-packet':this.log(`USB ${data.direction}: ${data.status} ${data.bytes?Array.from(data.bytes,b=>b.toString(16).padStart(2,'0')).join(' '):data.accepted??''}`);break;
    }
  }
  dispose(){if(this.dead)return;this.dead=true;++this.selection;clearTimeout(this.autoTimer);this.autoPending=null;
    this.state.dialog?.resolve(null);for(const d of this.dialogs)d.resolve(null);this.dialogs=[];
    this.worker.terminate();this.listeners.clear();this.frames.clear();}
}
