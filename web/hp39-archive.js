// SPDX-License-Identifier: MIT
// Bounded ZIP packages for HP39 typed files. No filesystem or network access.
// ZIP layout: PKWARE APPNOTE 6.3.10; DEFLATE: compression.spec.whatwg.org.
import {inspectHp39File,parseHp39Directory,validateHp39Filename} from './hp39-files.js';
import {prepareHp39Files,MAX_HP39_HOST_FILES} from './hp39-transfer.js';
import {MAX_FILE_BYTES,MAX_RECEIVE_BYTES} from './kermit.js';

export const MAX_HP39_ARCHIVE_BYTES=32*1024*1024;
const MAX_ENTRIES=1024,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});
export function zipCrc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

function archiveEntries(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_HP39_ARCHIVE_BYTES)
    throw Error('Choose an HP39 ZIP package of at most 32 MiB.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();
  let end=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
    if(view.getUint32(at,true)===0x06054b50&&at+22+view.getUint16(at+20,true)===bytes.length){end=at;break;}
  }
  if(end<0)throw Error('The ZIP directory is missing or truncated.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||
      count>MAX_ENTRIES||offset+size!==end)throw Error('Use a single-volume ZIP package with at most 1024 entries; ZIP64 is not supported.');
  let at=offset;
  for(let i=0;i<count;i++){
    if(at+46>end||view.getUint32(at,true)!==0x02014b50)throw Error('Invalid ZIP file directory.');
    const flags=view.getUint16(at+8,true),method=view.getUint16(at+10,true),crc=view.getUint32(at+16,true),
      packed=view.getUint32(at+20,true),length=view.getUint32(at+24,true),nameLength=view.getUint16(at+28,true),
      extra=view.getUint16(at+30,true),comment=view.getUint16(at+32,true),local=view.getUint32(at+42,true);
    const next=at+46+nameLength+extra+comment;
    if(!nameLength||next>end||view.getUint16(at+34,true))throw Error('Invalid ZIP directory entry.');
    const nameBytes=bytes.subarray(at+46,at+46+nameLength);
    const name=flags&0x800?decoder.decode(nameBytes):Array.from(nameBytes,b=>String.fromCharCode(b)).join('');
    if(/[\\\x00-\x1f\x7f:]/.test(name)||name.startsWith('/')||name.split('/').some(part=>part==='.'||part==='..'))
      throw Error('ZIP entries must use local relative names without parent directories.');
    const key=name.toUpperCase();
    if(entries.has(key))throw Error('Duplicate ZIP entry (case insensitive).');
    entries.set(key,{name,nameBytes,flags,method,crc,packed,length,local,directory:name.endsWith('/'),
      symlink:((view.getUint32(at+38,true)>>>16)&0xf000)===0xa000});
    at=next;
  }
  if(at!==end)throw Error('The ZIP directory length is inconsistent.');
  return {entries,view,offset};
}

/** Read one explicit package. Prefer its calculator/ directory; otherwise its
 * root or unique HP39 catalog. Source/readme/executable entries are not opened. */
