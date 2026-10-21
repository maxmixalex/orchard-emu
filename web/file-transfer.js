// SPDX-License-Identifier: MIT
import { KermitSession, MAX_FILE_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename } from './kermit.js';
export { MAX_FILE_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename };
export function transferCapabilities(model,transport='usb') {
  // HP39 typed catalog/client mode has a different application protocol. A
  // generic Kermit ACK must not imply that an HP48 object can be sent to it.
  const available=model===4&&transport==='usb';
  return Object.freeze({send:available,receive:available,get:available,directory:available,finish:available});
}
export function validateUpload(model, name, bytes) {
  validateFilename(name);
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw new Error('Choose a calculator file of 1 byte to 2 MiB.');
  if (!transferCapabilities(model).send) throw new Error('File transfer for this calculator family is not available yet.');
  const prefix=Array.from(bytes.subarray(0,8),b=>String.fromCharCode(b)).join('');
  if (!/^HPHP(?:48|49)-[\x20-\x7e]$/.test(prefix) && !prefix.startsWith('%%HP:'))
    throw new Error('Choose an HP48/49 binary object or an HP text file beginning with %%HP:. HP39 typed files, ROMs and ZIP files use different formats.');
  return bytes;
}
export class FileTransfer {
  constructor({core, usb, model, notify}) {
    this.core=core;this.usb=usb;this.model=model;this.notify=notify;this.session=null;this.lastRequest=0;this.usbReady=false;
  }
  get active() {return Boolean(this.session?.active);}
  get pending() {return Boolean(this.session?.pending);}
  get transport() {return this.currentTransport;}
  start(data,tick) {
    if (this.active) throw new Error('A file transfer is already running.');
    if (!Number.isSafeInteger(data.request)||data.request<=this.lastRequest) throw new Error('Stale file-transfer request.');
    if (!['serial','usb'].includes(data.transport)) throw new Error('Select a file-transfer connection.');
    if (!transferCapabilities(this.model,data.transport)[data.mode]) throw new Error('This file operation is not available for the selected calculator and connection.');
    if (data.mode==='send') validateUpload(this.model,data.name,data.bytes);
    if (data.mode==='get') validateFilename(data.name);
    if (data.transport==='usb') {this.usb.endpoint(true);this.usb.endpoint(false);}
    this.lastRequest=data.request;this.request=data.request;this.currentTransport=data.transport;this.lastProgress=null;this.writeAfter=-Infinity;
    if(data.transport==='usb'&&!this.usbReady){this.writeAfter=Infinity;this.readyDeadline=tick+30*this.core.timebase_hz();}
    const status=state=>{
      if(data.transport==='usb'&&(['error','cancelled'].includes(state.phase)||state.phase==='complete'&&['finish','receive'].includes(data.mode)))this.usbReady=false;
      // Publish phase transitions and useful byte increments, not one React
      // update for every 80-byte protocol packet.
      const previous=this.lastProgress;
      if (previous&&state.active&&state.phase===previous.phase&&state.name===previous.name&&state.transferred-previous.transferred<4096)return;
      this.lastProgress={...state};this.notify({type:'file-transfer-status',request:this.request,transport:this.currentTransport,...state});
    };
    this.session=new KermitSession({hz:this.core.timebase_hz(),write:bytes=>this.write(bytes),notify:status,
      end:data.transport==='usb'?13:null,
      onPacket:p=>{
        // Stock HP48gII USB can consume and then lose an application packet
        // sent immediately after enumeration. Wait for its complete first
        // Kermit response, but deliver every packet to the session unchanged.
        // Readiness is connection state, not an arbitrary per-packet delay.
        if(this.currentTransport==='usb'&&!this.usbReady&&p.sequence===0&&['N','S','I'].includes(p.type)){
          this.usbReady=true;this.writeAfter=this.session.now;
        }
      },
      file:({name,bytes})=>this.notify({type:'file-transfer-received',request:this.request,name,bytes}),
      listing:text=>this.notify({type:'file-transfer-listing',request:this.request,text})});
    this.session.start({mode:data.mode,name:data.name,bytes:data.bytes},tick);
  }
  write(bytes) {
    if (this.currentTransport==='serial') {
      const part=bytes.subarray(0,1024);
      new Uint8Array(this.core.memory.buffer,this.core.uart_input(),part.length).set(part);
      return this.core.uart_send(part.length);
    }
    if(this.session.now<=this.writeAfter)return 0;
    const endpoint=this.usb.endpoint(false),part=bytes.subarray(0,endpoint.maxPacket),result=this.usb.send(part);
    if (![0,1].includes(result.result)) throw new Error('USB file transfer: '+result.status);
    return result.accepted;
  }
  receiveUart(bytes,tick) {
    if (!this.pending||this.currentTransport!=='serial')return false;
    this.session.receive(bytes,tick);return true;
  }
  poll(tick) {
    if (!this.pending)return;
    try {
      if (this.currentTransport==='usb') {
        if(this.active&&!this.usbReady&&tick>=this.readyDeadline)throw new Error('The calculator did not enter USB file-transfer mode. Start SERVER or SEND on the calculator and reconnect.');
        // One IN transaction per original Worker slice, independent of the
        // display. NAK is ordinary backpressure, never a successful file read.
        const incoming=this.usb.read();
        if (incoming.result===0)this.session.receive(incoming.bytes,tick);
        else if (incoming.result!==1)throw new Error('USB file transfer: '+incoming.status);
      }
      this.session.poll(tick);
    } catch(error) {this.session.fail(error.message);}
  }
  cancel(tick,message='File transfer cancelled.',request=null) {
    if (!this.session||request!==null&&request!==this.request)return;
    this.session.cancel(message);
    // Best effort one packet notification before disconnect/pause. Discard
    // unsent bytes; a later session must never inherit an old cancellation.
    this.session.poll(tick);this.session.queue=[];this.session.lingerUntil=0;
  }
  resetUsb(tick) {
    if(this.currentTransport==='usb')this.cancel(tick,'USB connection changed.');
    this.usbReady=false;this.writeAfter=Infinity;
  }
}
