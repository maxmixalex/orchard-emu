// SPDX-License-Identifier: MIT
// Explicit, offline HP50g native-boot enumeration witness. No OS is supplied,
// installed or written; this is not a Conn3x/file-transfer or OS boot test.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareInput, readFirmware, sha256 } from './rom-inputs.mjs';
import { createUSBSession } from './usb-host.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length < 3 || process.argv.length > 4) throw new Error('Usage: node tools/probe-usb.mjs BOOT-50G.bin [NEW-REPORT.json]');
const original = await readFirmware(resolve(process.argv[2]));
const input = prepareInput(6, original, 'bootloader');
const build = resolve(root, process.env.ORCHARD_BUILD_DIR || 'build');
const s = await createUSBSession(root, build, 6, input.image);
for (const cmd of ['keyboard 1', 'pad 3 cc7f 0', 'pad 6 1 0', 'bias 6 f800 f800',
  'run 2000000', 'key 3 5 1', 'run 400000', 'key 3 5 0', 'run 600000',
  'connect 1', 'reset 1', 'run 1000', 'reset 0', 'run 20000']) assert.equal(s.command(cmd).result, 0);
const first = s.control([128,6,0,1,0,0,8,0]);assert.equal(first.length,8);assert.equal(first[7],8);
assert.equal(s.control([0,5,7,0,0,0,0,0]).length,0);
assert.equal(s.command('in 0 0 1').result,3,'Old USB address must not respond');
const device = s.control([128,6,0,1,0,0,18,0],7);assert.equal(device.length,18);assert.equal(device[0],18);assert.equal(device[1],1);
assert.deepEqual(device.subarray(0,8),first);
const header = s.control([128,6,0,2,0,0,9,0],7);assert.equal(header.length,9);
const total = header.readUInt16LE(2);assert(total >=9 && total <=1024);
const config = s.control([128,6,0,2,0,0,total&255,total>>8],7);assert.equal(config.length,total);assert.deepEqual(config.subarray(0,9),header);
const endpoints=[];
for(let at=0;at<config.length;){
  const len=config[at];assert(len>=2&&at+len<=config.length);
  if(config[at+1]===5){assert(len>=7);endpoints.push({address:config[at+2],attributes:config[at+3],max_packet:config.readUInt16LE(at+4)});}
  at+=len;
}
assert(endpoints.length>0);
assert.equal(s.control([0,9,config[5],0,0,0,0,0],7).length,0);
// Preserve a concrete unresolved control case rather than auto-arming a packet
// when firmware sets DATA_END without documented IN_PKT_RDY.
assert.equal(s.out(7,0,true,0,[128,8,0,0,0,0,1,0]).result,0);
const configurationReplies=[];
for(let i=0;i<8;++i){s.command('run 2000');configurationReplies.push(s.command('in 7 0 0'));}
assert(configurationReplies.every(p=>p.result===1));
const configurationDiagnostic=configurationReplies.at(-1);
// A fresh SETUP recovers without host edits to guest RAM/registers.
assert.deepEqual(s.control([128,6,0,1,0,0,18,0],7),device);
s.command('connect 0');assert.equal(s.command('in 7 0 1').result,3);
s.command('connect 1');s.command('reset 1');s.command('run 1000');s.command('reset 0');s.command('run 20000');
assert.equal(s.command('in 7 0 1').result,3);
assert.deepEqual(s.control([128,6,0,1,0,0,8,0]),first);
const languageDescriptor = s.control([128,6,0,3,0,0,255,0]);
assert(languageDescriptor.length >= 4 && languageDescriptor.length % 2 === 0);
assert.equal(languageDescriptor[0], languageDescriptor.length); assert.equal(languageDescriptor[1], 3);
const language = languageDescriptor.readUInt16LE(2), strings = [];
for (const index of new Set([device[14], device[15], device[16]].filter(Boolean))) {
  const raw = s.control([128,6,index,3,language&255,language>>8,255,0]);
  assert(raw.length >= 2 && raw.length % 2 === 0);
  assert.equal(raw[0], raw.length); assert.equal(raw[1], 3);
  strings.push({ index, language, descriptor: raw.toString('hex'), text: raw.subarray(2).toString('utf16le') });
}
const transcript=await s.verify();
const exe=resolve(build,process.platform==='win32'?'orchard-usb-session.exe':'orchard-usb-session');
const report={schema:'orchard-usb-probe-v1',base_revision:'a9e03bd946b6c6cc47887f937458fe158236dd20',
  source_input:input.source,construction:input.construction,input_sha256:sha256(input.image),
  native_binary_sha256:sha256(await readFile(exe)),wasm_sha256:sha256(s.wasm),
  conditions:{keyboard:'apples',strong_pads:['D:cc7f:0','G:1:0'],weak_bias:['G:f800:f800'],key1:[2000000,2400000],lcd_probe68:'strict'},
  device_descriptor:device.toString('hex'),configuration_descriptor:config.toString('hex'),
  vendor_id:device.readUInt16LE(8),product_id:device.readUInt16LE(10),endpoints,strings,
  set_address_status_complete:true,set_configuration_status_complete:true,
  get_configuration:{result:'NAK in 16000-quanta diagnostic window',csr0:configurationDiagnostic.usb[12]&255,tx_bytes:configurationDiagnostic.usb[14],resolved:false},
  cold_replay_equal:true,stock_os_booted:false,host_os_device_created:false,file_transfer_verified:false,...transcript};
const text=JSON.stringify(report,null,2)+'\n';
if(process.argv[3])await writeFile(resolve(process.argv[3]),text,{flag:'wx'});
console.log(JSON.stringify({source_input:report.source_input,device_descriptor:report.device_descriptor,
  configuration_descriptor:report.configuration_descriptor,vendor_id:report.vendor_id,product_id:report.product_id,
  endpoints,strings,steps:s.commands.length,native_wasm_equal:true,cold_replay_equal:true,get_configuration:report.get_configuration,
  stock_os_booted:false,file_transfer_verified:false},null,2));
