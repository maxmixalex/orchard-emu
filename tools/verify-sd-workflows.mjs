// SPDX-License-Identifier: MIT
// Private original-ROM witness. Files are created through the original Filer,
// not by writing guest RAM. An optional prepared image additionally verifies
// host-created files/directories against the unchanged stock Filer.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {HP48_ROM,HP49_ROM,applySetup} from '../web/hp48.js';
import {createSDImage,readSDState} from '../web/sd-card.js';
import {readFirmware,sha256} from './rom-inputs.mjs';

const usage='Usage: node tools/verify-sd-workflows.mjs HP49-FULL-NOR HP48-FULL-NOR NEW-PRIVATE-OUTPUT-DIRECTORY [PREPARED-CARD.img]';
if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log(usage+'\nBuild production WASM and orchard-checkpoint-replay first. No firmware is fetched.\nCold boots the admitted 49g+/48gII ROMs, exercises physical FILES navigation, copies\n42 to SD through Filer, checks the exported FAT16 file, restores an in-flight card\nwrite on native/WASM, and recalls the exported image in a fresh cold boot.\nOutput includes private ROM/checkpoint/LCD/card artifacts; do not publish them.');
  process.exit(0);
}
if(![5,6].includes(process.argv.length))throw Error(usage);
const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(process.argv[4]);
const [rom49,rom48,wasm]=await Promise.all([
  readFirmware(resolve(process.argv[2])),readFirmware(resolve(process.argv[3])),readFile(resolve(root,'dist/orchard.wasm')),
]);
assert.equal(sha256(rom49),HP49_ROM);assert.equal(sha256(rom48),HP48_ROM);
const prepared=process.argv[5]?new Uint8Array(await readFile(resolve(process.argv[5]))):null;
await mkdir(output); // Never overwrite an earlier failed or successful witness.
const native=resolve(root,process.env.ORCHARD_BUILD_DIR||'build',process.platform==='win32'?'orchard-checkpoint-replay.exe':'orchard-checkpoint-replay');
const report={schema:'orchard-sd-stock-workflows-v1',wasm_sha256:sha256(wasm),
  tool_sha256:sha256(await readFile(fileURLToPath(import.meta.url))),native_sha256:sha256(await readFile(native)),
  roms:{hp49gplus:HP49_ROM,hp48gii:HP48_ROM},
  physical_input_only:true,guest_memory_patched:false,card_image_bytes:16777216,
  sram_decode:'explicit nGCS1 low-address mirror; physical capacity unchanged',
  canonical_hardware_boot:false,stages:[],keys:[],passed:false};
if(prepared)report.prepared_image={sha256:sha256(prepared),bytes:prepared.length,
  expected_root_file:'ANSWER',expected_directory:'PROGRAMS',expected_nested_file:'NESTED'};