export async function readHp39Archive(bytes,{cancelled=()=>false}={}){
  const {entries,view,offset}=archiveEntries(bytes),files=[],visited=new Set();
  const check=()=>{if(cancelled())throw Error('HP39 package import cancelled.');};
  const roots=[...entries.values()].filter(f=>/(?:^|\/)HP39DIR\.(?:CUR|000)$/i.test(f.name));
  const folders=[...new Set(roots.map(f=>f.name.slice(0,f.name.lastIndexOf('/')+1)))];
  let folder=folders.find(f=>f.toUpperCase()==='CALCULATOR/')??folders.find(f=>f==='');
  if(folder===undefined){
    if(folders.length>1)throw Error('The ZIP contains several HP39 packages. Select the files from the package you want to transfer.');
    folder=folders[0]??'';
  }
  let total=0;
  const extract=async entry=>{
    check();
    if(entry.directory||entry.symlink||entry.flags&0x41||![0,8].includes(entry.method)||
        entry.length<8||entry.length>MAX_FILE_BYTES||total+entry.length>MAX_RECEIVE_BYTES)
      throw Error('HP39 ZIP files must be regular, unencrypted stored/DEFLATE files within the 2 MiB file and 8 MiB package limits.');
    const at=entry.local;
    if(at+30>offset||view.getUint32(at,true)!==0x04034b50||view.getUint16(at+6,true)!==entry.flags||
        view.getUint16(at+8,true)!==entry.method)throw Error('The ZIP local header does not match its directory.');
    const nameLength=view.getUint16(at+26,true),extra=view.getUint16(at+28,true),start=at+30+nameLength+extra;
    if(start+entry.packed>offset||nameLength!==entry.nameBytes.length||
        entry.nameBytes.some((b,i)=>b!==bytes[at+30+i]))throw Error('The ZIP file name or data range is inconsistent.');
    if(!(entry.flags&8)&&(view.getUint32(at+14,true)!==entry.crc||view.getUint32(at+18,true)!==entry.packed||view.getUint32(at+22,true)!==entry.length))
      throw Error('The ZIP local size or checksum is inconsistent.');
    const packed=bytes.subarray(start,start+entry.packed);
    let output;
    if(entry.method===0){
      if(entry.packed!==entry.length)throw Error('The ZIP stored-file length is inconsistent.');
      output=packed.slice();
    }else{
      let stream;
      try{stream=new DecompressionStream('deflate-raw');}
      catch{throw Error('This browser cannot unpack this ZIP. Extract its calculator files and select them together.');}
      const reader=new Blob([packed]).stream().pipeThrough(stream).getReader();
      output=new Uint8Array(entry.length);let count=0,complete=false;
      try{
        while(true){
          check();const {done,value}=await reader.read();
          if(done){complete=true;break;}
          if(count+value.length>entry.length)throw Error('The ZIP expands beyond its declared file size.');
          output.set(value,count);count+=value.length;
        }
        if(count!==entry.length)throw Error('The ZIP decompressed file is truncated.');
      }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
    check();
    if(zipCrc32(output)!==entry.crc)throw Error(`ZIP checksum mismatch: ${entry.name}.`);
    total+=output.length;return output;
  };
  const visit=async name=>{
    validateHp39Filename(name);const key=(folder+name).toUpperCase();
    if(visited.has(key))return;
    if(visited.size>=MAX_HP39_HOST_FILES+2)throw Error('An HP39 package supports at most 16 objects and two directory files.');
    const entry=entries.get(key);
    if(!entry)throw Error(`Missing HP39 ZIP file: ${name}.`);
    visited.add(key);const data=await extract(entry),info=inspectHp39File(data);
    files.push({name:entry.name.slice(folder.length),bytes:data});
    if(info.kind==='A')for(const reference of parseHp39Directory(data))await visit(reference.file);
  };
  const current=entries.get((folder+'HP39DIR.CUR').toUpperCase()),root=entries.get((folder+'HP39DIR.000').toUpperCase());
  if(current)await visit('HP39DIR.CUR');
  else if(root)await visit('HP39DIR.000');
  else{
    const loose=[...entries.values()].filter(f=>!f.directory&&!f.name.includes('/')&&/\.(?:000|apt|sys|hp39|prg|lib)$/i.test(f.name));
    if(!loose.length)throw Error('No HP39 catalog or typed files were found in the ZIP package.');
    for(const f of loose)await visit(f.name);
  }
  check();return prepareHp39Files(files);
}

/** Store-only standard ZIP: exact bytes, portable to Conn3x after extraction. */
export function writeHp39Archive(files){
  const prepared=prepareHp39Files(files),parts=[],directory=[];let offset=0;
  for(const f of prepared){
    const name=encoder.encode(f.name),crc=zipCrc32(f.bytes),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(10,0,true);v.setUint16(12,33,true);
    v.setUint32(14,crc,true);v.setUint32(18,f.bytes.length,true);v.setUint32(22,f.bytes.length,true);v.setUint16(26,name.length,true);local.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(14,33,true);
    c.setUint32(16,crc,true);c.setUint32(20,f.bytes.length,true);c.setUint32(24,f.bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
    parts.push(local,f.bytes);directory.push(central);offset+=local.length+f.bytes.length;
  }
  const directorySize=directory.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);
  v.setUint32(0,0x06054b50,true);v.setUint16(8,prepared.length,true);v.setUint16(10,prepared.length,true);v.setUint32(12,directorySize,true);v.setUint32(16,offset,true);
  const output=new Uint8Array(offset+directorySize+22);let at=0;
  for(const part of [...parts,...directory,end]){output.set(part,at);at+=part.length;}
  return output;
}
