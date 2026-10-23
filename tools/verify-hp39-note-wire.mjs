// SPDX-License-Identifier: MIT
// Private original-ROM witness. All guest changes use physical switches and
// the production USB/file-transfer interfaces. No ROM/RAM patch or injection.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup,HP39GS_ROM} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';
import {FileTransfer} from '../web/file-transfer.js';
import {inspectHp39File,parseHp39Directory} from '../web/hp39-files.js';
import {prepareHp39WireFile} from '../web/hp39-wire.js';
import {PacketReader} from '../web/kermit.js';

const usage='Usage: node tools/verify-hp39-note-wire.mjs MODEL(1|2) ORIGINAL-FULL-ROM.bin NEW-PRIVATE-OUTPUT-DIRECTORY [--large]';
if(process.argv[2]==='--help'){
  console.log(usage+'\nCold boots original 39g+/39gs; uploads a self-authored ASCII Note through production Wire, opens EDIT, exports it using stock Disk SEND and compares title/text including high bytes. Output includes private LCDs; do not publish them. No host timing or hardware claim.');
  process.exit(0);
}
if(![5,6].includes(process.argv.length)||process.argv.length===6&&process.argv[5]!=='--large'||!['1','2'].includes(process.argv[2]))throw Error(usage);
const model=Number(process.argv[2]),romPath=resolve(process.argv[3]),out=resolve(process.argv[4]),large=process.argv.includes('--large');
const sha=b=>createHash('sha256').update(b).digest('hex'),text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const rom=await readFile(romPath),wasm=await readFile('dist/orchard.wasm');
assert.equal(sha(rom),model===1?'95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67':HP39GS_ROM);
await mkdir(out);
const preset=model===1?'hp39-home':'hp39gs-home',title='Orchard Note';
const body='Wire note test.\r\nSecond line: 0123456789.\r\n'+
  'Multi-block: '+('0123456789'.repeat(14))+'\r\n'+
  'Legacy bytes: \xe9\x80\xff; literal \\\\123.\r\n'+
  'Escapes: \\233\\<)\\255\\Ga\\->.\r\n'+
  'Symbols: \\<)\\x-\\.V\\v/\\.S\\GS\\|>\\pi\\.d\\<=\\>=\\=/\\Ga\\->\\<-\\|v\\|^\\Gg\\Gd\\Ge\\Gn\\Gh\\Gl\\Gr\\Gs\\Gt\\Gw\\GD\\PI\\GW\\[]\\oo\\<<\\^o\\Gm\\>>\\.x\\O/\\Gb\\:-.\r\n'+
  (large?Array.from({length:96},(_,i)=>`Stress ${String(i).padStart(2,'0')}: ${'0123456789'.repeat(7)}\r\n`).join(''):'');
// Stock SEND emits mode-3 ASCII translations even for C Notes. These explicit
// expected strings are independent of the production decoder under test.
const exportedBody=body.replaceAll('\xe9','\\233').replaceAll('\x80','\\<)').replaceAll('\xff','\\255');
const input=text(`HP39AscC ${title.length} ${title}\r\n${body}`),expected=text(`HP39AscC ${title.length} ${title}${exportedBody}`);
const packed=prepareHp39WireFile('NOTE.any-suffix',input);
assert.equal(packed.noteConverted,true);assert(packed.bytes.length>128);
const report={schema:'orchard-hp39-note-wire-stock-v1',model,preset,large,rom_sha256:sha(rom),wasm_sha256:sha(wasm),
  cold_boot:true,guest_memory_patched:false,host_timing_sample:false,hardware_validated:false,
  source:{bytes:input.length,sha256:sha(input)},wire_object:{bytes:packed.bytes.length,sha256:sha(packed.bytes)},
  sources:{},keys:[],usb:[],transfers:[],frames:[],received:[],packets:[],passed:false};
