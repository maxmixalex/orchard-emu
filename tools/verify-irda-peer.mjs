// SPDX-License-Identifier: MIT
// Ordinary original-ROM SEND/RECV across two independent decoded UART2 peers.
// Requires the home checkpoints made by verify-serial-selftests.mjs. No guest
// memory edits, host Kermit server or synthesized IrLAP responses are used.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup} from '../web/hp48.js';
import {checksum,decodeData} from '../web/kermit.js';
const usage='Usage: node tools/verify-irda-peer.mjs WASM ROM-DIRECTORY SELFTEST-WITNESS-DIRECTORY NEW-PRIVATE-OUTPUT-DIRECTORY';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage);process.exit(0);}
if(process.argv.length!==6)throw Error(usage);
const [wasmPath,input,seeds,out]=process.argv.slice(2).map(p=>resolve(p));
const sha=b=>createHash('sha256').update(b).digest('hex'),wasm=await readFile(wasmPath);
await mkdir(out);
const report={schema:'orchard-original-irda-peer-v1',wasm_sha256:sha(wasm),
 tool_sha256:sha(await readFile(new URL(import.meta.url))),physical_input_only:true,
 guest_memory_patched:false,host_protocol_responses:false,physical_hardware_validated:false,
 quantum_ticks:512,roms:[],keys:[],wire:[[],[]],frames:[],transfers:[],passed:false};
const machines=[];
for(const[model,file,preset,hash]of[
 [5,'hp49gplus-full.bin','hp49-home','3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab'],
 [4,'48gii.bin','hp48-home','4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937'],
]){
 const rom=await readFile(join(input,file)),checkpoint=await readFile(join(seeds,String(model),'home.checkpoint'));
 assert.equal(sha(rom),hash,'Original ROM identity');
 const{instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
 assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
 assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
 new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),checkpoint.length).set(checkpoint);
 assert.equal(c.checkpoint_load(checkpoint.length),0);
 if(model===5)assert.equal(c.irda_attach(1),0);
 machines.push({c,model,tick:0,last:-1,dropped:0,modes:new Set()});
 report.roms.push({model,rom_sha256:hash,home_checkpoint_sha256:sha(checkpoint)});
}
const state=m=>Array.from(new Uint32Array(m.c.memory.buffer,m.c.snapshot(),33));
const uart=m=>Array.from(new Uint32Array(m.c.memory.buffer,m.c.uart_snapshot(2),9));
function route(from,to,index){
 const c=from.c,n=c.uart_receive_channel(2);if(!n)return;
 const bytes=new Uint8Array(c.memory.buffer,c.uart_output(),n).slice(),src=uart(from),dst=uart(to);
 from.modes.add(src.slice(0,5).join(','));
 // Infrared never preserves packets for a receiver that was switched off.
 if(!(src[0]&64)||src[1]&32||!dst[7]||!(dst[0]&64)||!(dst[1]&3)||dst[1]&32){from.dropped+=n;return;}
 assert(report.wire[index].length+n<=1024*1024,'Bound private capture');report.wire[index].push(...bytes);
 new Uint8Array(to.c.memory.buffer,to.c.uart_input(),n).set(bytes);
 assert.equal(to.c.uart_send_channel(2,n),n,'Peer staging queue must have room');
}
function run(n){while(n){const q=Math.min(n,512);for(let i=0;i<2;i++){
 const m=machines[i];assert.equal(m.c.run(q),0,JSON.stringify(state(m)));m.tick+=q;
 for(let ch=0;ch<2;ch++)assert.equal(m.c.uart_receive_channel(ch),0,'Unrelated UART traffic');
 route(m,machines[1-i],i);
 }n-=q;}}
