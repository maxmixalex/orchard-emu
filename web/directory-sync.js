// SPDX-License-Identifier: MIT
// Browser-only three-way directory/card synchronization. Plans are immutable
// snapshots. Applying requires an ejected image and explicit user confirmation.
import {readSDTree,listSDDirectory,reconcileSDTree} from './sd-filesystem.js';
import {readDirectoryHandle,mapDirectoryNames} from './directory-card.js';

const compare=(a,b)=>a<b?-1:a>b?1:0;
const equal=(a,b)=>!a&&!b||Boolean(a&&b&&a.type===b.type&&(a.type!=='file'||
  a.bytes instanceof Uint8Array&&b.bytes instanceof Uint8Array&&a.bytes.length===b.bytes.length&&a.bytes.every((value,index)=>value===b.bytes[index])));
const inside=(path,parent)=>path===parent||path.startsWith(parent+'/');
const depth=path=>path.split('/').length;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const guard=options=>{if(options.isCurrent&&!options.isCurrent())fail('directoryCancelled');};
const plain=entry=>entry?{source:entry.source,type:entry.type,...(entry.type==='file'?{bytes:new Uint8Array(entry.bytes)}:{})}:null;

export function directoryCardSerial(image){
  const offset=listSDDirectory(image).partitionStart*512;
  if(image[offset+38]!==0x29)return null;
  return new DataView(image.buffer,image.byteOffset,image.byteLength).getUint32(offset+39,true);
}
export function identifyDirectoryCard(image,association){
  if(!association)return association;
  const offset=listSDDirectory(image).partitionStart*512;
  const random=new Uint32Array(1);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(random);
  else random[0]=(Date.now()^Math.floor(Math.random()*0x100000000))>>>0;
  const serial=association.serial??(random[0]||1);
  new DataView(image.buffer,image.byteOffset,image.byteLength).setUint32(offset+39,serial,true);
  return {...association,serial};
}
export function matchesDirectoryCard(image,association){
  return Number.isInteger(association?.serial)&&association.serial!==0&&directoryCardSerial(image)===association.serial;
}

function cardEntries(image,association){
  const mapping=new Map(association.mappings.map(entry=>[entry.card,entry.source]));
  function source(card){
    if(mapping.has(card))return mapping.get(card);
    const slash=card.lastIndexOf('/'),parent=slash>0?source(card.slice(0,slash)):'';
    return (parent?parent+'/':'')+card.slice(slash+1);
  }
  const entries=readSDTree(image).map(entry=>({...entry,source:source(entry.path),card:entry.path}));
  if(new Set(entries.map(entry=>entry.source)).size!==entries.length)fail('directoryPath');
  return entries;
}

export async function planDirectorySync(image,association,options={}){
  if(!association?.handle)fail('directoryPath');
  const card=cardEntries(image,association),local=await readDirectoryHandle(association.handle,options);
  const maps={base:new Map(association.baseline.map(entry=>[entry.source,entry])),
    card:new Map(card.map(entry=>[entry.source,entry])),local:new Map(local.entries.map(entry=>[entry.source,entry]))};
  const paths=[...new Set([...maps.base.keys(),...maps.card.keys(),...maps.local.keys()])].sort((a,b)=>depth(a)-depth(b)||compare(a,b));
  const entries=paths.map(source=>{
    const base=maps.base.get(source)||null,card=maps.card.get(source)||null,local=maps.local.get(source)||null;
    const cardChanged=!equal(card,base),localChanged=!equal(local,base);
    const direction=equal(card,local)?'same':!cardChanged?'local':!localChanged?'card':'conflict';
    return {source,base,card,local,cardChanged,localChanged,direction};
  });
  // Deleting/replacing a directory conflicts with any change on the other
  // side below it. Resolve the subtree as one unit, never orphan its children.
  for(const entry of entries){
    // Both sides can have independently deleted or identically replaced the
    // entire subtree. Its removed children changed relative to the baseline,
    // but those matching changes do not introduce a competing version.
    if(entry.direction==='same')continue;
    if(![entry.base,entry.card,entry.local].some(value=>value?.type==='directory'))continue;
    const cardBoundary=entry.card?.type!=='directory',localBoundary=entry.local?.type!=='directory';
    const children=entries.filter(child=>child!==entry&&inside(child.source,entry.source));
    if((localBoundary&&children.some(child=>child.cardChanged))||(cardBoundary&&children.some(child=>child.localChanged)))entry.direction='conflict';
  }
  const groups=[];
  for(const entry of entries){
    const parent=groups.find(group=>inside(entry.source,group.source));
    if(parent){entry.group=parent.source;continue;}
    if(entry.direction==='conflict'&&[entry.base,entry.card,entry.local].some(value=>value?.type==='directory')&&
      (entry.card?.type!=='directory'||entry.local?.type!=='directory'))groups.push(entry);
  }
  guard(options);
  return {image:new Uint8Array(image),association,entries,local:local.entries,card,createdAt:Date.now()};
}

function decisions(plan,choices){
  const selected=new Map();
  for(const entry of plan.entries){
    if(entry.group){selected.set(entry.source,selected.get(entry.group));continue;}
    const choice=entry.direction==='conflict'?(choices[entry.source]||'keep'):entry.direction;
    if(!['local','card','same','keep'].includes(choice))fail('directoryPath');
    selected.set(entry.source,choice);
  }
  return selected;
}
export function directorySyncSummary(plan,choices={}){
  const selected=decisions(plan,choices),summary={toCard:0,toLocal:0,deletions:0,conflicts:0};
  for(const entry of plan.entries){
    const side=selected.get(entry.source);
    if(side==='keep'){if(!entry.group)summary.conflicts++;continue;}
    if(side==='local'&&!equal(entry.card,entry.local)){summary.toCard++;if(!entry.local)summary.deletions++;}
    if(side==='card'&&!equal(entry.card,entry.local)){summary.toLocal++;if(!entry.card)summary.deletions++;}
  }
  return summary;
}

