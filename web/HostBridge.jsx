// SPDX-License-Identifier: MIT
import React,{useState} from 'react';
import {Button,Code,Group,PasswordInput,Stack,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {BRIDGE_DEFAULT_URL} from './host-bridge-protocol.js';

const PHASES=new Set(['disconnected','connecting','enumerating','ready','attached','error']);
export function HostBridge({controller,state}){
 const {t}=useTranslation(),[address,setAddress]=useState(BRIDGE_DEFAULT_URL),[token,setToken]=useState('');
 const bridge=state.hostBridge??{},phase=PHASES.has(bridge.phase)?bridge.phase:'disconnected';
 const available=state.ready&&state.loaded&&!state.busy&&!state.stopped&&!state.transfer?.active&&!state.uploadBatch?.active;
 return <Stack gap="sm" data-testid="host-bridge">
  <Text size="sm">{t('hostBridgeHelp')}</Text>
  <Text size="sm" c="dimmed">{t('hostBridgeStartHelp')}</Text>
  <Code block>node host/bridge.mjs</Code>
  <TextInput label={t('hostBridgeAddress')} value={address} onChange={e=>setAddress(e.currentTarget.value)} disabled={bridge.active} autoComplete="off" spellCheck={false} maxLength={64}/>
  <PasswordInput label={t('hostBridgeToken')} description={t('hostBridgeTokenHelp')} value={token} onChange={e=>setToken(e.currentTarget.value)} disabled={bridge.active} autoComplete="off" maxLength={128}/>
  <Group>
   {bridge.active?<Button color="red" variant="light" onClick={()=>controller.disconnectHostBridge()}>{t('hostBridgeDisconnect')}</Button>:
    <Button disabled={!available||!address.trim()||!token.trim()} onClick={()=>controller.connectHostBridge(address.trim(),token.trim())}>{t('hostBridgeConnect')}</Button>}
  </Group>
  <Stack gap={4} role="status" aria-live="polite">
   <Text size="sm" fw={500}>{t('hostBridgePhase_'+phase)}</Text>
   {bridge.errorCode&&<Text size="sm" c="red">{t(bridge.errorCode,{defaultValue:t('hostBridgeNetwork')})}</Text>}
   {bridge.active&&bridge.usbipPort&&<Text size="sm">{t('hostBridgeEndpoint',{port:bridge.usbipPort})}</Text>}
   {bridge.active&&<Text size="xs" c="dimmed">{t('hostBridgeActiveHelp')}</Text>}
  </Stack>
  <Text size="xs" c="dimmed">{t('hostBridgeDriverHelp')}</Text>
 </Stack>;
}
