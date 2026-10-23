// SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Button,Group,Stack,Switch,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {SDCardFiles} from './SDCardFiles.jsx';
export function SDCard({controller,state,onClose}){
  const {t}=useTranslation(),input=useRef(null),[readOnly,setReadOnly]=useState(false),[editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(null);
  const card=state.sd,present=Boolean(card?.present),disabled=state.busy||Boolean(state.transfer?.active||state.uploadBatch?.active);
  const bridgeActive=Boolean(state.hostBridge?.active),mediaDisabled=disabled||bridgeActive;
  useEffect(()=>{if(present)setEditing(false);},[present]);
  useEffect(()=>{setDraft(null);setEditing(false);},[controller.generation]);
  async function editCard(){const next=await controller.editSD();if(next){setDraft(next);setReadOnly(next.writeProtected);setEditing(true);}}
  return <section aria-label={t('sdTitle')}>
    <Stack>
      <Text role="status">{present?t('sdPresent',{size:card.bytes/1024/1024}):t('sdEmpty')}</Text>
      {bridgeActive&&<Text size="sm" c="dimmed">{t('sdHostBridgeBusy')}</Text>}
      {!present&&<Switch label={t('sdReadOnly')} checked={readOnly} onChange={e=>setReadOnly(e.currentTarget.checked)} disabled={disabled}/>}
      {present?<>
        <Text size="sm">{state.sdName||'orchard-sd.img'} · {t(card.writeProtected?'sdReadOnly':'sdWritable')}</Text>
        <Text size="sm" c="dimmed">{t('sdActivity',{reads:card.readBlocks,writes:card.writtenBlocks})}</Text>
        {card.dirty&&<Text size="sm">{t('sdChanged')}</Text>}
        {controller.sdDirectory&&<Text size="sm">{t('sdDirectoryMounted',{name:controller.sdDirectory.name})}</Text>}
        <Group><Button disabled={mediaDisabled} onClick={()=>controller.exportSD()}>{t('sdExport')}</Button>
          <Button variant="default" disabled={mediaDisabled} onClick={()=>controller.ejectSD()}>{t('sdEject')}</Button>
          <Button variant="default" disabled={mediaDisabled} onClick={()=>void editCard()}>{t('sdEditEject')}</Button></Group>
      </>:editing?<SDCardFiles disabled={disabled} insertDisabled={bridgeActive} download={controller.download} initialDraft={draft} onBack={()=>{setDraft(null);setEditing(false);}}
        onInsert={(bytes,name,association)=>controller.insertSD(new File([bytes],name),readOnly,association)}/>:<>
        <Group><Button disabled={mediaDisabled} onClick={()=>controller.insertSD(null,readOnly)}>{t('sdCreate')}</Button>
          <Button variant="default" disabled={mediaDisabled} onClick={()=>{input.current.value='';input.current.click();}}>{t('sdImport')}</Button></Group>
        <Button variant="default" disabled={disabled} onClick={()=>{setDraft(null);setEditing(true);}}>{t('sdPrepareFiles')}</Button>
        <Text size="sm" c="dimmed">{t('sdImageHelp')}</Text>
      </>}
      <Text size="sm" c="dimmed">{t('sdHelp')}</Text>
      <input ref={input} id="sd-image-file" type="file" hidden onChange={e=>{if(e.target.files[0])void controller.insertSD(e.target.files[0],readOnly);}}/>
    </Stack>
  </section>;
}