async function readEntry(root,path){
  const names=path.split('/');let parent=root;
  try{
    for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name);
    try{const handle=await parent.getFileHandle(names.at(-1)),file=await handle.getFile();
      if(file.size>32*1024*1024)return {type:'file',bytes:null};
      return {type:'file',bytes:new Uint8Array(await file.arrayBuffer())};
    }catch(error){if(error.name!=='TypeMismatchError')throw error;
      await parent.getDirectoryHandle(names.at(-1));return {type:'directory'};}
  }catch(error){if(error.name==='NotFoundError')return null;if(error.name==='TypeMismatchError')return {type:'blocked'};throw error;}
}
async function parentFor(root,path){
  const names=path.split('/');let parent=root;
  for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name);
  return {parent,name:names.at(-1)};
}

export async function applyDirectorySync(plan,choices={},options={}){
  const {association}=plan,root=association.handle,selected=decisions(plan,choices);
  // A changed preview is rejected before any host mutation, including when a
  // local edit only feeds the card. Permission is requested by the UI button.
  const latest=await readDirectoryHandle(root,options),expected=new Map(plan.local.map(entry=>[entry.source,entry]));
  if(latest.entries.length!==expected.size||latest.entries.some(entry=>!equal(entry,expected.get(entry.source))))fail('directoryChanged');
  guard(options);
  const desired=new Map(plan.card.map(entry=>[entry.source,entry])),host=[];
  for(const entry of plan.entries){
    const side=selected.get(entry.source);
    if(side==='local'){if(entry.local)desired.set(entry.source,entry.local);else desired.delete(entry.source);}
    if(side==='card'&&!equal(entry.local,entry.card))host.push(entry);
  }
  const currentMappings=plan.card.map(entry=>({source:entry.source,card:entry.card,type:entry.type}));
  const mappings=mapDirectoryNames({entries:[...desired.values()]},{mappings:currentMappings});
  const image=reconcileSDTree(plan.image,mappings.map(entry=>({...entry,path:entry.card})));
  // Validate the complete card before writing any host file. Removals are
  // children-first and nonrecursive, so a newly arrived child is never erased.
  const removals=host.filter(entry=>entry.local&&(!entry.card||entry.card.type!==entry.local.type))
    .sort((a,b)=>depth(b.source)-depth(a.source)||compare(a.source,b.source));
  const writes=host.filter(entry=>entry.card).sort((a,b)=>depth(a.source)-depth(b.source)||compare(a.source,b.source));
  const completed=[],failed=[],conflicts=[],blocked=new Set(),removed=new Set();
  function block(entry){blocked.add(entry.source);}
  const isBlocked=path=>[...blocked].some(parent=>inside(path,parent));
  for(const entry of removals){
    guard(options);
    try{
      const observed=await readEntry(root,entry.source);guard(options);
      if(!equal(observed,entry.local)){conflicts.push(entry.source);block(entry);continue;}
      const {parent,name}=await parentFor(root,entry.source);guard(options);
      await parent.removeEntry(name,{recursive:false});
      removed.add(entry.source);if(!entry.card)completed.push(entry.source);
    }catch(error){if(error.code==='directoryCancelled')throw error;failed.push({path:entry.source,error:error.name||'Error'});block(entry);}
  }
  for(const entry of writes){
    guard(options);
    if(isBlocked(entry.source))continue;
    try{
      const before=removed.has(entry.source)?null:entry.local;
      const observed=await readEntry(root,entry.source);guard(options);
      if(!equal(observed,before)){conflicts.push(entry.source);block(entry);continue;}
      const {parent,name}=await parentFor(root,entry.source);guard(options);
      if(entry.card.type==='directory')await parent.getDirectoryHandle(name,{create:true});
      else{
        const handle=await parent.getFileHandle(name,{create:true});guard(options);
        const stream=await handle.createWritable();
        try{
          guard(options);await stream.write(entry.card.bytes);guard(options);
          await stream.close();
        }catch(error){try{await stream.abort();}catch{}throw error;}
      }
      completed.push(entry.source);
    }catch(error){if(error.code==='directoryCancelled')throw error;failed.push({path:entry.source,error:error.name||'Error'});block(entry);}
  }
  const baseline=new Map(association.baseline.map(entry=>[entry.source,entry]));
  for(const entry of plan.entries){
    guard(options);
    if(selected.get(entry.source)==='keep')continue;
    const finalCard=desired.get(entry.source)||null;
    const local=await readEntry(root,entry.source);guard(options);
    // A replaced directory's old descendants are absent beneath the new
    // file. Keep the blocked marker for mutation checks above, but do not
    // retain those obsolete descendants as a competing baseline version.
    if(equal(local,finalCard)||!finalCard&&local?.type==='blocked'){
      if(finalCard)baseline.set(entry.source,plain({...finalCard,source:entry.source}));else baseline.delete(entry.source);
    }
  }
  const unresolved=plan.entries.filter(entry=>selected.get(entry.source)==='keep'&&!entry.group).map(entry=>entry.source);
  return {bytes:image,completed,failed,conflicts:[...new Set([...unresolved,...conflicts])],
    association:{...association,mappings:mappings.map(({source,card,type})=>({source,card,type})),baseline:[...baseline.values()]}};
}
