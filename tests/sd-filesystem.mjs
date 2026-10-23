// SPDX-License-Identifier: MIT
// Raw offsets below are computed independently of the production parser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createSDImage} from '../web/sd-card.js';
import {listSDDirectory,readSDFile,addSDFiles,createSDDirectory,renameSDEntry,deleteSDEntry,validateSDName} from '../web/sd-filesystem.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let checks=0;
const check=fn=>{fn();++checks;};
function rejected(fn,code){assert.throws(fn,error=>!code||error.code===code);++checks;}
function raw(image){
  const v=new DataView(image.buffer,image.byteOffset,image.byteLength),base=v.getUint16(11,true)===512?0:v.getUint32(454,true)*512;
  const spc=image[base+13],reserved=v.getUint16(base+14,true),nfats=image[base+16],fatSectors=v.getUint16(base+22,true),rootEntries=v.getUint16(base+17,true);
  const fat=base+reserved*512,root=fat+nfats*fatSectors*512,data=root+Math.ceil(rootEntries*32/512)*512;
  const next=c=>v.getUint16(fat+2*c,true),offset=c=>data+(c-2)*spc*512;
  function chain(first){const out=[];let c=first;while(c>=2&&c<0xfff8){assert(!out.includes(c));out.push(c);c=next(c);}return out;}
  function entries(first=0){
    const ranges=first?chain(first).map(c=>[offset(c),spc*512]):[[root,rootEntries*32]],out=[];
    for(const [at,length] of ranges)for(let p=at;p<at+length;p+=32){
      if(!image[p])return out;if(image[p]===0xe5||image[p+11]===15)continue;
      const bytes=image.subarray(p,p+11),base=Buffer.from(bytes.subarray(0,8)).toString('latin1').trimEnd(),ext=Buffer.from(bytes.subarray(8)).toString('latin1').trimEnd();
      out.push({name:base+(ext?'.'+ext:''),offset:p,cluster:v.getUint16(p+26,true),size:v.getUint32(p+28,true),attr:image[p+11]});
    }return out;
  }
  function get(path){let first=0,entry;for(const name of path.split('/').filter(Boolean)){entry=entries(first).find(e=>e.name===name);assert(entry,path);first=entry.cluster;}return entry;}
  function extract(path){const e=get(path);return Buffer.concat(chain(e.cluster).map(c=>Buffer.from(image.subarray(offset(c),offset(c)+spc*512)))).subarray(0,e.size);}
  function set(c,value){for(let i=0;i<nfats;i++)v.setUint16(fat+i*fatSectors*512+c*2,value,true);}
  return {v,base,spc,nfats,fatSectors,fat,root,data,rootEntries,offset,next,entries,get,extract,set};
}

const blank=createSDImage(),blankHash=hash(blank),initial=listSDDirectory(blank);
check(()=>assert.equal(initial.entries.length,0));
check(()=>assert.equal(initial.partitionStart,1));
check(()=>assert.equal(initial.clusterBytes,1024));
for(const name of ['A','ABC.DEF','all.raw','NOEXT','A~1.X','!#$%&\'()'])check(()=>assert.equal(validateSDName(name),name.toUpperCase()));
for(const name of ['','a b','../A','a/b','a\\b','.','..','TOOLONGER.1','ONE.LONG','中文','A.B.C','A:','a\u0000b'])rejected(()=>validateSDName(name),'name');
const payload=Uint8Array.from({length:2501},(_,i)=>(i*37+19)&255);
let image=addSDFiles(blank,'/',[{name:'blob.xyz',bytes:payload},{name:'EMPTY',bytes:new Uint8Array()}]);
check(()=>assert.equal(hash(blank),blankHash));
check(()=>assert.deepEqual(readSDFile(image,'/blob.xyz'),payload));
check(()=>assert.equal(readSDFile(image,'/EMPTY').length,0));
check(()=>assert.deepEqual(raw(image).extract('/BLOB.XYZ'),Buffer.from(payload)));
check(()=>assert.equal(raw(image).get('/EMPTY').cluster,0));
check(()=>assert.equal(listSDDirectory(image).freeBytes,initial.freeBytes-3072));
image=createSDDirectory(image,'/','programs');
const shortPayload=Uint8Array.from([0,255,13,10,1,9]);
image=addSDFiles(image,'/PROGRAMS',[{name:'NOEXT',bytes:shortPayload}]);
const r=raw(image),dir=r.get('/PROGRAMS');
check(()=>assert.deepEqual(r.entries(dir.cluster).slice(0,2).map(e=>[e.name,e.cluster]),[['.',dir.cluster],['..',0]]));
check(()=>assert.deepEqual(r.extract('/PROGRAMS/NOEXT'),Buffer.from(shortPayload)));
check(()=>assert.deepEqual(readSDFile(image,'/programs/noext'),shortPayload));
check(()=>assert.equal(listSDDirectory(image,'/programs').path,'/PROGRAMS'));
image=createSDDirectory(image,'/PROGRAMS','SUB');
check(()=>assert.equal(raw(image).entries(raw(image).get('/PROGRAMS/SUB').cluster)[1].cluster,raw(image).get('/PROGRAMS').cluster));

