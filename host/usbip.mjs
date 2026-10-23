// SPDX-License-Identifier: MIT
// Original bounded USB/IP v1.1.1 server. Loopback only; no HTTP or arbitrary files.
// Protocol reference: https://docs.kernel.org/usb/usbip_protocol.html
import net from 'node:net';
export const BUSID='1-1', DEVID=0x00010001, MAX_TRANSFER=65536;
const MAX_BUFFER=131072,MAX_OUTPUT=262144,MAX_CLIENTS=8;
function operation(command,status=0){const b=Buffer.alloc(8);b.writeUInt16BE(0x0111);b.writeUInt16BE(command,2);b.writeUInt32BE(status,4);return b;}
export function deviceRecord(device){
 const d=device.device,c=device.config;
 if(!device.available||!d||d.length!==18||!c||c.length<9)return null;
 const interfaces=[];const seen=new Set();
 for(let i=0;i<c.length;){const n=c[i];if(n<2||i+n>c.length)throw Error('Invalid guest configuration');
  if(c[i+1]===4){if(n<9)throw Error('Invalid interface');if(c[i+3]===0){if(seen.has(c[i+2]))throw Error('Duplicate interface');seen.add(c[i+2]);interfaces.push(Buffer.from([c[i+5],c[i+6],c[i+7],0]));}}
  i+=n;
 }
 if(interfaces.length!==c[4]||interfaces.length>8)throw Error('Unsupported interface layout');
 const record=Buffer.alloc(312);record.write('/orchard/usb/'+BUSID);record.write(BUSID,256);
 record.writeUInt32BE(1,288);record.writeUInt32BE(1,292);record.writeUInt32BE(2,296); // full speed
 record.writeUInt16BE(d[8]|d[9]<<8,300);record.writeUInt16BE(d[10]|d[11]<<8,302);record.writeUInt16BE(d[12]|d[13]<<8,304);
 record[306]=d[4];record[307]=d[5];record[308]=d[6];record[309]=c[5];record[310]=d[17];record[311]=c[4];
 return {record,interfaces};
}
export function submitReply(result){
 const b=Buffer.alloc(48);b.writeUInt32BE(3);b.writeUInt32BE(result.seq,4);b.writeInt32BE(result.status,20);b.writeUInt32BE(result.length,24);b.writeInt32BE(-1,32);
 return result.direction===1?Buffer.concat([b,Buffer.from(result.data)]):b;
}
export function createUSBIPServer(device,{onRelease=()=>device.detach(),onAttach=()=>{}}={}){
 let owner=null;const sockets=new Set();
 const server=net.createServer(socket=>{
  if(sockets.size>=MAX_CLIENTS){socket.destroy();return;}sockets.add(socket);socket.setNoDelay(true);socket.setTimeout(10000);
  let buffer=Buffer.alloc(0),attached=false,closed=false;
  const write=b=>{if(closed||socket.destroyed)return;if(socket.writableLength+b.length>MAX_OUTPUT){socket.destroy();return;}socket.write(b);};
  const end=b=>{write(b);socket.end();closed=true;};
  socket.on('timeout',()=>socket.destroy());socket.on('error',()=>{});
  socket.on('close',()=>{closed=true;sockets.delete(socket);if(owner===socket){owner=null;device.cancelAll();onRelease();}});
  socket.on('data',chunk=>{
   if(closed)return;
   if(buffer.length+chunk.length>MAX_BUFFER){socket.destroy();return;}
   buffer=Buffer.concat([buffer,chunk]);
   try{
    while(!closed){
     if(!attached){
      if(buffer.length<8)return;
      if(buffer.readUInt16BE(0)!==0x0111||buffer.readUInt32BE(4)!==0){socket.destroy();return;}
      const command=buffer.readUInt16BE(2),info=deviceRecord(device);
      if(command===0x8005){
       const count=Buffer.alloc(4);count.writeUInt32BE(info&&!owner?1:0);
       end(Buffer.concat([operation(5),count,...(info&&!owner?[info.record,...info.interfaces]:[])]));return;
      }
      if(command!==0x8003){socket.destroy();return;}if(buffer.length<40)return;
      const id=buffer.subarray(8,40),nul=id.indexOf(0);
      if(nul<0||id.subarray(0,nul).toString('ascii')!==BUSID||id.subarray(nul).some(b=>b)||owner||!info){end(operation(3,1));return;}
      buffer=buffer.subarray(40);owner=socket;attached=true;socket.setTimeout(0);write(Buffer.concat([operation(3),info.record]));onAttach();continue;
     }
     if(buffer.length<48)return;
     const command=buffer.readUInt32BE(0),seq=buffer.readUInt32BE(4),id=buffer.readUInt32BE(8),direction=buffer.readUInt32BE(12),ep=buffer.readUInt32BE(16);
     if(id!==DEVID||direction>1||ep>15){socket.destroy();return;}
     if(command===2){
      if(ep!==0||buffer.subarray(24,48).some(b=>b)){socket.destroy();return;}
      const target=buffer.readUInt32BE(20);buffer=buffer.subarray(48);
      const canceled=device.unlink(target),reply=Buffer.alloc(48);reply.writeUInt32BE(4);reply.writeUInt32BE(seq,4);reply.writeInt32BE(canceled?-104:0,20);write(reply);continue;
     }
     if(command!==1){socket.destroy();return;}
     const length=buffer.readInt32BE(24),packets=buffer.readInt32BE(32);
     if(length<0||length>MAX_TRANSFER||![0,-1].includes(packets)){socket.destroy();return;}
     const total=48+(direction===0?length:0);if(buffer.length<total)return;
     const request={seq,ep,direction,length,flags:buffer.readUInt32BE(20),setup:Uint8Array.from(buffer.subarray(40,48)),data:direction===0?Uint8Array.from(buffer.subarray(48,total)):new Uint8Array()};
     buffer=buffer.subarray(total);
     if(!device.submit(request,result=>write(submitReply(result)))){socket.destroy();return;}
    }
   }catch{socket.destroy();}
  });
 });
 return {server,get attached(){return owner!==null;},detachClient(){const previous=owner;owner=null;previous?.destroy();},listen(port=3240){if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid USB/IP port');return new Promise((resolve,reject)=>{const fail=e=>reject(e);server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.off('error',fail);resolve(server.address().port);});});},close(){for(const s of sockets)s.destroy();return new Promise(resolve=>server.close(resolve));}};
}
