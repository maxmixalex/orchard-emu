// SPDX-License-Identifier: MIT
// Directory snapshots and stable short names for an unmounted FAT16 draft.
// Three-way synchronization lives in directory-sync.js; the older additive
// write-back functions remain available to callers of the original API.
import {createSDImage,MAX_SD_BYTES} from './sd-card.js';
import {addSDTree,readSDTree,validateSDName} from './sd-filesystem.js';

const MAX_ENTRIES=16000,MAX_DEPTH=32;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const same=(a,b)=>Boolean(a&&b&&a.length===b.length&&a.every((value,index)=>value===b[index]));
const fail=(code,details={})=>{throw Object.assign(new Error(code),{code,details});};
function component(value){
  if(typeof value!=='string'||!value||value==='.'||value==='..'||/[\\/\x00-\x1f\x7f]/.test(value))fail('directoryPath');
  return value;
}
function parts(path){return String(path).split('/').map(component);}
function guard(options){if(options.isCurrent&&!options.isCurrent())fail('directoryCancelled');}
function progress(options,entries,bytes){guard(options);options.onProgress?.({entries,bytes});}
function account(entry,state){
  if(!entry||!['directory','file'].includes(entry.type)||(entry.type==='file'&&!(entry.bytes instanceof Uint8Array)))fail('directoryPath');
  if(++state.count>MAX_ENTRIES||parts(entry.source).length-(entry.type==='file'?1:0)>MAX_DEPTH)fail('directoryLimit');
  if(entry.type==='file'){
    state.bytes+=entry.bytes.length;
    if(state.bytes>MAX_SD_BYTES)fail('directoryFull',{size:32});
  }
}

export async function requestDirectoryPermission(handle,mode='read'){
  // Called directly by the corresponding button: requestPermission can require
  // transient user activation even for a previously selected handle.
  if(handle.requestPermission&&await handle.requestPermission({mode})!=='granted')fail('directoryPermission');
}

export async function readDirectoryHandle(handle,options={}){
  if(!handle||handle.kind!=='directory')fail('directoryPath');
  const entries=[],state={count:0,bytes:0};
  async function visit(directory,parent=''){
    guard(options);
    const children=[];
    for await(const child of directory.values()){
      component(child.name);children.push(child);
      if(children.length+state.count>MAX_ENTRIES)fail('directoryLimit');
    }
    children.sort((a,b)=>compare(a.name,b.name));
    for(const child of children){
      guard(options);
      const source=parent?parent+'/'+child.name:child.name;
      if(child.kind==='directory'){
        const entry={source,type:'directory'};account(entry,state);entries.push(entry);
        progress(options,state.count,state.bytes);await visit(child,source);
      }else if(child.kind==='file'){
        const file=await child.getFile();
        if(file.size>MAX_SD_BYTES-state.bytes)fail('directoryFull',{size:32});
        const entry={source,type:'file',bytes:new Uint8Array(await file.arrayBuffer())};
        account(entry,state);entries.push(entry);progress(options,state.count,state.bytes);
      }else fail('directoryPath');
    }
  }
  await visit(handle);guard(options);
  return {name:handle.name,entries,handle,totalBytes:state.bytes,fallback:false};
}

export async function readDirectoryFiles(fileList,options={}){
  const files=Array.from(fileList),entries=[],seen=new Set(),state={count:0,bytes:0};
  if(!files.length)fail('directoryEmptyFallback');
  let name=null;
  for(const file of files){
    guard(options);
    const all=parts(file.webkitRelativePath||'');
    if(all.length<2)fail('directoryPath');
    if(name===null)name=all[0];else if(name!==all[0])fail('directoryPath');
    const relative=all.slice(1);
    for(let index=1;index<relative.length;index++){
      const source=relative.slice(0,index).join('/');
      if(!seen.has(source)){const entry={source,type:'directory'};account(entry,state);entries.push(entry);seen.add(source);}
    }
    const source=relative.join('/');
    if(seen.has(source))fail('directoryPath');
    if(file.size>MAX_SD_BYTES-state.bytes)fail('directoryFull',{size:32});
    const entry={source,type:'file',bytes:new Uint8Array(await file.arrayBuffer())};
    account(entry,state);entries.push(entry);seen.add(source);progress(options,state.count,state.bytes);
  }
  return {name,entries,handle:null,totalBytes:state.bytes,fallback:true};
}

