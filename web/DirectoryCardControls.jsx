// SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Alert,Button,Group,Pagination,Select,Stack,Table,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {sdImageName} from './sd-card.js';
import {readDirectoryHandle,readDirectoryFiles,createDirectoryCard,requestDirectoryPermission,
  planDirectoryWrite,writeDirectoryPlan} from './directory-card.js';

export function DirectoryCardControls({image,association,disabled,onDraft,onAssociation,onBusy}){
  const {t}=useTranslation(),input=useRef(null),epoch=useRef(0),lastProgress=useRef(0);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState(null),[progress,setProgress]=useState(null);
  const [size,setSize]=useState('16'),[snapshot,setSnapshot]=useState(null),[preview,setPreview]=useState(null),[page,setPage]=useState(1);
  const [writePlan,setWritePlan]=useState(null),[written,setWritten]=useState(null),[writePage,setWritePage]=useState(1);
  useEffect(()=>()=>{++epoch.current;},[]);
  useEffect(()=>{setWritePlan(null);},[image,association]);
  useEffect(()=>{setWritten(null);},[image]);
  const locked=disabled||busy;
  const problem=error=>setFailure({code:error.code||(error.name==='NotAllowedError'?'directoryPermission':'directoryRead'),details:error.details||{}});
  async function run(operation){
    if(locked)return;
    const token=++epoch.current;setBusy(true);onBusy(true);setFailure(null);setProgress(null);lastProgress.current=0;
    const options={isCurrent:()=>token===epoch.current,onProgress:value=>{
      if(Date.now()-lastProgress.current>80){lastProgress.current=Date.now();setProgress(value);}
    }};
    try{await operation(options);}catch(error){if(token===epoch.current&&error.name!=='AbortError'&&error.code!=='directoryCancelled')problem(error);}
    finally{if(token===epoch.current){setBusy(false);onBusy(false);setProgress(null);}}
  }
  function prepare(source,nextSize=size){
    setSnapshot(source);setPreview(null);setWritePlan(null);setWritten(null);setPage(1);
    const previous=source.handle===association?.handle?association:null;
    const prepared=createDirectoryCard(source,Number(nextSize)*1024*1024,previous);
    setPreview(prepared);
  }
  function choose(){
    if(locked)return;
    if(typeof globalThis.showDirectoryPicker!=='function'){input.current.value='';input.current.click();return;}
    void run(async options=>{
      const handle=await globalThis.showDirectoryPicker({id:'orchard-sd',mode:'read'});
      const source=await readDirectoryHandle(handle,options);
      if(options.isCurrent())prepare(source);
    });
  }
  const changes=writePlan?.entries.filter(entry=>entry.action!=='unchanged')||[];
  const writes=changes.filter(entry=>['create','update'].includes(entry.action)).length;
  return <Stack gap="xs" data-testid="sd-directory-controls">
    <Text fw={600} size="sm">{t('sdDirectoryTitle')}</Text>
    <Text size="xs" c="dimmed">{t('sdDirectoryHelp')}</Text>
    {failure&&<Alert color="red" role="alert">{t('sdFs_'+failure.code,{...failure.details,defaultValue:t('sdFs_directoryRead')})}</Alert>}
    <Group align="end" gap="xs">
      <Button variant="default" disabled={locked} onClick={choose}>{t('sdDirectoryChoose')}</Button>
      <Select label={t('sdDirectorySize')} value={size} data={[{value:'16',label:'16 MiB'},{value:'32',label:'32 MiB'}]}
        allowDeselect={false} disabled={locked} w={110} onChange={value=>{
          if(!value)return;setSize(value);setFailure(null);
          if(snapshot)try{prepare(snapshot,value);}catch(error){problem(error);}
        }}/>
    </Group>
    {busy&&<Text size="sm" role="status">{progress?t('sdDirectoryProgress',{count:progress.entries,bytes:progress.bytes.toLocaleString()}):t('loading')}</Text>}
    {preview&&<Stack gap="xs" data-testid="sd-directory-preview">
      <Text size="sm">{t('sdDirectoryPreview',{name:preview.name,count:preview.mappings.length,bytes:preview.totalBytes.toLocaleString(),size})}</Text>
      <Text size="xs" c="dimmed">{t('sdDirectoryMappingHelp')}</Text>
      {preview.fallback&&<Alert color="yellow">{t('sdDirectoryFallback')}</Alert>}
      <Table.ScrollContainer minWidth={260}><Table withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>{t('sdDirectorySource')}</Table.Th><Table.Th>{t('sdDirectoryTarget')}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{preview.mappings.slice((page-1)*25,page*25).map(entry=><Table.Tr key={entry.source}>
          <Table.Td style={{overflowWrap:'anywhere',maxWidth:260}}>{entry.source}{entry.type==='directory'?'/':''}</Table.Td>
          <Table.Td style={{overflowWrap:'anywhere',maxWidth:260}}><code>{entry.card}{entry.type==='directory'?'/':''}</code></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>
      {preview.mappings.length>25&&<Pagination total={Math.ceil(preview.mappings.length/25)} value={page} onChange={setPage} disabled={locked} size="sm"/>}
      <Text size="xs" c="dimmed">{t('sdDirectoryReplaceHelp')}</Text>
      <Group gap="xs"><Button disabled={locked} onClick={()=>{
        onDraft({bytes:preview.bytes,name:sdImageName(preview.name),association:preview.association});setSnapshot(null);setPreview(null);
      }}>{t('sdDirectoryApply')}</Button><Button disabled={locked} variant="subtle" onClick={()=>{setSnapshot(null);setPreview(null);}}>{t('cancel')}</Button></Group>
    </Stack>}
    {association&&<Stack gap="xs" data-testid="sd-directory-association">
      <Text size="sm" fw={600}>{t('sdDirectoryLinked',{name:association.name})}</Text>
      <Text size="xs" c="dimmed">{t('sdDirectorySyncHelp')}</Text>
      <Group gap="xs">
        <Button variant="default" disabled={locked} onClick={()=>void run(async options=>{
          await requestDirectoryPermission(association.handle,'read');
          const source=await readDirectoryHandle(association.handle,options);
          if(options.isCurrent())prepare(source);
        })}>{t('sdDirectoryReload')}</Button>
        <Button variant="default" disabled={locked} onClick={()=>void run(async options=>{
          await requestDirectoryPermission(association.handle,'read');
          const plan=await planDirectoryWrite(image,association,options);
          if(options.isCurrent()){setWritePlan(plan);setWritePage(1);setWritten(null);}
        })}>{t('sdDirectoryReviewWrite')}</Button>
      </Group>
      {writePlan&&<Stack gap="xs" data-testid="sd-directory-write-plan">
        <Text size="sm">{t('sdDirectoryWriteSummary',{count:writes,conflicts:changes.filter(entry=>entry.action==='conflict').length,retained:writePlan.retained})}</Text>
        {changes.length>0&&<Table.ScrollContainer minWidth={260}><Table withTableBorder>
          <Table.Thead><Table.Tr><Table.Th>{t('sdDirectorySource')}</Table.Th><Table.Th>{t('sdDraftAction')}</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{changes.slice((writePage-1)*25,writePage*25).map(entry=><Table.Tr key={entry.card}>
            <Table.Td style={{overflowWrap:'anywhere',maxWidth:300}}>{entry.source}</Table.Td>
            <Table.Td>{t('sdDirectoryAction_'+entry.action)}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer>}
        {changes.length>25&&<Pagination total={Math.ceil(changes.length/25)} value={writePage} onChange={setWritePage} disabled={locked} size="sm"/>}
        <Text size="xs" c="dimmed">{t('sdDirectoryConflictHelp')}</Text>
        <Group gap="xs"><Button disabled={locked||!writes} onClick={()=>void run(async options=>{
          await requestDirectoryPermission(association.handle,'readwrite');
          const result=await writeDirectoryPlan(writePlan,options);
          if(options.isCurrent()){onAssociation(result.association);setWritePlan(null);setWritten(result);}
        })}>{t('sdDirectoryWrite',{count:writes})}</Button>
          <Button disabled={locked} variant="subtle" onClick={()=>setWritePlan(null)}>{t('cancel')}</Button></Group>
      </Stack>}
      {written&&<Alert color={written.failed.length||written.conflicts.length?'yellow':'green'} role="status">
        <Text size="sm">{t('sdDirectoryWritten',{count:written.completed.length,conflicts:written.conflicts.length,failed:written.failed.length})}</Text>
        {written.conflicts.length>0&&<Text size="xs" style={{overflowWrap:'anywhere'}}>{t('sdDirectoryKeptPaths',{paths:written.conflicts.join(', ')})}</Text>}
        {written.failed.length>0&&<Text size="xs" style={{overflowWrap:'anywhere'}}>{t('sdDirectoryFailedPaths',{paths:written.failed.map(entry=>entry.path).join(', ')})}</Text>}
      </Alert>}
    </Stack>}
    <input ref={input} id="sd-directory-input" type="file" multiple webkitdirectory="" directory="" hidden onChange={e=>{
      const files=Array.from(e.target.files);if(files.length)void run(async options=>{
        const source=await readDirectoryFiles(files,options);if(options.isCurrent())prepare(source);
      });
    }}/>
  </Stack>;
}
