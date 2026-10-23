// SPDX-License-Identifier: MIT
// Real FAT images plus browser-handle contract doubles exercise data integrity,
// conflict preservation, failed writes, and transactional directory import.
import assert from 'node:assert/strict';
import {createSDImage} from '../web/sd-card.js';
import {addSDTree,readSDTree,readSDFile,listSDDirectory,addSDFiles,deleteSDEntry} from '../web/sd-filesystem.js';
import {readDirectoryHandle,readDirectoryFiles,mapDirectoryNames,createDirectoryCard,
  requestDirectoryPermission,planDirectoryWrite,writeDirectoryPlan} from '../web/directory-card.js';
let checks=0;
const check=fn=>{fn();checks++;},bytes=(...value)=>new Uint8Array(value);
const error=name=>Object.assign(new Error(name),{name});
class LocalFile {
  constructor(name,value){this.kind='file';this.name=name;this.bytes=new Uint8Array(value);this.writes=0;}
  async getFile(){return new File([this.bytes],this.name);}
  async createWritable(){
    if(this.fail)throw error('NotAllowedError');
    let value;
    return {write:async data=>{value=new Uint8Array(data);},close:async()=>{this.bytes=value;this.writes++;},abort:async()=>{}};
  }
}
class LocalDirectory {
  constructor(name='source'){this.name=name;this.kind='directory';this.children=new Map();this.permission='granted';this.permissions=[];}
  async *values(){yield* this.children.values();}
  async requestPermission({mode}){this.permissions.push(mode);return this.permission;}
  async getDirectoryHandle(name,{create=false}={}){
    if(this.children.has(name)){const entry=this.children.get(name);if(entry.kind!=='directory')throw error('TypeMismatchError');return entry;}
    if(!create)throw error('NotFoundError');const entry=new LocalDirectory(name);this.children.set(name,entry);return entry;
  }
  async getFileHandle(name,{create=false}={}){
    if(this.children.has(name)){const entry=this.children.get(name);if(entry.kind!=='file')throw error('TypeMismatchError');return entry;}
    if(!create)throw error('NotFoundError');const entry=new LocalFile(name,bytes());this.children.set(name,entry);return entry;
  }
  file(name,value){const entry=new LocalFile(name,value);this.children.set(name,entry);return entry;}
  dir(name){const entry=new LocalDirectory(name);this.children.set(name,entry);return entry;}
}
const root=new LocalDirectory('我的目录'),payload=bytes(0,255,13,10,0,1);
root.file('Long filename.anyextension',payload);root.file('LONGFI~1.ANY',bytes(7));
root.file('readme',bytes(8));root.file('README',bytes(9));root.file('NOEXT',bytes());
root.dir('空目录');root.dir('Long folder').file('arbitrary.未知',payload);
let observed=0;
const source=await readDirectoryHandle(root,{onProgress:()=>observed++});
check(()=>assert.equal(source.entries.length,8));check(()=>assert.equal(observed,8));
check(()=>assert.equal(source.handle,root));check(()=>assert(source.entries.some(entry=>entry.source==='空目录'&&entry.type==='directory')));
const card=createDirectoryCard(source),names=card.mappings.map(entry=>[entry.source,entry.card]);
check(()=>assert.equal(names.find(([name])=>name==='Long filename.anyextension')[1],'/LONGFI~2.ANY'));
check(()=>assert.equal(names.find(([name])=>name==='LONGFI~1.ANY')[1],'/LONGFI~1.ANY'));
check(()=>assert.equal(names.find(([name])=>name==='README')[1],'/README'));
check(()=>assert.equal(names.find(([name])=>name==='readme')[1],'/README~1'));
check(()=>assert(names.some(([name,path])=>name==='空目录'&&path==='/FOLDER~1')));
check(()=>assert.deepEqual(mapDirectoryNames({...source,entries:[...source.entries].reverse()}).map(entry=>[entry.source,entry.card]),names));
for(const entry of card.mappings.filter(entry=>entry.type==='file'))check(()=>assert.deepEqual(readSDFile(card.bytes,entry.card),source.entries.find(item=>item.source===entry.source).bytes));
check(()=>assert.equal(listSDDirectory(card.bytes,'/FOLDER~1').entries.length,0));
check(()=>assert.equal(card.association.handle,root));check(()=>assert.equal(root.permissions.length,0));
check(()=>assert.equal(readSDTree(card.bytes).length,8));
const fromFallback=await readDirectoryFiles(source.entries.filter(entry=>entry.type==='file').map(entry=>{
  const file=new File([entry.bytes],entry.source.split('/').at(-1));Object.defineProperty(file,'webkitRelativePath',{value:'fallback/'+entry.source});return file;
}));
check(()=>assert.equal(fromFallback.handle,null));check(()=>assert.equal(fromFallback.fallback,true));
check(()=>assert.equal(fromFallback.entries.filter(entry=>entry.type==='file').length,6));
check(()=>assert.equal(fromFallback.entries.some(entry=>entry.source==='空目录'),false));
const invalid=new File([bytes(1)],'escape');Object.defineProperty(invalid,'webkitRelativePath',{value:'root/../escape'});
await assert.rejects(readDirectoryFiles([invalid]),{code:'directoryPath'});checks++;
await assert.rejects(readDirectoryHandle(root,{isCurrent:()=>false}),{code:'directoryCancelled'});checks++;
const tooDeep={name:'deep',entries:[{source:Array(33).fill('A').join('/'),type:'directory'}]};
check(()=>assert.throws(()=>createDirectoryCard(tooDeep),{code:'directoryLimit'}));
const large={name:'large',entries:[{source:'DATA',type:'file',bytes:new Uint8Array(17*1024*1024)}],totalBytes:17*1024*1024};
check(()=>assert.throws(()=>createDirectoryCard(large),{code:'directoryFull'}));
const largeCard=createDirectoryCard(large,32*1024*1024);
check(()=>assert.equal(largeCard.bytes.length,32*1024*1024));check(()=>assert.equal(readSDFile(largeCard.bytes,'/DATA').length,17*1024*1024));
const view=new DataView(largeCard.bytes.buffer),partition=view.getUint32(454,true)*512;
check(()=>assert.equal(view.getUint16(partition+19,true),65535));check(()=>assert.equal(largeCard.bytes[453],31));
// Hundreds of nested entries are added in one copy. Rejected late members keep
// the source and earlier payload bytes unchanged.
const blank=createSDImage(),tree=[];
for(let folder=0;folder<40;folder++){
  tree.push({path:'D'+folder,type:'directory'});
  for(let file=0;file<10;file++)tree.push({path:`D${folder}/F${file}`,type:'file',bytes:payload});
}
const populated=addSDTree(blank,'/',tree.reverse());
check(()=>assert.equal(readSDTree(populated).length,440));check(()=>assert.deepEqual(readSDFile(populated,'/D39/F9'),payload));
check(()=>assert.deepEqual(blank,createSDImage()));
check(()=>assert.throws(()=>addSDTree(blank,'/',[{path:'A',type:'file',bytes:payload},{path:'a',type:'file',bytes:payload}]),{code:'duplicate'}));
check(()=>assert.deepEqual(blank,createSDImage()));
check(()=>assert.throws(()=>addSDTree(blank,'/',[{path:'MISSING/FILE',type:'file',bytes:payload}]),{code:'path'}));
check(()=>assert.throws(()=>addSDTree(blank,'/',[{path:'../FILE',type:'file',bytes:payload}]),{code:'name'}));

