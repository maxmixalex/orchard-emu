// SPDX-License-Identifier: MIT
// A generated ARMv4T guest exercises architectural TLB state through actual
// MCR/MRC, loads, branches and abort returns. No calculator firmware is used.
// Expectations follow ARM920T DDI0151C sections 2.3.12, 3.1.2 and 3.7.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const dir=await mkdtemp(resolve(tmpdir(),'orchard-tlb-guest-'));
const source=[];
let check=0,call=0;
function emit(...lines){source.push(...lines);}
function expect(register,value){
  const id=++check;
  emit('ldr r12, ='+value,'cmp '+register+', r12','movne r0, #'+(0x80|id),
    'bne failed','mov r0, #'+id,'strb r0, [r9, #0x20]');
}
function codeCall(){
  const label='returned_'+(++call);
  emit('add r5, r8, #0x100','adr lr, '+label,'bx r5',label+':');
}
function pte(value){emit('ldr r0, ='+value,'str r0, [r7]');}
function domain(value){emit('mov r0, #'+value,'mcr p15, 0, r0, c3, c0, 0');}
function invalidate(which,single=true){
  emit(single?'mov r0, r8':'mov r0, #0',
    'mcr p15, 0, r0, c8, c'+(which==='data'?6:5)+', '+(single?1:0));
}
emit('.syntax unified','.arch armv4t','.arm','.global _start',
  '_start: b start','.org 0x10','b data_abort','.org 0x40',
  'data_abort:','mrc p15, 0, r10, c5, c0, 0','add r11, r11, #1',
  'subs pc, lr, #4','.org 0x100','start:',
  'ldr r0, =0x53000000','mov r1, #0','str r1, [r0]',
  'ldr r9, =0x50000000','mov r0, #3','str r0, [r9]',
  'mov r0, #5','str r0, [r9, #4]',
  'ldr r4, =0x08000000','mov r5, #0x4000','mov r0, #0',
  'clear_tables:','str r0, [r4], #4','subs r5, r5, #1','bne clear_tables');
// Both address spaces keep the ROM, physical RAM and UART visible. Only the
// virtual test page changes, so every observed translation is made by the guest.
for(const [table,coarse] of [['0x08000000','0x08004021'],['0x08008000','0x0800c021']]){
  emit('ldr r4, ='+table,'ldr r0, =0x00000c02','str r0, [r4]',
    'ldr r0, =0x08000c02','str r0, [r4, #0x200]',
    'ldr r5, =0x1400','ldr r0, =0x50000c02','str r0, [r4, r5]',
    'ldr r0, ='+coarse,'str r0, [r4, #0x400]');
}
emit('ldr r7, =0x08004000');
pte('0x08010ff2');
emit('ldr r7, =0x0800c000');
pte('0x08010ff2');
for(const [physical,value,code] of [
  ['0x08010000','0x11223344','0xe3a0600a'],
  ['0x08011000','0xaabbccdd','0xe3a0600b'],
]){
  emit('ldr r4, ='+physical,'ldr r0, ='+value,'str r0, [r4]',
    'ldr r0, ='+code,'str r0, [r4, #0x100]',
    'ldr r0, =0xe12fff1e','str r0, [r4, #0x104]');
}
emit('ldr r0, =0x08000000','mcr p15, 0, r0, c2, c0, 0');
domain(15);
emit('mov r0, #0','mcr p15, 0, r0, c8, c7, 0',
  'mrc p15, 0, r0, c1, c0, 0','orr r0, r0, #1','mcr p15, 0, r0, c1, c0, 0',
  'b translated','translated:','ldr r8, =0x10000000','ldr r7, =0x08004000',
  'ldr r6, [r8]');
expect('r6','0x11223344');
codeCall();expect('r6',10);
pte('0x08011ff2');
emit('ldr r6, [r8]');expect('r6','0x11223344');
codeCall();expect('r6',10);
invalidate('data');
emit('ldr r6, [r8]');expect('r6','0xaabbccdd');
codeCall();expect('r6',10);
invalidate('instruction');
codeCall();expect('r6',11);
// A TTBR write does not invalidate either cache.
emit('ldr r0, =0x08008000','mcr p15, 0, r0, c2, c0, 0','ldr r7, =0x0800c000',
  'ldr r6, [r8]');
expect('r6','0xaabbccdd');
invalidate('data',false);
emit('ldr r6, [r8]');expect('r6','0x11223344');
codeCall();expect('r6',11);
invalidate('instruction',false);
codeCall();expect('r6',10);
// MMU disable/re-enable also preserves translations.
emit('mrc p15, 0, r0, c1, c0, 0','bic r0, r0, #1','mcr p15, 0, r0, c1, c0, 0',
  'b untranslated','untranslated:');
pte('0x08011ff2');
emit('mrc p15, 0, r0, c1, c0, 0','orr r0, r0, #1','mcr p15, 0, r0, c1, c0, 0',
  'b reenabled','reenabled:','ldr r6, [r8]');
