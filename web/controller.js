// SPDX-License-Identifier: MIT
// Owns one Worker. React receives only changed controls; pixels use a separate
// subscription so LCD refresh never rerenders settings or the PC keyboard.
import {prepareHp39Files,MAX_HP39_HOST_FILES} from './hp39-transfer.js';
import {readHp39Archive,writeHp39Archive,isHp39Archive,MAX_HP39_ARCHIVE_BYTES} from './hp39-archive.js';
import {inspectHp39File,validateHp39Filename} from './hp39-files.js';
import {prepareHp39WireFile} from './hp39-wire.js';
import {Hp39WireAutoReceive} from './hp39-wire-auto.js';
import {transferError,transferErrorDetails} from './transfer-errors.js';
import { CALCULATORS, identifyROM } from './catalog.js';
import { MAX_SESSION_BYTES } from './session.js';
import { createSDImage, validateSDSize, sdImageName } from './sd-card.js';
import { AutoSaveStore, AUTO_SIGNAL_PREFIX } from './autosave.js';
import { BuzzerAudio } from './buzzer-audio.js';
import {ROMStore,ROMAccessError,romRecordInfo,readRememberedROM} from './rom-storage.js';
import { AUTO_PREFIX, readPreferences, writePreferences, validatePreferences,
  readAuto, writeAuto, sessionName } from './preferences.js';
