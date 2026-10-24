// SPDX-License-Identifier: MIT
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Button,Group,Stack,Switch,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {SDCardFiles} from './SDCardFiles.jsx';
import {DirectoryStore} from './directory-storage.js';
import {matchesDirectoryCard} from './directory-sync.js';
import {requestDirectoryPermission} from './directory-card.js';
export function SDCard({controller,state,onClose}){
  const {t,i18n}=useTranslation(),input=useRef(null),[readOnly,setReadOnly]=useState(false),[editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(null),[savedDirectory,setSavedDirectory]=useState(null),[localBusy,setLocalBusy]=useState(false);
  const [draftRevision,setDraftRevision]=useState(0);
  const store=useMemo(()=>new DirectoryStore(),[]),resume=useRef(null),sync=useRef(null),hash=state.model.hash;
  const card=state.sd,present=Boolean(card?.present),disabled=state.busy||localBusy||Boolean(state.transfer?.active||state.uploadBatch?.active);
  const bridgeActive=Boolean(state.hostBridge?.active),mediaDisabled=disabled||bridgeActive;
  const current=transaction=>transaction&&!controller.dead&&transaction.generation===controller.generation&&transaction.epoch===controller.state.sessionEpoch;
  function directoryProblem(error,fallback='sdFs_directoryRead'){
    const key=typeof error?.code==='string'?'sdFs_'+error.code:null;
    // DOMException.code is a legacy number, not one of our translated keys.
    controller.report(key&&i18n.exists(key)?key:error?.name==='NotAllowedError'&&fallback==='sdFs_directoryRead'?'sdFs_directoryPermission':fallback);
  }
  useEffect(()=>{
    if(present&&!state.busy){
      const transaction=resume.current;resume.current=null;sync.current=null;setDraft(null);setEditing(false);
      if(current(transaction)&&transaction.running&&!state.running&&!state.stopped&&controller.mayRun(state.prefs))controller.send('run');
    }else if(!state.busy&&state.note!=='sdInserted'&&sync.current?.restoring){sync.current.restoring=false;resume.current=null;}
  },[present,state.busy]);
  useEffect(()=>{setDraft(null);setEditing(false);setLocalBusy(false);resume.current=null;sync.current=null;},[controller.generation,state.sessionEpoch]);
  useEffect(()=>{let current=true;setSavedDirectory(null);void store.read(hash).then(value=>{if(current)setSavedDirectory(value);}).catch(()=>{});
    return()=>{current=false;};},[store,hash]);
  async function editCard(synchronize=false){
    if(mediaDisabled)return;const transaction={generation:controller.generation,epoch:controller.state.sessionEpoch,running:Boolean(synchronize&&controller.state.running)};
    setLocalBusy(true);
    try{
      const candidate=controller.sdDirectory||savedDirectory?.association;
      if(synchronize&&candidate)await requestDirectoryPermission(candidate.handle,'read');
      if(!current(transaction))return;
      resume.current=synchronize?transaction:null;if(synchronize)controller.pause();
      const next=await controller.editSD();if(!next||!current(transaction)){if(current(transaction))resume.current=null;return;}
      if(!next.association&&savedDirectory&&matchesDirectoryCard(next.bytes,savedDirectory.association))next.association=savedDirectory.association;
      sync.current=synchronize?{...transaction,original:{...next,bytes:next.bytes.slice()},applied:false,restoring:false}:null;
      if(synchronize&&!next.association)controller.report('sdDirectoryMismatch');
      setDraft({...next,sync:Boolean(synchronize&&next.association)});setReadOnly(next.writeProtected);setEditing(true);
    }catch(error){if(current(transaction)){resume.current=null;directoryProblem(error);}}
    finally{if(current(transaction))setLocalBusy(false);}
  }
  async function cancelSync(){
    const transaction=sync.current;
    if(!current(transaction)||transaction.applied||transaction.restoring||mediaDisabled||!controller.state.ready)return;
    transaction.restoring=true;setLocalBusy(true);
    try{
      const original=transaction.original;
      // Restore the visible draft before any fallible storage/Worker handoff.
      // SDCardFiles owns local image state, so a new key is required when a
      // different folder was selected while the original card was ejected.
      setDraft({...original,bytes:original.bytes.slice(),sync:false});setReadOnly(original.writeProtected);
      setDraftRevision(value=>value+1);
      // A different folder may have been previewed while this card was out.
      // Saving its original association is best effort: an IndexedDB failure
      // must not prevent restoring the original media in memory.
      if(original.association){
        try{
          const record=await store.write(hash,original.association,()=>current(transaction));
          if(!current(transaction))return;if(record)setSavedDirectory(record);
        }catch(error){if(!current(transaction))return;directoryProblem(error,'sdFs_directoryStorage');}
      }
      if(!current(transaction))return;
      resume.current=transaction;
      if(!await controller.insertSD(new File([original.bytes],original.name),original.writeProtected,original.association)){
        if(current(transaction)){transaction.restoring=false;resume.current=null;}
      }
    }catch(error){if(current(transaction)){transaction.restoring=false;resume.current=null;directoryProblem(error);}}
    finally{if(current(transaction))setLocalBusy(false);}
  }
  function back(){
    if(current(sync.current)&&!sync.current.applied){void cancelSync();return;}
    setDraft(null);setEditing(false);resume.current=null;sync.current=null;
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
      </>:editing?<SDCardFiles key={draftRevision} disabled={disabled} insertDisabled={bridgeActive} download={controller.download} initialDraft={draft}
        store={store} storageKey={hash} savedDirectory={savedDirectory} onSaved={setSavedDirectory}
        onBack={back} onSyncCancel={current(sync.current)&&!sync.current.applied?cancelSync:undefined}
        onSyncApply={()=>{if(sync.current)sync.current.applied=true;setDraft(value=>value?{...value,syncApplied:true}:value);}}
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
