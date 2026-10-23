#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Loopback USB/IP relay for the live browser Worker. This process has no WASM.
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createUSBIPServer} from './usbip.mjs';
import {endpoints} from '../web/virtual-usb.js';
import {BRIDGE_PROTOCOL,BRIDGE_MAX_URB,BRIDGE_MAX_BODY,BRIDGE_MAX_EVENTS,BRIDGE_MAX_PENDING,bridgeToken,encodeBridgeBytes,decodeBridgeBytes} from '../web/host-bridge-protocol.js';
export const DEFAULT_BRIDGE_ORIGINS=Object.freeze(['https://maxmixalex.github.io','http://127.0.0.1:8123','http://localhost:8123']);
const MAX_EVENTS=128,MAX_QUEUE_BYTES=6*1024*1024;
const statusError=(status,message)=>Object.assign(Error(message),{status});
function originList(values){return new Set(values.map(value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.origin!==value||url.username||url.password)throw Error('Allow exact HTTP(S) origins only');return value;}));}

class BridgeDevice {
 constructor(enqueue,drop,{requestTimeout=15000}={}){this.enqueue=enqueue;this.drop=drop;this.requestTimeout=requestTimeout;this.jobs=new Map();this.ids=new Map();this.nextId=0;this.epoch=0;this.available=false;}
 publish(value){
  if(value.epoch!==this.epoch)return;
  if(value.ready!==true){this.available=false;this.device=null;this.config=null;return;}
  const device=decodeBridgeBytes(value.device,18),config=decodeBridgeBytes(value.config,4096);
  if(device.length!==18||device[0]!==18||device[1]!==1||![8,16,32,64].includes(device[7]))throw statusError(400,'Invalid device descriptor');
  endpoints(config);this.device=device;this.config=config;this.available=true;
 }
 submit(request,done){
  if(!this.available||this.jobs.size>=BRIDGE_MAX_PENDING||this.jobs.has(request.seq))return false;
  if(this.nextId>=0xffffffff){this.drop();return false;}
  const id=++this.nextId,event={type:'submit',id,request:{...request,setup:encodeBridgeBytes(request.setup,8),data:encodeBridgeBytes(request.data)}};
  const job={id,request,done,timer:setTimeout(()=>{if(!this.enqueue({type:'unlink',id})){this.drop();return;}this.finish(id,{status:-110,length:0,data:''});},this.requestTimeout)};job.timer.unref?.();
  this.jobs.set(request.seq,job);this.ids.set(id,job);
  if(!this.enqueue(event)){this.drop();return false;}return true;
 }
 finish(id,result){
  const job=this.ids.get(id);if(!job)return false;
  if(!Number.isInteger(result.status)||result.status>0||result.status< -4095||!Number.isInteger(result.length)||result.length<0||result.length>job.request.length)throw statusError(400,'Invalid URB result');
  const data=decodeBridgeBytes(result.data);
  if(data.length!==(job.request.direction===1?result.length:0))throw statusError(400,'Invalid URB byte count');
  clearTimeout(job.timer);this.jobs.delete(job.request.seq);this.ids.delete(id);
  job.done({seq:job.request.seq,direction:job.request.direction,status:result.status,length:result.length,data});return true;
 }
 unlink(seq){const job=this.jobs.get(seq);if(!job)return false;clearTimeout(job.timer);this.jobs.delete(seq);this.ids.delete(job.id);if(!this.enqueue({type:'unlink',id:job.id}))this.drop();return true;}
 cancelAll(){for(const job of this.jobs.values())clearTimeout(job.timer);this.jobs.clear();this.ids.clear();}
 detach(){this.cancelAll();this.available=false;this.device=null;this.config=null;}
}

