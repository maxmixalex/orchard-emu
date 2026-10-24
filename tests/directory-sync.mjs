// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createDirectoryCard,readDirectoryHandle} from '../web/directory-card.js';
import {planDirectorySync,applyDirectorySync,directorySyncSummary,identifyDirectoryCard,matchesDirectoryCard} from '../web/directory-sync.js';
import {readSDFile,readSDTree,addSDFiles,deleteSDEntry,renameSDEntry,reconcileSDTree,listSDDirectory} from '../web/sd-filesystem.js';
let checks=0;
const check=fn=>{fn();checks++;},bytes=(...values)=>new Uint8Array(values),error=name=>Object.assign(new Error(name),{name});
class LocalFile{
  constructor(name,value){this.kind='file';this.name=name;this.bytes=bytes(...value);}
  async getFile(){this.onRead?.();return new File([this.bytes],this.name);}
  async createWritable(){if(this.fail)throw error('NotAllowedError');let value;
    return {write:async data=>{value=new Uint8Array(data);},close:async()=>{this.bytes=value;},abort:async()=>{}};}
}
class LocalDirectory{
  constructor(name='sync'){this.kind='directory';this.name=name;this.children=new Map();}
  async *values(){yield* this.children.values();}
  async getFileHandle(name,{create=false}={}){let child=this.children.get(name);if(child&&child.kind!=='file')throw error('TypeMismatchError');
    if(!child){if(!create)throw error('NotFoundError');child=this.file(name,bytes());}return child;}
  async getDirectoryHandle(name,{create=false}={}){let child=this.children.get(name);if(child&&child.kind!=='directory')throw error('TypeMismatchError');
    if(!child){if(!create)throw error('NotFoundError');child=this.dir(name);}return child;}
  async removeEntry(name,{recursive=false}={}){assert.equal(recursive,false);const entry=this.children.get(name);
    if(!entry)throw error('NotFoundError');if(entry.kind==='directory'&&entry.children.size)throw error('InvalidModificationError');this.children.delete(name);}
  file(name,value){const child=new LocalFile(name,value);this.children.set(name,child);return child;}
  dir(name){const child=new LocalDirectory(name);this.children.set(name,child);return child;}
}
const put=(image,path,value)=>addSDFiles(deleteSDEntry(image,path),path.slice(0,path.lastIndexOf('/'))||'/',[{name:path.split('/').at(-1),bytes:value}]);
const imported=async root=>{const card=createDirectoryCard(await readDirectoryHandle(root));card.association=identifyDirectoryCard(card.bytes,card.association);return card;};
const root=new LocalDirectory(),local=root.file('LOCAL',bytes(1)),guest=root.file('GUEST',bytes(2)),both=root.file('BOTH',bytes(3));
root.file('LOCALDEL',bytes(4));root.file('CARDDEL',bytes(5));root.file('Long original.name',bytes(6));
const a=await imported(root);check(()=>assert(matchesDirectoryCard(a.bytes,a.association)));
check(()=>assert(!matchesDirectoryCard(a.bytes,{...a.association,serial:a.association.serial^1})));
local.bytes=bytes(11);both.bytes=bytes(33);root.children.delete('LOCALDEL');root.file('FROMHOST',bytes(8));
let image=put(a.bytes,'/GUEST',bytes(22));image=put(image,'/BOTH',bytes(44));image=deleteSDEntry(image,'/CARDDEL');
image=renameSDEntry(image,a.mappings.find(entry=>entry.source==='Long original.name').card,'RENAMED');
image=addSDFiles(image,'/',[{name:'FROMCARD',bytes:bytes(9)}]);
let plan=await planDirectorySync(image,a.association),summary=directorySyncSummary(plan);
check(()=>assert.deepEqual(summary,{toCard:3,toLocal:5,deletions:3,conflicts:1}));
check(()=>assert.equal(plan.entries.find(entry=>entry.source==='BOTH').direction,'conflict'));
let result=await applyDirectorySync(plan);
check(()=>assert.deepEqual(readSDFile(result.bytes,'/LOCAL'),bytes(11)));check(()=>assert.deepEqual(guest.bytes,bytes(22)));
check(()=>assert.deepEqual(readSDFile(result.bytes,'/FROMHOST'),bytes(8)));check(()=>assert.deepEqual(root.children.get('FROMCARD').bytes,bytes(9)));
check(()=>assert.equal(root.children.has('CARDDEL'),false));check(()=>assert.equal(root.children.has('Long original.name'),false));
check(()=>assert.deepEqual(root.children.get('RENAMED').bytes,bytes(6)));
check(()=>assert.throws(()=>readSDFile(result.bytes,'/LOCALDEL')));
check(()=>assert.deepEqual(both.bytes,bytes(33)));check(()=>assert.deepEqual(readSDFile(result.bytes,'/BOTH'),bytes(44)));
check(()=>assert.deepEqual(result.conflicts,['BOTH']));check(()=>assert.equal(result.failed.length,0));
plan=await planDirectorySync(result.bytes,result.association);
check(()=>assert.deepEqual(directorySyncSummary(plan),{toCard:0,toLocal:0,deletions:0,conflicts:1}));
result=await applyDirectorySync(plan,{BOTH:'local'});
check(()=>assert.deepEqual(readSDFile(result.bytes,'/BOTH'),bytes(33)));
const resolvedPlan=await planDirectorySync(result.bytes,result.association);
check(()=>assert.deepEqual(directorySyncSummary(resolvedPlan),{toCard:0,toLocal:0,deletions:0,conflicts:0}));
// A new direct host filename cannot steal an already published long alias.
const aliases=new LocalDirectory();aliases.file('Long filename.extension',bytes(1));const aliasCard=await imported(aliases);
const alias=aliasCard.mappings[0].card;aliases.file(alias.slice(1),bytes(2));
const aliasResult=await applyDirectorySync(await planDirectorySync(aliasCard.bytes,aliasCard.association));
check(()=>assert.deepEqual(readSDFile(aliasResult.bytes,alias),bytes(1)));
check(()=>assert.equal(aliasResult.association.mappings.find(entry=>entry.source===alias.slice(1)).card===alias,false));
// Folder deletion versus a child modification is a single subtree conflict.
for(const choose of ['keep','local','card']){
  const directory=new LocalDirectory(),folder=directory.dir('FOLDER');folder.file('A',bytes(1));folder.file('B',bytes(2));
  const initial=await imported(directory);directory.children.delete('FOLDER');
  const changed=put(initial.bytes,'/FOLDER/A',bytes(10)),p=await planDirectorySync(changed,initial.association);
  check(()=>assert.equal(p.entries.find(entry=>entry.source==='FOLDER').direction,'conflict'));
  check(()=>assert.equal(p.entries.find(entry=>entry.source==='FOLDER/A').group,'FOLDER'));
  const r=await applyDirectorySync(p,{FOLDER:choose});
  if(choose==='keep'){check(()=>assert.equal(directory.children.has('FOLDER'),false));check(()=>assert.deepEqual(readSDFile(r.bytes,'/FOLDER/A'),bytes(10)));}
  if(choose==='local'){check(()=>assert.equal(readSDTree(r.bytes).length,0));check(()=>assert.equal(directory.children.has('FOLDER'),false));}
  if(choose==='card'){check(()=>assert.deepEqual(directory.children.get('FOLDER').children.get('A').bytes,bytes(10)));check(()=>assert.equal(r.failed.length,0));}
}
// Independently reaching the same subtree result is already synchronized.
// Matching deletions and directory-to-file replacements need no conflict UI
// and must discard the obsolete subtree baseline in the same apply.
for(const replacement of [null,bytes(8,9)]){
  const directory=new LocalDirectory(),folder=directory.dir('FOLDER');
  folder.file('A',bytes(1));folder.dir('NESTED').file('B',bytes(2));
  const initial=await imported(directory);directory.children.delete('FOLDER');
  let image=initial.bytes;
  for(const path of ['/FOLDER/NESTED/B','/FOLDER/NESTED','/FOLDER/A','/FOLDER'])image=deleteSDEntry(image,path);
  if(replacement){directory.file('FOLDER',replacement);image=addSDFiles(image,'/',[{name:'FOLDER',bytes:replacement}]);}
  const p=await planDirectorySync(image,initial.association);
  check(()=>assert.deepEqual(directorySyncSummary(p),{toCard:0,toLocal:0,deletions:0,conflicts:0}));
  check(()=>assert(p.entries.every(entry=>entry.direction==='same'&&!entry.group)));
  const r=await applyDirectorySync(p);
  check(()=>assert.deepEqual(r.conflicts,[]));check(()=>assert.deepEqual(r.failed,[]));
  check(()=>assert.deepEqual(r.association.baseline.map(entry=>entry.source),replacement?['FOLDER']:[]));
  const next=await planDirectorySync(r.bytes,r.association);
  check(()=>assert.deepEqual(directorySyncSummary(next),{toCard:0,toLocal:0,deletions:0,conflicts:0}));
}
// Changed preview is rejected before any host writes and leaves source image.
const stale=new LocalDirectory(),staleFile=stale.file('A',bytes(1)),staleCard=await imported(stale);
const staleImage=put(staleCard.bytes,'/A',bytes(2)),stalePlan=await planDirectorySync(staleImage,staleCard.association);
staleFile.bytes=bytes(3);await assert.rejects(applyDirectorySync(stalePlan),{code:'directoryChanged'});checks++;
check(()=>assert.deepEqual(staleFile.bytes,bytes(3)));check(()=>assert.deepEqual(readSDFile(staleImage,'/A'),bytes(2)));
await assert.rejects(planDirectorySync(staleImage,staleCard.association,{isCurrent:()=>false}),{code:'directoryCancelled'});checks++;
// Per-file failures keep a retryable baseline and do not abort other writes.
const failures=new LocalDirectory(),f=failures.file('FAIL',bytes(1));failures.file('OK',bytes(1));
const failureCard=await imported(failures),changed=put(put(failureCard.bytes,'/FAIL',bytes(2)),'/OK',bytes(2));
const failurePlan=await planDirectorySync(changed,failureCard.association);f.fail=true;
const failureResult=await applyDirectorySync(failurePlan);
check(()=>assert.deepEqual(failureResult.failed.map(entry=>entry.path),['FAIL']));
check(()=>assert.deepEqual(failures.children.get('OK').bytes,bytes(2)));check(()=>assert.deepEqual(f.bytes,bytes(1)));
const retryPlan=await planDirectorySync(failureResult.bytes,failureResult.association);
check(()=>assert.equal(retryPlan.entries.find(entry=>entry.source==='FAIL').direction,'card'));
// An edit after the initial full-tree check is detected immediately before
// that individual file is replaced; the other requested write can succeed.
const racing=new LocalDirectory(),race=racing.file('A',bytes(1));racing.file('B',bytes(1));
const racingCard=await imported(racing),racingImage=put(put(racingCard.bytes,'/A',bytes(2)),'/B',bytes(2));
const racingPlan=await planDirectorySync(racingImage,racingCard.association);let reads=0;
race.onRead=()=>{if(++reads===2)race.bytes=bytes(9);};
const racingResult=await applyDirectorySync(racingPlan);
check(()=>assert.deepEqual(racingResult.conflicts,['A']));check(()=>assert.deepEqual(race.bytes,bytes(9)));
check(()=>assert.deepEqual(racing.children.get('B').bytes,bytes(2)));
// A new child appearing at the removal boundary prevents the directory's
// removal. No recursive deletion is used, and the new child survives.
const late=new LocalDirectory(),lateFolder=late.dir('FOLDER');lateFolder.file('A',bytes(1));
const lateCard=await imported(late),lateImage=deleteSDEntry(deleteSDEntry(lateCard.bytes,'/FOLDER/A'),'/FOLDER');
const latePlan=await planDirectorySync(lateImage,lateCard.association),removeLate=late.removeEntry.bind(late);
late.removeEntry=async(name,options)=>{lateFolder.file('ARRIVED',bytes(7));return removeLate(name,options);};
const lateResult=await applyDirectorySync(latePlan);
check(()=>assert.deepEqual(lateResult.failed.map(entry=>entry.path),['FOLDER']));
check(()=>assert.deepEqual(lateFolder.children.get('ARRIVED').bytes,bytes(7)));
// Changing file/directory types is deliberate create/delete work in either
// direction, including removal of all old children before a file replaces it.
for(const direction of ['local','card']){
  const typed=new LocalDirectory(),dir=typed.dir('NODE');dir.file('CHILD',bytes(1));const initial=await imported(typed);
  let next=initial.bytes;
  if(direction==='local')typed.file('NODE',bytes(4));
  else next=addSDFiles(deleteSDEntry(deleteSDEntry(next,'/NODE/CHILD'),'/NODE'),'/',[{name:'NODE',bytes:bytes(4)}]);
  const typedResult=await applyDirectorySync(await planDirectorySync(next,initial.association));
  check(()=>assert.deepEqual(readSDFile(typedResult.bytes,'/NODE'),bytes(4)));
  check(()=>assert.deepEqual(typed.children.get('NODE').bytes,bytes(4)));
  check(()=>assert.equal(typedResult.failed.length,0));
  check(()=>assert.deepEqual(typedResult.association.baseline.map(entry=>entry.source),['NODE']));
  const typedNext=await planDirectorySync(typedResult.bytes,typedResult.association);
  check(()=>assert.deepEqual(directorySyncSummary(typedNext),{toCard:0,toLocal:0,deletions:0,conflicts:0}));
}
// Reconciliation preserves metadata for untouched and rewritten files, rejects
// readonly changes and rolls back a late capacity failure in one private copy.
const meta=new LocalDirectory();meta.file('A',bytes(1));meta.file('B',bytes(2));const metaCard=await imported(meta);
const volume=listSDDirectory(metaCard.bytes),view=new DataView(metaCard.bytes.buffer),b=volume.partitionStart*512;
const rootOffset=b+(view.getUint16(b+14,true)+metaCard.bytes[b+16]*view.getUint16(b+22,true))*512;
metaCard.bytes[rootOffset+13]=57;metaCard.bytes[rootOffset+32+11]|=2;
const metaTree=readSDTree(metaCard.bytes);metaTree.find(entry=>entry.path==='/A').bytes=bytes(9,8);
const reconciled=reconcileSDTree(metaCard.bytes,metaTree);
check(()=>assert.equal(reconciled[rootOffset+13],57));check(()=>assert.equal(reconciled[rootOffset+32+11]&2,2));
check(()=>assert.deepEqual(readSDFile(reconciled,'/A'),bytes(9,8)));
metaCard.bytes[rootOffset+11]|=1;
check(()=>assert.throws(()=>reconcileSDTree(metaCard.bytes,metaTree),{code:'readOnly'}));
const before=new Uint8Array(reconciled),huge=readSDTree(reconciled);huge.push({path:'/HUGE',type:'file',bytes:new Uint8Array(reconciled.length)});
check(()=>assert.throws(()=>reconcileSDTree(reconciled,huge),{code:'full'}));check(()=>assert.deepEqual(reconciled,before));
// A generation can be cancelled while an asynchronous destination read is
// outstanding. Do not turn its eventual result into a new local mutation.
for(const operation of ['delete','write']){
  const cancelled=new LocalDirectory(),file=cancelled.file('A',bytes(1)),initial=await imported(cancelled);
  const changed=operation==='delete'?deleteSDEntry(initial.bytes,'/A'):put(initial.bytes,'/A',bytes(2));
  const pending=await planDirectorySync(changed,initial.association);let current=true,reads=0;
  file.onRead=()=>{if(++reads===2)current=false;};
  await assert.rejects(applyDirectorySync(pending,{}, {isCurrent:()=>current}),{code:'directoryCancelled'});checks++;
  check(()=>assert.deepEqual(cancelled.children.get('A').bytes,bytes(1)));
}
// Resolving a nested parent is another await between the recheck and delete.
{
  const cancelled=new LocalDirectory(),folder=cancelled.dir('FOLDER');folder.file('A',bytes(1));
  const initial=await imported(cancelled),pending=await planDirectorySync(deleteSDEntry(initial.bytes,'/FOLDER/A'),initial.association);
  const lookup=cancelled.getDirectoryHandle.bind(cancelled);let current=true,lookups=0;
  cancelled.getDirectoryHandle=async(...args)=>{const value=await lookup(...args);if(++lookups===2)current=false;return value;};
  await assert.rejects(applyDirectorySync(pending,{}, {isCurrent:()=>current}),{code:'directoryCancelled'});checks++;
  check(()=>assert.deepEqual(folder.children.get('A').bytes,bytes(1)));
}
// Cancellation while obtaining/opening/writing a stream must never close it
// into the original file. Abort an acquired stream instead of committing it.
for(const phase of ['handle','open','write']){
  const cancelled=new LocalDirectory(),file=cancelled.file('A',bytes(1)),initial=await imported(cancelled);
  const pending=await planDirectorySync(put(initial.bytes,'/A',bytes(2)),initial.association);
  let current=true,handles=0,opened=0,written=0,closed=0,aborted=0;
  const lookup=cancelled.getFileHandle.bind(cancelled),open=file.createWritable.bind(file);
  cancelled.getFileHandle=async(...args)=>{const value=await lookup(...args);if(++handles===2&&phase==='handle')current=false;return value;};
  file.createWritable=async()=>{
    const stream=await open();opened++;if(phase==='open')current=false;
    return {write:async data=>{await stream.write(data);written++;if(phase==='write')current=false;},
      close:async()=>{closed++;await stream.close();},abort:async()=>{aborted++;await stream.abort();}};
  };
  await assert.rejects(applyDirectorySync(pending,{}, {isCurrent:()=>current}),{code:'directoryCancelled'});checks++;
  check(()=>assert.deepEqual(file.bytes,bytes(1)));check(()=>assert.equal(closed,0));
  check(()=>assert.equal(opened,phase==='handle'?0:1));check(()=>assert.equal(aborted,opened));
  check(()=>assert.equal(written,phase==='write'?1:0));
}
// A close which already committed before cancellation cannot be undone. Stop
// before touching the next destination, rather than pretending full rollback.
{
  const cancelled=new LocalDirectory(),file=cancelled.file('A',bytes(1));cancelled.file('B',bytes(1));
  const initial=await imported(cancelled),changed=put(put(initial.bytes,'/A',bytes(2)),'/B',bytes(2));
  const pending=await planDirectorySync(changed,initial.association),open=file.createWritable.bind(file);let current=true,aborted=0;
  file.createWritable=async()=>{const stream=await open();return {write:stream.write,
    close:async()=>{await stream.close();current=false;},abort:async()=>{aborted++;await stream.abort();}};};
  await assert.rejects(applyDirectorySync(pending,{}, {isCurrent:()=>current}),{code:'directoryCancelled'});checks++;
  check(()=>assert.deepEqual(file.bytes,bytes(2)));check(()=>assert.deepEqual(cancelled.children.get('B').bytes,bytes(1)));
  check(()=>assert.equal(aborted,0));
}
console.log(`Directory synchronization: ${checks} two-way changes, deletions/renames, subtree conflicts, explicit resolutions, preview races, asynchronous cancellation, partial writes, alias identity and transactional FAT checks pass.`);
