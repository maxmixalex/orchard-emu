// SPDX-License-Identifier: MIT
import React from 'react';
import {Button,Group,Stack,Switch,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {CALCULATORS} from './catalog.js';

export function ROMSettings({controller,state,remember,onChange}){
  const {t}=useTranslation();
  return <Stack gap="xs">
    <Switch label={t('romRemember')} description={t('romRememberHelp')} checked={remember} onChange={e=>onChange(e.currentTarget.checked)}/>
    {state.rememberedROMs.map(record=><Group key={record.model} justify="space-between" wrap="nowrap">
      <div style={{minWidth:0,flex:1}}><Text size="sm" style={{overflowWrap:'anywhere'}}>{CALCULATORS.find(c=>c.id===record.model)?.name} · {record.name}</Text><Text size="xs" c="dimmed">{t(record.kind==='handle'?'romOriginalFile':'romLocalCopy')}</Text></div>
      <Button variant="light" size="xs" disabled={state.busy} onClick={()=>controller.openRememberedROM(record.model)}>{t('romOpenRemembered')}</Button>
    </Group>)}
    <ROMAccessNotice controller={controller} state={state}/>
    {(Boolean(state.rememberedROMs.length)||state.romIssue?.code==='storage')&&<Button variant="subtle" color="red" size="xs" disabled={state.busy} onClick={()=>controller.forgetROMs()}>{t('romForget')}</Button>}
  </Stack>;
}
export function ROMAccessNotice({controller,state}){
  const {t}=useTranslation(),issue=state.romIssue;if(!issue)return null;
  return <Group className="rom-access-notice" role="status" gap="xs">
    <Text size="sm">{t('romIssue_'+issue.code,{name:issue.name})}</Text>
    {issue.code==='permission'&&<Button size="xs" variant="light" disabled={state.busy} onClick={()=>controller.openRememberedROM(issue.model)}>{t('romContinue')}</Button>}
  </Group>;
}
