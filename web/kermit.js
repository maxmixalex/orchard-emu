// SPDX-License-Identifier: MIT
// Original bounded, stop-and-wait implementation of the Kermit protocol.
// References: kermitproject.org/kproto.pdf and kermitproject.org/kpackets.html.
// This module owns no clock, transport, filesystem, or calculator memory.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_RECEIVE_FILES = 16;
export const MAX_RECEIVE_BYTES = 8 * 1024 * 1024;
export const MAX_LISTING_BYTES = 64 * 1024;
export function validateReceiveBudget(value = {files:MAX_RECEIVE_FILES,bytes:MAX_RECEIVE_BYTES}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !Number.isSafeInteger(value.files) || value.files < 0 || value.files > MAX_RECEIVE_FILES ||
      !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > MAX_RECEIVE_BYTES)
    throw new Error('Invalid remaining file-receive capacity.');
  return Object.freeze({files:value.files,bytes:value.bytes});
}
const EMPTY = new Uint8Array();
const ascii = value => Uint8Array.from(value, c => c.charCodeAt(0));
export const byteText = bytes => Array.from(bytes, b => String.fromCharCode(b)).join('');
export function validateFilename(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 64 ||
      /[\x00-\x1f\x7f/\\:]/.test(name) || /[^\x20-\xff]/.test(name) ||
      name === '.' || name === '..' || name.trim() !== name)
    throw new Error('Use a file name of 1–64 single-byte characters without a path or control characters.');
  return name;
}
export function checksum(bytes) {
  let sum = 0; for (const b of bytes) sum += b;
  return ((sum + ((sum & 192) >>> 6)) & 63) + 32;
}
export function packet(sequence, type, data = EMPTY, end = 13, pad = 0, padding = 0) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 63 ||
      !/^[A-Z]$/.test(type) || !(data instanceof Uint8Array) || data.length > 91)
    throw new Error('Invalid short Kermit packet.');
  const out = new Uint8Array(data.length + 6 + pad); out.fill(padding, 0, pad);
  out.set([1, data.length + 35, sequence + 32, type.charCodeAt(0)], pad);
  out.set(data, pad + 4); out[out.length - 2] = checksum(out.subarray(pad + 1, out.length - 2));
  out[out.length - 1] = end; return out;
}
export class PacketReader {
  constructor({end=null}={}) {
    if(end!==null&&(!Number.isInteger(end)||end<0||end>31))throw new Error('Invalid Kermit terminator.');
    this.end=end;this.bytes=[];this.want=0;
  }
  reset() { this.bytes.length = 0; this.want = 0; }
  feed(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 65536) throw new Error('Invalid Kermit input.');
    const out = [];
    for (const b of bytes) {
      if (b === 1) { this.bytes = [1]; this.want = 0; continue; }
      if (!this.bytes.length) continue;
      this.bytes.push(b);
      if (this.bytes.length === 2) {
        const length = b - 32;
        if (length < 3 || length > 94) { out.push({error:'Unsupported or invalid Kermit packet length.'}); this.reset(); continue; }
        this.want = length + 2 + Number(this.end!==null);
      }
      // Kermit itself is length framed and permits ignoring the terminator.
      // A transport may opt into waiting for the requested terminator before
      // releasing a packet (HP USB sends each character in a separate IN).
      if (this.want && this.bytes.length === this.want) {
        const p = Uint8Array.from(this.bytes); this.reset();
        const tail=this.end===null?-1:-2;
        if (this.end!==null&&p.at(-1)!==this.end || p[2] < 32 || p[2] > 95 || p[3] < 65 || p[3] > 90 || checksum(p.subarray(1, tail)) !== p.at(tail))
          out.push({error:'Kermit packet checksum or header is invalid.'});
        else out.push({sequence:p[2] - 32, type:String.fromCharCode(p[3]), data:p.slice(4, tail)});
      }
    }
    return out;
  }
}
const quoteOK = c => c >= 33 && c <= 62 || c >= 96 && c <= 126;
const LOCAL = Object.freeze({ctl:35, binary:38, repeat:126});
// 80-byte short packets avoid the receive-buffer limit documented by the
// Kermit Project for the HP50g. Optional long/window/attribute features are off.
export const PARAMETERS = Uint8Array.of(80+32, 5+32, 32, 64, 13+32, 35, 38, 49, 126, 32);
export function parameters(bytes) {
  // The protocol permits omitted trailing fields and SP placeholders for
  // intermediate defaults (kproto.pdf, section 7). SP is never a quote byte.
  const at = (i, fallback) => i < bytes.length && bytes[i] !== 32 ? bytes[i] : fallback;
  const max = at(0, 80+32)-32, timeout = at(1, 5+32)-32, pad = at(2,32)-32;
  const end = at(4,45)-32, ctl = at(5,35), bin = at(6,78), repeat = at(8,32);
  if (max < 10 || max > 94 || timeout < 0 || timeout > 94 || pad < 0 || pad > 94 ||
      end < 0 || end > 31 || !quoteOK(ctl)) throw new Error('Invalid Kermit negotiation.');
  return {max:Math.min(80,max), timeout:Math.min(30,Math.max(2,timeout || 5)), pad,
    padding:at(3,64)^64, end, ctl,
    binary:bin === 89 || bin === 38 ? 38 : null,
    repeat:repeat === 126 ? 126 : null};
}
export function encodeData(bytes, start = 0, maximum = 77, config = LOCAL) {
  const out = []; let i = start;
  for (; i < bytes.length; ++i) {
    const encoded = []; let value = bytes[i];
    if (config.binary && value & 128) { encoded.push(config.binary); value &= 127; }
    const low = value & 127;
    if (low < 32 || low === 127) encoded.push(config.ctl, value ^ 64);
    else if (value === config.ctl || value === config.binary || value === config.repeat) encoded.push(config.ctl, value);
    else encoded.push(value);
    if (out.length + encoded.length > maximum) break;
    out.push(...encoded);
  }
  return {data:Uint8Array.from(out), end:i};
}
export function decodeData(bytes, config = LOCAL, maximum = MAX_FILE_BYTES) {
  const out = [];
  for (let i = 0; i < bytes.length;) {
    let count = 1, high = 0, value = bytes[i++];
    if (config.repeat && value === config.repeat) {
      if (i + 1 >= bytes.length) throw new Error('Incomplete Kermit repeat prefix.');
      count = bytes[i++]-32; value = bytes[i++];
      if (count < 1 || count > 94) throw new Error('Invalid Kermit repeat count.');
    }
    if (config.binary && value === config.binary) {
      if (i >= bytes.length) throw new Error('Incomplete Kermit 8-bit prefix.');
      high = 128; value = bytes[i++];
    }
    if (value === config.ctl) {
      if (i >= bytes.length) throw new Error('Incomplete Kermit control prefix.');
      value = bytes[i++]; const low = value & 127;
      if (low >= 63 && low <= 95) value ^= 64;
    }
    value |= high;
    if (out.length + count > maximum) throw new Error('Received file exceeds the transfer limit.');
    for (let n = 0; n < count; n++) out.push(value);
  }
  return Uint8Array.from(out);
}