const alphabet=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
async function emulator(label,model,rom){
  const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
  assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
  assert.equal(c.load(rom.length),0);applySetup(c,model,model===5?'hp49-home':'hp48-home');
  let previous=-1,observe=null;
  const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
  const tick=()=>{const s=state();return s[22]+s[23]*2**32;};
  function run(n){while(n){const amount=Math.min(n,observe?1024:1000000);assert.equal(c.run(amount),0,`${label}: diagnostic stop`);n-=amount;
    const s=state();assert.equal(s[18],0,`${label}: CPU data fault ${s[18]} at 0x${s[19].toString(16)}`);if(observe)observe();}}
  function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);
    report.keys.push({machine:label,tick:tick(),scan,down});}
  function tap(scan){if(scan===previous)run(2000000);previous=scan;key(scan,true);run(1200000);key(scan,false);run(1200000);}
  function type(text){assert.match(text,/^[A-Z]+$/);for(const ch of text){tap(57);tap(alphabet[ch.charCodeAt(0)-65]);}}
  function checkpoint(){assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();}
  function restore(bytes){const p=c.checkpoint_buffer(bytes.length);assert(p);new Uint8Array(c.memory.buffer,p,bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);}
  async function picture(name){assert.equal(c.frame_view(1),0);const height=c.profile(model,3),pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*height).slice();
    const hash=sha256(pixels);await writeFile(resolve(output,name+'.pgm'),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),Buffer.from(pixels.map(v=>255-v))]),{flag:'wx'});
    const s=state();report.stages.push({name,machine:label,tick:tick(),frame_sha256:hash,stop:s[28],dfsr:s[18],far:s[19],sd:readSDState(c),
      sram_alias_reads:c.sram_alias_reads().toString(),sram_alias_writes:c.sram_alias_writes().toString()});console.log(name,tick(),hash);return hash;}
  async function cold(){run(60000000);key(40,true);run(600000);key(40,false);run(59400000);key(40,true);run(600000);key(40,false);run(39400000);return picture(label+'-home');}
  function insert(image){const p=c.sd_buffer(image.length);assert(p);new Uint8Array(c.memory.buffer,p,image.length).set(image);assert.equal(c.sd_insert(image.length,0),0);}
  function card(){const s=readSDState(c),p=c.sd_image_buffer();assert(s?.present&&p);return new Uint8Array(c.memory.buffer,p,s.bytes).slice();}
  return {c,state,tick,run,key,tap,type,checkpoint,restore,picture,cold,insert,card,setObserver:fn=>{observe=fn;}};
}
// Independent filesystem inspection of the image exported by the emulated card.
// Walk FAT16 clusters and compare both allocation tables; never write the image.
function fileFromFAT16(bytes,name){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=o=>v.getUint16(o,true),u32=o=>v.getUint32(o,true);
  assert.equal(u16(510),0xaa55);const start=u32(454),b=start*512;assert.equal(u16(b+510),0xaa55);
  assert.equal(u16(b+11),512);const clusterBytes=bytes[b+13]*512,reserved=u16(b+14),fats=bytes[b+16],fatBytes=u16(b+22)*512;
  assert.equal(fats,2);const fat=b+reserved*512,entries=u16(b+17),directory=fat+fats*fatBytes,data=directory+Math.ceil(entries*32/512)*512;
  assert.equal(Buffer.compare(bytes.subarray(fat,fat+fatBytes),bytes.subarray(fat+fatBytes,fat+2*fatBytes)),0,'FAT copies disagree');
  let entry=-1;
  for(let i=0;i<entries;i++){const o=directory+i*32;if(!bytes[o])break;if(bytes[o]===0xe5||(bytes[o+11]&8))continue;
    const base=new TextDecoder().decode(bytes.subarray(o,o+8)).trim(),ext=new TextDecoder().decode(bytes.subarray(o+8,o+11)).trim();
    if((ext?base+'.'+ext:base)===name){entry=o;break;}}
  assert(entry>=0,`${name} not found on exported card`);assert.equal(bytes[entry+11]&0x10,0);
  const length=u32(entry+28),result=new Uint8Array(length),seen=new Set();let cluster=u16(entry+26),offset=0;
  while(offset<length){assert(cluster>=2&&cluster<0xfff0&&!seen.has(cluster),'Invalid or cyclic FAT chain');seen.add(cluster);
    const pos=data+(cluster-2)*clusterBytes,amount=Math.min(clusterBytes,length-offset);assert(pos+amount<=bytes.length);
    result.set(bytes.subarray(pos,pos+amount),offset);offset+=amount;assert(cluster*2+2<=fatBytes);cluster=u16(fat+cluster*2);}
  assert(cluster>=0xfff8,'File chain has unexpected surplus clusters');return result;
}
async function strictBoundaryWitness(before){
  const e=await emulator('strict-boundary-probe',5,rom49);e.restore(before);assert.equal(e.c.sram_select(0),0);e.key(42,true);
  for(let i=0;i<500000;i++){const pc=e.state()[15];assert.equal(e.c.run(1),0);const s=e.state();if(s[18]){
    const fault={tick:e.tick(),pc,opcode:rom49.readUInt32LE(pc),dfsr:s[18],far:s[19],physical_ram_bytes:524288};
    assert.equal(pc,0x3f814);assert.equal(fault.opcode,0xe5931004);assert.equal(s[18],8);assert.equal(s[19],0x08080000);
    report.strict_boundary_probe=fault;return;}}
  throw Error('Expected strict-decoder boundary read was not observed');
}
async function crossHost(before){
  const e=await emulator('checkpoint-replay',5,rom49);e.restore(before);const delta=100000;
  const prefix=resolve(output,'partial-sd-write');await writeFile(prefix+'.checkpoint',before,{flag:'wx'});
  e.run(delta);const expected=e.checkpoint();await writeFile(prefix+'-wasm-after.checkpoint',expected,{flag:'wx'});
  const norPath=resolve(output,'private-hp49-full-nor.bin');await writeFile(norPath,rom49,{flag:'wx'});
  const nativePath=prefix+'-native-after.checkpoint';
  const result=spawnSync(native,['5',norPath,prefix+'.checkpoint',String(delta),nativePath],{encoding:'utf8',timeout:60000,maxBuffer:1048576});
  if(result.error)throw result.error;assert.equal(result.status,0,result.stderr||'Native replay failed');
  const actual=await readFile(nativePath);assert.equal(Buffer.compare(actual,expected),0,'Native/WASM full-card continuation differs');
  const view=new DataView(before.buffer,before.byteOffset,before.byteLength);
  report.continuation={checkpoint_bytes:before.length,version:view.getUint32(8,true),partial_sector_bytes:view.getUint32(4122+96,true),
    delta_ticks:delta,before_sha256:sha256(before),after_sha256:sha256(expected),native_wasm_equal:true,full_card_included:true};
}
let active;
try{
  const a=active=await emulator('hp49',5,rom49),home=await a.cold();
  a.tap(58);a.tap(41);a.run(20000000);const tree=await a.picture('hp49-files-no-card');
  const noCard=a.checkpoint();await strictBoundaryWitness(noCard);
  a.tap(42);a.run(5000000);assert.notEqual(await a.picture('hp49-files-no-card-up'),tree);
  a.tap(56);a.run(5000000);assert.equal(await a.picture('hp49-files-no-card-return'),home);
  if(prepared)assert.equal(Buffer.from(fileFromFAT16(prepared,'ANSWER')).toString('hex'),'4850485034392d5814268000004200');
  a.insert(prepared||createSDImage());a.tap(58);a.tap(41);a.run(20000000);await a.picture('hp49-files-with-card');
  assert(readSDState(a.c).readBlocks>0);a.tap(56);a.run(5000000);
  // ALG HOME: 42 -> TEST, then ordinary File Manager COPY to port 3.
  for(const key of [25,19,49])a.tap(key);a.type('TEST');a.tap(6);a.run(10000000);await a.picture('hp49-created-test-42');
  a.tap(58);a.tap(41);a.run(10000000);a.tap(40);a.run(10000000);await a.picture('hp49-home-test-selected');
  a.tap(36);a.run(10000000);a.tap(42);await a.picture('hp49-copy-destination-sd');
  const writesBefore=readSDState(a.c).writtenBlocks;let partial=null;
  a.setObserver(()=>{if(partial||readSDState(a.c).cardState!==6)return;
    const bytes=a.checkpoint(),v=new DataView(bytes.buffer);assert.equal(v.getUint32(8,true),3);
    const count=v.getUint32(4122+96,true);if(count>0&&count<512)partial=bytes;});
  a.tap(40);a.run(15000000);a.setObserver(null);await a.picture('hp49-copy-complete');
  assert(partial,'No in-flight sector write captured');assert(readSDState(a.c).writtenBlocks>writesBefore);await crossHost(partial);
  const exported=a.card(),file=fileFromFAT16(exported,'TEST');
  if(prepared)assert.deepEqual(fileFromFAT16(exported,'ANSWER'),fileFromFAT16(prepared,'ANSWER'),'Guest write changed the prepared root file');
  // This is the stock ROM's exact-integer 42 object, including its transfer header.
  assert.equal(Buffer.from(file).toString('hex'),'4850485034392d5814268000004200');
  await writeFile(resolve(output,'exported-sd.img'),exported,{flag:'wx'});
  report.exported={image_sha256:sha256(exported),file:'TEST',file_bytes:file.length,file_sha256:sha256(file),
    filesystem:'FAT16',fat_copies_equal:true,writes_before_copy:writesBefore,writes_after_copy:readSDState(a.c).writtenBlocks};
  a.tap(40);a.run(5000000);a.tap(42);a.run(5000000);
  const readsBeforeEntry=readSDState(a.c).readBlocks;a.tap(40);a.run(20000000);
  assert(readSDState(a.c).readBlocks>readsBeforeEntry,'Filer has not entered the SD directory');
  if(prepared)a.tap(44); // Stock Filer sorts PROGRAMS before the first regular file ANSWER.
  await a.picture(prepared?'hp49-sd-answer-selected':'hp49-sd-test-selected');
  const readsBefore=readSDState(a.c).readBlocks;a.tap(38);a.run(10000000);a.tap(56);a.run(5000000);
  await a.picture('hp49-sd-recalled-42');assert(readSDState(a.c).readBlocks>readsBefore);
  // A genuinely fresh calculator has no HOME TEST variable or old card cache.
  const fresh=active=await emulator('hp49-fresh',5,rom49);await fresh.cold();fresh.insert(exported);
  fresh.tap(58);fresh.tap(41);fresh.run(20000000);fresh.tap(42);fresh.tap(40);fresh.run(15000000);
  if(prepared)fresh.tap(44);
  await fresh.picture(prepared?'hp49-fresh-sd-answer':'hp49-fresh-sd-test');fresh.tap(38);fresh.run(10000000);fresh.tap(56);fresh.run(5000000);
  const recalled=await fresh.picture('hp49-fresh-recalled-42');assert(readSDState(fresh.c).readBlocks>0);
  assert.equal(recalled,'e01013055e51a5d9a50820786b7ba3eb821eb74dfc614949dda98a4d22dc5b97','Fresh original-ROM HOME must display the independently reviewed integer 42');
  assert.equal(Buffer.compare(fileFromFAT16(fresh.card(),'TEST'),file),0);report.fresh_card_reimport=true;
  if(prepared){
    const nested=active=await emulator('hp49-nested',5,rom49);await nested.cold();nested.insert(exported);
    nested.tap(58);nested.tap(41);nested.run(20000000);nested.tap(42);nested.tap(40);nested.run(15000000);
    nested.tap(45);nested.run(15000000);await nested.picture('hp49-prepared-nested-directory'); // RIGHT enters PROGRAMS; F6 is TREE and EVAL evaluates a name.
    const reads=readSDState(nested.c).readBlocks;nested.tap(38);nested.run(10000000);nested.tap(56);nested.run(5000000);
    const nestedRecalled=await nested.picture('hp49-prepared-nested-recalled-42');
    assert.equal(nestedRecalled,recalled,'Prepared nested file did not recall the same 42 on a fresh machine');
    assert(readSDState(nested.c).readBlocks>reads);
    report.prepared_image={...report.prepared_image,root_recalled:true,nested_recalled:true,
      guest_created_test:true,prepared_root_preserved:true};
  }
  const h=active=await emulator('hp48',4,rom48),hHome=await h.cold();
  assert.equal(h.c.profile(4,4),0);assert.equal(h.c.sd_buffer(16777216),0);assert.notEqual(h.c.sd_insert(16777216,0),0);
  h.tap(58);h.tap(41);h.run(20000000);const hTree=await h.picture('hp48-files');
  h.tap(42);h.run(5000000);assert.notEqual(await h.picture('hp48-files-up'),hTree);
  h.tap(56);h.run(5000000);assert.equal(await h.picture('hp48-files-return'),hHome);
  for(const key of [26,5,26,6])h.tap(key);h.run(5000000);await h.picture('hp48-after-files-one-plus-one');
  report.hp48={cold_boot:true,files_navigation:true,returned_home:true,sd_slot:false,card_rejected:true};
  report.passed=true;
}catch(error){report.error=error.message;report.last_state=active?.state();process.exitCode=1;console.error(error.message);}
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('Stock SD/FILES workflows',report.passed?'PASSED':'FAILED');
