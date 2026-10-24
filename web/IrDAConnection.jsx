// SPDX-License-Identifier: MIT
import React,{useState} from 'react';
import {Button,Group,Stack,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
export function IrDAConnection({controller,state}){
  const {t}=useTranslation(),[code,setCode]=useState(''),link=state.irda;
  const available=typeof BroadcastChannel==='function',ready=state.loaded&&!state.busy&&!state.stopped;
  return <Stack gap="sm">
    <Text size="sm" c="dimmed">{t(available?'irdaHelp':'irdaUnavailable')}</Text>
    <TextInput label={t('irdaPairCode')} value={link.active?link.code:code} maxLength={12} autoComplete="off" spellCheck={false} readOnly={link.active} onChange={event=>setCode(event.currentTarget.value.toUpperCase())}/>
    <Group gap="xs">{link.active?<Button variant="default" onClick={()=>controller.disconnectIrDA()}>{t('irdaDisconnect')}</Button>:<>
      <Button variant="default" disabled={!ready||!available} onClick={()=>controller.connectIrDA()}>{t('irdaNew')}</Button>
      <Button disabled={!ready||!available||!code.trim()} onClick={()=>controller.connectIrDA(code)}>{t('irdaJoin')}</Button>
    </>}</Group>
    <Text size="sm" role="status">{t('irdaPhase_'+link.phase,{peer:link.peer})}</Text>
    {(link.sent>0||link.received>0)&&<Text size="xs" c="dimmed">{t('irdaStats',link)}</Text>}
    {link.error&&<Text size="sm" c="red" role="alert">{t('irdaError_'+link.error)}</Text>}
  </Stack>;
}