// Extending a full subdirectory must allocate/link another directory cluster.
image=addSDFiles(image,'/PROGRAMS/SUB',Array.from({length:70},(_,i)=>({name:'F'+i,bytes:new Uint8Array()})));
check(()=>assert.equal(listSDDirectory(image,'/PROGRAMS/SUB').entries.length,70));
check(()=>assert.equal(raw(image).entries(raw(image).get('/PROGRAMS/SUB').cluster).length,72));
check(()=>assert.notEqual(raw(image).next(raw(image).get('/PROGRAMS/SUB').cluster),0xffff));

// Every failed batch keeps the original bytes, including a failure after the
// first file was allocated in the private work copy.
const before=hash(image);
// A Buffer is a Uint8Array subclass, but Buffer.slice() shares storage. Both
// mutations and escaped short-name decoding must preserve these callers too.
const nodeBuffer=Buffer.from(blank),nodeBefore=hash(nodeBuffer);
rejected(()=>addSDFiles(nodeBuffer,'/',[{name:'FIRST',bytes:shortPayload},{name:'SECOND',bytes:new Uint8Array(blank.length)}]),'full');
check(()=>assert.equal(hash(nodeBuffer),nodeBefore));
const nodeDirectory=createSDDirectory(nodeBuffer,'/','DIR');
check(()=>assert.equal(hash(nodeBuffer),nodeBefore));
check(()=>assert.equal(Buffer.isBuffer(nodeDirectory),false));
check(()=>assert.notEqual(nodeDirectory.buffer,nodeBuffer.buffer));
const nodeFile=addSDFiles(nodeBuffer,'/',[{name:'FIRST',bytes:shortPayload}]);
check(()=>assert.equal(hash(nodeBuffer),nodeBefore));
check(()=>assert.notEqual(nodeFile.buffer,nodeBuffer.buffer));
const escaped=Buffer.from(nodeFile);escaped[raw(escaped).root]=5;const escapedBefore=hash(escaped);
check(()=>assert.equal(listSDDirectory(escaped).entries[0].name,'åIRST'));
check(()=>assert.equal(hash(escaped),escapedBefore));
for(const [files,code] of [
  [[{name:'NEW',bytes:shortPayload},{name:'new',bytes:shortPayload}],'duplicate'],
  [[{name:'EMPTY',bytes:shortPayload}],'duplicate'],
  [[{name:'GOOD',bytes:shortPayload},{name:'bad name',bytes:shortPayload}],'name'],
  [[{name:'GOOD',bytes:shortPayload},{name:'TOOBIG',bytes:new Uint8Array(image.length)}],'full'],
  [[{name:'GOOD',bytes:shortPayload},{name:'BAD',bytes:[]}],'input'],
]){rejected(()=>addSDFiles(image,'/',files),code);check(()=>assert.equal(hash(image),before));}
rejected(()=>createSDDirectory(image,'/','empty'),'duplicate');
for(const path of ['/../A','PROGRAMS','//','/PROGRAMS/..','/BLOB.XYZ'])rejected(()=>listSDDirectory(image,path),'path');
rejected(()=>readSDFile(image,'/PROGRAMS'),'path');