const sync=new LocalDirectory('sync'),long=sync.file('My original.longextension',payload),external=sync.file('EXTERNAL',bytes(1)),keep=sync.file('KEEP',bytes(2));
sync.dir('Long folder').file('BEFORE',bytes(3));
const imported=createDirectoryCard(await readDirectoryHandle(sync));
const originalPath=imported.mappings.find(entry=>entry.source==='My original.longextension').card;
const replace=(image,path,data)=>addSDFiles(deleteSDEntry(image,path),path.slice(0,path.lastIndexOf('/'))||'/',[{name:path.split('/').at(-1),bytes:data}]);
let changed=replace(imported.bytes,originalPath,bytes(42));changed=replace(changed,'/EXTERNAL',bytes(4));
changed=deleteSDEntry(changed,'/KEEP');changed=addSDFiles(changed,'/',[{name:'NEW.ANY',bytes:payload}]);
const folderPath=imported.mappings.find(entry=>entry.source==='Long folder').card;
changed=addSDFiles(changed,folderPath,[{name:'AFTER',bytes:payload}]);
external.bytes=bytes(77);
const plan=await planDirectoryWrite(changed,imported.association);
check(()=>assert.equal(plan.entries.find(entry=>entry.source==='My original.longextension').action,'update'));
check(()=>assert.equal(plan.entries.find(entry=>entry.source==='EXTERNAL').action,'conflict'));
check(()=>assert.equal(plan.entries.find(entry=>entry.source==='Long folder/AFTER').action,'create'));
check(()=>assert.equal(plan.retained,1));check(()=>assert.deepEqual(long.bytes,payload));
await requestDirectoryPermission(sync,'readwrite');
const result=await writeDirectoryPlan(plan);
check(()=>assert.equal(result.completed.length,3));check(()=>assert.deepEqual(result.conflicts,['EXTERNAL']));check(()=>assert.equal(result.failed.length,0));
check(()=>assert.deepEqual(long.bytes,bytes(42)));check(()=>assert.deepEqual(external.bytes,bytes(77)));check(()=>assert.deepEqual(keep.bytes,bytes(2)));
check(()=>assert.deepEqual(sync.children.get('Long folder').children.get('AFTER').bytes,payload));
check(()=>assert.equal(sync.children.has(originalPath.slice(1)),false));
check(()=>assert.equal(result.association.mappings.find(entry=>entry.source==='Long folder/AFTER').card,folderPath+'/AFTER'));
check(()=>assert.deepEqual(sync.permissions,['readwrite']));
const next=await planDirectoryWrite(changed,result.association);
check(()=>assert.equal(next.entries.filter(entry=>['create','update'].includes(entry.action)).length,0));