expect('r6','0x11223344');
invalidate('data');
emit('ldr r6, [r8]');expect('r6','0xaabbccdd');
// A valid translation is filled before access protection rejects a load.
pte('0x08010002');invalidate('data');domain(7);
emit('mov r11, #0','ldr r6, [r8]');
expect('r11',1);expect('r10',0x1f);
pte('0x08011ff2');domain(15);
emit('ldr r6, [r8]');expect('r6','0x11223344');
pte('0x08010ff2');invalidate('data');domain(3);
emit('mov r11, #0','ldr r6, [r8]');
expect('r11',1);expect('r10',0x1b);
pte('0x08011ff2');domain(15);
emit('ldr r6, [r8]');expect('r6','0x11223344');
// An invalid descriptor must not become a cached translation.
pte(0);invalidate('data');
emit('mov r11, #0','ldr r6, [r8]');
expect('r11',1);expect('r10',0x17);
pte('0x08010ff2');
emit('ldr r6, [r8]');expect('r6','0x11223344');
// Deliberately overlapping entries have no physical-hardware claim. Orchard's
// reference lookup chooses the first matching slot; a host hint must preserve
// that deterministic choice even after a different 1 KiB page hashes alike.
// Keep the old 4 KiB entry, add a section via an adjacent-page miss, then touch
// a distant page that collides with the original page's host hint.
emit('ldr r4, =0x08008400','ldr r0, =0x08000c02','str r0, [r4]',
  'ldr r5, =0x10001000','ldr r6, [r5]',
  'ldr r5, =0x10010000','ldr r6, [r5]');
expect('r6','0x11223344');
emit('ldr r6, [r8]');expect('r6','0x11223344');
// Restore the normal table and a single warmed page for the checkpoint case.
emit('ldr r0, =0x0800c021','str r0, [r4]');invalidate('data');
emit('ldr r6, [r8]');
// Leave the ONLY usable mapping in the TLB, and wait for a host UART byte.
// Saving here distinguishes architectural state from reconstructible host hints.
pte(0);
emit('mov r0, #0x70','strb r0, [r9, #0x20]','wait_input:',
  'ldr r0, [r9, #0x10]','tst r0, #1','beq wait_input',
  'ldrb r0, [r9, #0x24]','ldr r6, [r8]');
expect('r6','0x11223344');
emit('mov r0, #0x71','strb r0, [r9, #0x20]','b finished',
  'failed:','strb r0, [r9, #0x20]','finished:',
  'mov r0, #0','mcr p15, 0, r0, c7, c0, 4','b finished','.ltorg');

try{
  const assembly=resolve(dir,'guest.S'),binary=resolve(dir,'guest.bin');
  await writeFile(assembly,source.join('\n')+'\n');
  const compiled=spawnSync(process.env.CLANG||'clang',[
    '--target=armv4t-none-eabi','-nostdlib','-fuse-ld=lld',
    '-Wl,-Ttext=0,-e,_start,--oformat=binary',assembly,'-o',binary,
  ],{encoding:'utf8'});
  assert.ifError(compiled.error);assert.equal(compiled.status,0,compiled.stderr);
  const guest=await readFile(binary),rom=new Uint8Array(1048576).fill(255);rom.set(guest);
  const wasm=await readFile(process.argv[2]||new URL('../dist/orchard.wasm',import.meta.url));
  async function machine(){
    const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
    assert.equal(c.create(1),0);
    new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
    assert.equal(c.load(rom.length),0);return c;
  }
  function receive(c){const n=c.uart_receive();return Array.from(new Uint8Array(c.memory.buffer,c.uart_output(),n));}
  function save(c){
    assert.equal(c.checkpoint_save(),0);
    return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
  }
  const a=await machine();assert.equal(a.run(100000),0);
  const initial=receive(a);
  assert.deepEqual(initial,[...Array.from({length:check-1},(_,i)=>i+1),0x70],
    'Guest emits the failing assertion with bit7 set; expected all pre-save cases.');
  const checkpoint=save(a),b=await machine();
  assert.equal(new DataView(checkpoint.buffer).getUint32(8,true),7,'Architectural TLB requires v7 state');
  new Uint8Array(b.memory.buffer,b.checkpoint_buffer(checkpoint.length),checkpoint.length).set(checkpoint);
  assert.equal(b.checkpoint_load(checkpoint.length),0);assert.deepEqual(save(b),checkpoint);
  for(const c of [a,b]){
    new Uint8Array(c.memory.buffer,c.uart_input(),1)[0]=1;
    assert.equal(c.uart_send(1),1);assert.equal(c.run(4096),0);
    assert.deepEqual(receive(c),[check,0x71]);
    const state=new Uint32Array(c.memory.buffer,c.snapshot(),33);
    assert.equal(state[24],3);assert.equal(state[28],0);assert.equal(state[26],1);
  }
  assert.deepEqual(save(a),save(b));
  console.log('ARM TLB guest: '+check+' instruction-driven mapping/abort cases, independent I/D invalidation, TTBR/MMU retention and stale-translation checkpoint continuation pass.');
}finally{await rm(dir,{recursive:true,force:true});}
