// SPDX-License-Identifier: MIT
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Button,Group,Stack,Switch,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {SDCardFiles} from './SDCardFiles.jsx';
import {DirectoryStore} from './directory-storage.js';
import {matchesDirectoryCard} from './directory-sync.js';
import {requestDirectoryPermission} from './directory-card.js';
export function SDCard({controller,state,onClose}){
  const {t}=useTranslation(),input=useRef(null),[readOnly,setReadOnly]=useState(false),[editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(null),[savedDirectory,setSavedDirectory]=useState(null),[localBusy,setLocalBusy]=useState(false);
  const store=useMemo(()=>new DirectoryStore(),[]),resume=useRef(false),hash=state.model.hash;
  const card=state.sd,present=Boolean(card?.present),disabled=state.busy||localBusy||Boolean(state.transfer?.active||state.uploadBatch?.active);
  const bridgeActive=Boolean(state.hostBridge?.active),mediaDisabled=disabled||bridgeActive;
  useEffect(()=>{if(present)setEditing(false);
    if(present&&!state.busy&&resume.current){resume.current=false;if(!state.running&&controller.mayRun(state.prefs))controller.send('run');}
  },[present,state.busy]);
  useEffect(()=>{setDraft(null);setEditing(false);setLocalBusy(false);resume.current=false;},[controller.generation]);
  useEffect(()=>{let current=true;setSavedDirectory(null);void store.read(hash).then(value=>{if(current)setSavedDirectory(value);}).catch(()=>{});
    return()=>{current=false;};},[store,hash]);
  async function editCard(sync=false){
    if(mediaDisabled)return;const generation=controller.generation;
    setLocalBusy(true);
    try{
      const candidate=controller.sdDirectory||savedDirectory?.association;
      if(sync&&candidate)await requestDirectoryPermission(candidate.handle,'read');
      if(generation!==controller.generation||controller.dead)return;
      resume.current=Boolean(sync&&controller.state.running);if(sync)controller.pause();
      const next=await controller.editSD();if(!next||generation!==controller.generation){resume.current=false;return;}
      if(!next.association&&savedDirectory&&matchesDirectoryCard(next.bytes,savedDirectory.association))next.association=savedDirectory.association;
      if(sync&&!next.association){resume.current=false;controller.report('sdDirectoryMismatch');}
      setDraft({...next,sync:Boolean(sync&&next.association)});setReadOnly(next.writeProtected);setEditing(true);
    }catch(error){if(generation===controller.generation){resume.current=false;controller.report(error.code?'sdFs_'+error.code:'sdFs_directoryRead');}}
    finally{if(generation===controller.generation)setLocalBusy(false);}
  }
  return <section aria-label={t('sdTitle')}>
    <Stack>
      <Text role="status">{present?t('sdPresent',{size:card.bytes/1024/1024}):t('sdEmpty')}</Text>
      {bridgeActive&&<Text size="sm" c="dimmed">{t('sdHostBridgeBusy')}</Text>}
      {!present&&<Switch label={t('sdReadOnly')} checked={readOnly} onChange={e=>setReadOnly(e.currentTarget.checked)} disabled={disabled}/>}
      {present?<>
        <Group gap="xs"><Text size="sm">{state.sdName||'orchard-sd.img'}</Text><Text size="sm" c="dimmed">{t(card.writeProtected?'sdReadOnly':'sdWritable')}</Text></Group>
        <Text size="sm" c="dimmed">{t('sdActivity',{reads:card.readBlocks,writes:card.writtenBlocks})}</Text>
        {card.dirty&&<Text size="sm">{t('sdChanged')}</Text>}
        {controller.sdDirectory&&<Text size="sm">{t('sdDirectoryLinked',{name:controller.sdDirectory.name})}</Text>}
        {(controller.sdDirectory||savedDirectory)&&<Button disabled={mediaDisabled} onClick={()=>void editCard(true)}>{t('sdDirectorySyncMounted')}</Button>}
        <Group><Button disabled={mediaDisabled} onClick={()=>controller.exportSD()}>{t('sdExport')}</Button>
          <Button variant="default" disabled={mediaDisabled} onClick={()=>controller.ejectSD()}>{t('sdEject')}</Button>
          <Button variant="default" disabled={mediaDisabled} onClick={()=>void editCard(false)}>{t('sdEditEject')}</Button></Group>
      </>:editing?<SDCardFiles disabled={disabled} insertDisabled={bridgeActive} download={controller.download} initialDraft={draft}
        store={store} storageKey={hash} savedDirectory={savedDirectory} onSaved={setSavedDirectory}
        onBack={()=>{setDraft(null);setEditing(false);resume.current=false;}}
        onInsert={(bytes,name,association)=>controller.insertSD(new File([bytes],name),readOnly,association)}/>:<>
        <Group><Button disabled={mediaDisabled} onClick={()=>controller.insertSD(null,readOnly)}>{t('sdCreate')}</Button>
          <Button variant="default" disabled={mediaDisabled} onClick={()=>{input.current.value='';input.current.click();}}>{t('sdImport')}</Button></Group>
        <Button variant="default" disabled={disabled} onClick={()=>{setDraft(null);setEditing(true);}}>{t('sdPrepareFiles')}</Button>
        <Text size="sm" c="dimmed">{t('sdImageHelp')}</Text>
      </>}
      <input ref={input} id="sd-image-file" type="file" hidden onChange={e=>{if(e.target.files[0])void controller.insertSD(e.target.files[0],readOnly);}}/>
    </Stack>
  </section>;
}
