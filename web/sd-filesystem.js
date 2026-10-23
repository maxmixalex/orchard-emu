// SPDX-License-Identifier: MIT
// Original, bounded FAT16 image tools. On-disk facts: Microsoft FAT spec v1.03,
// sections Boot Sector/BPB, FAT Type Determination and FAT Directory Structure.
// These functions operate on an unmounted copy; they never access guest memory.
import {validateSDSize} from './sd-card.js';

const SECTOR=512, MAX_ENTRIES=16384, MAX_DEPTH=32, MAX_FILES=128;
const SHORT=/^[A-Z0-9!#$%&'()\-@^_`{}~]{1,8}(?:\.[A-Z0-9!#$%&'()\-@^_`{}~]{1,3})?$/;
const fold=value=>value.replace(/[a-z]/g,c=>c.toUpperCase());
function fail(code,message,details={}){throw Object.assign(new Error(message),{code,details});}
function need(condition,message){if(!condition)fail('damaged',message);}
function byteArray(bytes){
  if(!(bytes instanceof Uint8Array)||!(bytes.buffer instanceof ArrayBuffer))fail('input','Expected local image bytes.');
  try{validateSDSize(bytes.byteLength);}catch{fail('format','Choose a complete 1–32 MiB supported card image.');}
}
export function validateSDName(name){
  if(typeof name!=='string'||!SHORT.test(fold(name)))
    fail('name','Use an ASCII name of 1–8 characters and an optional 1–3 character extension.',{name:String(name??'')});
  return fold(name);
}
function rawName(name){
  if(name==='.'||name==='..')return Uint8Array.from(name.padEnd(11,' '),c=>c.charCodeAt(0));
  const [base,ext='']=name.split('.');
  return Uint8Array.from((base.padEnd(8,' ')+ext.padEnd(3,' ')),c=>c.charCodeAt(0));
}
function pathKey(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.length>4096)fail('path','Invalid card path.');
  if(path==='/')return path;
  const parts=path.slice(1).split('/');
  if(parts.some(s=>!s||s==='.'||s==='..'||s.includes('\\')||/[\x00-\x1f\x7f]/.test(s)))fail('path','Invalid card path.');
  return '/'+parts.map(fold).join('/');
}
function checksum(bytes){let sum=0;for(const byte of bytes)sum=(((sum&1)<<7)+(sum>>>1)+byte)&255;return sum;}
function longNameKey(name){
  // FAT compares one uppercase character per character; do not expand sharp-s
  // to "SS" or normalize the Unicode spelling stored in someone else's image.
  return Array.from(name.replace(/^ +|[ .]+$/g,''),c=>{
    const upper=c.toUpperCase();return Array.from(upper).length===1?upper:c;
  }).join('');
}
function longText(parts){
  const units=[];let ended=false;
  for(let i=parts.length-1;i>=0;i--)for(const offset of [1,3,5,7,9,14,16,18,20,22,24,28,30]){
    const unit=parts[i][offset]|parts[i][offset+1]<<8;
    if(ended)need(unit===0xffff,'Invalid long-name padding.');
    else if(unit===0)ended=true;
    else{need(unit!==0xffff,'Long name contains padding before its terminator.');units.push(unit);}
  }
  need(units.length>0&&units.length<=255,'Long name must contain 1–255 characters.');
  const name=String.fromCharCode(...units);
  need(!/[\x00-\x1f"*/:<>?\\|]/.test(name)&&longNameKey(name).length>0,'Invalid long file name.');
  return name;
}
const entryNames=entry=>[fold(entry.name),...(entry.longName?[longNameKey(entry.longName)]:[])];
function writable(node){if(node.readOnly)fail('readOnly','This file or folder is read only.');}

class Volume {
  constructor(image){
    byteArray(image);this.image=image;this.view=new DataView(image.buffer,image.byteOffset,image.byteLength);
    const v=this.view, totalImage=image.length/SECTOR;
    need(v.getUint16(510,true)===0xaa55,'Missing card boot signature.');
    let start=0,partitionSectors=totalImage;
    // A superfloppy has its BPB at sector zero. Otherwise accept exactly one
    // primary FAT16 partition; an extended/GPT/multi-volume disk is not edited.
    if(!([0xeb,0xe9].includes(image[0])&&v.getUint16(11,true)===SECTOR)){
      const parts=[];
      for(let i=0;i<4;i++){
        const p=446+i*16,type=image[p+4];
        if(!type)continue;
        if(![4,6,14].includes(type)||![0,128].includes(image[p]))fail('format','Only one primary FAT16 partition is supported.');
        parts.push({start:v.getUint32(p+8,true),sectors:v.getUint32(p+12,true)});
      }
      if(parts.length!==1)fail('format','Only one primary FAT16 partition is supported.');
      ({start,sectors:partitionSectors}=parts[0]);
      need(start>=1&&partitionSectors>0&&start+partitionSectors<=totalImage,'Partition extends outside the card image.');
    }
    const b=start*SECTOR;
    need(v.getUint16(b+510,true)===0xaa55,'Missing FAT16 boot signature.');
    const sectors16=v.getUint16(b+19,true),sectors32=v.getUint32(b+32,true);
    const sectorSize=v.getUint16(b+11,true),clusterSectors=image[b+13],reserved=v.getUint16(b+14,true);
    const copies=image[b+16],rootEntries=v.getUint16(b+17,true),fatSectors=v.getUint16(b+22,true);
    const sectors=sectors16||sectors32,rootSectors=Math.ceil(rootEntries*32/SECTOR);
    need(sectorSize===SECTOR&&clusterSectors>=1&&clusterSectors<=64&&!(clusterSectors&(clusterSectors-1)),
      'Only 512-byte sectors and power-of-two clusters up to 32 KiB are supported.');
    need(reserved>0&&[1,2].includes(copies)&&rootEntries>0&&fatSectors>0,'Invalid FAT16 metadata geometry.');
    need(!(sectors16&&sectors32)&&sectors>0&&sectors<=partitionSectors,'Invalid FAT16 volume length.');
    need(v.getUint32(b+28,true)===start,'BPB hidden-sector count disagrees with the partition.');
    const dataSector=start+reserved+copies*fatSectors+rootSectors;
    const clusterCount=Math.floor((start+sectors-dataSector)/clusterSectors);
    if(clusterCount<4085||clusterCount>=65525)fail('format','This volume is not FAT16 (determined by its data-cluster count).');
    need((clusterCount+2)*2<=fatSectors*SECTOR,'FAT is too short for the data area.');
    this.fatOffset=(start+reserved)*SECTOR;this.fatBytes=fatSectors*SECTOR;this.copies=copies;
    this.clusterBytes=clusterSectors*SECTOR;this.clusterCount=clusterCount;this.dataOffset=dataSector*SECTOR;
    this.rootOffset=(start+reserved+copies*fatSectors)*SECTOR;this.rootEntries=rootEntries;
    this.volumeBytes=sectors*SECTOR;this.partitionStart=start;
    for(let f=1;f<copies;f++)for(let i=0;i<this.fatBytes;i++)
      need(image[this.fatOffset+i]===image[this.fatOffset+f*this.fatBytes+i],'The FAT copies disagree.');
    need(this.fat(0)===(0xff00|image[b+21])&&(this.fat(1)&0x3fff)===0x3fff,'Invalid reserved FAT entries.');
    this.freeClusters=0;
    for(let c=2;c<=clusterCount+1;c++){
      const next=this.fat(c);
      need(next===0||next===0xfff7||next>=0xfff8||(next>=2&&next<0xfff0&&next<=clusterCount+1),'Invalid FAT chain target.');
      if(!next&&c<0xfff0)this.freeClusters++;
    }
    this.nodes=new Map();this.used=new Uint8Array(clusterCount+2);this.entries=0;this.nextFree=2;
    const root={name:'/',path:'/',type:'directory',cluster:0,chain:[],parent:0};
    this.nodes.set('/',root);this.directory(root,0);
    for(let c=2;c<=clusterCount+1;c++)
      need(!this.fat(c)||this.fat(c)===0xfff7||this.used[c],'Allocated cluster has no live file or directory.');
  }
  fat(c){return this.view.getUint16(this.fatOffset+c*2,true);}
  setFat(c,next){for(let f=0;f<this.copies;f++)this.view.setUint16(this.fatOffset+f*this.fatBytes+c*2,next,true);}
  offset(c){need(c>=2&&c<0xfff0&&c<=this.clusterCount+1,'Data cluster is outside the volume.');return this.dataOffset+(c-2)*this.clusterBytes;}
  chain(first){
    const chain=[];let c=first;
    while(true){
      this.offset(c);need(!this.used[c],'A cluster chain loops or is shared by multiple entries.');
      this.used[c]=1;chain.push(c);
      const next=this.fat(c);
      if(next>=0xfff8)break;
      need(next>=2&&next<0xfff0,'File points at a free, reserved or bad cluster.');c=next;
    }
    return chain;
  }
  slots(node){
    if(!node.cluster)return Array.from({length:this.rootEntries},(_,i)=>this.rootOffset+i*32);
    return node.chain.flatMap(c=>Array.from({length:this.clusterBytes/32},(_,i)=>this.offset(c)+i*32));
  }
  directory(node,depth){
    if(depth>MAX_DEPTH)fail('limit','Directory nesting exceeds 32 levels.');
    const items=[],seen=new Set(),long=[];let dot=false,parent=false;
    for(const offset of this.slots(node)){
      const e=this.image.subarray(offset,offset+32),attr=e[11];
      if(e[0]===0){need(!long.length,'Unfinished long-name entry.');break;}
      if(e[0]===0xe5){need(!long.length,'Long-name entry has no live short alias.');continue;}
      if(++this.entries>MAX_ENTRIES)fail('limit','The card directory exceeds 16,384 entries.');
      if(attr===15){
        need(e[12]===0&&this.view.getUint16(offset+26,true)===0&&(e[0]&0x1f)>=1&&(e[0]&0x1f)<=20&&!(e[0]&0xa0),'Invalid long-name entry.');
        long.push(e);need(long.length<=20,'Long name exceeds its bounded entry chain.');continue;
      }
      need(!(attr&0xc0),'Reserved directory attribute bits are set.');
      const hadLong=long.length>0,longOffsets=long.map(part=>part.byteOffset-this.image.byteOffset);
      let longName=null;
      if(hadLong){
        const sum=checksum(e.subarray(0,11));
        need(long.every((part,i)=>part[0]===(long.length-i|(i===0?64:0))&&part[13]===sum),'Long-name sequence/checksum disagrees with its short alias.');
        longName=longText(long);
        long.length=0;
      }
      need(this.view.getUint16(offset+20,true)===0,'FAT16 entry contains a high cluster number.');
      const cluster=this.view.getUint16(offset+26,true),size=this.view.getUint32(offset+28,true);
      if(attr&8){need(!(attr&16)&&!cluster&&!size&&!node.cluster,'Invalid volume-label entry.');continue;}
      const nameBytes=new Uint8Array(e.subarray(0,11));if(nameBytes[0]===5)nameBytes[0]=0xe5;
      const part=(a,b)=>String.fromCharCode(...nameBytes.subarray(a,b)).replace(/ +$/,'');
      let base=part(0,8),ext=part(8,11);
      if(base==='.'||base==='..'){
        need(node.cluster&&!ext&&(attr&16)&&!size&&!hadLong,'Invalid dot directory entry.');
        if(base==='.'){need(!dot&&cluster===node.cluster,'Invalid self directory entry.');dot=true;}
        else{need(!parent&&cluster===node.parent,'Invalid parent directory entry.');parent=true;}
        continue;
      }
      need(base.length>0&&![...base,...ext].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||'"*+,./:;<=>?[\\]|'.includes(c)), 'Invalid short directory name.');
      if(e[12]&8)base=base.toLowerCase();if(e[12]&16)ext=ext.toLowerCase();
      const name=base+(ext?'.'+ext:''),key=fold(name);
      // Short aliases and long names share one namespace. Validate the input
      // too, so rename/delete cannot choose an ambiguous imported entry.
      for(const candidate of new Set(entryNames({name,longName}))){
        need(!seen.has(candidate),'Duplicate short or long file name.');seen.add(candidate);
      }
      const path=(node.path==='/'?'':node.path)+'/'+key,type=attr&16?'directory':'file';
      let chain=[];
      if(cluster)chain=this.chain(cluster);
      if(type==='directory')need(cluster>=2&&size===0,'Invalid directory storage.');
      else need(size===0?!cluster:cluster>=2&&chain.length===Math.ceil(size/this.clusterBytes),'File length disagrees with its cluster chain.');
      const item={name,path,type,size,cluster,chain,offset,readOnly:Boolean(attr&1),hasLongName:hadLong,longName,longOffsets,parent:node.cluster};
      this.nodes.set(path,item);items.push(item);
    }
    need(!long.length,'Unfinished long-name entry.');
    if(node.cluster)need(dot&&parent,'Subdirectory is missing its dot entries.');
    node.children=items;
    for(const child of items)if(child.type==='directory')this.directory(child,depth+1);
  }
  get(path,type){const node=this.nodes.get(pathKey(path));if(!node||node.type!==type)fail('path',`No such ${type} on the card.`);return node;}
  allocate(count){
    const chain=[];
    for(let c=this.nextFree;chain.length<count&&c<=this.clusterCount+1&&c<0xfff0;c++)if(!this.fat(c))chain.push(c);
    if(chain.length!==count)fail('full','There is not enough free space on this card.');
    for(let i=0;i<chain.length;i++){
      this.setFat(chain[i],chain[i+1]??0xffff);
      this.image.fill(0,this.offset(chain[i]),this.offset(chain[i])+this.clusterBytes);
    }
    if(chain.length)this.nextFree=chain.at(-1)+1;
    return chain;
  }
  freeSlot(node){
    const slots=this.slots(node);
    for(let i=0;i<slots.length;i++){
      const p=slots[i];
      if(this.image[p]!==0&&this.image[p]!==0xe5)continue;
      if(this.image[p]===0&&i+1<slots.length)this.image[slots[i+1]]=0;
      return p;
    }
    if(!node.cluster)fail('full','The fixed FAT16 root directory is full.');
    const [cluster]=this.allocate(1);this.setFat(node.chain.at(-1),cluster);node.chain.push(cluster);
    return this.offset(cluster);
  }
  entry(offset,name,attr,cluster,size){
    this.image.fill(0,offset,offset+32);this.image.set(rawName(name),offset);this.image[offset+11]=attr;
    // Valid deterministic DOS date (1980-01-01), with no invented source time.
    for(const field of [16,18,24])this.view.setUint16(offset+field,33,true);
    this.view.setUint16(offset+26,cluster,true);this.view.setUint32(offset+28,size,true);
  }
}
const publicEntry=({name,path,type,size,readOnly,hasLongName})=>({name,path,type,size,readOnly,hasLongName});
export function listSDDirectory(image,path='/'){
  const volume=new Volume(image),node=volume.get(path,'directory');
  return {path:node.path,entries:node.children.map(publicEntry),bytes:image.length,volumeBytes:volume.volumeBytes,
    freeBytes:volume.freeClusters*volume.clusterBytes,clusterBytes:volume.clusterBytes,partitionStart:volume.partitionStart};
}
export function readSDFile(image,path){
  const volume=new Volume(image),node=volume.get(path,'file');
  return fileBytes(volume,node);
}
function fileBytes(volume,node){
  const bytes=new Uint8Array(node.size),image=volume.image;
  for(let i=0;i<node.chain.length;i++){
    const offset=volume.offset(node.chain[i]),length=Math.min(volume.clusterBytes,node.size-i*volume.clusterBytes);
    bytes.set(image.subarray(offset,offset+length),i*volume.clusterBytes);
  }
  return bytes;
}
// Read the complete unmounted card with one filesystem validation, rather than
// re-parsing the FAT for every file during a directory export.
export function readSDTree(image){
  const volume=new Volume(image);
  return [...volume.nodes.values()].filter(node=>node.path!=='/').map(node=>({
    ...publicEntry(node),...(node.type==='file'?{bytes:fileBytes(volume,node)}:{})
  }));
}
// Import a complete directory snapshot transactionally. Every entry has a
// relative 8.3 path; parents can appear in any order. A failure returns no copy
// and never mutates the caller's image or any source file's bytes.
export function addSDTree(image,path,entries){
  byteArray(image);
  if(!Array.isArray(entries)||entries.length>MAX_ENTRIES)fail('limit','The directory contains too many entries.');
  const base=pathKey(path),prepared=entries.map(entry=>{
    if(typeof entry?.path!=='string'||entry.path.startsWith('/')||entry.path.length>4096)fail('path','Invalid relative card path.');
    const parts=entry.path.split('/').map(validateSDName),type=entry.type;
    if(!['directory','file'].includes(type))fail('input','Invalid directory entry type.');
    const depth=(base==='/'?0:base.slice(1).split('/').length)+parts.length-(type==='file'?1:0);
    if(depth>MAX_DEPTH)fail('limit','Directory nesting exceeds 32 levels.');
    if(type==='file'&&(!(entry.bytes instanceof Uint8Array)||!(entry.bytes.buffer instanceof ArrayBuffer)||entry.bytes.length>image.length))
      fail('input','A selected file is too large or could not be read.');
    return {...entry,type,parts,path:(base==='/'?'':base)+'/'+parts.join('/')};
  }).sort((a,b)=>a.parts.length-b.parts.length||(a.path<b.path?-1:a.path>b.path?1:0));
  const copy=new Uint8Array(image),volume=new Volume(copy),names=new Map();
  writable(volume.get(base,'directory'));
  for(const entry of prepared){
    const parent=volume.get(entry.path.slice(0,entry.path.lastIndexOf('/'))||'/','directory'),name=entry.parts.at(-1);
    writable(parent);
    if(!names.has(parent.path))names.set(parent.path,new Set(parent.children.flatMap(entryNames)));
    const siblings=names.get(parent.path);
    if(siblings.has(name))fail('duplicate','A file or folder with that name already exists.',{name});
    siblings.add(name);
    const slot=volume.freeSlot(parent),directory=entry.type==='directory';
    const chain=volume.allocate(directory?1:Math.ceil(entry.bytes.length/volume.clusterBytes)),cluster=chain[0]??0;
    if(directory){
      const offset=volume.offset(cluster);
      volume.entry(offset,'.',16,cluster,0);volume.entry(offset+32,'..',16,parent.cluster,0);
    }else for(let i=0;i<chain.length;i++)copy.set(entry.bytes.subarray(i*volume.clusterBytes,(i+1)*volume.clusterBytes),volume.offset(chain[i]));
    volume.entry(slot,name,directory?16:32,cluster,directory?0:entry.bytes.length);
    const node={name,path:entry.path,type:entry.type,cluster,chain,children:[],parent:parent.cluster};
    volume.nodes.set(entry.path,node);parent.children.push(node);
  }
  new Volume(copy);return copy;
}
export function addSDFiles(image,path,files){
  byteArray(image);
  if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)fail('limit','Choose between 1 and 128 files.');
  const prepared=files.map(file=>{
    const name=validateSDName(file?.name),bytes=file?.bytes;
    if(!(bytes instanceof Uint8Array)||!(bytes.buffer instanceof ArrayBuffer)||bytes.length>image.length)fail('input','A selected file is too large or could not be read.');
    return {name,bytes};
  });
  // Uint8Array subclasses (notably Node Buffer) may have a sharing slice().
  const copy=new Uint8Array(image),volume=new Volume(copy),directory=volume.get(path,'directory');
  writable(directory);
  const names=new Set(directory.children.flatMap(entryNames));
  for(const {name} of prepared){if(names.has(name))fail('duplicate','A file or folder with that name already exists.',{name});names.add(name);}
  for(const {name,bytes} of prepared){
    const slot=volume.freeSlot(directory),chain=volume.allocate(Math.ceil(bytes.length/volume.clusterBytes));
    for(let i=0;i<chain.length;i++)copy.set(bytes.subarray(i*volume.clusterBytes,(i+1)*volume.clusterBytes),volume.offset(chain[i]));
    volume.entry(slot,name,32,chain[0]??0,bytes.length);
  }
  new Volume(copy);return copy;
}
export function createSDDirectory(image,path,name){
  byteArray(image);name=validateSDName(name);
  const copy=new Uint8Array(image),volume=new Volume(copy),parent=volume.get(path,'directory');
  writable(parent);
  if(parent.children.some(entry=>entryNames(entry).includes(name)))fail('duplicate','A file or folder with that name already exists.',{name});
  const slot=volume.freeSlot(parent),[cluster]=volume.allocate(1),offset=volume.offset(cluster);
  volume.entry(offset,'.',16,cluster,0);volume.entry(offset+32,'..',16,parent.cluster,0);
  volume.entry(slot,name,16,cluster,0);
  new Volume(copy);return copy;
}
function editableEntry(volume,path){
  const key=pathKey(path);
  if(key==='/')fail('root','The card root cannot be renamed or deleted.');
  const entry=volume.nodes.get(key);
  if(!entry)fail('path','No such file or folder on the card.');
  const parent=volume.get(key.slice(0,key.lastIndexOf('/'))||'/','directory');
  writable(entry);writable(parent);
  return {entry,parent};
}
export function renameSDEntry(image,path,name){
  byteArray(image);name=validateSDName(name);
  const copy=new Uint8Array(image),volume=new Volume(copy),{entry,parent}=editableEntry(volume,path);
  if(name===fold(entry.name))return copy;
  if(parent.children.some(other=>other!==entry&&entryNames(other).includes(name)))
    fail('duplicate','A file or folder with that name already exists.',{name});
  // Rename to the explicitly chosen short name. Retiring every associated LFN
  // entry avoids a stale name/checksum attaching itself to a later allocation.
  for(const offset of entry.longOffsets)copy[offset]=0xe5;
  copy.set(rawName(name),entry.offset);copy[entry.offset+12]&=~0x18;
  // Cluster chains, file bytes, attributes and dates are otherwise unchanged.
  new Volume(copy);return copy;
}
export function deleteSDEntry(image,path){
  byteArray(image);
  const copy=new Uint8Array(image),volume=new Volume(copy),{entry}=editableEntry(volume,path);
  if(entry.type==='directory'&&entry.children.length)fail('notEmpty','The folder is not empty.');
  for(const cluster of entry.chain)volume.setFat(cluster,0);
  for(const offset of [...entry.longOffsets,entry.offset])copy[offset]=0xe5;
  // FAT deletion releases storage; it does not claim to securely erase bytes.
  new Volume(copy);return copy;
}