// A file changed or created after preview must still be kept. Other files can
// finish, and reported failures do not claim a whole-directory transaction.
let late=addSDFiles(changed,'/',[{name:'RACE',bytes:bytes(1)},{name:'FAIL',bytes:bytes(2)},{name:'OK',bytes:bytes(3)}]);
late=replace(late,originalPath,bytes(99));
const latePlan=await planDirectoryWrite(late,result.association);
sync.file('RACE',bytes(88));long.bytes=bytes(66);
const getFile=sync.getFileHandle.bind(sync);
sync.getFileHandle=async(name,options)=>{const file=await getFile(name,options);if(name==='FAIL')file.fail=true;return file;};
const lateResult=await writeDirectoryPlan(latePlan);
check(()=>assert(lateResult.conflicts.includes('RACE')));check(()=>assert(lateResult.conflicts.includes('My original.longextension')));
check(()=>assert.deepEqual(sync.children.get('RACE').bytes,bytes(88)));check(()=>assert.deepEqual(long.bytes,bytes(66)));
check(()=>assert.deepEqual(lateResult.failed.map(entry=>entry.path),['FAIL']));check(()=>assert.deepEqual(sync.children.get('OK').bytes,bytes(3)));
check(()=>assert(lateResult.completed.includes('OK')));
sync.permission='denied';await assert.rejects(requestDirectoryPermission(sync,'readwrite'),{code:'directoryPermission'});checks++;
// A new directory appearing after preview blocks its child writes as well.
const newDir=addSDTree(changed,'/',[{path:'RACEDIR',type:'directory'},{path:'RACEDIR/FILE',type:'file',bytes:payload}]);
const dirPlan=await planDirectoryWrite(newDir,result.association);sync.dir('RACEDIR');
const dirResult=await writeDirectoryPlan(dirPlan);
check(()=>assert(dirResult.conflicts.includes('RACEDIR')));check(()=>assert(dirResult.conflicts.includes('RACEDIR/FILE')));
check(()=>assert.equal(sync.children.get('RACEDIR').children.size,0));
// The original mapped file was removed externally, not created by this app.
sync.children.delete('My original.longextension');
const missingPlan=await planDirectoryWrite(imported.bytes,imported.association);
check(()=>assert.equal(missingPlan.entries.find(entry=>entry.source==='My original.longextension').action,'conflict'));
check(()=>assert.equal(sync.children.has('My original.longextension'),false));
console.log(`Directory SD: ${checks} recursive import, deterministic aliases, FAT16 capacity/rollback, byte preservation, conflict/race protection, and partial-write checks pass.`);
