// SPDX-License-Identifier: MIT
// Real TCP discovery framing; this is NOT an OS attach/Conn3x witness.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createUSBIPServer} from '../host/usbip.mjs';
const d=Uint8Array.from([18,1,0,2,0,0,0,8,0xf0,3,0x12,1,0,1,0,0,0,1]);
const c=Uint8Array.from([9,2,18,0,1,1,0,128,50,9,4,0,0,0,255,0,0,0]);
const server=createUSBIPServer({available:true,device:d,config:c,cancelAll(){},detach(){},unlink(){return false;},submit(){return false;}});
const port=await server.listen(0);
try{
 const child=spawn(process.env.PYTHON||'python3',['host/attach.py','--port',String(port)],{stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 assert.equal(status,0,err);const result=JSON.parse(out);
 assert.equal(result.osAttachmentVerified,false);assert.equal(result.conn3xRoundtripVerified,false);
 assert.equal(result.devices[0].busid,'1-1');assert.equal(result.devices[0].vendor,0x03f0);assert.equal(result.devices[0].product,0x0112);assert.equal(result.devices[0].devid,0x10001);
 console.log('Native-client discovery: actual loopback USB/IP server returned synthetic fixture descriptor identity; no OS attach claim');
}finally{await server.close();}
