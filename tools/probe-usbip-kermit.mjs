// SPDX-License-Identifier: MIT
// A user-space USB/IP client for the original-ROM browser bridge witness.
// This deliberately does not attach an OS driver or impersonate Conn3x.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {KermitSession} from '../web/kermit.js';
import {tcpClient,operation,urb,importDevice,completion,until} from '../tests/host-bridge-helpers.mjs';

const {values}=parseArgs({options:{port:{type:'string'},output:{type:'string'},name:{type:'string',default:'OR22B'}}});
const port=Number(values.port);
assert(Number.isInteger(port)&&port>0&&port<=65535&&values.output,'Use --port <loopback USB/IP port> --output <private report.json>');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const payload=Uint8Array.from(Buffer.from('4850485034392d4314268000004200','hex'));
const report={schema:'orchard-usbip-kermit-v1',passed:false,os_driver_attached:false,conn3x_tested:false,
  source_bytes:payload.length,source_sha256:sha(payload),source_header:Buffer.from(payload).subarray(0,8).toString(),
  packets:[],transfers:[]};
const sockets=[];let timer=null,keepReading=true,bulkError=null;
try{
 const list=await tcpClient(port);sockets.push(list.socket);list.socket.write(operation(0x8005));
 const record=await list.read(328);assert.equal(record.readUInt32BE(8),1);
 report.vendor=record.readUInt16BE(312);report.product=record.readUInt16BE(314);
 const owner=await importDevice(port);sockets.push(owner.socket);
 owner.socket.write(urb(1));let result=await completion(owner);assert.equal(result.status,0);
 report.device_descriptor=result.data.toString('hex');assert.equal(result.length,18);
 owner.socket.write(urb(2,{length:9,setup:[128,6,0,2,0,0,9,0]}));result=await completion(owner);assert.equal(result.status,0);
 const length=result.data.readUInt16LE(2);assert(length>=9&&length<=4096);
 owner.socket.write(urb(3,{length,setup:[128,6,0,2,0,0,length&255,length>>>8]}));result=await completion(owner);assert.equal(result.status,0);
 const config=result.data;report.configuration_descriptor=config.toString('hex');
 owner.socket.write(urb(4,{direction:0,length:0,setup:[0,9,config[5],0,0,0,0,0]}));result=await completion(owner,false);assert.equal(result.status,0);
 report.set_configuration_status=0;
 let sequence=100,usbReady=false,outPending=false,outAck=0,inPending=false,session=null;
 const requests=new Map(),files=[];
 const submit=request=>new Promise((resolve,reject)=>{const seq=sequence++;requests.set(seq,{resolve,reject,input:request.direction!==0});owner.socket.write(urb(seq,request));});
 void(async()=>{try{while(keepReading){
  const header=await owner.read(48,90000),seq=header.readUInt32BE(4),count=header.readUInt32BE(24),entry=requests.get(seq);
  assert.equal(header.readUInt32BE(0),3);assert(entry);assert(count<=65536);requests.delete(seq);
  const data=entry.input&&count?await owner.read(count,90000):Buffer.alloc(0);
  entry.resolve({status:header.readInt32BE(20),length:count,data});
 }}catch(error){if(keepReading)bulkError=error;}})();
 const write=bytes=>{
  if(!usbReady)return 0;
  if(outAck){const count=outAck;outAck=0;return count;}
  if(!outPending){const part=bytes.slice(0,64);outPending=true;
   void submit({ep:3,direction:0,length:part.length,data:part}).then(reply=>{
    assert.equal(reply.status,0);assert.equal(reply.length,part.length);outPending=false;outAck=reply.length;
   }).catch(error=>bulkError=error);
  }return 0;
 };
 const start=performance.now(),now=()=>performance.now()-start;
 timer=setInterval(()=>{try{
  if(bulkError||!session?.pending)return;
  if(!inPending){inPending=true;void submit({ep:1,direction:1,length:64}).then(reply=>{
   inPending=false;if(reply.status===-110)return;assert.equal(reply.status,0);session.receive(reply.data,now());
  }).catch(error=>bulkError=error);}
  session.poll(now());
 }catch(error){bulkError=error;}},1);
 for(const mode of ['send','get','finish']){
  session=new KermitSession({hz:1000,end:13,write,file:file=>files.push(file),
   notify:status=>report.transfers.push({ms:Math.round(now()),...status}),
   onPacket:packet=>{report.packets.push({ms:Math.round(now()),type:packet.type,sequence:packet.sequence,length:packet.data.length});
    if(packet.sequence===0&&['N','S','I','R'].includes(packet.type))usbReady=true;}});
  session.start({mode,name:values.name,bytes:payload},now());
  await until(()=>{if(bulkError)throw bulkError;return !session.active;},'original Kermit '+mode,120000);
  assert.equal(session.phase,'complete',JSON.stringify(report.transfers.at(-1)));
  report[mode]='complete';
 }
 assert.equal(files.length,1);assert.equal(files[0].bytes.length,payload.length);
 assert.deepEqual(Buffer.from(files[0].bytes).subarray(8),Buffer.from(payload).subarray(8));
 report.received_name=files[0].name;report.received_bytes=files[0].bytes.length;report.received_sha256=sha(files[0].bytes);
 report.received_header=Buffer.from(files[0].bytes).subarray(0,8).toString();
 report.object_bytes_equal=true;report.all_bytes_equal=Buffer.from(files[0].bytes).equals(Buffer.from(payload));
 report.elapsed_ms=Math.round(now());report.passed=true;
}catch(error){report.error=String(error);process.exitCode=1;}
finally{clearInterval(timer);keepReading=false;for(const socket of sockets)socket.destroy();
 await writeFile(values.output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,send:report.send,get:report.get,finish:report.finish,object_bytes_equal:report.object_bytes_equal,error:report.error}));}
