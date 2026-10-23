// SPDX-License-Identifier: MIT
import React,{useRef,useState} from 'react';
import {Button,Group,Progress,Stack,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {transferCapabilities} from './file-transfer.js';

const size=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n/1024)+' KiB';
export function FileTransfer({controller,state,transport}){
  const {t}=useTranslation(),input=useRef(null),[files,setFiles]=useState([]),[name,setName]=useState('');
  const file=files[0]?.file,multiple=files.length>1,batch=state.uploadBatch;
  const transfer=state.transfer,active=Boolean(transfer?.active||batch?.active),connected=transport==='usb'?state.usbReady:state.serial;
  const capabilities=transferCapabilities(state.model.id,transport),supported=capabilities.send,hp39=capabilities.serve;
  const available=supported&&connected&&state.ready&&state.loaded&&!state.busy&&!state.stopped&&!active;
  const progress=transfer?.total?Math.min(100,100*transfer.transferred/transfer.total):0;
  return <Stack gap="sm">
    <Text size="sm" c="dimmed">{t(hp39?'fileTransfer39Help':!supported?'fileTransferUnavailable':transport==='serial'?'fileTransferSerialHelp':'fileTransferHelp')}</Text>
    {supported&&<>
      <Group align="end"><Button variant="default" disabled={active} onClick={()=>{input.current.value='';input.current.click();}}>{t('chooseTransferFile')}</Button>
        <Text size="sm" style={{overflowWrap:'anywhere',flex:1,minWidth:100}}>{multiple?t('selectedTransferFiles',{count:files.length}):file?`${file.name} (${size(file.size)})`:t('noTransferFile')}</Text></Group>
      <input ref={input} type="file" multiple data-testid="transfer-file" hidden onChange={e=>{const next=Array.from(e.target.files||[],file=>({file,name:file.name}));setFiles(next);setName(next.length===1?next[0].name:'');}}/>
      {multiple&&!hp39&&<Stack gap="xs" style={{maxHeight:260,overflowY:'auto'}}>{files.map((entry,index)=><Group key={index} align="end" wrap="nowrap">
        <TextInput label={`${t('calculatorFileName')} · ${entry.file.name}`} value={entry.name} maxLength={64} disabled={active} style={{flex:1,minWidth:0}}
          onChange={e=>{const next=e.currentTarget.value;setFiles(current=>current.map((item,i)=>i===index?{...item,name:next}:item));}}/>
        <Button variant="subtle" size="compact-sm" disabled={active} aria-label={t('removeTransferFile',{name:entry.file.name})}
          onClick={()=>{const remaining=files.filter((_,i)=>i!==index);setFiles(remaining);if(remaining.length===1)setName(remaining[0].name);}}>{t('removeUploadFile')}</Button>
      </Group>)}</Stack>}
      {hp39&&files.length>0&&<Stack gap={4} style={{maxHeight:220,overflowY:'auto'}}>{files.map((entry,index)=><Group key={index} justify="space-between" wrap="nowrap">
        <Text size="sm" style={{overflowWrap:'anywhere',minWidth:0}}>{entry.file.name} ({size(entry.file.size)})</Text>
        <Button variant="subtle" size="compact-sm" disabled={active} aria-label={t('removeTransferFile',{name:entry.file.name})}
          onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}>{t('removeUploadFile')}</Button>
      </Group>)}</Stack>}
      {!hp39&&<TextInput label={t(multiple?'retrieveObjectName':'calculatorFileName')} value={name} onChange={e=>setName(e.currentTarget.value)} maxLength={64} disabled={active}/>}
      <Group><Button disabled={!available||!file} onClick={()=>hp39?controller.startHp39Server(transport,files):multiple?controller.startUploadBatch(transport,files):controller.startTransfer('send',transport,{file,name})}>{t(hp39?'hostHp39Files':'uploadFile')}</Button>
        {capabilities.receive&&<Button variant="light" disabled={!available} onClick={()=>controller.startTransfer('receive',transport)}>{t(hp39?'receiveHp39Files':'receiveFiles')}</Button>}
        {capabilities.get&&<Button variant="light" disabled={!available||!name.trim()} onClick={()=>controller.startTransfer('get',transport,{name})}>{t('getNamedFile')}</Button>}
        {active&&<Button color="red" variant="light" onClick={()=>controller.cancelTransfer()}>{t(hp39?'stopHp39Server':'cancelTransfer')}</Button>}</Group>
      {(capabilities.directory||capabilities.finish)&&<Group>
        {capabilities.directory&&<Button variant="subtle" disabled={!available} onClick={()=>controller.startTransfer('directory',transport)}>{t('listCalculatorFiles')}</Button>}
        {capabilities.finish&&<Button variant="subtle" disabled={!available} onClick={()=>controller.startTransfer('finish',transport)}>{t('finishCalculatorServer')}</Button>}
      </Group>}
      {!connected&&<Text size="xs" c="dimmed">{t('fileConnectFirst')}</Text>}
    </>}
    {transfer&&<Stack gap={4} role="status" aria-live="polite">
      <Text size="sm">{t('transferPhase_'+transfer.phase)}{!batch&&transfer.name?` · ${transfer.name}`:''}</Text>
      {!batch&&transfer.total>0&&<><Progress value={progress} aria-label={t('transferProgress')}/><Text size="xs" c="dimmed">{size(transfer.transferred||0)} / {size(transfer.total)}</Text></>}
      {transfer.error&&<Text size="sm" c="red" style={{overflowWrap:'anywhere'}}>{transfer.error}</Text>}
    </Stack>}
    {batch&&<Stack gap="xs" data-testid="upload-batch">
      <Text size="sm">{t('uploadBatchProgress',{completed:batch.completed,count:batch.items.length})}</Text>
      <Progress value={batch.total?100*batch.transferred/batch.total:0} aria-label={t('transferProgress')}/>
      <Stack gap="xs" style={{maxHeight:220,overflowY:'auto'}}>{batch.items.map((entry,index)=><Group key={index} justify="space-between" wrap="nowrap">
        <Text size="sm" style={{overflowWrap:'anywhere',minWidth:0}}>{entry.storedName||entry.name}</Text>
        <Text size="xs" c={entry.phase==='error'?'red':entry.phase==='complete'?'green':'dimmed'} style={{flexShrink:0}}>{t('uploadPhase_'+entry.phase)}</Text>
      </Group>)}</Stack>
    </Stack>}
    {state.receivedFiles.length>0&&<Stack gap="xs"><Group justify="space-between"><Text size="sm" fw={600}>{t('receivedFiles')}</Text>
      <Button variant="subtle" size="compact-xs" disabled={active} onClick={()=>controller.clearTransferredFiles()}>{t('clearReceivedFiles')}</Button></Group>
      {state.receivedFiles.map(f=><Group key={f.id} justify="space-between" wrap="nowrap"><Text size="sm" style={{overflowWrap:'anywhere',minWidth:0}}>{f.name} <Text span size="xs" c="dimmed">({size(f.size)})</Text></Text>
        <Button size="compact-sm" variant="light" onClick={()=>controller.downloadTransferredFile(f.id)}>{t('downloadFile')}</Button></Group>)}
    </Stack>}
    {state.transferListing&&<pre className="link-log">{state.transferListing}</pre>}
  </Stack>;
}