for(const name of ['web/hp48.js','web/virtual-usb.js','web/file-transfer.js','web/hp39-wire.js','web/hp39-transfer.js','web/hp39-files.js','web/kermit.js'])report.sources[name]=sha(await readFile(name));
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
const hz=c.timebase_hz(),state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
let tick=0,request=0,error='',wireBytesOut=0,wireBytesIn=0;
const returned=[];
const usb=new VirtualUSB(c,hz,e=>{report.usb.push({tick,...e});if(e.error)error=e.error;});
const ft=new FileTransfer({core:c,usb,model,now:()=>tick/hz*1000,notify:e=>{
  if(e.type==='file-transfer-received'){
    returned.push({name:e.name,bytes:e.bytes.slice()});report.received.push({tick,name:e.name,bytes:e.bytes.length,sha256:sha(e.bytes)});
    console.log('RECEIVED',e.name,e.bytes.length);
  }else{report.transfers.push({tick,...e});if(e.phase==='error')error=e.error;}
}});
const send=usb.send.bind(usb),read=usb.read.bind(usb),outReader=new PacketReader({end:13}),inReader=new PacketReader({end:13});
function packets(reader,bytes,direction){for(const p of reader.feed(bytes))report.packets.push({tick,direction,type:p.type,sequence:p.sequence,data_bytes:p.data?.length,error:p.error});}
usb.send=b=>{const r=send(b);if(ft.wire)wireBytesOut+=r.accepted;else if(r.accepted)packets(outReader,b.subarray(0,r.accepted),'host-to-calculator');return r;};
usb.read=()=>{const r=read();if(r.result===0){if(ft.wire)wireBytesIn+=r.bytes.length;else packets(inReader,r.bytes,'calculator-to-host');}return r;};
function run(n){while(n){const q=Math.min(8192,n);assert.equal(c.run(q),0,'Core stop: '+JSON.stringify(state()));tick+=q;n-=q;if(usb.connected)usb.poll(tick);ft.poll(tick);if(error)throw Error(error);}}
function until(predicate,seconds,label){const end=tick+seconds*hz;while(!predicate()&&tick<end)run(Math.min(8192,end-tick));assert(predicate(),label+' exceeded virtual budget');}
function key(scan,down){report.keys.push({tick,scan,down});assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated(scan===56?0:scan===57?4:scan===58?5:6,+down),0);}
function tap(scan){key(scan,true);run(2000000);key(scan,false);run(2000000);}
async function frame(name){assert.equal(c.frame_view(1),0);const bytes=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(bytes.map(b=>255-b))]),{flag:'wx'});
  const s=state(),record={name,tick,sha256:sha(bytes),stop:s[28],dfsr:s[18],far:s[19]};report.frames.push(record);console.log(name,tick,record.sha256);return record.sha256;}
try{
  run(50000000);tap(40);run(70000000);await frame('home');
  tap(59);tap(27);run(20000000);await frame('empty-note-catalog');
  tap(39);run(3000000);tap(44);await frame('wire-receive-menu');
  assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);until(()=>usb.phase==='ready',10,'USB enumeration');
  assert.equal(usb.info.name,'HPx9G+ Device');
  const start=tick;
  // Send the original ASCII bytes here; the actual production sender must
  // perform its own conversion, not rely on the preparatory expected result.
  ft.start({request:++request,mode:'send',protocol:'hp39-wire',transport:'usb',name:'NOTE.any-suffix',bytes:input},tick);tap(6);
  until(()=>!ft.active,60,'Wire upload');assert.equal(ft.session.phase,'complete');
  assert.equal(ft.session.transferred,packed.bytes.length);assert.deepEqual(ft.session.bytes,packed.bytes);
  report.wire={start_tick:start,end_tick:tick,acknowledged_bytes:ft.session.transferred,transport_bytes_out:wireBytesOut,transport_bytes_in:wireBytesIn,check:ft.session.check};
  run(120000000);await frame('installed-note-catalog');
  tap(35);run(20000000);await frame('installed-note-editor');
  tap(48);run(10000000);tap(59);tap(27);run(10000000);
  tap(38);run(3000000);for(let i=0;i<(model===1?2:3);i++)tap(44);await frame('disk-send-menu');
  tap(6);run(20000000);await frame('send-now');
  ft.start({request:++request,mode:'receive',transport:'usb'},tick);tap(6);
  until(()=>returned.length===2,large?900:120,'Stock Note SEND');run(12000000);await frame('after-send');
  const note=returned.find(f=>inspectHp39File(f.bytes).kind==='C'),directory=returned.find(f=>inspectHp39File(f.bytes).kind==='A');
  assert(note&&directory,'Expected a Note and its stock directory');
  assert.deepEqual(note.bytes,expected,'Stock export changed note title, lines or original charset bytes');
  assert.deepEqual(prepareHp39WireFile(note.name,note.bytes).bytes,packed.bytes,'Reimporting the stock ASCII export must recover the same binary object');
  const dataPackets=report.packets.filter(p=>p.direction==='calculator-to-host'&&p.type==='D');
  report.data_sequence_wraps=dataPackets.filter((p,i)=>i&&dataPackets[i-1].sequence===63&&p.sequence===0).length;
  if(large)assert(report.data_sequence_wraps>0,'The large Note must exercise stock Kermit sequence wrap');
  assert.deepEqual(parseHp39Directory(directory.bytes),[{kind:'C',file:note.name,title}]);
  report.note_equal=true;report.title_equal=true;report.high_bytes_equal=true;report.literal_backslash_equal=true;report.stock_export_repacked_equal=true;
  for(const f of returned)await writeFile(resolve(out,f.name),f.bytes,{flag:'wx'});
  ft.cancel(tick);usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);error='';
  run(2000000);tap(48);run(10000000);for(const scan of [26,5,26,6])tap(scan);run(30000000);
  report.arithmetic_frame_sha256=await frame('one-plus-one');
  assert.equal(report.arithmetic_frame_sha256,'15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759');
  report.arithmetic_after_transfer=true;
  report.final_state=state();assert.equal(report.final_state[18],0);assert.equal(report.final_state[28],0);report.passed=true;
}catch(failure){report.error=String(failure.stack||failure);report.final_state=state();await frame('failure').catch(()=>{});console.error(report.error);process.exitCode=1;}
report.tool_sha256=sha(await readFile(new URL(import.meta.url)));
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('HP39 Note Wire stock workflow',report.passed?'PASSED':'FAILED');
