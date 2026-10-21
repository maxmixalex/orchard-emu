// SPDX-License-Identifier: MIT
import React,{useRef,useState} from 'react';
import {Button,Group,Progress,Stack,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {transferCapabilities} from './file-transfer.js';

const size=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n/1024)+' KiB';
export function FileTransfer({controller,state,transport}){
  const {t}=useTranslation(),input=useRef(null),[file,setFile]=useState(null),[name,setName]=useState('');
  const transfer=state.transfer,active=Boolean(transfer?.active),connected=transport==='usb'?state.usbReady:state.serial;
  const capabilities=transferCapabilities(state.model.id,transport),supported=capabilities.send;
  const available=supported&&connected&&state.ready&&state.loaded&&!state.busy&&!state.stopped&&!active;
  const progress=transfer?.total?Math.min(100,100*transfer.transferred/transfer.total):0;
  return <Stack gap="sm">
    <Text size="sm" c="dimmed">{t(!supported?'fileTransfer39Help':transport==='serial'?'fileTransferSerialHelp':'fileTransferHelp')}</Text>
    {supported&&<>
      <Group align="end"><Button variant="default" disabled={active} onClick={()=>{input.current.value='';input.current.click();}}>{t('chooseTransferFile')}</Button>
        <Text size="sm" style={{overflowWrap:'anywhere',flex:1,minWidth:100}}>{file?`${file.name} (${size(file.size)})`:t('noTransferFile')}</Text></Group>
      <input ref={input} type="file" data-testid="transfer-file" hidden onChange={e=>{const next=e.target.files[0]||null;setFile(next);setName(next?.name||'');}}/>
      <TextInput label={t('calculatorFileName')} value={name} onChange={e=>setName(e.currentTarget.value)} maxLength={64} disabled={active}/>
      <Group><Button disabled={!available||!file} onClick={()=>controller.startTransfer('send',transport,{file,name})}>{t('uploadFile')}</Button>
        {capabilities.receive&&<Button variant="light" disabled={!available} onClick={()=>controller.startTransfer('receive',transport)}>{t('receiveFiles')}</Button>}
        {capabilities.get&&<Button variant="light" disabled={!available||!name.trim()} onClick={()=>controller.startTransfer('get',transport,{name})}>{t('getNamedFile')}</Button>}
        {active&&<Button color="red" variant="light" onClick={()=>controller.cancelTransfer()}>{t('cancelTransfer')}</Button>}</Group>
      {(capabilities.directory||capabilities.finish)&&<Group>
        {capabilities.directory&&<Button variant="subtle" disabled={!available} onClick={()=>controller.startTransfer('directory',transport)}>{t('listCalculatorFiles')}</Button>}
        {capabilities.finish&&<Button variant="subtle" disabled={!available} onClick={()=>controller.startTransfer('finish',transport)}>{t('finishCalculatorServer')}</Button>}
      </Group>}
      {!connected&&<Text size="xs" c="dimmed">{t('fileConnectFirst')}</Text>}
    </>}
    {transfer&&<Stack gap={4} role="status" aria-live="polite">
      <Text size="sm">{t('transferPhase_'+transfer.phase)}{transfer.name?` · ${transfer.name}`:''}</Text>
      {transfer.total>0&&<><Progress value={progress} aria-label={t('transferProgress')}/><Text size="xs" c="dimmed">{size(transfer.transferred||0)} / {size(transfer.total)}</Text></>}
      {transfer.error&&<Text size="sm" c="red" style={{overflowWrap:'anywhere'}}>{transfer.error}</Text>}
    </Stack>}
    {state.receivedFiles.length>0&&<Stack gap="xs"><Group justify="space-between"><Text size="sm" fw={600}>{t('receivedFiles')}</Text>
      <Button variant="subtle" size="compact-xs" disabled={active} onClick={()=>controller.clearTransferredFiles()}>{t('clearReceivedFiles')}</Button></Group>
      {state.receivedFiles.map(f=><Group key={f.id} justify="space-between" wrap="nowrap"><Text size="sm" style={{overflowWrap:'anywhere',minWidth:0}}>{f.name} <Text span size="xs" c="dimmed">({size(f.size)})</Text></Text>
        <Button size="compact-sm" variant="light" onClick={()=>controller.downloadTransferredFile(f.id)}>{t('downloadFile')}</Button></Group>)}
    </Stack>}
    {state.transferListing&&<pre className="link-log">{state.transferListing}</pre>}
  </Stack>;
}