function key(m,scan,down){const c=m.c;assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);report.keys.push({model:m.model,tick:m.tick,scan,down});}
function tap(m,scan){if(m.last===scan)run(2000000);m.last=scan;key(m,scan,true);run(1200000);key(m,scan,false);run(1200000);}
const alphabet=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
const digits=[27,26,19,12,25,18,11,24,17,10];
function type(m,text){for(const ch of text){tap(m,57);tap(m,alphabet[ch.charCodeAt(0)-65]);}}
function command(m,text){type(m,text);tap(m,6);run(3000000);}
function number(m,n){for(const ch of String(Math.abs(n)))tap(m,digits[Number(ch)]);if(n<0)tap(m,23);tap(m,6);}
function name(m,text){tap(m,14);type(m,text);tap(m,6);}
async function frame(label){for(const m of machines){const c=m.c,height=m.model===5?80:64;
 assert.equal(c.frame_view(1),0);const p=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*height).slice();
 await writeFile(join(out,`${label}-${m.model}.pgm`),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),p.map(v=>255-v)]),{flag:'wx'});
 assert.equal(c.checkpoint_save(),0);const cp=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
 await writeFile(join(out,`${label}-${m.model}.checkpoint`),cp,{flag:'wx'});
 report.frames.push({label,model:m.model,tick:m.tick,frame_sha256:sha(p),checkpoint_sha256:sha(cp),state:state(m),uart2:uart(m)});
 console.log(label,m.model,sha(p));
}}
// Read-only observer for the LSAP3 IrCOMM data path used by these originals.
// Kermit CRC16 is specified in kermitproject.org/kproto.pdf section6.3.
// It analyzes captured bytes after the guests have finished; it sends nothing.
function packets(raw){
 const stream=[];let frame=[],inside=false,escape=false,last=-1;
 for(const byte of raw){
  if(byte===0xc0){frame=[];inside=true;escape=false;}
  else if(byte===0xc1){
   if(inside&&frame.length>=8&&!(frame[1]&1)&&frame[2]===3&&frame[3]===3){
    const sequence=(frame[1]>>1)&7;
    if(sequence!==last){last=sequence;if(frame[5]===0)stream.push(...frame.slice(6,-2));}
   }inside=false;
  }else if(inside){if(escape){frame.push(byte^32);escape=false;}else if(byte===0x7d)escape=true;else frame.push(byte);}
 }
 const result=[];
 for(let i=0;i<stream.length;i++)if(stream[i]===1){
  const length=stream[i+1]-32,p=stream.slice(i,i+length+2);if(length<3||length>94||p.length!==length+2)continue;
  let crc=0;for(const byte of p.slice(1,-3)){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0x8408:0);}
  const encoded=(p.at(-3)-32)*4096+(p.at(-2)-32)*64+p.at(-1)-32;
  const check=crc===encoded?3:checksum(p.slice(1,-1))===p.at(-1)?1:0;
  assert(check,'Captured guest Kermit checksum');
  result.push({sequence:p[2]-32,type:String.fromCharCode(p[3]),check,data:p.slice(4,-check)});i+=length+1;
 }
 return result;
}
async function exchange(fromIndex,label,value){
 const from=machines[fromIndex],to=machines[1-fromIndex],starts=report.wire.map(w=>w.length);
 number(from,value);name(from,label);command(from,'STO');
 name(from,label);type(from,'SEND');type(to,'RECV');await frame(label+'-ready');
 tap(to,6);tap(from,6);let waited=0;
 while((uart(from)[7]||uart(to)[7])&&waited<360000000){run(120000);waited+=120000;}
 assert.equal(uart(from)[7]+uart(to)[7],0,'Stock commands must close both ports');run(5000000);
 const sent=packets(report.wire[fromIndex].slice(starts[fromIndex]));
 const received=packets(report.wire[1-fromIndex].slice(starts[1-fromIndex]));
 const unique=sent.filter((p,i)=>sent.findIndex(q=>q.sequence===p.sequence&&q.type===p.type)===i);
 const header=unique.find(p=>p.type==='F'),data=unique.filter(p=>p.type==='D');
 assert.equal(Buffer.from(header?.data||[]).toString('ascii'),label);
 const bytes=Buffer.concat(data.map(p=>Buffer.from(decodeData(Uint8Array.from(p.data),{ctl:35,binary:null,repeat:null}))));
 assert.equal(bytes.toString('ascii'),`%%HP: T(1)A(R)F(.);\r\n${value}`);
 const end=unique.find(p=>p.type==='B');assert(end&&received.some(p=>p.type==='Y'&&p.sequence===end.sequence));
 command(to,label);await frame(label+'-recalled');
 report.transfers.push({from:from.model,to:to.model,name:label,value,waited_ticks:waited,
  file_bytes:bytes.length,file_sha256:sha(bytes),file_crc_verified:true,end_acknowledged:true,
  packets:sent.map(({sequence,type,check,data})=>({sequence,type,check,data_bytes:data.length}))});
}
try{
 for(const m of machines){for(const scan of[46,23,40])tap(m,scan);number(m,-33);command(m,'SF');}
 await exchange(0,'ORCHARD',12345);await exchange(1,'RETURN',54321);report.passed=true;
}catch(error){report.error=String(error.stack||error);await frame('failure').catch(()=>{});process.exitCode=1;console.error(report.error);}
report.transport=machines.map(m=>({model:m.model,discarded_while_unready:m.dropped,modes:[...m.modes]}));
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
