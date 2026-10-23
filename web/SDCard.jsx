// SPDX-License-Identifier: MIT
import React,{useRef,useState} from 'react';
import {Button,Group,Modal,Stack,Switch,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
export function SDCard({controller,state,onClose}){
  const {t}=useTranslation(),input=useRef(null),[readOnly,setReadOnly]=useState(false);
  const card=state.sd,present=Boolean(card?.present),disabled=state.busy||Boolean(state.transfer?.active||state.uploadBatch?.active);
  return <Modal opened trapFocus={!state.dialog} onClose={onClose} title={t('sdTitle')} closeButtonProps={{'aria-label':t('close')}}>
    <Stack>
      <Text role="status">{present?t('sdPresent',{size:card.bytes/1024/1024}):t('sdEmpty')}</Text>
      {present?<>
        <Text size="sm">{state.sdName||'orchard-sd.img'} · {t(card.writeProtected?'sdReadOnly':'sdWritable')}</Text>
        <Text size="sm" c="dimmed">{t('sdActivity',{reads:card.readBlocks,writes:card.writtenBlocks})}</Text>
        {card.dirty&&<Text size="sm">{t('sdChanged')}</Text>}
        <Group><Button disabled={disabled} onClick={()=>controller.exportSD()}>{t('sdExport')}</Button>
          <Button variant="default" disabled={disabled} onClick={()=>controller.ejectSD()}>{t('sdEject')}</Button></Group>
      </>:<>
        <Switch label={t('sdReadOnly')} checked={readOnly} onChange={e=>setReadOnly(e.currentTarget.checked)} disabled={disabled}/>
        <Group><Button disabled={disabled} onClick={()=>controller.insertSD(null,readOnly)}>{t('sdCreate')}</Button>
          <Button variant="default" disabled={disabled} onClick={()=>{input.current.value='';input.current.click();}}>{t('sdImport')}</Button></Group>
        <Text size="sm" c="dimmed">{t('sdImageHelp')}</Text>
      </>}
      <Text size="sm" c="dimmed">{t('sdHelp')}</Text>
      <input ref={input} id="sd-image-file" type="file" accept=".img,.bin,.sd" hidden onChange={e=>{if(e.target.files[0])void controller.insertSD(e.target.files[0],readOnly);}}/>
    </Stack>
  </Modal>;
}