function short(value){try{return validateSDName(value);}catch{return null;}}
function alias(name,type,used){
  const dot=name.lastIndexOf('.'),base=dot>0?name.slice(0,dot):name,extension=dot>0?name.slice(dot+1):'';
  const clean=text=>text.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g,'');
  const stem=clean(base)||(type==='directory'?'FOLDER':'FILE'),ext=clean(extension).slice(0,3);
  for(let number=1;number<=MAX_ENTRIES;number++){
    const suffix='~'+number,name=stem.slice(0,8-suffix.length)+suffix+(ext?'.'+ext:'');
    if(!used.has(name))return name;
  }
  fail('directoryLimit');
}

export function mapDirectoryNames(snapshot,previous=null){
  const tree={children:new Map()},sources=new Set(),state={count:0,bytes:0};
  for(const entry of snapshot.entries){
    account(entry,state);
    if(sources.has(entry.source))fail('directoryPath');sources.add(entry.source);
    const path=parts(entry.source);let parent=tree;
    for(let index=0;index<path.length;index++){
      const name=path[index],last=index===path.length-1;
      if(!parent.children)fail('directoryPath');
      let child=parent.children.get(name);
      if(!child){child={name,type:'directory',children:new Map()};parent.children.set(name,child);}
      if(last){
        if(entry.type==='file'&&child.children?.size)fail('directoryPath');
        Object.assign(child,{source:entry.source,type:entry.type,...(entry.type==='file'?{bytes:entry.bytes}:{}),
          children:entry.type==='directory'?child.children:undefined});
      }
      parent=child;
    }
  }
  const previousMap=new Map((previous?.mappings||[]).map(entry=>[entry.source,entry.card])),mapped=[];
  function visit(parent,sourceParent='',cardParent=''){
    const children=[...parent.children.values()].sort((a,b)=>compare(a.name,b.name)),used=new Set(),chosen=new Map();
    // Retain previously published aliases first: new host filenames must not
    // rename an existing guest path. On first import, direct short names still
    // take precedence over generated aliases.
    for(const child of children){
      const source=sourceParent?sourceParent+'/'+child.name:child.name,old=previousMap.get(source);
      const candidate=old&&old.slice(0,old.lastIndexOf('/'))===cardParent?short(old.split('/').at(-1)):null;
      if(candidate&&!used.has(candidate)){used.add(candidate);chosen.set(child,candidate);}
    }
    for(const child of children){const direct=short(child.name);if(!chosen.has(child)&&direct&&!used.has(direct)){used.add(direct);chosen.set(child,direct);}}
    for(const child of children){
      const source=sourceParent?sourceParent+'/'+child.name:child.name;
      if(!chosen.has(child)){
        const old=previousMap.get(source),candidate=old&&old.slice(0,old.lastIndexOf('/'))===cardParent?short(old.split('/').at(-1)):null;
        const value=candidate&&!used.has(candidate)?candidate:alias(child.name,child.type,used);
        chosen.set(child,value);used.add(value);
      }
    }
    for(const child of children){
      const source=sourceParent?sourceParent+'/'+child.name:child.name,card=cardParent+'/'+chosen.get(child);
      mapped.push({source,card,path:card.slice(1),type:child.type,...(child.type==='file'?{bytes:child.bytes}:{})});
      if(child.type==='directory')visit(child,source,card);
    }
  }
  visit(tree);return mapped;
}

export function createDirectoryCard(snapshot,size=16*1024*1024,previous=null){
  const mappings=mapDirectoryNames(snapshot,previous);
  if(mappings.reduce((sum,entry)=>sum+(entry.bytes?.length||0),0)>size)fail('directoryFull',{size:size/1024/1024});
  let bytes;
  try{bytes=addSDTree(createSDImage(size),'/',mappings);}catch(error){if(error.code==='full')fail('directoryFull',{size:size/1024/1024});if(error.code==='limit')fail('directoryLimit');throw error;}
  const association=snapshot.handle?{
    handle:snapshot.handle,name:snapshot.name,
    mappings:mappings.map(({source,card,type})=>({source,card,type})),
    baseline:snapshot.entries
  }:null;
  return {bytes,association,mappings,name:snapshot.name,fallback:snapshot.fallback,totalBytes:snapshot.totalBytes};
}