export function createHostBridge({token=randomBytes(32).toString('hex'),origins=DEFAULT_BRIDGE_ORIGINS,pollTimeout=20000,leaseTimeout=35000,requestTimeout=15000}={}){
 bridgeToken(token);const allowed=originList(origins);if(!allowed.size)throw Error('At least one explicit browser origin is required');
 const secret=Buffer.from(token);let session=null,usbPort=0,httpPort=0,closed=false;
 function reply(res,status,body){if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(body===undefined?'':JSON.stringify(body));}
 function renew(){if(!session)return;clearTimeout(session.lease);session.lease=setTimeout(drop,leaseTimeout);session.lease.unref?.();}
 function flush(){
  if(!session?.poll||!session.events.length)return;
  const {res,timer}=session.poll;session.poll=null;clearTimeout(timer);const events=[];let bytes=0;
  while(session.events.length&&events.length<BRIDGE_MAX_EVENTS){const item=session.events[0];if(events.length&&bytes+item.size>BRIDGE_MAX_BODY-1024)break;session.events.shift();session.queuedBytes-=item.size;events.push(item.event);bytes+=item.size;}
  reply(res,200,{events});
 }
 function enqueue(event){
  if(!session)return false;const size=Buffer.byteLength(JSON.stringify(event));
  if(session.events.length>=MAX_EVENTS||session.queuedBytes+size>MAX_QUEUE_BYTES||size>BRIDGE_MAX_BODY-1024)return false;
  session.events.push({event,size});session.queuedBytes+=size;flush();return true;
 }
 const device=new BridgeDevice(enqueue,()=>drop(),{requestTimeout});
 function releaseDevice(){if(!session)return;device.detach();++device.epoch;session.events=[];session.queuedBytes=0;enqueue({type:'release',epoch:device.epoch});}
 const usb=createUSBIPServer(device,{onAttach:()=>{if(!enqueue({type:'client',attached:true}))drop();},onRelease:releaseDevice});
 function drop(){
  if(!session)return;const old=session;session=null;clearTimeout(old.lease);device.detach();usb.detachClient();
  if(old.poll){clearTimeout(old.poll.timer);reply(old.poll.res,410,{error:'session-ended'});}
 }
 async function json(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw statusError(415,'JSON required');
  const declared=Number(req.headers['content-length']??0);if(declared>BRIDGE_MAX_BODY)throw statusError(413,'Request too large');
  let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>BRIDGE_MAX_BODY)throw statusError(413,'Request too large');parts.push(chunk);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw statusError(400,'Invalid JSON');}
 }
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!==(httpPort===80?'127.0.0.1':`127.0.0.1:${httpPort}`))throw statusError(403,'Invalid Host');
   const origin=req.headers.origin;if(!allowed.has(origin))throw statusError(403,'Origin not allowed');
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
   if(req.method==='OPTIONS'){
    const requested=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(!['GET','POST','DELETE'].includes(req.headers['access-control-request-method'])||requested.some(s=>!['authorization','content-type','x-orchard-session'].includes(s)))throw statusError(403,'Preflight not allowed');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Orchard-Session');
    if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');reply(res,204);return;
   }
   const provided=Buffer.from((req.headers.authorization??'').replace(/^Bearer /,''));
   if(!req.headers.authorization?.startsWith('Bearer ')||provided.length!==secret.length||!timingSafeEqual(provided,secret))throw statusError(401,'Invalid token');
   if(req.url==='/v1/session'&&req.method==='POST'){
    const value=await json(req);if(value?.protocol!==BRIDGE_PROTOCOL)throw statusError(400,'Unsupported bridge protocol');if(session)throw statusError(409,'Another calculator is connected');
    session={id:randomBytes(24).toString('hex'),events:[],queuedBytes:0,poll:null,lease:null};device.detach();device.epoch=0;renew();reply(res,201,{protocol:BRIDGE_PROTOCOL,session:session.id,usbipPort:usbPort,epoch:device.epoch});return;
   }
   if(!session||req.headers['x-orchard-session']!==session.id)throw statusError(410,'Session ended');
   const current=session;renew();
   if(req.url==='/v1/session'&&req.method==='DELETE'){drop();reply(res,204);return;}
   if(req.url==='/v1/events'&&req.method==='GET'){
    if(current.poll)throw statusError(409,'An event request is already pending');
    const timer=setTimeout(()=>{if(session===current&&current.poll?.res===res){current.poll=null;reply(res,200,{events:[]});}},pollTimeout);timer.unref?.();
    current.poll={res,timer};res.once('close',()=>{if(!res.writableEnded&&session===current&&current.poll?.res===res)drop();});flush();return;
   }
   if(req.url==='/v1/device'&&req.method==='POST'){
    const value=await json(req);if(session!==current)throw statusError(410,'Session ended');device.publish(value);reply(res,204);return;
   }
   if(req.url==='/v1/reset'&&req.method==='POST'){
    const value=await json(req);if(session!==current)throw statusError(410,'Session ended');
    if(value.epoch===device.epoch){usb.detachClient();releaseDevice();}reply(res,204);return;
   }
   if(req.url==='/v1/results'&&req.method==='POST'){
    const value=await json(req);if(session!==current)throw statusError(410,'Session ended');
    if(!Array.isArray(value?.results)||value.results.length>BRIDGE_MAX_EVENTS)throw statusError(400,'Invalid result batch');
    for(const result of value.results){if(!Number.isInteger(result?.id)||result.id<1||result.id>0xffffffff)throw statusError(400,'Invalid request identity');device.finish(result.id,result);}
    reply(res,204);return;
   }
   throw statusError(404,'Unknown bridge endpoint');
  }catch(error){reply(res,error.status??400,{error:error.message});}
 });
 server.maxConnections=16;server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=5000;
 return {server,usb,device,token,origins:[...allowed],get connected(){return Boolean(session);},
  async listen({http:port=8125,usbip=3240}={}){
   if(![port,usbip].every(n=>Number.isInteger(n)&&n>=0&&n<=65535))throw Error('Ports must be 0–65535');
   usbPort=await usb.listen(usbip);
   try{await new Promise((resolve,reject)=>{const fail=e=>reject(e);server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.off('error',fail);httpPort=server.address().port;resolve();});});}
   catch(error){await usb.close();throw error;}
   return {httpPort,usbipPort:usbPort};
  },async close(){if(closed)return;closed=true;drop();const stopped=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await Promise.all([usb.close(),stopped]);}
 };
}

async function main(){
 const {values}=parseArgs({options:{http:{type:'string',default:'8125'},usbip:{type:'string',default:'3240'},origin:{type:'string',multiple:true},help:{type:'boolean'}}});
 if(values.help){console.log('node host/bridge.mjs [--http 8125] [--usbip 3240] [--origin https://your-site.example]\nRelays the live browser calculator. Both listeners are 127.0.0.1 only; no ROM or driver is loaded.');return;}
 const port=value=>{if(!/^\d{1,5}$/.test(value)||Number(value)>65535)throw Error('Invalid port');return Number(value);};
 const bridge=createHostBridge({origins:values.origin??DEFAULT_BRIDGE_ORIGINS}),ports=await bridge.listen({http:port(values.http),usbip:port(values.usbip)});
 console.log(`Live browser bridge: http://127.0.0.1:${ports.httpPort}\nAccess token: ${bridge.token}\nUSB/IP: 127.0.0.1:${ports.usbipPort}, bus 1-1\nAllowed origins: ${bridge.origins.join(', ')}\nPaste the address and token into Connections → Local device. Keep this process running.\nOS driver attachment and Conn3x compatibility require separate verification.`);
 const stop=()=>void bridge.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
