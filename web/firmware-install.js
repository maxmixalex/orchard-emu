// SPDX-License-Identifier: MIT
// Explicit local preparation of the two pinned original 49g+/50g inputs.
// This is an installed-image reconstruction, never a physical full-NOR dump.
import {identifyROM} from './catalog.js';
const UPDATE='b08235fbf7d6ab3c5ad64b82d3ffe7004f942fafe90d0449ab3b0e5c3b0bc8a0';
const BOOTS=new Map([
 ['f46fbfbbd6442bf76bd412e89fc6d3c64850f742f35eca732e3e5b01cf3393c8',5],
 ['dfa544617039e1bff0f62b9f51a943e57ff756d12bb81478de7aec41a5b73a28',6]
]);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function prepare4950(first,second){
 if(!(first instanceof ArrayBuffer)||!(second instanceof ArrayBuffer))throw Error('Select the original boot region and the 2.15 update together.');
 const inputs=[first,second],boot=inputs.find(x=>x.byteLength===16384),update=inputs.find(x=>x.byteLength===1294336);
 if(!boot||!update)throw Error('Expected a 16 KiB boot region and the 49g+/50g 2.15 update.');
 const model=BOOTS.get(await digest(boot));
 if(!model||await digest(update)!==UPDATE)throw Error('The boot region or update does not match the supported original files.');
 const signature=new TextEncoder().encode('KINPOUPDATEIMAGE');
 if(!signature.every((b,i)=>b===new Uint8Array(update)[i]))throw Error('Invalid update transport header.');
 const bytes=new Uint8Array(2097152);bytes.fill(255);bytes.set(new Uint8Array(boot));bytes.set(new Uint8Array(update),0x4000);
 // The native boot code expects the installed-flash marker, not the updater's
 // transport marker. Preserve the length/checksum words and every code byte.
 bytes.set(new TextEncoder().encode('Kinposhcopyright'),0x4000);
 const match=await identifyROM(bytes.buffer);
 if(match.id!==model)throw Error('Prepared image identity mismatch.');
 return {rom:bytes.buffer,model:match,provenance:'original-boot-plus-2.15-update'};
}
export async function readFirmware(input){
 const files=Array.isArray(input)?input:[input];
 if(files.length<1||files.length>2||files.some(f=>!f||typeof f.arrayBuffer!=='function'))throw Error('Select one complete ROM, or a matching boot region and update.');
 if(files.length===1){const file=files[0];if(![1048576,2097152].includes(file.size))throw Error('Select a complete ROM, or select the 49g+/50g boot region and 2.15 update together.');const rom=await file.arrayBuffer();return {rom,model:await identifyROM(rom),provenance:'complete-image'};}
 if(!files.every(f=>[16384,1294336].includes(f.size)))throw Error('Expected a 16 KiB boot region and the 49g+/50g 2.15 update.');
 return prepare4950(...await Promise.all(files.map(f=>f.arrayBuffer())));
}