import { MAX_FILE_BYTES, MAX_UPLOAD_FILES, MAX_UPLOAD_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename, validateUpload, transferCapabilities } from './file-transfer.js';
import {bridgeAddress,bridgeToken} from './host-bridge-protocol.js';
import {IrDALink,irdaCode,newIrdaCode} from './irda-link.js';
const bridgeDisconnected=()=>({active:false,phase:'disconnected',ready:false,attached:false,usbipPort:null,errorCode:null});
const irdaDisconnected=()=>({active:false,phase:'disconnected',error:null,code:'',peer:null,sent:0,received:0});
export class CalculatorController {
  constructor({worker, storage=null, database=globalThis.indexedDB, locks=null, mayRun=()=>true, download=()=>{}, now=()=>new Date(), audio=null,romStore=undefined}={}) {
    this.worker=worker; this.storage=storage;this.autoStore=database?new AutoSaveStore(storage,database):null; this.locks=locks; this.mayRun=mayRun;
    this.download=download; this.now=now; this.listeners=new Set(); this.frames=new Set();
    this.generation=0; this.selection=0; this.dead=false; this.pending=null; this.last=null;
    this.autoRequest=0; this.autoPending=null; this.autoBlocked=false; this.autoToken=null;
    this.romStore=romStore===undefined?(database?new ROMStore(database):null):romStore;this.romRecords=new Map();this.currentROM=null;this.romStorageEpoch=0;this.automaticROMEpoch=0;
    this.writer=crypto.randomUUID(); this.dialogs=[]; this.dialogId=0;
    this.transferRequest=0;this.received=new Map();this.receivedId=0;this.uploadQueue=null;
    this.sdDirectory=null;this.sdInsertDirectory=null;this.sdEditPending=null;
    this.irdaLink=null;this.irdaInput=new Map();this.irdaRequest=0;
    this.state={model:CALCULATORS[0],prefs:readPreferences(storage),ready:false,loaded:false,running:false,
      busy:false,stopped:false,note:null,dialog:null,sd:null,sdName:'orchard-sd.img',serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:'',
      transfer:null,uploadBatch:null,receivedFiles:[],transferListing:'',effectiveSpeed:1,transferBoosted:false,
      rememberedROMs:[],romSource:null,romIssue:null,hostBridge:bridgeDisconnected(),irda:irdaDisconnected()};
    this.audio=audio||new BuzzerAudio();this.audioLive=false;this.audio.configure(this.state.prefs);
    this.hostBridgeRequest=0;
    worker.onmessage=({data})=>this.receive(data);
    worker.onerror=()=>{this.disconnectIrDA();if(this.state.hostBridge?.active)this.send('host-bridge-stop');this.sdEditPending?.(null);this.sdEditPending=null;this.audioLive=false;this.audio.reset();this.endTransfer('error','The calculator worker stopped.');this.patch({ready:false,running:false,busy:false,hostBridge:bridgeDisconnected()});this.report('workerFailure');};
  }
  subscribe=(fn)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
  getSnapshot=()=>this.state;
  onFrame(fn){this.frames.add(fn);if(this.last)fn(this.last);return()=>this.frames.delete(fn);}
  patch(update){if(this.dead)return; if(Object.entries(update).every(([k,v])=>this.state[k]===v))return;
    this.state={...this.state,...update};for(const fn of this.listeners)fn();}
  send(type,extra={}){if(this.dead)return;
    if(['pause','create','load','reset','checkpoint-save','checkpoint-load'].includes(type))this.disconnectIrDA();
    if(type==='run')this.audioLive=true;
    else if(['pause','create','load','reset','checkpoint-save','checkpoint-load'].includes(type)){this.audioLive=false;this.audio.reset();}
    this.worker.postMessage({type,generation:this.generation,...extra});}
  unlockAudio(){if(!this.dead)void this.audio.unlock();}
  connectIrDA(value){
    if(this.dead||!this.state.loaded||this.state.busy||this.state.stopped)return;
    this.disconnectIrDA();
    try{
      const code=value?irdaCode(value):newIrdaCode();
      if(typeof BroadcastChannel!=='function')return;
      const generation=this.generation;
      this.irdaLink=new IrDALink({code,label:this.state.model.name,
        receive:bytes=>this.receiveIrDA(bytes,generation),notify:status=>{
          if(this.dead||generation!==this.generation)return;
          this.patch({irda:status});this.send('irda-connect',{connected:status.active&&status.phase==='paired'});
        }});
      if(!this.state.running)this.send('run');
    }catch(error){this.patch({irda:{...irdaDisconnected(),phase:'error',error:error.code||'code'}});}
  }
  disconnectIrDA(){
    if(this.irdaLink){const link=this.irdaLink;this.irdaLink=null;link.close();this.send('irda-connect',{connected:false});}
    for(const pending of this.irdaInput.values()){clearTimeout(pending.timer);pending.reject(Error('IrDA disconnected'));}this.irdaInput.clear();
  }
  async receiveIrDA(bytes,generation){
    if(this.dead||generation!==this.generation||!this.irdaLink?.active||!this.state.running)return 0;
    let offset=0,accepted=0,attempt=0;
    while(offset<bytes.length){
      if(this.dead||generation!==this.generation||!this.irdaLink?.active)return accepted;
      const request=++this.irdaRequest;
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{this.irdaInput.delete(request);reject(Error('IrDA worker timeout'));},2000);
        this.irdaInput.set(request,{resolve,reject,timer});this.send('irda-input',{request,bytes:bytes.subarray(offset)});
      });
      if(result.discarded)return accepted; // Inactive transceivers do not retain earlier light.
      offset+=result.accepted;accepted+=result.accepted;
      if(offset<bytes.length){if(++attempt>200)throw Error('IrDA receive overflow');await new Promise(resolve=>setTimeout(resolve,5));}
    }
    return accepted;
  }
  ask(title,message,ok='ok',cancel=null,values={}){if(this.dead)return Promise.resolve(null);
    return new Promise(resolve=>{this.dialogs.push({id:++this.dialogId,title,message,ok,cancel,values,resolve});this.nextDialog();});}
  nextDialog(){if(!this.state.dialog&&this.dialogs.length)this.patch({dialog:this.dialogs.shift()});}
  answer(value){const d=this.state.dialog;if(!d)return;this.patch({dialog:null});d.resolve(value);this.nextDialog();}
  report(message='operationFailed',detail=''){return this.ask('error',message,'ok',null,{detail:String(detail)});}
  linksReset(){++this.transferRequest;this.uploadQueue=null;this.received.clear();this.patch({serial:false,usb:false,usbReady:false,usbInfo:null,usbPhase:'Disconnected',log:'',transfer:null,uploadBatch:null,receivedFiles:[],transferListing:'',effectiveSpeed:this.state.prefs.speed,transferBoosted:false});}
  create(model=this.state.model,rom=null){
    this.disconnectIrDA();
    this.sdEditPending?.(null);this.sdEditPending=null;this.sdDirectory=null;this.sdInsertDirectory=null;
    ++this.generation;clearTimeout(this.autoTimer);this.autoPending=null;this.autoBlocked=false;this.autoToken=null;this.awaitingRestore=false;
    this.pending=rom;this.last=null;this.linksReset();this.patch({model,loaded:false,running:false,stopped:false,busy:Boolean(rom),note:null,sd:null,sdName:'orchard-sd.img',hostBridge:bridgeDisconnected()});
    this.send('create',{model:model.id,preset:model.preset,audience:'calculator'});this.send('configure',{speed:this.state.prefs.speed,transferUnlimited:this.state.prefs.transferUnlimited,sound:this.state.prefs.sound,lcdResponse:this.state.prefs.lcdResponse});
  }
  async chooseROM(fallback){
    if(!this.state.ready||this.state.busy)return;
    const token=++this.selection;
    if(typeof globalThis.showOpenFilePicker!=='function'){fallback();return;}
    try{
      const [handle]=await globalThis.showOpenFilePicker({id:'orchard-rom',multiple:false});
      const file=await handle.getFile();if(this.dead||token!==this.selection)return;
      await this.open(file,{handle,selection:token});
    }catch(error){
      if(this.dead||token!==this.selection||error?.name==='AbortError')return;
      // Embedded/older browsers can expose the API but disallow the picker.
      if(error?.name==='SecurityError'||error?.name==='NotAllowedError'){fallback();return;}
      this.report('romError',error.message);
    }
  }
  async open(file,{handle=null,expectedHash=null,automatic=false,selection=null,automaticEpoch=this.automaticROMEpoch}={}){if(!file||!this.state.ready||this.state.busy)return false;
    const token=selection??++this.selection;if(token!==this.selection)return false;
    const current=()=>!this.dead&&token===this.selection&&(!automatic||(this.state.prefs.rememberROM&&automaticEpoch===this.automaticROMEpoch));
    if(!current())return false;
    if(this.state.loaded){if(automatic)return false;this.send('pause');if(!await this.ask('open','replaceMemory','open','cancel'))return false;}
    if(!current())return false;
    this.patch({busy:true,romIssue:null});this.send('pause');
    try{if(!CALCULATORS.some(c=>c.bytes===file.size))throw Error('Expected a complete 1 MiB or 2 MiB NOR.');
      const rom=await file.arrayBuffer();
      if(!current()){if(!this.dead&&token===this.selection)this.patch({busy:false});return false;}
      const model=await identifyROM(rom);
      if(!current()){if(!this.dead&&token===this.selection)this.patch({busy:false});return false;}
      if(expectedHash&&model.hash!==expectedHash)throw new ROMAccessError('changed');
      this.create(model,rom);
      this.currentROM={file,handle,model};this.patch({romSource:{name:file.name,kind:handle?'handle':'copy'}});
      void this.rememberCurrentROM();return true;
    }catch(e){if(!this.dead&&token===this.selection){this.patch({busy:false});if(!current())return false;
      if(expectedHash)this.patch({romIssue:{code:e.code==='changed'?'changed':'invalid',name:file.name,model:this.state.model.id}});
      else this.report('romError',e.message);}return false;}
  }
  async restoreRememberedROMs(){
    if(!this.romStore)return;
    const token=this.selection,epoch=this.romStorageEpoch;
    try{
      const {records,last}=await this.romStore.list();if(this.dead||epoch!==this.romStorageEpoch)return;
      this.romRecords=new Map(records.map(r=>[r.model,r]));this.patch({rememberedROMs:records.map(romRecordInfo)});
      if(last&&this.state.prefs.rememberROM&&token===this.selection&&!this.state.loaded&&!this.state.busy)
        await this.openRememberedROM(last.model,{automatic:true});
    }catch(error){if(!this.dead&&epoch===this.romStorageEpoch)this.patch({romIssue:{code:'storage',name:''}});}
  }
  async openRememberedROM(model,{automatic=false}={}){
    const record=this.romRecords.get(model);if(!record||this.dead||!this.state.ready||this.state.busy||(automatic&&(this.state.loaded||!this.state.prefs.rememberROM)))return false;
    const token=++this.selection,automaticEpoch=this.automaticROMEpoch;this.patch({romIssue:null});
    const current=()=>!this.dead&&token===this.selection&&(!automatic||(this.state.prefs.rememberROM&&automaticEpoch===this.automaticROMEpoch));
    try{
      const file=await readRememberedROM(record,{request:!automatic});
      if(!current())return false;
      return await this.open(file,{handle:record.kind==='handle'?record.handle:null,expectedHash:record.hash,automatic,selection:token,automaticEpoch});
    }catch(error){if(current())this.patch({romIssue:{code:error.code||'missing',name:record.name,model}});return false;}
  }
  async rememberCurrentROM(){
    const selected=this.currentROM,epoch=this.romStorageEpoch;
    if(!selected||!this.romStore||!this.state.prefs.rememberROM)return;
    const current=()=>!this.dead&&selected===this.currentROM&&epoch===this.romStorageEpoch&&this.state.prefs.rememberROM;
    try{
      const record=await this.romStore.remember(selected.model,selected.file,selected.handle,current);if(!record||!current())return;
      this.romRecords.set(record.model,record);this.patch({rememberedROMs:[...this.romRecords.values()].map(romRecordInfo)});
    }catch(error){if(current())this.patch({romIssue:{code:'storage',name:selected.file.name}});}
  }
  async forgetROMs(){
    if(!this.romStore||this.state.busy)return;
    ++this.selection;++this.romStorageEpoch;
    try{await this.romStore.clear();if(this.dead)return;this.romRecords.clear();this.patch({rememberedROMs:[],romIssue:null});}
    catch(error){if(!this.dead)this.patch({romIssue:{code:'storage',name:''}});}
  }
  async select(id){const model=CALCULATORS.find(c=>c.id===Number(id));if(!model||this.state.busy)return;
    if(this.state.loaded){this.pause();if(!await this.ask('model','replaceMemory','switch','cancel'))return;}
    ++this.selection;this.currentROM=null;this.patch({romSource:null,romIssue:null});this.create(model);
    if(this.state.prefs.rememberROM)void this.openRememberedROM(model.id,{automatic:true});
  }
  toggle(){if(!this.state.loaded||this.state.busy||this.state.stopped)return;if(this.state.running)this.pause();else{this.unlockAudio();this.send('run');}}
  pause(){if(this.state.loaded){this.cancelTransfer();this.send('pause');}}
  release(){if(this.state.loaded)this.send('release');}
  tap(scans){if(this.state.loaded&&this.state.running&&!this.state.busy&&!this.state.stopped){this.stopWireAutoReceive(true);this.unlockAudio();this.send('tap-sequence',{scans});}}
  stopWireAutoReceive(manual=false){this.wireAutoReceive?.cancel();this.wireAutoReceive=null;if(manual&&this.uploadQueue)this.uploadQueue.autoReceive=false;
    if(this.state.transfer?.autoReceive)this.patch({transfer:{...this.state.transfer,autoReceive:false}});}
  continueWireReceive(frame){
    const driver=this.wireAutoReceive;if(!driver)return;
    if(!this.state.transfer?.active||this.state.transfer.protocol!=='hp39-wire'||this.state.transfer.phase!=='negotiating'){this.stopWireAutoReceive();return;}
    const scans=driver.observe(frame);
    if(!driver.active)this.stopWireAutoReceive();
    if(scans)this.send('tap-sequence',{scans});
  }
  systemChord(action){const s=this.state;if(!['self-test','warm-restart'].includes(action)||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active||s.hostBridge?.active)return;
    this.unlockAudio();if(!s.running)this.send('run');this.send('system-chord',{action});}
  async restart(){if(!this.state.loaded||this.state.busy)return;this.pause();
    if(await this.ask('restart','clearMemory','restart','cancel')){this.autoPending=null;this.send('reset');this.send('configure',{speed:this.state.prefs.speed,transferUnlimited:this.state.prefs.transferUnlimited,sound:this.state.prefs.sound,lcdResponse:this.state.prefs.lcdResponse});if(this.mayRun(this.state.prefs))this.send('run');}}
  save(){if(!this.state.loaded||this.state.busy)return;this.cancelTransfer();this.autoPending=null;this.patch({busy:true});this.send('checkpoint-save');}
  async restore(file){if(!file||!this.state.loaded||this.state.busy)return;this.pause();
    if(!await this.ask('restore','replaceMemory','restore','cancel'))return;
    const token=this.generation;this.autoPending=null;this.patch({busy:true});
    try{if(file.size>MAX_SESSION_BYTES)throw Error('Session too large.');const bytes=await file.arrayBuffer();
      if(!this.dead&&token===this.generation)this.send('checkpoint-load',{file:bytes});
    }catch(e){if(!this.dead&&token===this.generation){this.patch({busy:false});this.report('sessionError',e.message);}}
  }
  async insertSD(file=null,writeProtected=false,association=null){
    const s=this.state;if(this.dead||!s.loaded||s.busy||![5,6].includes(s.model.id)||s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return;
    if(s.hostBridge?.active){this.report('sdHostBridgeBusy');return;}
    const token=this.generation;this.autoPending=null;this.sdInsertDirectory=association;this.patch({busy:true});
    try{
      if(file)validateSDSize(file.size);
      const bytes=file?new Uint8Array(await file.arrayBuffer()):createSDImage();
      validateSDSize(bytes.length);
      if(this.dead||token!==this.generation)return;
      if(this.state.hostBridge?.active)throw Object.assign(new Error(),{code:'hostBridgeBusy'});
      this.send('sd-insert',{bytes,writeProtected:Boolean(writeProtected),name:sdImageName(file?.name)});
    }catch(e){if(!this.dead&&token===this.generation){this.sdInsertDirectory=null;this.patch({busy:false});this.report(e.code==='hostBridgeBusy'?'sdHostBridgeBusy':'sdError',e.message);}}
  }
  exportSD(){
    const s=this.state;if(!s.loaded||s.busy||!s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return;
    if(s.hostBridge?.active){this.report('sdHostBridgeBusy');return;}
    this.patch({busy:true});this.send('sd-export');
  }
  editSD(){
    const s=this.state;if(this.dead||!s.loaded||s.busy||!s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return Promise.resolve(null);
    if(s.hostBridge?.active){this.report('sdHostBridgeBusy');return Promise.resolve(null);}
    this.autoPending=null;this.patch({busy:true});
    return new Promise(resolve=>{this.sdEditPending=resolve;this.send('sd-edit');});
  }
  async ejectSD(){
    const s=this.state;if(!s.loaded||s.busy||!s.sd?.present||s.transfer?.active||s.uploadBatch?.active)return;
    if(s.hostBridge?.active){this.report('sdHostBridgeBusy');return;}
    const token=this.generation;
    if(s.sd.dirty&&!await this.ask('sdEject','sdEjectConfirm','sdEject','cancel'))return;
    if(this.dead||token!==this.generation)return;
    if(this.state.hostBridge?.active){this.report('sdHostBridgeBusy');return;}
    this.autoPending=null;this.patch({busy:true});this.send('sd-eject');
  }
  setPreferences(value){const previous=this.state.prefs;const prefs=validatePreferences(value);this.patch({prefs});this.audio.configure(prefs);if(prefs.sound&&!previous.sound)this.unlockAudio();this.send('configure',{speed:prefs.speed,transferUnlimited:prefs.transferUnlimited,sound:prefs.sound,lcdResponse:prefs.lcdResponse});
    if(previous.rememberROM&&!prefs.rememberROM)++this.automaticROMEpoch;
    try{writePreferences(this.storage,prefs);}catch(e){this.report('storageError',e.message);}
    if(prefs.autosave&&!previous.autosave)this.autoBlocked=false;
    if(prefs.rememberROM&&!previous.rememberROM)void this.rememberCurrentROM();
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
  requestAuto(){const s=this.state;if(!s.prefs.autosave||(!this.storage&&!this.autoStore)||!s.loaded||s.busy||s.stopped||s.hostBridge?.active||this.autoBlocked||this.awaitingRestore){this.scheduleAuto();return;}
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
    if(this.state.hostBridge?.active){this.report('hostBridgeDisconnectFirst');return;}
    if(!connected&&this.state.transfer?.transport===transport)this.cancelTransfer();
    if(connected&&!this.state.running&&!this.state.stopped)this.send('run');
    this.send(transport==='usb'?'usb-connect':'serial-connect',{connected});
  }
  connectHostBridge(address,token){
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.hostBridge?.active)return;
    try{address=bridgeAddress(address);token=bridgeToken(token);}catch(error){this.patch({hostBridge:{...bridgeDisconnected(),phase:'error',errorCode:error.code}});return;}
    this.cancelTransfer();this.linksReset();this.patch({hostBridge:{...bridgeDisconnected(),active:true,phase:'connecting'}});
    if(!s.running)this.send('run');this.send('host-bridge-start',{address,token,request:++this.hostBridgeRequest});
  }
  disconnectHostBridge(){if(!this.state.hostBridge?.active)return;++this.hostBridgeRequest;this.send('host-bridge-stop');this.patch({hostBridge:bridgeDisconnected()});}
  remainingReceiveBudget(){
    return {files:MAX_RECEIVE_FILES-this.received.size,
      bytes:MAX_RECEIVE_BYTES-[...this.received.values()].reduce((n,f)=>n+f.bytes.length,0)};
  }
  async startTransfer(mode,transport,{file=null,name=''}={}){
    if(this.state.hostBridge?.active){this.report('hostBridgeDisconnectFirst');return;}
    if(transferCapabilities(this.state.model.id,transport).serve&&['send','receive'].includes(mode))return this.startHp39Server(transport,mode==='send'?[{file,name:name||file?.name}]:[]);
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active)return;
    const token=this.generation,request=++this.transferRequest;
    this.uploadQueue=null;this.patch({uploadBatch:null});
    try{
      if(!['send','receive','get','directory','finish'].includes(mode)||!['serial','usb'].includes(transport))throw Error('Invalid file transfer.');
      if(!transferCapabilities(s.model.id,transport)[mode])throw transferError('unsupportedOperation','This file operation is not available for the selected calculator and connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw transferError('connectFirst','Connect the selected link first.');
      if(mode==='send'){
        if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw transferError('fileSize',`Choose a file of 1–${MAX_FILE_BYTES} bytes.`);
        name=validateFilename(name||file.name);
      }else if(mode==='get')name=validateFilename(name);
      this.patch({transfer:{request,active:true,phase:'preparing',transport,direction:mode,name,transferred:0,total:file?.size??0,error:null,errorCode:null,errorValues:null},uploadBatch:null,transferListing:''});
      const bytes=mode==='send'?new Uint8Array(await file.arrayBuffer()):undefined;
      if(this.dead||token!==this.generation||request!==this.transferRequest)return;
      if(bytes&&bytes.length!==file.size)throw transferError('fileChanged','The file changed while being read.');
      if(bytes)validateUpload(this.state.model.id,name,bytes);
      if(!this.state.ready||!this.state.loaded||this.state.busy||this.state.stopped)throw transferError('calculatorNotReady','The calculator is not ready for transfer.');
      if(transport==='usb'?!this.state.usbReady:!this.state.serial)throw transferError('linkDisconnected','The selected link disconnected while preparing the transfer.');
      // Choosing a local file can blur the page and pause the calculator.
      // An explicit transfer action resumes it before starting the protocol.
      if(!this.state.running)this.send('run');
      this.send('file-transfer-start',{request,mode,transport,name,receiveBudget:this.remainingReceiveBudget(),...(bytes?{bytes}:{})});
    }catch(error){
      if(this.dead||token!==this.generation||request!==this.transferRequest)return;
      this.patch({transfer:{request,active:false,phase:'error',transport,direction:mode,name,transferred:0,total:0,...transferErrorDetails(error)}});
    }
  }
  async startHp39Server(transport,files=[],{protocol='disk',autoReceive=false}={}){
    if(this.state.hostBridge?.active){this.report('hostBridgeDisconnectFirst');return;}
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active)return;
    const generation=this.generation,request=++this.transferRequest;
    this.uploadQueue=null;this.patch({uploadBatch:null});
    try{
      if(!['disk','wire'].includes(protocol))throw Error('Choose a valid HP39 transfer mode.');
      if(!transferCapabilities(s.model.id,transport).serve)throw transferError('unsupportedOperation','HP39 file serving is unavailable on this connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw transferError('connectFirst','Connect the selected link first.');
      if(!Array.isArray(files)||files.length>MAX_HP39_HOST_FILES+2)throw transferError('hp39ObjectLimit','Choose at most 16 HP39 objects and their two directory files, or one ZIP package.');
      let total=0;
      const selected=files.map(entry=>{
        const file=entry?.file,name=String(entry?.name||file?.name||'Unnamed file'),item={file,name,size:0};
        try{
          if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<8||file.size>(files.length===1?MAX_HP39_ARCHIVE_BYTES:MAX_FILE_BYTES))
            throw transferError('hp39ChooseFiles','Choose an HP39 typed file of 8 bytes to 2 MiB, or one ZIP package of at most 32 MiB.');
          item.size=file.size;total+=file.size;
        }catch(error){if(protocol!=='wire')throw {...transferErrorDetails(error),error:`${name}: ${error.message}`};Object.assign(item,transferErrorDetails(error));}
        return item;
      });
      if(files.length!==1&&total>MAX_UPLOAD_BYTES)throw transferError('hp39UploadLimit','The selected HP39 files exceed 8 MiB.');
      this.patch({uploadBatch:null,transferListing:'',transfer:{request,active:true,phase:'preparing',transport,direction:'serve',name:'',transferred:0,total,error:null,errorCode:null,errorValues:null}});
      const loaded=[];
      for(const entry of selected){
        if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
        try{
          if(entry.error){loaded.push(entry);continue;}
          const bytes=new Uint8Array(await entry.file.arrayBuffer());
          if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
          if(bytes.length!==entry.file.size)throw transferError('fileChanged','The file changed while being read.');
          loaded.push({...entry,bytes});
        }catch(error){
          if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
          if(protocol!=='wire')throw {...transferErrorDetails(error),error:`${entry.name}: ${error.message}`};
          loaded.push({...entry,...transferErrorDetails(error)});
        }
      }
      const archives=loaded.filter(entry=>isHp39Archive(entry.bytes));
      if(archives.length&&loaded.length!==1)throw transferError('hp39ArchiveSelection','Select one HP39 ZIP package, or select its extracted calculator files together.');
      const hasDirectory=loaded.some(entry=>entry.bytes?.[7]===65&&String.fromCharCode(...entry.bytes.subarray(0,4))==='HP39');
      // Explicit catalogs and ZIP dependencies still receive complete structural
      // validation. Loose Wire files retain individual format/read errors so a
      // bad selection cannot discard the other selected objects.
      const prepared=archives.length?await readHp39Archive(archives[0].bytes,{cancelled:()=>this.dead||generation!==this.generation||request!==this.transferRequest}):
        protocol==='wire'&&!hasDirectory?loaded:prepareHp39Files(loaded);
      if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
      if(!this.state.ready||!this.state.loaded||this.state.busy||this.state.stopped||(transport==='usb'?!this.state.usbReady:!this.state.serial))throw transferError('calculatorNotReady','The selected calculator connection is no longer ready.');
      if(protocol==='wire'){
        const seen=new Set(),entries=[];
        for(const entry of prepared){
          if(!entry.error&&entry.bytes?.[7]===65&&String.fromCharCode(...entry.bytes.subarray(0,4))==='HP39'&&inspectHp39File(entry.bytes).kind==='A')continue;
          const item={...entry,size:entry.size??entry.bytes?.length??0,library:false};
          try{
            if(item.error)throw item;
            validateHp39Filename(item.name);
            const key=item.name.toUpperCase();
            if(item.name.length>64||seen.has(key))throw transferError('hp39Filename','Use unique HP39 filenames of at most 64 bytes.');
            seen.add(key);
            const prepared=prepareHp39WireFile(item.name,item.bytes);
            item.sourceSize=item.size;item.bytes=prepared.bytes;item.size=prepared.bytes.length;
            item.library=prepared.info.kind==='H';item.objectKind=prepared.info.kind;
            item.noteConverted=prepared.noteConverted;item.sourceBytes=prepared.sourceBytes;
          }catch(error){Object.assign(item,transferErrorDetails(error));}
          entries.push(item);
        }
        entries.sort((a,b)=>Number(b.library)-Number(a.library));
        if(!entries.length)throw transferError('hp39ChooseFiles','Choose at least one HP39 object for Wire upload.');
        if(entries.length>MAX_HP39_HOST_FILES)throw transferError('hp39ObjectLimit','Choose at most 16 HP39 objects.');
        const total=entries.reduce((sum,entry)=>sum+entry.size,0);
        if(total>MAX_UPLOAD_BYTES)throw transferError('hp39UploadLimit','The selected HP39 files exceed 8 MiB.');
        const invalid=entries.findIndex(entry=>entry.error);
        const queue={generation,request,transport,protocol:'hp39-wire',entries,index:invalid<0?0:invalid,completedBytes:0,preflight:invalid>=0,
          autoReceive:autoReceive===true&&transport==='usb'&&[1,2].includes(this.state.model.id),continueReceive:false};
        this.uploadQueue=queue;
        this.patch({uploadBatch:{active:true,recoverable:false,protocol:'hp39-wire',completed:0,total,transferred:0,
          items:entries.map(entry=>({name:entry.name,size:entry.size,phase:'queued',transferred:0}))}});
        this.sendNextUpload(queue);return;
      }
      if(!this.state.running)this.send('run');
      this.send('file-transfer-start',{request,mode:'serve',transport,files:prepared,receiveBudget:this.remainingReceiveBudget()});
    }catch(error){
      if(this.dead||generation!==this.generation||request!==this.transferRequest)return;
      this.stopUploadBatch('error',error);this.uploadQueue=null;
      this.patch({transfer:{request,active:false,phase:'error',transport,direction:'serve',name:'',transferred:0,total:0,...transferErrorDetails(error)}});
    }
  }
  async startUploadBatch(transport,files){
    if(this.state.hostBridge?.active){this.report('hostBridgeDisconnectFirst');return;}
    if(transferCapabilities(this.state.model.id,transport).serve)return this.startHp39Server(transport,files);
    const s=this.state;if(this.dead||!s.ready||!s.loaded||s.busy||s.stopped||s.transfer?.active||s.uploadBatch?.active)return;
    const generation=this.generation,request=++this.transferRequest;let queue=null;
    this.uploadQueue=null;this.patch({uploadBatch:null});
    try{
      if(!['serial','usb'].includes(transport)||!transferCapabilities(s.model.id,transport).send)throw transferError('unsupportedOperation','This file operation is not available for the selected calculator and connection.');
      if(transport==='usb'?!s.usbReady:!s.serial)throw transferError('connectFirst','Connect the selected link first.');
      if(!Array.isArray(files)||files.length<1||files.length>MAX_UPLOAD_FILES)throw transferError('uploadCount',`Choose 1–${MAX_UPLOAD_FILES} files.`,{count:MAX_UPLOAD_FILES});
      const names=new Set();let total=0;
      const entries=files.map(entry=>{
        const file=entry?.file,name=validateFilename(entry?.name||file?.name);
        if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES)throw transferError('fileSize','Each file must contain 1 byte to 2 MiB.');
        if(names.has(name))throw transferError('duplicateFilename','Choose a different calculator name for each file.');
        names.add(name);total+=file.size;
        if(total>MAX_UPLOAD_BYTES)throw transferError('uploadLimit','The selected files exceed the 8 MiB upload limit.');
        return {file,name,size:file.size};
      });
      queue={generation,request,transport,entries,index:-1,completedBytes:0};this.uploadQueue=queue;
      this.patch({transfer:{request,active:true,phase:'preparing',transport,direction:'send',name:'',transferred:0,total,error:null,errorCode:null,errorValues:null},
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
          if(bytes.length!==entry.size)throw transferError('fileChanged','A file changed while being read.');
          validateUpload(s.model.id,entry.name,bytes);entry.bytes=bytes;delete entry.file;
        }catch(error){throw {...transferErrorDetails(error),error:`${entry.name}: ${transferErrorDetails(error).error}`};}
        this.updateUploadItem(i,{phase:'queued'});
      }
      queue.index=0;this.sendNextUpload(queue);
    }catch(error){
      if(this.dead||generation!==this.generation||request!==this.transferRequest||queue&&this.uploadQueue!==queue)return;
      if(queue)this.endTransfer('error',error);
      else this.patch({uploadBatch:null,transfer:{request,active:false,phase:'error',transport,direction:'send',name:'',transferred:0,total:0,...transferErrorDetails(error)}});
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
      this.endTransfer('error',transferError('calculatorNotReady','The calculator connection is not ready for the next file.'));return;
    }
    if(queue.index>0||queue.protocol==='hp39-wire')queue.request=++this.transferRequest;
    const entry=queue.entries[queue.index],bytes=entry.bytes;
    if(entry.error){this.pauseUploadFile(queue,entry);return;}
    this.stopWireAutoReceive();
    if(queue.autoReceive&&queue.continueReceive)this.wireAutoReceive=new Hp39WireAutoReceive({model:s.model.id,transport:queue.transport,previousKind:queue.previousKind,kind:entry.objectKind});
    queue.continueReceive=false;
    this.patch({transfer:{request:queue.request,active:true,phase:'negotiating',transport:queue.transport,protocol:queue.protocol,direction:'send',name:entry.name,objectKind:entry.objectKind,
      autoReceive:Boolean(this.wireAutoReceive?.active),
      noteConverted:entry.noteConverted,sourceBytes:entry.sourceBytes,transferred:0,total:entry.size,error:null,errorCode:null,errorValues:null},
      uploadBatch:{...s.uploadBatch,active:true,recoverable:false,items:s.uploadBatch.items.map((item,i)=>i===queue.index?{...item,phase:'sending',transferred:0,error:null,errorCode:null,errorValues:null}:item)}});
    // Subscribers may cancel or replace the machine while the state is posted.
    if(this.dead||this.uploadQueue!==queue||queue.generation!==this.generation)return;
    try{
      if(!this.state.running)this.send('run');
      this.send('file-transfer-start',{request:queue.request,mode:'send',transport:queue.transport,...(queue.protocol?{protocol:queue.protocol}:{}),name:entry.name,bytes,receiveBudget:this.remainingReceiveBudget()});
    }catch(error){
      // A failed Worker post must not leave a newly numbered request active.
      // The caller may still hold the preceding request's number, so finish
      // this queue transition here and retain Wire's retryable bytes.
      if(this.uploadQueue===queue&&queue.generation===this.generation){
        if(queue.protocol==='hp39-wire')this.pauseUploadFile(queue,error);
        else this.endTransfer('error',error);
      }
      return;
    }
    // Keep Wire bytes until final ACK so a failed item can be retried. The
    // complete queue remains bounded by the same 8 MiB selection limit.
    if(queue.protocol!=='hp39-wire')delete entry.bytes;
  }
  nextWireUpload(queue,items=this.state.uploadBatch.items){
    const pending=queue.entries.map((entry,index)=>({entry,index})).filter(({index})=>items[index].phase==='queued');
    if(queue.preflight){const invalid=pending.find(({entry})=>entry.error);if(invalid)return invalid.index;queue.preflight=false;}
    return (pending.find(({entry})=>entry.library)||pending[0])?.index??-1;
  }
  pauseUploadFile(queue,error,transferred=0){
    if(this.dead||this.uploadQueue!==queue||queue.generation!==this.generation)return;
    this.stopWireAutoReceive();queue.continueReceive=false;
    const batch=this.state.uploadBatch,entry=queue.entries[queue.index];
    queue.request=++this.transferRequest;
    this.patch({effectiveSpeed:this.state.prefs.speed,transferBoosted:false,transfer:{...this.state.transfer,request:queue.request,active:false,phase:'error',transport:queue.transport,
      protocol:queue.protocol,direction:'send',name:entry.name,objectKind:entry.objectKind,noteConverted:entry.noteConverted,sourceBytes:entry.sourceBytes,total:entry.size,transferred,...transferErrorDetails(error)},
      uploadBatch:{...batch,active:false,recoverable:true,index:queue.index,transferred:queue.completedBytes+transferred,
        items:batch.items.map((item,i)=>i===queue.index?{...item,phase:'error',transferred,...transferErrorDetails(error)}:item)}});
  }
  async retryUploadFile(){
    const queue=this.uploadQueue,batch=this.state.uploadBatch;
    if(this.dead||!queue||queue.protocol!=='hp39-wire'||queue.generation!==this.generation||!batch?.recoverable||batch.active)return;
    const entry=queue.entries[queue.index],request=++this.transferRequest;queue.request=request;
    this.patch({uploadBatch:{...batch,active:true,recoverable:false,items:batch.items.map((item,i)=>i===queue.index?{...item,phase:'preparing',error:null,errorCode:null,errorValues:null}:item)},
      transfer:{...this.state.transfer,request,active:true,phase:'preparing',error:null,errorCode:null,errorValues:null}});
    try{
      // Read errors and unsupported local files can be retried without losing
      // the valid selections. A protocol error reuses the exact original bytes.
      if(entry.error){
        if(!entry.file||!Number.isSafeInteger(entry.file.size)||entry.file.size<8||entry.file.size>MAX_FILE_BYTES)throw transferError('hp39ChooseFiles','Choose HP39 typed files of 8 bytes to 2 MiB.');
        const bytes=new Uint8Array(await entry.file.arrayBuffer());
        if(this.dead||this.uploadQueue!==queue||queue.generation!==this.generation||request!==this.transferRequest)return;
        if(bytes.length!==(entry.sourceSize??entry.size))throw transferError('fileChanged','The file changed while being read.');
        const prepared=prepareHp39WireFile(entry.name,bytes);
        if(this.state.uploadBatch.total+prepared.bytes.length-entry.size>MAX_UPLOAD_BYTES)throw transferError('hp39UploadLimit','The selected HP39 files exceed 8 MiB.');
        if(entry.name.length>64||queue.entries.some((other,i)=>i!==queue.index&&batch.items[i].phase!=='skipped'&&other.name.toUpperCase()===entry.name.toUpperCase()))throw transferError('hp39Filename','Use unique HP39 filenames of at most 64 bytes.');
        const oldSize=entry.size;
        entry.sourceSize=bytes.length;entry.bytes=prepared.bytes;entry.size=prepared.bytes.length;
        entry.library=prepared.info.kind==='H';entry.objectKind=prepared.info.kind;
        entry.noteConverted=prepared.noteConverted;entry.sourceBytes=prepared.sourceBytes;
        entry.error=null;entry.errorCode=null;entry.errorValues=null;
        this.patch({uploadBatch:{...this.state.uploadBatch,total:this.state.uploadBatch.total+entry.size-oldSize}});
      }
      if(this.dead||this.uploadQueue!==queue||queue.generation!==this.generation||request!==this.transferRequest)return;
      this.updateUploadItem(queue.index,{phase:'queued',size:entry.size,transferred:0,error:null,errorCode:null,errorValues:null});
      if(queue.preflight)queue.index=this.nextWireUpload(queue);
      this.sendNextUpload(queue);
    }catch(error){if(!this.dead&&this.uploadQueue===queue&&queue.generation===this.generation&&request===this.transferRequest)this.pauseUploadFile(queue,error);}
  }
  skipUploadFile(){
    const queue=this.uploadQueue,batch=this.state.uploadBatch;
    if(this.dead||!queue||queue.protocol!=='hp39-wire'||queue.generation!==this.generation||!batch?.recoverable||batch.active)return;
    const entry=queue.entries[queue.index];delete entry.bytes;delete entry.file;
    const items=batch.items.map((item,i)=>i===queue.index?{...item,phase:'skipped',transferred:0}:item);
    queue.index=this.nextWireUpload(queue,items);
    const active=queue.index>=0;if(!active)this.uploadQueue=null;
    this.patch({uploadBatch:{...batch,active,recoverable:false,transferred:queue.completedBytes,items},
      ...(!active?{transfer:{...this.state.transfer,active:false,phase:'complete',name:'',error:null,errorCode:null,errorValues:null,total:queue.completedBytes,transferred:queue.completedBytes}}:{})});
    if(active)this.sendNextUpload(queue);
  }
  stopUploadBatch(phase,error){
    const queue=this.uploadQueue,batch=this.state.uploadBatch;if(!queue||!batch)return;
    this.uploadQueue=null;
    this.patch({uploadBatch:{...batch,active:false,recoverable:false,items:batch.items.map((item,i)=>{
      if(['complete','skipped','error'].includes(item.phase))return item;
      const started=i===queue.index&&item.phase==='sending';
      return {...item,phase:started?phase:'not-sent',...(started&&error?transferErrorDetails(error):{})};
    })}});
  }
  cancelTransfer(){this.stopWireAutoReceive();const current=this.state.transfer;if(!current?.active&&!this.uploadQueue)return;
    if(current?.active)this.send('file-transfer-cancel',{request:current.request});
    this.endTransfer('cancelled');
  }
  endTransfer(phase,error=null){const current=this.state.transfer;if(!current?.active&&!this.uploadQueue)return;
    this.stopWireAutoReceive();
    // Invalidate a pending File.arrayBuffer() and any late messages immediately.
    ++this.transferRequest;this.stopUploadBatch(phase,error);this.patch({effectiveSpeed:this.state.prefs.speed,transferBoosted:false,transfer:{...current,active:false,phase,...transferErrorDetails(error)}});
  }
  transferStatus(data){
    if(data.request!==this.transferRequest||this.state.transfer?.request!==data.request||!this.state.transfer.active)return;
    const previous=this.state.transfer,{type,generation,...status}=data,now=Number(this.now());
    const changed=previous.phase!==status.phase||previous.name!==status.name||previous.transferred!==status.transferred;
    const transfer={...previous,...status,...transferErrorDetails(status.error||status.errorCode?status:null),startedAt:previous.startedAt??now,
      fileStartedAt:previous.name!==status.name||previous.phase==='serving'?now:previous.fileStartedAt??now,
      progressAt:changed?now:previous.progressAt??now};
    const publish=update=>this.patch({...update,...(data.effectiveSpeed!==undefined?{effectiveSpeed:data.effectiveSpeed,transferBoosted:Boolean(data.transferBoosted)}:{})});
    const queue=this.uploadQueue,batch=this.state.uploadBatch;
    if(!queue||queue.request!==data.request||!batch?.active){publish({transfer});return;}
    const index=queue.index,item=batch.items[index];if(!item){publish({transfer});return;}
    const transferred=Number.isFinite(data.transferred)?Math.max(0,Math.min(item.size,data.transferred)):item.transferred;
    const update={transferred,...(data.name?{storedName:data.name}:{})};
    if(data.active){
      publish({transfer,uploadBatch:{...batch,transferred:queue.completedBytes+transferred,
        items:batch.items.map((entry,i)=>i===index?{...entry,...update,phase:'sending'}:entry)}});return;
    }
    if(data.phase!=='complete'){
      if(queue.protocol==='hp39-wire'&&data.phase!=='cancelled'){
        this.pauseUploadFile(queue,data.error?data:transferError('uploadIncomplete','The Wire upload did not complete.'),transferred);return;
      }
      this.uploadQueue=null;
      publish({transfer,uploadBatch:{...batch,active:false,recoverable:false,transferred:queue.completedBytes+transferred,items:batch.items.map((entry,i)=>{
        if(i<index)return entry;
        return i===index?{...entry,...update,phase:data.phase==='cancelled'?'cancelled':'error',...transferErrorDetails(data)}:{...entry,phase:'not-sent'};
      })}});return;
    }
    queue.completedBytes+=item.size;queue.previousKind=queue.entries[index].objectKind;queue.continueReceive=true;
    delete queue.entries[index].bytes;delete queue.entries[index].file;
    const items=batch.items.map((entry,i)=>i===index?{...entry,...update,phase:'complete',transferred:item.size}:entry);
    queue.index=queue.protocol==='hp39-wire'?this.nextWireUpload(queue,items):index+1;
    const active=queue.index>=0&&queue.index<queue.entries.length;if(!active)this.uploadQueue=null;
    publish({transfer,uploadBatch:{...batch,active,recoverable:false,completed:items.filter(entry=>entry.phase==='complete').length,transferred:queue.completedBytes,items}});
    if(active)this.sendNextUpload(queue);
  }
  acceptTransferredFile(data){
    if(data.request!==this.transferRequest||this.state.transfer?.request!==data.request||!this.state.transfer.active)return;
    try{
      if(!(data.bytes instanceof Uint8Array)||data.bytes.length>MAX_FILE_BYTES||typeof data.name!=='string')throw Error('Invalid received file.');
      const bytes=[...this.received.values()].reduce((n,f)=>n+f.bytes.length,0);
      if(this.received.size>=MAX_RECEIVE_FILES||bytes+data.bytes.length>MAX_RECEIVE_BYTES)throw transferError('receiveCapacity','Download and clear received files before receiving more.');
      // A calculator name is a label, never a host filesystem path.
      const name=data.name.replace(/[\\/\x00-\x1f\x7f]/g,'_').replace(/^\.+$/,'_').slice(0,128)||'calculator-file';
      const id=++this.receivedId;this.received.set(id,{name,bytes:data.bytes.slice()});
      this.patch({receivedFiles:[...this.state.receivedFiles,{id,name,size:data.bytes.length}]});
    }catch(error){this.send('file-transfer-cancel',{request:data.request});++this.transferRequest;
      this.patch({transfer:{...this.state.transfer,active:false,phase:'error',...transferErrorDetails(error)}});}
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
    if(data.type==='ready'){this.patch({ready:true});this.create();void this.restoreRememberedROMs();return;}
    if(data.type==='fatal'){this.disconnectIrDA();this.audioLive=false;this.audio.reset();this.endTransfer('error','The calculator worker stopped.');this.patch({ready:false,loaded:false,running:false,busy:false,hostBridge:bridgeDisconnected()});this.report('workerFailure',data.message);return;}
    if(data.generation!==this.generation)return;
    switch(data.type){
      case 'created':if(this.pending){const rom=this.pending;this.pending=null;this.send('load',{rom});}else this.patch({busy:false});break;
      case 'loaded':this.patch({loaded:true,busy:false});void this.loadedROM();break;
      case 'snapshot':{const stopped=!this.state.stopped&&data.stopped;this.last=data;
        if(data.stopped)this.disconnectIrDA();
        if(!data.running||data.stopped)this.audio.reset();
        if(data.stopped)this.endTransfer('error','The calculator stopped.');
        const sd=data.sd===undefined?this.state.sd:JSON.stringify(data.sd)===JSON.stringify(this.state.sd)?this.state.sd:data.sd;
        this.patch({loaded:data.loaded,running:data.running,stopped:data.stopped,sd,...(data.stopped?{hostBridge:bridgeDisconnected()}:{}),
          ...(data.effectiveSpeed!==undefined?{effectiveSpeed:data.effectiveSpeed,transferBoosted:Boolean(data.transferBoosted)}:{})});for(const f of this.frames)f(data);
        this.continueWireReceive(data);if(stopped)this.report('compatibilityError');break;}
      case 'checkpoint-auto-saved':void this.acceptAuto(data);break;
      case 'checkpoint-skipped':if(data.request===this.autoPending?.request){this.autoPending=null;this.scheduleAuto(5000);}break;
      case 'autosave-error':this.autoPending=null;this.autoBlocked=true;this.patch({note:'autoStopped'});this.report('storageError',data.message);break;
      case 'checkpoint-saved':this.autoPending=null;this.patch({busy:false,running:false,note:'exported'});
        Promise.resolve(this.download(data.file,sessionName(this.state.model.id,this.now()))).catch(e=>this.report('saveError',e.message));this.scheduleAuto();break;
      case 'checkpoint-restored':this.sdDirectory=null;this.patch({sdName:'orchard-sd.img'});this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false,stopped:Boolean(data.stopped),note:'restored'});if(!data.stopped&&this.mayRun(this.state.prefs))this.send('run');this.scheduleAuto();break;
      case 'error':this.disconnectIrDA();this.audioLive=false;this.audio.reset();this.endTransfer('error','The calculator operation stopped.');if(this.awaitingRestore)this.autoBlocked=true;this.autoPending=null;this.awaitingRestore=false;this.patch({busy:false,running:false,hostBridge:bridgeDisconnected()});this.report('operationFailed',data.message);this.scheduleAuto();break;
      case 'sd-complete':if(data.action==='insert'){this.sdDirectory=this.sdInsertDirectory;this.sdInsertDirectory=null;}this.patch({busy:false,note:data.action==='insert'?'sdInserted':'sdEjected',...(data.action==='insert'?{sdName:sdImageName(data.name)}:{})});this.scheduleAuto();break;
      case 'sd-exported':this.patch({busy:false,note:'sdExported'});Promise.resolve(this.download(data.bytes,sdImageName(this.state.sdName))).catch(e=>this.report('saveError',e.message));break;
      case 'sd-edited':{
        const draft={bytes:data.bytes,name:this.state.sdName,association:this.sdDirectory,writeProtected:Boolean(this.state.sd?.writeProtected)};
        const resolve=this.sdEditPending;this.sdEditPending=null;
        this.patch({busy:false,sd:null,note:'sdEjected'});resolve?.(draft);this.scheduleAuto();break;
      }
      case 'sd-error':this.sdEditPending?.(null);this.sdEditPending=null;this.sdInsertDirectory=null;this.patch({busy:false});this.report(data.code==='hostBridgeBusy'?'sdHostBridgeBusy':['format','damaged','limit'].includes(data.code)?'sdFs_'+data.code:'sdError',data.code==='hostBridgeBusy'?undefined:data.message);this.scheduleAuto();break;
      case 'links-reset':this.disconnectIrDA();this.linksReset();break;
      case 'host-bridge-status':if(data.request!==undefined&&data.request!==this.hostBridgeRequest)break;
        this.patch({hostBridge:{active:Boolean(data.active),phase:data.phase,ready:Boolean(data.ready),attached:Boolean(data.attached),usbipPort:data.usbipPort??null,errorCode:data.errorCode??null}});break;
      case 'host-bridge-conflict':this.report('hostBridgeDisconnectFirst');break;
      case 'serial-status':this.patch({serial:data.connected});if(!data.connected&&this.state.transfer?.transport==='serial')this.cancelTransfer();break;
      case 'uart-output':this.log('RX '+Array.from(data.bytes,b=>b.toString(16).padStart(2,'0')).join(' '));break;
      case 'uart-sent':this.log(`TX ${data.accepted}/${data.requested}`);break;
      case 'irda-output':this.irdaLink?.send(data.bytes);break;
      case 'irda-input-result':{const pending=this.irdaInput.get(data.request);if(pending){this.irdaInput.delete(data.request);clearTimeout(pending.timer);pending.resolve(data);}break;}
      case 'usb-status':this.patch({usb:data.connected,usbReady:data.phase==='Connected',usbPhase:data.phase,usbInfo:data.info||this.state.usbInfo});if(!data.connected&&this.state.transfer?.transport==='usb')this.cancelTransfer();if(data.error)this.report('usbError',data.error);break;
      case 'usb-packet':this.log(`USB ${data.direction}: ${data.status} ${data.bytes?Array.from(data.bytes,b=>b.toString(16).padStart(2,'0')).join(' '):data.accepted??''}`);break;
      case 'file-transfer-status':this.transferStatus(data);break;
      case 'file-transfer-received':this.acceptTransferredFile(data);break;
      case 'file-transfer-listing':this.acceptTransferListing(data);break;
      case 'buzzer':if(this.audioLive&&this.state.running&&!this.state.stopped)this.audio.receive(data);break;
    }
  }
  dispose(){if(this.dead)return;this.disconnectIrDA();this.dead=true;++this.selection;clearTimeout(this.autoTimer);this.autoPending=null;
    this.sdEditPending?.(null);this.sdEditPending=null;this.sdDirectory=null;this.sdInsertDirectory=null;
    this.state.dialog?.resolve(null);for(const d of this.dialogs)d.resolve(null);this.dialogs=[];
    ++this.transferRequest;this.uploadQueue=null;this.received.clear();this.audioLive=false;this.audio.dispose();this.worker.terminate();this.listeners.clear();this.frames.clear();}
}