// A fixed FAT16 root cannot grow, even when data clusters are still free.
let fullRoot=blank;
for(let i=0;i<4;i++)fullRoot=addSDFiles(fullRoot,'/',Array.from({length:128},(_,j)=>({name:'F'+(i*128+j),bytes:new Uint8Array()})));
const fullRootHash=hash(fullRoot);rejected(()=>addSDFiles(fullRoot,'/',[{name:'OVER',bytes:shortPayload}]),'full');
check(()=>assert.equal(hash(fullRoot),fullRootHash));
check(()=>assert.equal(listSDDirectory(fullRoot).entries.length,512));

// A fragmented two-cluster file is read in FAT order, not physical order.
let fragmented=addSDFiles(blank,'/',[{name:'A',bytes:new Uint8Array(1024).fill(1)},
  {name:'B',bytes:new Uint8Array(1024).fill(2)},{name:'C',bytes:new Uint8Array(3072).fill(3)}]);
const f=raw(fragmented),a=f.get('/A'),c=f.get('/C');
f.v.setUint32(a.offset+28,2048,true);f.v.setUint32(c.offset+28,2048,true);f.set(a.cluster,c.cluster+2);f.set(c.cluster+1,0xffff);
check(()=>assert.deepEqual(readSDFile(fragmented,'/A'),Uint8Array.from([...new Uint8Array(1024).fill(1),...new Uint8Array(1024).fill(3)])));

// Accept a single-volume superfloppy and retain its placement on mutation.
const floppy=new Uint8Array(blank.length);floppy.set(blank.subarray(512));new DataView(floppy.buffer).setUint32(28,0,true);
check(()=>assert.equal(listSDDirectory(floppy).partitionStart,0));
check(()=>assert.deepEqual(raw(addSDFiles(floppy,'/',[{name:'F',bytes:shortPayload}])).extract('/F'),Buffer.from(shortPayload)));

// Rename changes directory metadata only, including for nonempty directories.
// Inspect the actual FAT and payload with the independent reader above.
const renamed=renameSDEntry(image,'/BLOB.XYZ','RENAMED.ANY'),renamedRaw=raw(renamed);
check(()=>assert.deepEqual(renamedRaw.extract('/RENAMED.ANY'),Buffer.from(payload)));
check(()=>assert.deepEqual(renamed.subarray(r.fat,r.root),image.subarray(r.fat,r.root)));
check(()=>assert.deepEqual(renamed.subarray(r.data),image.subarray(r.data)));
check(()=>assert.equal(hash(image),before));
rejected(()=>readSDFile(renamed,'/BLOB.XYZ'),'path');
const renamedDir=renameSDEntry(image,'/PROGRAMS','TOOLS');
check(()=>assert.deepEqual(raw(renamedDir).extract('/TOOLS/NOEXT'),Buffer.from(shortPayload)));
check(()=>assert.equal(listSDDirectory(renamedDir,'/TOOLS/SUB').entries.length,70));
check(()=>assert.deepEqual(renamedDir.subarray(r.fat,r.root),image.subarray(r.fat,r.root)));
check(()=>assert.deepEqual(renamedDir.subarray(r.data),image.subarray(r.data)));
check(()=>assert.equal(hash(renameSDEntry(image,'/BLOB.XYZ','blob.xyz')),before));
for(const [fn,code] of [
  [()=>renameSDEntry(image,'/BLOB.XYZ','EMPTY'),'duplicate'],
  [()=>renameSDEntry(image,'/BLOB.XYZ','a long name'),'name'],
  [()=>renameSDEntry(image,'/','ROOT'),'root'],
  [()=>deleteSDEntry(image,'/'),'root'],
  [()=>deleteSDEntry(image,'/PROGRAMS'),'notEmpty'],
  [()=>deleteSDEntry(image,'/DOESNOT'),'path'],
]){rejected(fn,code);check(()=>assert.equal(hash(image),before));}

