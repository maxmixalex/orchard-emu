// SPDX-License-Identifier: MIT
// Runs beside the live core in its Worker. The Node bridge is only a transport.
import {GuestUSBDevice,ERR} from './usb-device.js';
import {BRIDGE_PROTOCOL,BRIDGE_MAX_URB,BRIDGE_MAX_BODY,BRIDGE_MAX_EVENTS,BRIDGE_MAX_PENDING,bridgeAddress,bridgeToken,bridgeError,encodeBridgeBytes,decodeBridgeBytes} from './host-bridge-protocol.js';
const EMPTY=new Uint8Array();
const HTTP_ERRORS={401:'hostBridgeAuthentication',403:'hostBridgeOrigin',409:'hostBridgeBusy',410:'hostBridgeSessionEnded'};
const failureCode=error=>typeof error?.code==='string'&&error.code.startsWith('hostBridge')?error.code:'hostBridgeNetwork';
async function boundedJSON(response){
 if(Number(response.headers.get('content-length')??0)>BRIDGE_MAX_BODY)throw bridgeError('hostBridgeProtocol');
 const reader=response.body?.getReader();if(!reader)throw bridgeError('hostBridgeProtocol');
 let length=0;const chunks=[];
 for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>BRIDGE_MAX_BODY){await reader.cancel();throw bridgeError('hostBridgeProtocol');}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw bridgeError('hostBridgeProtocol');}
}
export class BrowserHostBridge {
 constructor(core,{tick=()=>0,notify=()=>{},fetch=globalThis.fetch,waitFor=Promise.resolve()}={}){
  this.core=core;this.tick=tick;this.notify=notify;this.fetch=fetch.bind(globalThis);this.waitFor=waitFor;this.device=new GuestUSBDevice(core);
  this.active=false;this.ready=false;this.attached=false;this.phase='disconnected';this.usbipPort=null;this.errorCode=null;this.session=null;this.pending=[];this.flushing=false;this.publishing=false;this.epoch=0;this.resetPending=false;
 }
 status(values={}){Object.assign(this,values);this.notify({active:this.active,ready:this.ready,attached:this.attached,phase:this.phase,usbipPort:this.usbipPort,errorCode:this.errorCode});}
 async request(path,{method='GET',body,detached=false}={}){
  const abort=new AbortController(),parent=this.abort?.signal,stop=()=>abort.abort();
  if(!detached){if(parent?.aborted)abort.abort();else parent?.addEventListener('abort',stop,{once:true});}
  const timer=setTimeout(stop,path==='/v1/events'?30000:8000);
  try{
   const headers={Authorization:'Bearer '+this.token,...(this.session?{'X-Orchard-Session':this.session}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})};
   const response=await this.fetch(this.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',mode:'cors',signal:abort.signal});
   if(!response.ok)throw bridgeError(HTTP_ERRORS[response.status]??'hostBridgeHTTP',`HTTP ${response.status}`);
   return response.status===204?null:await boundedJSON(response);
  }finally{clearTimeout(timer);parent?.removeEventListener('abort',stop);}
 }
 async start(address,token){
  // A bridge object belongs to one Worker connection. Reconnecting uses a new
  // object so old aborted fetches cannot end a replacement connection.
  if(this.abort)throw bridgeError('hostBridgeBusy');
  this.url=bridgeAddress(address);this.token=bridgeToken(token);this.abort=new AbortController();this.status({active:true,phase:'connecting',errorCode:null});
  try{
   await this.waitFor;if(!this.active)return;
   // A stopped connection must still learn a just-created session identity so
   // it can DELETE it. Keep only this bounded (8 s) handshake outside abort;
   // stop() waits for it before allowing the Worker's next connection.
   this.opening=this.request('/v1/session',{method:'POST',body:{protocol:BRIDGE_PROTOCOL},detached:true});
   const reply=await this.opening;
   if(reply?.protocol!==BRIDGE_PROTOCOL||typeof reply.session!=='string'||!/^[a-f0-9]{48}$/.test(reply.session)||!Number.isInteger(reply.usbipPort)||reply.usbipPort<1||reply.usbipPort>65535||reply.epoch!==0)throw bridgeError('hostBridgeProtocol');
   this.session=reply.session;if(!this.active)return;
   this.status({usbipPort:reply.usbipPort});this.enumerate(0);void this.events();
  }catch(error){if(this.active)this.stop(failureCode(error));}
 }
 enumerate(epoch){
  this.epoch=epoch;this.resetPending=false;this.publishing=false;this.pending=[];this.device.start(this.tick());this.resets=this.usbResets();this.status({ready:false,attached:false,phase:'enumerating'});
 }
 usbResets(){const pointer=this.core.usb_snapshot?.();if(!pointer)return null;const words=new Uint32Array(this.core.memory.buffer,pointer,44);return BigInt(words[36])|(BigInt(words[37])<<32n);}
 poll(tick){
  if(!this.active||!this.session||this.resetPending)return;
  try{
   const resets=this.usbResets();
   // WDT/retained reset clears the USB controller while retaining its physical
   // connection. Drop the old OS import, then enumerate the actual reset guest.
   if(resets!==null&&this.resets!==null&&resets<this.resets){
    this.resetPending=true;this.device.cancelAll();this.status({ready:false,attached:false,phase:'enumerating'});
    const epoch=this.epoch;
    void this.request('/v1/reset',{method:'POST',body:{epoch}}).catch(error=>{if(this.active&&epoch===this.epoch&&this.resetPending)this.stop(failureCode(error));});return;
   }
   this.resets=resets;this.device.poll(tick);
   if(this.device.error){this.stop('hostBridgeUSB');return;}
   if(this.device.available&&!this.ready&&!this.publishing){
    this.publishing=true;const epoch=this.epoch;
    void this.request('/v1/device',{method:'POST',body:{ready:true,epoch,device:encodeBridgeBytes(this.device.device,18),config:encodeBridgeBytes(this.device.config,4096)}})
     .then(()=>{if(this.active&&epoch===this.epoch&&!this.resetPending)this.status({ready:true,phase:this.attached?'attached':'ready'});})
     .catch(error=>{if(this.active&&epoch===this.epoch&&!this.resetPending)this.stop(failureCode(error));});
   }
  }catch{this.stop('hostBridgeUSB');}
 }
 async events(){
  try{while(this.active){
   const result=await this.request('/v1/events');if(!this.active)return;
   if(!Array.isArray(result?.events)||result.events.length>BRIDGE_MAX_EVENTS)throw bridgeError('hostBridgeProtocol');
   for(const event of result.events)this.event(event);
  }}catch(error){if(this.active)this.stop(failureCode(error));}
 }
 event(event){
  if(event?.type==='release'){
   if(!Number.isSafeInteger(event.epoch)||event.epoch<=this.epoch)throw bridgeError('hostBridgeProtocol');this.enumerate(event.epoch);return;
  }
  if(event?.type==='client'&&typeof event.attached==='boolean'){this.status({attached:event.attached,phase:event.attached?'attached':this.ready?'ready':'enumerating'});return;}
  if(!Number.isInteger(event?.id)||event.id<1||event.id>0xffffffff)throw bridgeError('hostBridgeProtocol');
  if(event.type==='unlink'){this.device.unlink(event.id);return;}
  if(event.type!=='submit')throw bridgeError('hostBridgeProtocol');
  const request=event.request;
  if(!request||!Number.isInteger(request.seq)||request.seq<0||request.seq>0xffffffff||!Number.isInteger(request.flags)||request.flags<0||request.flags>0xffffffff||!Number.isInteger(request.ep)||request.ep<0||request.ep>15||![0,1].includes(request.direction)||!Number.isInteger(request.length)||request.length<0||request.length>BRIDGE_MAX_URB)throw bridgeError('hostBridgeProtocol');
  const input={...request,seq:event.id,setup:decodeBridgeBytes(request.setup,8),data:decodeBridgeBytes(request.data)};
  const done=result=>this.result({id:event.id,status:result.status,length:result.length,data:encodeBridgeBytes(result.data)});
  if(!this.device.submit(input,done))done({status:ERR.IO,length:0,data:EMPTY});
 }
 result(value){
  if(!this.active)return;if(this.pending.length>=BRIDGE_MAX_PENDING){this.stop('hostBridgeProtocol');return;}
  this.pending.push(value);if(!this.flushing)void this.flush();
 }
 async flush(){
  this.flushing=true;let epoch=this.epoch;
  try{while(this.active&&this.pending.length){
   epoch=this.epoch;
   const results=[];let size=0;while(this.pending.length&&results.length<BRIDGE_MAX_EVENTS){const next=this.pending[0],length=JSON.stringify(next).length;if(results.length&&size+length>BRIDGE_MAX_BODY-1024)break;results.push(this.pending.shift());size+=length;}
   await this.request('/v1/results',{method:'POST',body:{results}});
  }}catch(error){if(this.active&&epoch===this.epoch)this.stop(failureCode(error));}finally{this.flushing=false;if(this.active&&this.pending.length)void this.flush();}
 }
 stop(errorCode=null){
  if(!this.active)return this.cleanup??Promise.resolve();
  this.active=false;this.abort?.abort();this.device.detach();this.pending=[];this.status({ready:false,attached:false,phase:errorCode?'error':'disconnected',errorCode});
  this.cleanup=Promise.resolve(this.opening).catch(()=>{}).then(()=>this.session?this.request('/v1/session',{method:'DELETE',detached:true}).catch(()=>{}):undefined);return this.cleanup;
 }
}
