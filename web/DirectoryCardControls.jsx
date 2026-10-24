// SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Alert,Button,Group,NativeSelect,Pagination,Select,Stack,Table,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {sdImageName} from './sd-card.js';
import {readDirectoryHandle,readDirectoryFiles,createDirectoryCard,requestDirectoryPermission} from './directory-card.js';
import {identifyDirectoryCard,planDirectorySync,applyDirectorySync,directorySyncSummary} from './directory-sync.js';

export function DirectoryCardControls({image,association,disabled,onDraft,onAssociation,onBusy,
  store,storageKey,savedDirectory,onSaved,autoSync=false,onSyncInsert,onSyncCancel,onSyncApply}){
  const {t}=useTranslation(),input=useRef(null),epoch=useRef(0),lastProgress=useRef(0),automatic=useRef(false),working=useRef(false);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState(null),[progress,setProgress]=useState(null);
  const [size,setSize]=useState(image.length===32*1024*1024?'32':'16'),[snapshot,setSnapshot]=useState(null),[preview,setPreview]=useState(null),[page,setPage]=useState(1);
  const [plan,setPlan]=useState(null),[choices,setChoices]=useState({}),[result,setResult]=useState(null),[syncPage,setSyncPage]=useState(1);
  useEffect(()=>()=>{++epoch.current;},[]);
  useEffect(()=>{setPlan(null);setChoices({});},[image,association]);
  const locked=disabled||busy;
  const problem=error=>setFailure({code:error.code||(error.name==='NotAllowedError'?'directoryPermission':'directoryRead'),details:error.details||{}});
  async function run(operation){
    if(locked||working.current)return;
    working.current=true;
    const token=++epoch.current;setBusy(true);onBusy(true);setFailure(null);setProgress(null);lastProgress.current=0;
    const options={isCurrent:()=>token===epoch.current,onProgress:value=>{
      if(Date.now()-lastProgress.current>80){lastProgress.current=Date.now();setProgress(value);}
    }};
    try{await operation(options);}catch(error){if(token===epoch.current&&error.name!=='AbortError'&&error.code!=='directoryCancelled')problem(error);}
    finally{working.current=false;if(token===epoch.current){setBusy(false);onBusy(false);setProgress(null);}}
  }
  async function remember(next,options){
    if(!store||!storageKey||!next)return true;
    try{const record=await store.write(storageKey,next,options.isCurrent);if(record&&options.isCurrent())onSaved?.(record);return Boolean(record);}
    catch(error){if(options.isCurrent())problem(error);return false;}
  }
  function prepare(source,nextSize=size,previous=association){
    setSnapshot(source);setPreview(null);setPlan(null);setResult(null);setPage(1);
    const prepared=createDirectoryCard(source,Number(nextSize)*1024*1024,source.handle===previous?.handle?previous:null);
    prepared.association=identifyDirectoryCard(prepared.bytes,prepared.association);
    setPreview(prepared);
  }
  function choose(){
    if(locked)return;
    if(typeof globalThis.showDirectoryPicker!=='function'){input.current.value='';input.current.click();return;}
    void run(async options=>{
      const handle=await globalThis.showDirectoryPicker({id:'orchard-sd',mode:'read'}),source=await readDirectoryHandle(handle,options);
      if(options.isCurrent())prepare(source);
    });
  }
  async function previewSync(options){
    const next=await planDirectorySync(image,association,options);
    if(options.isCurrent()){setPlan(next);setChoices({});setSyncPage(1);setResult(null);}
  }
  useEffect(()=>{
    if(autoSync&&association&&!automatic.current){automatic.current=true;void run(previewSync);}
  },[autoSync,association]);
  const changes=plan?.entries.filter(entry=>entry.direction!=='same'&&!entry.group)||[];
  const summary=plan?directorySyncSummary(plan,choices):null;
  const changeAction=entry=>{
    const side=entry.direction==='conflict'?(choices[entry.source]||'keep'):entry.direction;
    if(side==='keep')return t('sdDirectoryKeepBoth');
    const target=side==='local'?entry.local:entry.card,previous=side==='local'?entry.card:entry.local;
    return t('sdDirectorySync_'+side+'_'+(!target?'delete':!previous?'create':'update'));
  };
  return <Stack gap="xs" data-testid="sd-directory-controls">
    <Group justify="space-between" gap="xs"><Text fw={600} size="sm">{association?association.name:t('sdDirectoryTitle')}</Text>
      {association&&<Button variant="subtle" size="compact-xs" disabled={locked} onClick={()=>void run(async options=>{
        if(store&&storageKey)await store.forget(storageKey);
        if(options.isCurrent()){onAssociation(null);onSaved?.(null);setResult(null);}
      })}>{t('sdDirectoryForget')}</Button>}
    </Group>
    {failure&&<Alert color="red" role="alert">{t('sdFs_'+failure.code,{...failure.details,defaultValue:t('sdFs_directoryRead')})}</Alert>}
    <Group align="end" gap="xs">
      <Button variant="default" disabled={locked} onClick={choose}>{t('sdDirectoryChoose')}</Button>
      <Select label={t('sdDirectorySize')} value={size} data={[{value:'16',label:'16 MiB'},{value:'32',label:'32 MiB'}]}
        allowDeselect={false} disabled={locked} w={110} onChange={value=>{
          if(!value)return;setSize(value);setFailure(null);
          if(snapshot)try{prepare(snapshot,value);}catch(error){problem(error);}
        }}/>
      {!association&&savedDirectory&&<Button variant="default" disabled={locked} onClick={()=>void run(async options=>{
        await requestDirectoryPermission(savedDirectory.association.handle,'read');
        const source=await readDirectoryHandle(savedDirectory.association.handle,options);
        if(options.isCurrent())prepare(source,size,savedDirectory.association);
      })}>{t('sdDirectoryReopen',{name:savedDirectory.association.name})}</Button>}
      {association&&<Button variant="default" disabled={locked} onClick={()=>void run(async options=>{
        await requestDirectoryPermission(association.handle,'read');await previewSync(options);
      })}>{t('sdDirectorySyncPreview')}</Button>}
    </Group>
    {busy&&<Text size="sm" role="status">{progress?t('sdDirectoryProgress',{count:progress.entries,bytes:progress.bytes.toLocaleString()}):t('loading')}</Text>}
    {preview&&<Stack gap="xs" data-testid="sd-directory-preview">
      <Text size="sm">{t('sdDirectoryPreview',{name:preview.name,count:preview.mappings.length,bytes:preview.totalBytes.toLocaleString(),size})}</Text>
      {preview.fallback&&<Alert color="yellow">{t('sdDirectoryFallback')}</Alert>}
      <Table.ScrollContainer minWidth={260}><Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>{t('sdDirectorySource')}</Table.Th><Table.Th>{t('sdDirectoryTarget')}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{preview.mappings.slice((page-1)*25,page*25).map(entry=><Table.Tr key={entry.source}>
          <Table.Td style={{overflowWrap:'anywhere',maxWidth:260}}>{entry.source}{entry.type==='directory'?'/':''}</Table.Td>
          <Table.Td style={{overflowWrap:'anywhere',maxWidth:260}}><code>{entry.card}{entry.type==='directory'?'/':''}</code></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>
      {preview.mappings.length>25&&<Pagination total={Math.ceil(preview.mappings.length/25)} value={page} onChange={setPage} disabled={locked} size="sm"/>}
      <Group gap="xs"><Button disabled={locked} onClick={()=>void run(async options=>{
        await remember(preview.association,options);if(!options.isCurrent())return;
        onDraft({bytes:preview.bytes,name:sdImageName(preview.name),association:preview.association});setSnapshot(null);setPreview(null);
      })}>{t('sdDirectoryApply')}</Button><Button disabled={locked} variant="subtle" onClick={()=>{setSnapshot(null);setPreview(null);}}>{t('cancel')}</Button></Group>
    </Stack>}
    {plan&&<Stack gap="xs" data-testid="sd-directory-sync-plan">
      <Text size="sm">{t('sdDirectorySyncSummary',summary)}</Text>
      {changes.length>0&&<Table.ScrollContainer minWidth={290}><Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>{t('sdDirectorySource')}</Table.Th><Table.Th>{t('sdDraftAction')}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{changes.slice((syncPage-1)*20,syncPage*20).map(entry=><Table.Tr key={entry.source}>
          <Table.Td style={{overflowWrap:'anywhere',maxWidth:220}}>{entry.source}</Table.Td>
          <Table.Td>{entry.direction==='conflict'?<NativeSelect aria-label={t('sdDirectoryResolve',{path:entry.source})} value={choices[entry.source]||'keep'}
            data={[{value:'keep',label:t('sdDirectoryKeepBoth')},{value:'local',label:t('sdDirectoryUseLocal')},{value:'card',label:t('sdDirectoryUseCard')}]}
            disabled={locked} onChange={e=>{const value=e.currentTarget.value;setChoices(current=>({...current,[entry.source]:value}));}}/>:<Text size="sm">{changeAction(entry)}</Text>}</Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>}
      {changes.length>20&&<Pagination total={Math.ceil(changes.length/20)} value={syncPage} onChange={setSyncPage} disabled={locked} size="sm"/>}
      {summary.deletions>0&&<Text size="sm" c="red">{t('sdDirectoryDeletionCount',{count:summary.deletions})}</Text>}
      {summary.conflicts>0&&<Text size="xs" c="dimmed">{t('sdDirectoryUnresolved')}</Text>}
      <Group gap="xs"><Button disabled={locked} onClick={()=>void run(async options=>{
        if(summary.toLocal>0)await requestDirectoryPermission(association.handle,'readwrite');
        if(!options.isCurrent())return;onSyncApply?.();
        const next=await applyDirectorySync(plan,choices,options);
        next.association=identifyDirectoryCard(next.bytes,next.association);
        const saved=await remember(next.association,options);if(!options.isCurrent())return;
        onDraft({bytes:next.bytes,name:sdImageName(association.name),association:next.association});setPlan(null);setResult(next);
        if(saved&&onSyncInsert&&!next.failed.length&&!next.conflicts.length)await onSyncInsert(next.bytes,sdImageName(association.name),next.association);
      })}>{t(onSyncInsert?'sdDirectorySyncInsert':'sdDirectorySyncApply')}</Button>
        <Button variant="subtle" disabled={locked} onClick={()=>{if(onSyncCancel)void onSyncCancel();else setPlan(null);}}>{t('cancel')}</Button></Group>
    </Stack>}
    {result&&<Stack gap={4} role="status">
      <Text size="sm">{t('sdDirectorySynced',{count:result.completed.length,conflicts:result.conflicts.length,failed:result.failed.length})}</Text>
      {result.conflicts.length>0&&<Text size="xs" style={{overflowWrap:'anywhere'}}>{t('sdDirectoryKeptPaths',{paths:result.conflicts.join(', ')})}</Text>}
      {result.failed.length>0&&<Text size="xs" c="red" style={{overflowWrap:'anywhere'}}>{t('sdDirectoryFailedPaths',{paths:result.failed.map(entry=>entry.path).join(', ')})}</Text>}
    </Stack>}
    <input ref={input} id="sd-directory-input" type="file" multiple webkitdirectory="" directory="" hidden onChange={e=>{
      const files=Array.from(e.target.files||[]);void run(async options=>{const source=await readDirectoryFiles(files,options);if(options.isCurrent())prepare(source);});
    }}/>
  </Stack>;
}