// Delete reclaims the exact file chain in every FAT, preserves other payloads,
// and accepts zero-length files or empty folders without touching cluster zero.
const deleted=deleteSDEntry(image,'/BLOB.XYZ'),d=raw(deleted);
check(()=>assert.equal(listSDDirectory(deleted).freeBytes,listSDDirectory(image).freeBytes+3072));
check(()=>assert.deepEqual(d.extract('/PROGRAMS/NOEXT'),Buffer.from(shortPayload)));
check(()=>assert.equal(deleted[r.get('/BLOB.XYZ').offset],0xe5));
for(let c=r.get('/BLOB.XYZ').cluster,seen=[];c<0xfff8;c=r.next(c)){
  assert(!seen.includes(c));seen.push(c);
  for(let f=0;f<d.nfats;f++)check(()=>assert.equal(d.v.getUint16(d.fat+f*d.fatSectors*512+c*2,true),0));
}
check(()=>assert.deepEqual(readSDFile(addSDFiles(deleted,'/',[{name:'REUSED',bytes:payload}]),'/REUSED'),payload));
const deletedEmpty=deleteSDEntry(image,'/EMPTY');
check(()=>assert.equal(listSDDirectory(deletedEmpty).freeBytes,listSDDirectory(image).freeBytes));
check(()=>assert.equal(raw(deletedEmpty).next(0),r.next(0)));
const emptyFolder=createSDDirectory(blank,'/','REMOVE'),removedFolder=deleteSDEntry(emptyFolder,'/REMOVE');
check(()=>assert.equal(listSDDirectory(removedFolder).freeBytes,initial.freeBytes));
check(()=>assert.equal(listSDDirectory(removedFolder).entries.length,0));
const partialDeleted=deleteSDEntry(fragmented,'/A');
check(()=>assert.equal(raw(partialDeleted).next(a.cluster),0));
check(()=>assert.equal(raw(partialDeleted).next(c.cluster+2),0));
check(()=>assert.deepEqual(raw(partialDeleted).extract('/C'),Buffer.alloc(2048,3)));
const rootReused=addSDFiles(deleteSDEntry(fullRoot,'/F3'),'/',[{name:'REUSE',bytes:shortPayload}]);
check(()=>assert.equal(listSDDirectory(rootReused).entries.length,512));
check(()=>assert.deepEqual(raw(rootReused).extract('/REUSE'),Buffer.from(shortPayload)));

const protectedImage=image.slice(),protectedRaw=raw(protectedImage);
protectedImage[protectedRaw.get('/BLOB.XYZ').offset+11]|=1;
protectedImage[protectedRaw.get('/PROGRAMS').offset+11]|=1;
const protectedHash=hash(protectedImage);
for(const fn of [()=>renameSDEntry(protectedImage,'/BLOB.XYZ','X'),()=>deleteSDEntry(protectedImage,'/BLOB.XYZ'),
  ()=>renameSDEntry(protectedImage,'/PROGRAMS/NOEXT','X'),()=>deleteSDEntry(protectedImage,'/PROGRAMS/NOEXT'),
  ()=>addSDFiles(protectedImage,'/PROGRAMS',[{name:'X',bytes:shortPayload}]),()=>createSDDirectory(protectedImage,'/PROGRAMS','X')]){
  rejected(fn,'readOnly');check(()=>assert.equal(hash(protectedImage),protectedHash));
}
const bufferImage=Buffer.from(image),bufferHash=hash(bufferImage);
for(const result of [renameSDEntry(bufferImage,'/BLOB.XYZ','RENAMED'),deleteSDEntry(bufferImage,'/BLOB.XYZ')]){
  check(()=>assert.notEqual(result.buffer,bufferImage.buffer));check(()=>assert.equal(hash(bufferImage),bufferHash));
}