export class KermitSession {
  constructor({write, notify = () => {}, file = () => {}, listing = () => {}, hz = 12000000,
    timeout = 5, retries = 4, duration = 300, end=null, onPacket=()=>{}, validateFile=()=>{}, receiveBudget} = {}) {
    if (typeof write !== 'function' || !Number.isFinite(hz) || hz <= 0) throw new Error('Invalid Kermit transport.');
    this.write = write; this.notify = notify; this.file = file; this.listing = listing; this.hz = hz;
    this.timeout = timeout * hz; this.retryLimit = retries; this.duration = duration * hz;
    this.receiveBudget=validateReceiveBudget(receiveBudget);
    this.reader = new PacketReader({end});this.onPacket=onPacket;this.validateFile=validateFile;this.active = false; this.queue = []; this.lingerUntil = 0;
  }
  get pending() { return this.active || this.queue.length > 0 || this.lingerUntil > this.now; }
  status(phase, error) {
    this.phase = phase;
    this.notify({active:this.active, phase, direction:this.mode === 'send' ? 'send':'receive',
      name:this.name || '', transferred:this.transferred, total:this.mode === 'send' ? this.total : undefined,
      ...(error ? {error} : {})});
  }
  start({mode, name, bytes, passive = false}, now) {
    if (this.active) throw new Error('A file transfer is already running.');
    if (!['send','receive','get','directory','finish'].includes(mode)) throw new Error('Unsupported file operation.');
    if (mode === 'send' || mode === 'get') validateFilename(name);
    if (mode === 'send' && (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_BYTES)) throw new Error('File must be at most 2 MiB.');
    this.now=now; this.started=now; this.end=now+this.duration; this.active=true; this.mode=mode; this.name=name || '';
    this.bytes=bytes || EMPTY; this.total=this.bytes.length; this.transferred=0; this.sequence=0; this.expected=0; this.retries=0;
    this.peer=parameters(PARAMETERS); this.rx={...LOCAL}; this.tx={...LOCAL}; this.queue=[]; this.reader.reset();
    this.last=null; this.ack=null; this.receiving=false; this.current=null; this.files=[]; this.receivedBytes=0;this.listingBytes=0; this.lingerUntil=0;this.initialProbe=null;
    this.status('negotiating');
    if (mode === 'send') this.send('S', PARAMETERS, 'send-init');
    else if (mode === 'receive') {
      this.stage='receive-init';this.deadline=Infinity;
      if(!passive){this.initialProbe=packet(0,'N');this.enqueue(this.initialProbe,()=>{this.deadline=this.now+this.timeout;});}
    }
    else this.send('I', PARAMETERS, 'command-init');
    this.poll(now);
  }
  enqueue(bytes, sent = null) {
    if (this.queue.length >= 8) throw new Error('Kermit output queue exceeded its limit.');
    this.queue.push({bytes, offset:0, sent});
  }
  frame(sequence, type, data = EMPTY) { return packet(sequence,type,data,this.peer.end,this.peer.pad,this.peer.padding); }
  send(type, data, stage) {
    this.stage=stage; this.last=this.frame(this.sequence,type,data); this.retries=0; this.deadline=Infinity;
    this.enqueue(this.last, () => { this.deadline=this.now+this.timeout; });
  }
  encoded(bytes) {
    const encoded=encodeData(bytes,0,this.peer.max-3,this.tx);
    if (encoded.end!==bytes.length) throw new Error('File name or command is too long for the negotiated packet size.');
    return encoded.data;
  }
  negotiate(data) {
    this.peer=parameters(data); this.timeout=this.peer.timeout*this.hz;
    this.tx={ctl:35,binary:this.peer.binary,repeat:this.peer.repeat};
    this.rx={ctl:this.peer.ctl,binary:this.peer.binary,repeat:this.peer.repeat};
  }
  acknowledge(p, data = EMPTY) {
    this.ack={sequence:p.sequence, bytes:this.frame(p.sequence,'Y',data)};
    this.enqueue(this.ack.bytes); this.deadline=this.now+this.timeout; this.retries=0;
  }
  nextSend() {
    this.sequence=(this.sequence+1)&63;
    if (this.transferred < this.bytes.length) {
      const encoded=encodeData(this.bytes,this.transferred,this.peer.max-3,this.tx);
      if (encoded.end===this.transferred) throw new Error('Negotiated Kermit packet is too small.');
      this.nextOffset=encoded.end; this.send('D',encoded.data,'send-data');
    } else this.send('Z',EMPTY,'send-eof');
  }
  retry() {
    if (++this.retries>this.retryLimit) throw new Error('File transfer timed out. Check the calculator transfer mode and try again.');
    if (this.queue.length) throw new Error('The link did not accept the queued packet.');
    this.deadline=this.now+this.timeout;
    this.enqueue(this.last || this.frame(this.expected,'N'));
  }
  receive(bytes, now) {
    this.now=now;
    try {
      for (const p of this.reader.feed(bytes)) {
        if(!p.error)this.onPacket(p);
        if (!this.active) {
          if (!p.error && this.lingerUntil>now && p.type==='B' && p.sequence===this.ack?.sequence) this.enqueue(this.ack.bytes);
          continue;
        }
        if (p.error) { if (this.receiving || this.stage==='receive-init') this.enqueue(this.frame(this.expected,'N')); continue; }
        if (p.type==='E') throw new Error('Calculator: '+byteText(decodeData(p.data,this.rx,4096)));
        this.accept(p);
      }
    } catch (error) { this.fail(error.message); }
  }
  accept(p) {
    if (p.type==='I' && this.mode==='receive' && !this.receiving) {
      this.discardInitialProbe();
      this.negotiate(p.data); this.acknowledge(p,PARAMETERS); return;
    }
    if (p.type==='S' && ['receive','get','directory'].includes(this.mode) && (this.stage==='receive-init'||this.stage==='command-response'||this.receiving&&this.expected===1)) {
      if (p.sequence!==0) { this.enqueue(this.frame(0,'N')); return; }
      this.discardInitialProbe();
      if (!this.receiving) {this.negotiate(p.data);this.receiving=true;this.expected=1;this.last=null;this.stage='receive-file';this.status(this.mode==='directory'?'listing':'receiving');}
      this.acknowledge(p,PARAMETERS); return;
    }
    if (this.receiving) { this.acceptFile(p); return; }
    if (p.type==='N' && p.sequence===this.sequence) { if(!this.queue.length)this.retry(); return; }
    // A receiver requesting the next sequence already accepted our current
    // packet. This is the protocol's implicit ACK after a lost explicit ACK.
    if(p.type==='N'&&p.sequence===((this.sequence+1)&63)&&this.stage.startsWith('send-')&&this.stage!=='send-init')
      p={...p,type:'Y',sequence:this.sequence};
    if (p.type!=='Y' || p.sequence!==this.sequence) return;
    this.deadline=this.now+this.timeout;
    switch(this.stage) {
      case 'send-init':this.negotiate(p.data);this.sequence=1;this.send('F',this.encoded(ascii(this.name)),'send-name');this.status('sending');break;
      case 'send-name':
        // The receiver may preserve an existing variable and choose another
        // name. Its F ACK reports the actual target name when supported.
        if(p.data.length){this.name=validateFilename(byteText(decodeData(p.data,this.rx,256)));this.status('sending');}
        this.nextSend();break;
      case 'send-data':
        if (p.data[0]===88||p.data[0]===90) throw new Error('The calculator cancelled the file transfer.');
        this.transferred=this.nextOffset;this.status('sending');this.nextSend();break;
      case 'send-eof':this.sequence=(this.sequence+1)&63;this.send('B',EMPTY,'send-break');break;
      case 'send-break':this.complete();break;
      case 'command-init':
        this.negotiate(p.data);this.sequence=0;
        this.send(this.mode==='get'?'R':'G',this.encoded(ascii(this.mode==='get'?this.name:this.mode==='directory'?'D':'F')),'command-response');
        this.status(this.mode==='directory'?'listing':this.mode==='finish'?'finishing':'receiving');break;
      case 'command-response':
        if (this.mode==='finish') this.complete();
        else if (this.mode==='directory') {this.listing(byteText(decodeData(p.data,this.rx,MAX_LISTING_BYTES)));this.complete();}
        break;
    }
  }
  discardInitialProbe() {
    // If the transport held our initial NAK, a valid peer initialization has
    // superseded it. Never drop a packet that has already been partly written.
    if(this.initialProbe&&this.queue[0]?.bytes===this.initialProbe&&this.queue[0].offset===0)this.queue.shift();
  }
  acceptFile(p) {
    if (p.sequence!==this.expected) {
      if (p.sequence===((this.expected+63)&63) && this.ack?.sequence===p.sequence) {
        this.enqueue(this.ack.bytes);this.deadline=this.now+this.timeout;this.retries=0;
      }
      else if (p.type!=='Y'&&p.type!=='N') this.enqueue(this.frame(this.expected,'N'));
      return;
    }
    if (p.type==='F'||p.type==='X') {
      if (this.current || this.files.length>=MAX_RECEIVE_FILES) throw new Error('Received too many files or an incomplete file.');
      const name=byteText(decodeData(p.data,this.rx,256));
      if (p.type==='F') validateFilename(name);
      this.current={name,screen:p.type==='X',buffer:new Uint8Array(p.type==='X'?MAX_LISTING_BYTES-this.listingBytes:MAX_FILE_BYTES),length:0};this.name=name;this.transferred=0;this.status(p.type==='X'?'listing':'receiving');
    } else if (p.type==='D') {
      if (!this.current) throw new Error('Kermit data arrived without a file header.');
      const data=decodeData(p.data,this.rx,this.current.buffer.length-this.current.length);
      if (this.receivedBytes+data.length>MAX_RECEIVE_BYTES) throw new Error('Received files exceed the 8 MiB session limit.');
      this.current.buffer.set(data,this.current.length);this.current.length+=data.length;this.receivedBytes+=data.length;
      if(this.current.screen)this.listingBytes+=data.length;
      this.transferred=this.current.length;this.status(this.current.screen?'listing':'receiving');
    } else if (p.type==='Z') {
      if (!this.current) throw new Error('Kermit EOF arrived without a file.');
      if (p.data.length && decodeData(p.data,this.rx,16)[0]===68) throw new Error('The calculator discarded the incomplete file.');
      const bytes=this.current.buffer.slice(0,this.current.length);
      if(!this.current.screen){
        const pending=this.files.filter(f=>!f.screen);
        if(pending.length+1>this.receiveBudget.files||pending.reduce((n,f)=>n+f.bytes.length,0)+bytes.length>this.receiveBudget.bytes)
          throw new Error('Download and clear received files before receiving more.');
        this.validateFile({name:this.current.name,bytes});
      }
      this.files.push({name:this.current.name,bytes,screen:this.current.screen});this.current=null;
    } else if (p.type==='B') {
      if (this.current) throw new Error('Kermit transfer ended before the file EOF.');
      this.acknowledge(p);this.stage='receive-close';this.expected=(this.expected+1)&63;
      this.queue.at(-1).sent=()=>{
        const screen=this.files.filter(f=>f.screen);
        if(screen.length){
          const merged=new Uint8Array(this.listingBytes);let offset=0;
          for(const f of screen){merged.set(f.bytes,offset);offset+=f.bytes.length;}
          this.listing(byteText(merged));
        }
        for (const f of this.files) if(!f.screen)this.file(f);
        // A retry is sent at the peer's timeout and arrives in a later poll.
        // Keep one additional timeout interval without extending on duplicates.
        this.files=[];this.lingerUntil=this.now+2*this.timeout;this.complete();
      };return;
    } else throw new Error('Unexpected Kermit packet '+p.type+'.');
    this.acknowledge(p);this.expected=(this.expected+1)&63;
  }
  poll(now) {
    this.now=now;
    try {
      if (this.active && now>=this.end) throw new Error('File transfer exceeded its five-minute virtual-time limit.');
      if (this.active && now>=this.deadline) this.retry();
      // At most one bounded write per poll; the transport may accept a prefix.
      const q=this.queue[0];
      if (q) {
        const remaining=q.bytes.subarray(q.offset), n=this.write(remaining);
        if (!Number.isInteger(n)||n<0||n>remaining.length) throw new Error('Invalid file-transfer transport acceptance.');
        q.offset+=n;
        if (q.offset===q.bytes.length) {this.queue.shift();q.sent?.();}
      }
    } catch (error) {this.fail(error.message);}
  }
  complete() {this.active=false;this.last=null;this.bytes=EMPTY;this.status('complete');}
  cancel(message = 'File transfer cancelled.') {
    if (!this.active) {this.queue=[];this.lingerUntil=0;return;}
    this.queue=[];
    // E is a protocol cancellation, not an injected calculator key or reset.
    this.enqueue(this.frame(this.sequence,'E',this.encoded(ascii('Cancelled'))));
    this.active=false;this.files=[];this.current=null;this.bytes=EMPTY;this.lingerUntil=0;this.status('cancelled',message);
  }
  fail(message) {
    if (!this.active) {this.queue=[];this.lingerUntil=0;return;}
    this.active=false;this.queue=[];this.files=[];this.current=null;this.bytes=EMPTY;this.lingerUntil=0;this.status('error',message);
  }
}
