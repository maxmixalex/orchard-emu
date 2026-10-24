// SPDX-License-Identifier: MIT
// State-machine fixtures only. Real unmodified-ROM frame recognition and
// protocol ACK evidence are reported separately in hp39-wire-batch-r23.json.
import assert from 'node:assert/strict';
import {Hp39WireAutoReceive,recognizeHp39WireScreen} from '../web/hp39-wire-auto.js';
import {hp39TransferMenus} from '../web/hp39-transfer-ui.js';
import {CalculatorController} from '../web/controller.js';
import {CALCULATORS} from '../web/catalog.js';
let checks=0;const check=fn=>{fn();checks++;};
const make=extra=>new Hp39WireAutoReceive({model:2,previousKind:'H',kind:'B',recognize:frame=>frame.screen,...extra});
const frame=(tick,screen,extra={})=>({tick,screen,running:true,stopped:false,pending:0,active:null,...extra});
const driver=make();
check(()=>assert.equal(driver.observe(frame(0,'aplet-catalog')),null));
check(()=>assert.equal(driver.observe(frame(100000,'aplet-catalog')),null));
check(()=>assert.deepEqual(driver.observe(frame(1300000,'aplet-catalog')),[39]));
check(()=>assert.equal(driver.observe(frame(2700000,'aplet-catalog')),null));
check(()=>assert.equal(driver.observe(frame(4000000,'receive-initial',{pending:1})),null));
check(()=>assert.equal(driver.observe(frame(5000000,'receive-initial')),null));
check(()=>assert.deepEqual(driver.observe(frame(6300000,'receive-initial')),[44]));
check(()=>assert.equal(driver.observe(frame(7000000,'receive-wire')),null));
check(()=>assert.deepEqual(driver.observe(frame(8300000,'receive-wire')),[6]));
check(()=>assert.equal(driver.active,false));check(()=>assert.equal(driver.observe(frame(10000000,'receive-wire')),null));
for(const extra of [{model:3},{transport:'serial'},{kind:'C'},{kind:'D'},{previousKind:'C'}])check(()=>assert.equal(make(extra).active,false));
for(const bad of [{running:false},{stopped:true},{tick:NaN}]){
  const guarded=make();check(()=>assert.equal(guarded.observe(frame(0,'aplet-catalog',bad)),null));check(()=>assert.equal(guarded.active,false));
}
const unknown=make();for(let tick=0;tick<=360000000;tick+=12000000)check(()=>assert.equal(unknown.observe(frame(tick,null)),null));
check(()=>assert.equal(unknown.observe(frame(360000001,'aplet-catalog')),null));check(()=>assert.equal(unknown.active,false));
const backwards=make();backwards.observe(frame(1000000,'aplet-catalog'));backwards.observe(frame(0,'aplet-catalog'));check(()=>assert.equal(backwards.active,false));
const cancelled=make();cancelled.observe(frame(0,'aplet-catalog'));cancelled.cancel();check(()=>assert.equal(cancelled.observe(frame(2000000,'aplet-catalog')),null));
for(const value of [0,255])check(()=>assert.equal(recognizeHp39WireScreen({width:131,height:64,pixels:new Uint8Array(131*64).fill(value)},2),null));
check(()=>assert.deepEqual(hp39TransferMenus(1),{wire:'HP39/40 (Wire)',disk:'Disk drive…'}));
check(()=>assert.deepEqual(hp39TransferMenus(2),{wire:'HP39/40 (USB)',disk:'USB Disk drive…'}));
check(()=>assert.deepEqual(hp39TransferMenus(2,'serial'),{wire:'HP39/40 (Ser)',disk:'Ser. Disk drive…'}));

const bytes=new TextEncoder().encode('HP39BinB\x04TESTopaque-body');
const file=name=>({file:{name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer}});
for(const enabled of [false,true]){
  const sent=[],c=new CalculatorController({database:null,worker:{postMessage:message=>sent.push(message),terminate(){}}});
  c.patch({model:CALCULATORS.find(model=>model.id===2),ready:true,loaded:true,running:true,usb:true,usbReady:true});
  const emit=data=>c.receive({generation:c.generation,...data});
  const complete=()=>emit({type:'file-transfer-status',request:c.transferRequest,active:false,phase:'complete',transferred:bytes.length,total:bytes.length});
  await c.startHp39Server('usb',[file('FIRST'),file('SECOND'),file('THIRD')],{protocol:'wire',autoReceive:enabled});
  check(()=>assert.equal(c.state.transfer.autoReceive,false));
  check(()=>assert.equal(sent.filter(message=>message.type==='tap-sequence').length,0));
  complete();check(()=>assert.equal(c.state.transfer.autoReceive,enabled));
  if(enabled){
    c.wireAutoReceive.recognize=frame=>frame.screen;
    emit({type:'snapshot',loaded:true,...frame(0,'aplet-catalog')});emit({type:'snapshot',loaded:true,...frame(1300000,'aplet-catalog')});
    check(()=>assert.deepEqual(sent.at(-1).scans,[39]));
    c.tap([56]);check(()=>assert.equal(c.wireAutoReceive,null));check(()=>assert.equal(c.uploadQueue.autoReceive,false));
    check(()=>assert.deepEqual(sent.at(-1).scans,[56]));
    emit({type:'snapshot',loaded:true,...frame(4000000,'receive-initial')});
    check(()=>assert.deepEqual(sent.at(-1).scans,[56]));
  }
  complete();check(()=>assert.equal(c.state.transfer.autoReceive,false));complete();c.dispose();
}
console.log(`HP39 Wire continuation: ${checks} stable-screen/key-queue gates, unknown pages, timing epochs, manual interruption, explicit batch opt-in, catalog restrictions and model-specific menu checks pass.`);
