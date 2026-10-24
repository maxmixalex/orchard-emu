// SPDX-License-Identifier: MIT
import {Hp39FileServer,prepareHp39Files} from './hp39-transfer.js';
import {Hp39WireSender,validateHp39WireFile} from './hp39-wire.js';
import {Hp39WireReceiver} from './hp39-wire-receive.js';
import {inspectHp39File,validateHp39Filename} from './hp39-files.js';
import {transferError} from './transfer-errors.js';
import { KermitSession, MAX_FILE_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename, validateReceiveBudget } from './kermit.js';
export { MAX_FILE_BYTES, MAX_RECEIVE_FILES, MAX_RECEIVE_BYTES, MAX_LISTING_BYTES, validateFilename };
export const MAX_UPLOAD_FILES = 16;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const isHp39 = model => [1,2,3].includes(model);
// Continuous Wire reception follows the original model's exposed connector.
export const canReceiveHp39Wire = (model,transport) => [1,2].includes(model)&&transport==='usb'||model===2&&transport==='serial';
export function transferCapabilities(model,transport='usb') {
  const link=['usb','serial'].includes(transport),hp39=isHp39(model)&&(transport==='usb'||model!==1&&transport==='serial');
  const supported=model===4&&link||model===5&&transport==='usb';
  return Object.freeze({send:supported||hp39,receive:supported||hp39,get:supported,directory:supported,finish:supported,serve:hp39});
}
export function validateUpload(model, name, bytes) {
  validateFilename(name);
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw transferError('fileSize','Choose a calculator file of 1 byte to 2 MiB.');
  if (!transferCapabilities(model).send) throw transferError('unsupportedCalculator','File transfer for this calculator family is not available yet.');
  if(isHp39(model)){validateHp39Filename(name);inspectHp39File(bytes);return bytes;}
  const prefix=Array.from(bytes.subarray(0,8),b=>String.fromCharCode(b)).join('');
  if (!/^HPHP(?:48|49)-[\x20-\x7e]$/.test(prefix) && !prefix.startsWith('%%HP:'))
    throw transferError('hp48FileType','Choose an HP48/49 binary object or an HP text file beginning with %%HP:. HP39 typed files, ROMs and ZIP files use different formats.');
  return bytes;
}
export class FileTransfer {
  constructor({core, usb, model, notify, now=()=>performance.now()}) {
    this.core=core;this.usb=usb;this.model=model;this.notify=notify;this.now=now;this.session=null;this.lastRequest=0;this.usbReady=false;
  }
  get active() {return Boolean(this.session?.active);}
  get pending() {return Boolean(this.session?.pending);}
  get transport() {return this.currentTransport;}
  start(data,tick) {
    if (this.active) throw new Error('A file transfer is already running.');
    if (!Number.isSafeInteger(data.request)||data.request<=this.lastRequest) throw new Error('Stale file-transfer request.');
    if (!['serial','usb'].includes(data.transport)) throw new Error('Select a file-transfer connection.');
    if (!transferCapabilities(this.model,data.transport)[data.mode]) throw transferError('unsupportedOperation','This file operation is not available for the selected calculator and connection.');
    if(data.protocol!==undefined&&data.protocol!=='hp39-wire')throw Error('Invalid file-transfer protocol.');
    const wire=data.protocol==='hp39-wire';
    if(wire&&(!isHp39(this.model)||!['send','receive'].includes(data.mode)||
      data.mode==='receive'&&!canReceiveHp39Wire(this.model,data.transport)))throw transferError('unsupportedOperation','This Wire operation is not available for the selected calculator and connection.');
    const receiveBudget=validateReceiveBudget(data.receiveBudget);
    if (data.mode==='send') validateUpload(this.model,data.name,data.bytes);
    if(wire&&data.mode==='send')validateHp39WireFile(data.name,data.bytes);
    if (data.mode==='get') validateFilename(data.name);
    if(data.mode==='serve')prepareHp39Files(data.files);
    if (data.transport==='usb') {this.usb.endpoint(true);this.usb.endpoint(false);}
    this.lastRequest=data.request;this.request=data.request;this.currentTransport=data.transport;this.lastProgress=null;this.writeAfter=-Infinity;this.wire=wire;
    if(data.transport==='usb'&&!wire&&!this.usbReady){this.writeAfter=Infinity;this.readyDeadline=tick+30*this.core.timebase_hz();}
    const status=state=>{
      if(data.transport==='usb'&&(['error','cancelled'].includes(state.phase)||state.phase==='complete'&&(wire||['finish','receive'].includes(data.mode))))this.usbReady=false;
      // Keep slow, small HP39 files visibly moving. A 4 KiB-only threshold
      // hid every progress update for libraries and tens of seconds for aplets.
      // Wall time limits UI messages only; protocol time remains guest ticks.
      const previous=this.lastProgress,now=this.now();
      if(previous&&state.active&&state.phase===previous.phase&&state.name===previous.name){
        if(state.transferred===previous.transferred)return;
        if(now-this.progressAt<250&&state.transferred!==state.total)return;
      }
      this.progressAt=now;this.lastProgress={...state};this.notify({type:'file-transfer-status',request:this.request,transport:this.currentTransport,...state});
    };
    const Session=wire?(data.mode==='receive'?Hp39WireReceiver:Hp39WireSender):isHp39(this.model)?Hp39FileServer:KermitSession;
    this.session=new Session({hz:this.core.timebase_hz(),write:bytes=>this.write(bytes),notify:status,receiveBudget,
      // The stock 39gs serial receiver rejects STX/1 KiB blocks even after
      // the D CRC handshake. USB accepts them; serial uses SOH/128 bytes.
      // CRC selection is not block-size negotiation.
      maxBlockSize:data.transport==='serial'?128:1024,
      receiveId:data.request,
      end:data.transport==='usb'?13:null,
      onPacket:p=>{
        // Stock HP48gII USB can consume and then lose an application packet
        // sent immediately after enumeration. Wait for its complete first
        // Kermit response, but deliver every packet to the session unchanged.
        // Readiness is connection state, not an arbitrary per-packet delay.
        if(this.currentTransport==='usb'&&!this.usbReady&&p.sequence===0&&['N','S','I','R'].includes(p.type)){
          this.usbReady=true;this.writeAfter=this.session.now;
        }
      },
      file:({name,bytes})=>this.notify({type:'file-transfer-received',request:this.request,name,bytes}),
      listing:text=>this.notify({type:'file-transfer-listing',request:this.request,text})});
    this.session.start(wire?{name:data.name,bytes:data.bytes}:isHp39(this.model)?{files:data.mode==='send'?[{name:data.name,bytes:data.bytes}]:data.files||[]}:{mode:data.mode,name:data.name,bytes:data.bytes},tick);
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
        if(this.active&&!this.wire&&!this.usbReady&&tick>=this.readyDeadline)throw transferError(isHp39(this.model)?'hp39UsbMode':'hp48UsbMode',isHp39(this.model)?'Choose Disk drive in the calculator Send/Receive menu, then reconnect USB.':'The calculator did not enter USB file-transfer mode. Start SERVER or SEND on the calculator and reconnect.');
        // One IN transaction per original Worker slice, independent of the
        // display. NAK is ordinary backpressure, never a successful file read.
        const incoming=this.usb.read();
        if (incoming.result===0){
          // A device IN completion must reach the guest before a dependent
          // HP39 reply is placed in OUT. Drain the response on the next
          // ordinary guest slice; no extra run budget or wall timer is added.
          if(isHp39(this.model)&&incoming.bytes.length)this.writeAfter=tick;
          this.session.receive(incoming.bytes,tick);
        }
        else if (incoming.result!==1)throw new Error('USB file transfer: '+incoming.status);
      }
      this.session.poll(tick);
    } catch(error) {this.session.fail(error);}
  }
  cancel(tick,message=transferError('transferCancelled','File transfer cancelled.'),request=null) {
    if (!this.session||request!==null&&request!==this.request)return;
    this.session.cancel(message);
    // Best effort one packet notification before disconnect/pause. Discard
    // unsent bytes; a later session must never inherit an old cancellation.
    this.session.poll(tick);this.session.queue=[];this.session.lingerUntil=0;
  }
  resetUsb(tick) {
    if(this.currentTransport==='usb')this.cancel(tick,transferError('linkDisconnected','USB connection changed.'));
    this.usbReady=false;this.writeAfter=Infinity;
  }
}