function corrupt(change,code='damaged'){
  const damaged=image.slice(),view=raw(damaged);change(damaged,view);const original=hash(damaged);
  rejected(()=>listSDDirectory(damaged),code);
  rejected(()=>addSDFiles(damaged,'/',[{name:'NEW',bytes:shortPayload}]),code);
  check(()=>assert.equal(hash(damaged),original));
}
corrupt((b,v)=>{b[v.fat+v.fatSectors*512+8]^=1;});
corrupt((b,v)=>v.v.setUint32(454,0xffffffff,true));
corrupt((b,v)=>v.v.setUint32(458,0xffffffff,true));
corrupt((b,v)=>v.v.setUint16(v.base+11,4096,true));
corrupt((b,v)=>{b[v.base+13]=3;});
corrupt((b,v)=>v.v.setUint16(v.base+22,1,true));
corrupt((b,v)=>v.set(v.get('/BLOB.XYZ').cluster,v.get('/BLOB.XYZ').cluster));
corrupt((b,v)=>v.set(v.get('/BLOB.XYZ').cluster,0));
corrupt((b,v)=>v.set(v.get('/BLOB.XYZ').cluster,0xfff7));
corrupt((b,v)=>v.set(v.get('/BLOB.XYZ').cluster,0xffff));
corrupt((b,v)=>v.v.setUint32(v.get('/BLOB.XYZ').offset+28,0xffffffff,true));
corrupt((b,v)=>{const x=v.get('/EMPTY'),a=v.get('/BLOB.XYZ');v.v.setUint16(x.offset+26,a.cluster,true);v.v.setUint32(x.offset+28,2501,true);});
corrupt((b,v)=>v.set(500,0xffff));
corrupt((b,v)=>{const d=v.get('/PROGRAMS');v.v.setUint16(v.offset(d.cluster)+32+26,d.cluster,true);});
corrupt((b,v)=>{const d=v.get('/PROGRAMS');b[v.offset(d.cluster)]=0xe5;});
corrupt((b,v)=>{b[466]=6;v.v.setUint32(470,2,true);v.v.setUint32(474,4,true);},'format');
corrupt((b,v)=>v.v.setUint16(v.base+19,4000,true),'format');

