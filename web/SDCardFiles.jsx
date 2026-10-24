// SPDX-License-Identifier: MIT
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Button,Group,Pagination,Stack,Table,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {createSDImage,sdImageName,validateSDSize} from './sd-card.js';
import {listSDDirectory,readSDFile,addSDFiles,createSDDirectory,renameSDEntry,deleteSDEntry} from './sd-filesystem.js';
import {DirectoryCardControls} from './DirectoryCardControls.jsx';

// A draft owns its image bytes. Mounted SD media stays exclusively in the Worker.
export function SDCardFiles({disabled,insertDisabled=false,download,onInsert,onBack,initialDraft=null,
  store,storageKey,savedDirectory,onSaved,onSyncCancel,onSyncApply}){
  const {t}=useTranslation(),imageInput=useRef(null),filesInput=useRef(null),epoch=useRef(0);
  const [image,setImage]=useState(()=>initialDraft?.bytes||createSDImage()),[imageName,setImageName]=useState(initialDraft?.name||'orchard-sd.img');
  const [association,setAssociation]=useState(initialDraft?.association||null);
  const [path,setPath]=useState('/'),[page,setPage]=useState(1),[folder,setFolder]=useState('');
  const [selected,setSelected]=useState([]),[reading,setReading]=useState(false),[failure,setFailure]=useState(null);
  const [editing,setEditing]=useState(null);
  useEffect(()=>()=>{++epoch.current;},[]);
  const directory=useMemo(()=>listSDDirectory(image,path),[image,path]);
  const locked=disabled||reading,rows=directory.entries.slice((page-1)*50,page*50);
  const problem=error=>setFailure({code:error.code||'input',details:error.details||{}});
  const action=operation=>{setFailure(null);try{operation();}catch(error){problem(error);}};
  const changePath=next=>{setPath(next);setPage(1);setSelected([]);setEditing(null);setFailure(null);};
  const changeImage=next=>{setImage(next);setEditing(null);setPage(1);};
  const edit=(mode,entry)=>{setFailure(null);setEditing({mode,entry,name:entry.name});};
  async function openImage(file){
    if(!file||locked)return;
    const token=++epoch.current;setReading(true);setFailure(null);
    try{
      validateSDSize(file.size);const bytes=new Uint8Array(await file.arrayBuffer());
      listSDDirectory(bytes);
      if(token!==epoch.current)return;
      setImage(bytes);setImageName(sdImageName(file.name));setAssociation(null);changePath('/');
    }catch(error){if(token===epoch.current)problem(error);}
    finally{if(token===epoch.current)setReading(false);}
  }
  async function chooseFiles(files){
    if(locked||!files.length)return;
    const token=++epoch.current;setReading(true);setFailure(null);
    try{
      const list=Array.from(files);
      if(list.length>128)throw Object.assign(new Error(),{code:'limit'});
      if(list.reduce((sum,file)=>sum+file.size,0)>image.length)throw Object.assign(new Error(),{code:'full'});
      const loaded=await Promise.all(list.map(async file=>({source:file.name,name:file.name,bytes:new Uint8Array(await file.arrayBuffer())})));
      if(token===epoch.current)setSelected(loaded);
    }catch(error){if(token===epoch.current)problem(error);}
    finally{if(token===epoch.current)setReading(false);}
  }
  async function save(bytes,name){try{await download(bytes,name);setFailure(null);}catch{setFailure({code:'download',details:{}});}}
  return <Stack data-testid="sd-file-editor" gap="sm">
    <Text fw={600}>{t('sdDraftTitle')}</Text>
    {failure&&<Alert color="red" role="alert">{t('sdFs_'+failure.code,{...failure.details,defaultValue:t('sdFs_input')})}</Alert>}
    <TextInput label={t('sdDraftImageName')} value={imageName} onChange={e=>setImageName(e.currentTarget.value)} disabled={locked}/>
    <Group gap="xs">
      <Button variant="default" disabled={locked} onClick={()=>{imageInput.current.value='';imageInput.current.click();}}>{t('sdDraftOpen')}</Button>
      <Button variant="subtle" disabled={locked} onClick={()=>action(()=>{setImage(createSDImage());setImageName('orchard-sd.img');setAssociation(null);changePath('/');})}>{t('sdDraftBlank')}</Button>
    </Group>
    <DirectoryCardControls image={image} association={association} disabled={locked} onBusy={setReading} onAssociation={setAssociation}
      store={store} storageKey={storageKey} savedDirectory={savedDirectory} onSaved={onSaved}
      autoSync={Boolean(initialDraft?.sync)} onSyncInsert={initialDraft?.sync?onInsert:undefined}
      onSyncCancel={initialDraft?.sync?onSyncCancel:undefined} onSyncApply={onSyncApply}
      onDraft={draft=>{setImage(draft.bytes);setImageName(draft.name);setAssociation(draft.association);setSelected([]);changePath('/');}}/>
    <Text size="sm" role="status">{t('sdDraftSpace',{size:directory.bytes/1024/1024,free:directory.freeBytes.toLocaleString()})}</Text>
    <Group justify="space-between">
      <Text component="code" size="sm" style={{overflowWrap:'anywhere'}}>{path}</Text>
      <Button size="compact-sm" variant="default" disabled={locked||path==='/'} onClick={()=>changePath(path.slice(0,path.lastIndexOf('/'))||'/')}>{t('sdDraftParent')}</Button>
    </Group>
    {rows.length?<Table.ScrollContainer minWidth={300}>
      <Table striped withTableBorder>
        <Table.Thead><Table.Tr><Table.Th>{t('sdDraftEntry')}</Table.Th><Table.Th>{t('sdDraftBytes')}</Table.Th><Table.Th>{t('sdDraftAction')}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{rows.map(entry=><Table.Tr key={entry.path}>
          <Table.Td>{entry.type==='directory'?<Button variant="subtle" size="compact-sm" disabled={locked} onClick={()=>changePath(entry.path)} aria-label={t('sdDraftOpenFolder',{name:entry.name})}>{entry.name}/</Button>:entry.name}
            {entry.hasLongName&&<Text size="xs" c="dimmed">{t('sdDraftAlias')}</Text>}</Table.Td>
          <Table.Td>{entry.type==='file'?entry.size.toLocaleString():'—'}</Table.Td>
          <Table.Td><Group gap={6}>
            {entry.type==='file'&&<Button size="compact-sm" variant="default" disabled={locked} aria-label={t('sdDraftDownloadFile',{name:entry.name})}
              onClick={()=>action(()=>{void save(readSDFile(image,entry.path),entry.name);})}>{t('downloadFile')}</Button>}
            <Button size="compact-sm" variant="subtle" disabled={locked||entry.readOnly} aria-label={t('sdDraftRenameEntry',{name:entry.name})}
              onClick={()=>edit('rename',entry)}>{t('sdDraftRename')}</Button>
            <Button size="compact-sm" variant="subtle" color="red" disabled={locked||entry.readOnly} aria-label={t('sdDraftDeleteEntry',{name:entry.name})}
              onClick={()=>edit('delete',entry)}>{t('sdDraftDelete')}</Button>
          </Group></Table.Td>
        </Table.Tr>)}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>:<Text c="dimmed" size="sm">{t('sdDraftNoFiles')}</Text>}
    {directory.entries.length>50&&<Pagination total={Math.ceil(directory.entries.length/50)} value={page} onChange={setPage} disabled={locked} size="sm"/>}
    {editing&&<Stack gap="xs" data-testid="sd-entry-action">
      {editing.mode==='rename'?<>
        <Text size="sm" fw={600}>{t('sdDraftRenameEntry',{name:editing.entry.name})}</Text>
        {editing.entry.hasLongName&&<Text size="sm">{t('sdDraftRenameLong')}</Text>}
        <TextInput label={t('sdDraftNewName')} value={editing.name} disabled={locked}
          onChange={e=>{const name=e.currentTarget.value;setEditing(value=>({...value,name}));}}/>
        <Group><Button disabled={locked||!editing.name} onClick={()=>action(()=>changeImage(renameSDEntry(image,editing.entry.path,editing.name)))}>{t('sdDraftApplyRename')}</Button>
          <Button variant="subtle" disabled={locked} onClick={()=>setEditing(null)}>{t('cancel')}</Button></Group>
      </>:<>
        <Text size="sm" fw={600}>{t('sdDraftConfirmDelete',{name:editing.entry.name})}</Text>
        <Text size="sm" c="dimmed">{t('sdDraftDeleteHelp')}</Text>
        <Group><Button color="red" disabled={locked} onClick={()=>action(()=>changeImage(deleteSDEntry(image,editing.entry.path)))}>{t('sdDraftDelete')}</Button>
          <Button variant="subtle" disabled={locked} onClick={()=>setEditing(null)}>{t('cancel')}</Button></Group>
      </>}
    </Stack>}
    <Group align="end" gap="xs">
      <TextInput label={t('sdDraftFolderName')} value={folder} onChange={e=>setFolder(e.currentTarget.value)} disabled={locked} style={{flex:'1 1 180px'}}/>
      <Button variant="default" disabled={locked||!folder} onClick={()=>action(()=>{changeImage(createSDDirectory(image,path,folder));setFolder('');})}>{t('sdDraftMakeFolder')}</Button>
    </Group>
    <Button variant="default" disabled={locked} onClick={()=>{filesInput.current.value='';filesInput.current.click();}}>{reading?t('loading'):t('sdDraftChooseFiles')}</Button>
    <Text size="xs" c="dimmed">{t('sdDraftNamesHelp')}</Text>
    {selected.length>0&&<Stack gap="xs">
      {selected.map((file,index)=><TextInput key={index} label={t('sdDraftTargetName',{name:file.source})} value={file.name} disabled={locked}
        onChange={e=>{const value=e.currentTarget.value;setSelected(list=>list.map((item,i)=>i===index?{...item,name:value}:item));}}/>)}
      <Group><Button disabled={locked} onClick={()=>action(()=>{changeImage(addSDFiles(image,path,selected));setSelected([]);})}>{t('sdDraftAddFiles',{count:selected.length})}</Button>
        <Button variant="subtle" disabled={locked} onClick={()=>setSelected([])}>{t('cancel')}</Button></Group>
    </Stack>}
    <Group>
      <Button disabled={locked||insertDisabled} onClick={()=>onInsert(image,sdImageName(imageName),association)}>{t('sdDraftInsert')}</Button>
      <Button variant="default" disabled={locked} onClick={()=>void save(image,sdImageName(imageName))}>{t('sdDraftDownload')}</Button>
      <Button variant="subtle" disabled={locked} onClick={onBack}>{t('sdDraftBack')}</Button>
    </Group>
    <input ref={imageInput} id="sd-draft-image" type="file" hidden onChange={e=>void openImage(e.target.files[0])}/>
    <input ref={filesInput} id="sd-draft-files" type="file" multiple hidden onChange={e=>void chooseFiles(e.target.files)}/>
  </Stack>;
}
