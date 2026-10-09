// SPDX-License-Identifier: MIT
// One bounded loopback TCP client. No telnet framing or terminal escape parsing.
import net from 'node:net';
export function createSerialServer(core){
 let client=null,queue=Buffer.alloc(0);const MAX=65536;
 const server=net.createServer(socket=>{
  if(client){socket.destroy();return;}client=socket;socket.setNoDelay(true);
  socket.on('data',data=>{if(queue.length+data.length>MAX){socket.destroy();return;}queue=Buffer.concat([queue,data]);});
  socket.on('error',()=>{});socket.on('close',()=>{if(client===socket){client=null;queue=Buffer.alloc(0);}});
 });
 return {server,poll(){
  if(queue.length&&client){const bytes=queue.subarray(0,1024);new Uint8Array(core.memory.buffer,core.uart_input(),bytes.length).set(bytes);const n=core.uart_send(bytes.length);queue=queue.subarray(n);}
  const n=core.uart_receive();if(!n||!client)return;
  if(client.writableLength+n>MAX){client.destroy();return;}
  client.write(Buffer.from(new Uint8Array(core.memory.buffer,core.uart_output(),n)));
 },listen(port=8124){if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid serial port');return new Promise((resolve,reject)=>{const fail=e=>reject(e);server.once('error',fail);server.listen(port,'127.0.0.1',()=>{server.off('error',fail);resolve(server.address().port);});});},close(){client?.destroy();queue=Buffer.alloc(0);return new Promise(resolve=>server.close(resolve));}};
}
