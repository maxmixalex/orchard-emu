// SPDX-License-Identifier: MIT
// User-space USB/IP witness helpers; no operating-system driver is involved.
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
export async function until(predicate,label,timeout=8000){
 const end=Date.now()+timeout;while(!predicate()){if(Date.now()>=end)throw Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,5));}
}
export async function tcpClient(port){
 const socket=net.createConnection({port,host:'127.0.0.1'});let buffer=Buffer.alloc(0),waiter=null;
 function flush(){if(waiter&&buffer.length>=waiter.n){const w=waiter;waiter=null;clearTimeout(w.timer);const result=buffer.subarray(0,w.n);buffer=buffer.subarray(w.n);w.resolve(result);}}
 socket.on('error',()=>{});socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);flush();});
 socket.on('close',()=>{if(waiter){const w=waiter;waiter=null;clearTimeout(w.timer);w.reject(Error('TCP closed before response'));}});
 await once(socket,'connect');
 return {socket,get buffered(){return buffer.length;},read(n,timeout=8000){return new Promise((resolve,reject)=>{assert(!waiter);waiter={n,resolve,reject,timer:setTimeout(()=>{waiter=null;reject(Error('TCP read timeout'));},timeout)};flush();});}};
}
export function operation(code){const b=Buffer.alloc(code===0x8003?40:8);b.writeUInt16BE(0x111);b.writeUInt16BE(code,2);if(code===0x8003)b.write('1-1',8);return b;}
export function urb(seq,{ep=0,direction=1,length=18,flags=0,setup=[128,6,0,1,0,0,length&255,length>>>8],data=new Uint8Array()}={}){
 const b=Buffer.alloc(48+(direction===0?data.length:0));b.writeUInt32BE(1);b.writeUInt32BE(seq,4);b.writeUInt32BE(0x10001,8);b.writeUInt32BE(direction,12);b.writeUInt32BE(ep,16);b.writeUInt32BE(flags,20);b.writeUInt32BE(length,24);b.writeInt32BE(-1,32);b.set(setup,40);if(direction===0)b.set(data,48);return b;
}
export function unlink(seq,target){const b=Buffer.alloc(48);b.writeUInt32BE(2);b.writeUInt32BE(seq,4);b.writeUInt32BE(0x10001,8);b.writeUInt32BE(target,20);return b;}
export async function importDevice(port){const client=await tcpClient(port);client.socket.write(operation(0x8003));const reply=await client.read(320);assert.equal(reply.readUInt32BE(4),0);return client;}
export async function completion(client,input=true){const header=await client.read(48);assert.equal(header.readUInt32BE(0),3);const length=header.readUInt32BE(24);return {seq:header.readUInt32BE(4),status:header.readInt32BE(20),length,data:input&&length?await client.read(length):Buffer.alloc(0)};}