// Existing valid LFN records retain byte-for-byte metadata and expose the
// short alias. The editor does not write or silently truncate long filenames.
let lfn=addSDFiles(blank,'/',[{name:'LONGNA~1.TXT',bytes:shortPayload}]);
const l=raw(lfn),entry=lfn.slice(l.root,l.root+32);lfn.set(entry,l.root+32);lfn.fill(0,l.root,l.root+32);
let sum=0;for(const byte of entry.subarray(0,11))sum=(((sum&1)<<7)+(sum>>>1)+byte)&255;
lfn[l.root]=0x41;lfn[l.root+11]=15;lfn[l.root+13]=sum;
const offsets=[1,3,5,7,9,14,16,18,20,22,24,28,30],title='LongName.txt';
for(let i=0;i<offsets.length;i++)l.v.setUint16(l.root+offsets[i],i<title.length?title.charCodeAt(i):i===title.length?0:0xffff,true);
check(()=>assert.equal(listSDDirectory(lfn).entries[0].hasLongName,true));
check(()=>assert.deepEqual(readSDFile(lfn,'/LONGNA~1.TXT'),shortPayload));
const lfnAdded=addSDFiles(lfn,'/',[{name:'SECOND',bytes:shortPayload}]);
check(()=>assert.deepEqual(lfnAdded.subarray(l.root,l.root+64),lfn.subarray(l.root,l.root+64)));
// A newly selected short name may not collide with another entry's LFN.
rejected(()=>addSDFiles(lfn,'/',[{name:'LONGNAME.TXT',bytes:shortPayload}]),'duplicate');
rejected(()=>renameSDEntry(lfnAdded,'/SECOND','LONGNAME.TXT'),'duplicate');
const lfnRenamed=renameSDEntry(lfn,'/LONGNA~1.TXT','NEW.TXT');
check(()=>assert.equal(lfnRenamed[l.root],0xe5));
check(()=>assert.equal(listSDDirectory(lfnRenamed).entries[0].hasLongName,false));
check(()=>assert.deepEqual(raw(lfnRenamed).extract('/NEW.TXT'),Buffer.from(shortPayload)));
const lfnDeleted=deleteSDEntry(lfn,'/LONGNA~1.TXT');
check(()=>assert.deepEqual([lfnDeleted[l.root],lfnDeleted[l.root+32]],[0xe5,0xe5]));
check(()=>assert.equal(listSDDirectory(lfnDeleted).freeBytes,initial.freeBytes));
function withLongTitle(source,name){
  const bytes=source.slice(),v=new DataView(bytes.buffer);
  for(let i=0;i<offsets.length;i++)v.setUint16(l.root+offsets[i],i<name.length?name.charCodeAt(i):i===name.length?0:0xffff,true);
  return bytes;
}
// Imported aliases and LFNs must already form an unambiguous namespace.
// Changing which spelling is displayed must not select a different file.
const ambiguous=withLongTitle(lfnAdded,'second'),ambiguousHash=hash(ambiguous);
for(const fn of [()=>listSDDirectory(ambiguous),()=>renameSDEntry(ambiguous,'/SECOND','THIRD'),
  ()=>deleteSDEntry(ambiguous,'/SECOND'),()=>addSDFiles(ambiguous,'/',[{name:'THIRD',bytes:shortPayload}])]){
  rejected(fn,'damaged');check(()=>assert.equal(hash(ambiguous),ambiguousHash));
}
// Unicode uppercase can collide with an ASCII target (dotless i -> I), but
// must not expand sharp-s into two ASCII characters or normalize accents.
const dotless=withLongTitle(lfn,'\u0131.txt');
rejected(()=>addSDFiles(dotless,'/',[{name:'I.TXT',bytes:shortPayload}]),'duplicate');
rejected(()=>createSDDirectory(dotless,'/','I.TXT'),'duplicate');
const dotlessOther=addSDFiles(dotless,'/',[{name:'OTHER',bytes:shortPayload}]);
rejected(()=>renameSDEntry(dotlessOther,'/OTHER','I.TXT'),'duplicate');
const sharpS=withLongTitle(lfn,'\u00df.txt');
check(()=>assert.deepEqual(readSDFile(addSDFiles(sharpS,'/',[{name:'SS.TXT',bytes:payload}]),'/SS.TXT'),payload));
const spaces=withLongTitle(lfn,' i.txt. ');
rejected(()=>addSDFiles(spaces,'/',[{name:'I.TXT',bytes:shortPayload}]),'duplicate');
const exactLong=withLongTitle(lfn,'THIRTEEN.TXTX');
check(()=>assert.equal(listSDDirectory(exactLong).entries[0].hasLongName,true));
for(const damage of [
  bytes=>new DataView(bytes.buffer).setUint16(l.root+offsets[2],0xffff,true),
  bytes=>new DataView(bytes.buffer).setUint16(l.root+offsets[10],65,true),
  bytes=>new DataView(bytes.buffer).setUint16(l.root+offsets[1],47,true),
]){
  const bad=withLongTitle(lfn,'A.TXT');damage(bad);const original=hash(bad);
  rejected(()=>deleteSDEntry(bad,'/LONGNA~1.TXT'),'damaged');check(()=>assert.equal(hash(bad),original));
}
function maximumLong(length){
  const bytes=lfn.slice(),v=new DataView(bytes.buffer),alias=bytes.slice(l.root+32,l.root+64);
  bytes.fill(0,l.root,l.root+22*32);bytes.set(alias,l.root+20*32);
  for(let i=0;i<20;i++){
    const p=l.root+i*32;bytes[p]=(20-i)|(i===0?64:0);bytes[p+11]=15;bytes[p+13]=sum;
    for(let j=0;j<13;j++){
      const at=(19-i)*13+j;v.setUint16(p+offsets[j],at<length?65:at===length?0:0xffff,true);
    }
  }
  return bytes;
}
check(()=>assert.equal(listSDDirectory(maximumLong(255)).entries[0].hasLongName,true));
rejected(()=>listSDDirectory(maximumLong(256)),'damaged');
lfn[l.root+13]^=1;rejected(()=>listSDDirectory(lfn),'damaged');