async function existing(root,path){
  const names=parts(path);let parent=root;
  try{
    for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name);
    const name=names.at(-1);
    try{
      const handle=await parent.getFileHandle(name),file=await handle.getFile();
      return {type:'file',bytes:file.size<=MAX_SD_BYTES?new Uint8Array(await file.arrayBuffer()):null};
    }catch(error){
      if(error.name!=='TypeMismatchError')throw error;
      await parent.getDirectoryHandle(name);return {type:'directory'};
    }
  }catch(error){
    if(error.name==='NotFoundError')return null;
    if(error.name==='TypeMismatchError')return {type:'blocked'};
    throw error;
  }
}
const equivalent=(a,b)=>!a&&!b||Boolean(a&&b&&a.type===b.type&&(a.type!=='file'||same(a.bytes,b.bytes)));

export async function planDirectoryWrite(image,association,options={}){
  if(!association?.handle)fail('directoryPath');
  const tree=readSDTree(image),mapping=new Map(association.mappings.map(entry=>[entry.card,entry.source]));
  const baseline=new Map(association.baseline.map(entry=>[entry.source,entry])),entries=[],seen=new Set();
  function sourcePath(card){
    if(mapping.has(card))return mapping.get(card);
    const slash=card.lastIndexOf('/'),parent=slash>0?sourcePath(card.slice(0,slash)):'';
    return (parent?parent+'/':'')+component(card.slice(slash+1));
  }
  tree.sort((a,b)=>a.path.split('/').length-b.path.split('/').length||compare(a.path,b.path));
  for(const entry of tree){
    guard(options);
    const source=sourcePath(entry.path);
    if(seen.has(source))fail('directoryPath');seen.add(source);
    const before=await existing(association.handle,source),original=baseline.get(source);
    let action;
    if(!before)action=original?'conflict':'create';
    else if(equivalent(before,entry))action='unchanged';
    else if(entry.type==='file'&&before.type==='file'&&original&&equivalent(before,original))action='update';
    else action='conflict';
    entries.push({...entry,source,card:entry.path,before,action});progress(options,entries.length,0);
  }
  return {association,entries,retained:association.baseline.filter(entry=>!seen.has(entry.source)).length};
}

export async function writeDirectoryPlan(plan,options={}){
  const {association}=plan,root=association.handle,completed=[],conflicts=[],failed=[],blocked=[];
  const baseline=new Map(association.baseline.map(entry=>[entry.source,entry])),mapping=new Map(association.mappings.map(entry=>[entry.card,entry]));
  for(const entry of plan.entries){
    guard(options);
    if(entry.action==='conflict'||blocked.some(path=>entry.source.startsWith(path+'/'))){conflicts.push(entry.source);if(entry.type==='directory')blocked.push(entry.source);continue;}
    if(entry.action==='unchanged')continue;
    try{
      // Re-read each destination immediately before writing. A new file or an
      // externally edited destination is preserved even after preview.
      if(!equivalent(await existing(root,entry.source),entry.before)){conflicts.push(entry.source);if(entry.type==='directory')blocked.push(entry.source);continue;}
      const names=parts(entry.source);let parent=root;
      for(const name of names.slice(0,-1))parent=await parent.getDirectoryHandle(name);
      if(entry.type==='directory')await parent.getDirectoryHandle(names.at(-1),{create:true});
      else{
        const handle=await parent.getFileHandle(names.at(-1),{create:true}),stream=await handle.createWritable();
        try{await stream.write(entry.bytes);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}
      }
      completed.push(entry.source);
      baseline.set(entry.source,{source:entry.source,type:entry.type,...(entry.type==='file'?{bytes:entry.bytes}:{})});
      mapping.set(entry.card,{card:entry.card,source:entry.source,type:entry.type});
    }catch(error){failed.push({path:entry.source,error:error.name||'Error'});if(entry.type==='directory')blocked.push(entry.source);}
    progress(options,completed.length,0);
  }
  return {completed,conflicts,failed,association:{...association,baseline:[...baseline.values()],mappings:[...mapping.values()]}};
}