// LFN entries can straddle directory clusters. All three records must be
// retired on rename/delete; unrelated entries must remain reachable.
let splitLong=createSDDirectory(blank,'/','DIR');
splitLong=addSDFiles(splitLong,'/DIR',[
  ...Array.from({length:28},(_,i)=>({name:'F'+i,bytes:new Uint8Array()})),
  ...Array.from({length:3},(_,i)=>({name:'PLACE'+i,bytes:new Uint8Array()})),
  {name:'CROSS~1.TXT',bytes:shortPayload},
]);
const sl=raw(splitLong),longSlots=[0,1,2].map(i=>sl.get('/DIR/PLACE'+i).offset),shortSlot=sl.get('/DIR/CROSS~1.TXT').offset;
const longTitle='A name across directory clusters.txt';
let longSum=0;for(const byte of splitLong.subarray(shortSlot,shortSlot+11))longSum=(((longSum&1)<<7)+(longSum>>>1)+byte)&255;
for(let i=0;i<3;i++){
  const p=longSlots[i];splitLong.fill(0,p,p+32);splitLong[p]=(3-i)|(i===0?64:0);splitLong[p+11]=15;splitLong[p+13]=longSum;
  for(let j=0;j<offsets.length;j++){
    const at=(2-i)*13+j;sl.v.setUint16(p+offsets[j],at<longTitle.length?longTitle.charCodeAt(at):at===longTitle.length?0:0xffff,true);
  }
}
check(()=>assert.equal(listSDDirectory(splitLong,'/DIR').entries.length,29));
for(const edited of [renameSDEntry(splitLong,'/DIR/CROSS~1.TXT','CROSS.TXT'),deleteSDEntry(splitLong,'/DIR/CROSS~1.TXT')]){
  check(()=>assert.deepEqual(longSlots.map(p=>edited[p]),[0xe5,0xe5,0xe5]));
  check(()=>assert.equal(raw(edited).get('/DIR/F27').size,0));
}

let deep=blank;
for(let i=0;i<32;i++)deep=createSDDirectory(deep,'/'+Array(i).fill('D').join('/'),'D');
const deepHash=hash(deep);rejected(()=>createSDDirectory(deep,'/'+Array(32).fill('D').join('/'),'D'),'limit');
check(()=>assert.equal(hash(deep),deepHash));
rejected(()=>addSDFiles(blank,'/',Array.from({length:129},()=>({name:'A',bytes:new Uint8Array()}))),'limit');
for(const bad of [null,new Uint8Array(),new Uint8Array(1000)])rejected(()=>listSDDirectory(bad));

await mkdir('build-r20/sd-files',{recursive:true});
const answer=Uint8Array.from(Buffer.from('%%HP: T(3)A(D)F(.);\n42','ascii'));
let card=addSDFiles(blank,'/',[{name:'ANSWER',bytes:answer},{name:'BLOB.XYZ',bytes:payload}]);
card=createSDDirectory(card,'/','PROGRAMS');card=addSDFiles(card,'/PROGRAMS',[{name:'NOEXT',bytes:shortPayload}]);
await writeFile('build-r20/sd-files/prepared.img',card);
await writeFile('build-r20/sd-files/answer.txt',answer);
await writeFile('build-r20/sd-files/unit-result.json',JSON.stringify({checks,card_sha256:hash(card),answer_sha256:hash(answer),
  independent_raw_parser:true,source_unchanged:true,scope:'ROM-free FAT16 parsing, transactional mutation and rejection; no guest execution claim'},null,2)+'\n');
console.log(`SD filesystem: ${checks} checks; independent raw extraction, FAT16 root/subdirectory/fragmented files, short-alias preservation, malformed-chain rejection and transactional rollback pass.`);
