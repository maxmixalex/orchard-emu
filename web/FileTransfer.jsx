// SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Button,Group,NativeSelect,Progress,Stack,Switch,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {transferCapabilities} from './file-transfer.js';
import {hp39TransferMenus} from './hp39-transfer-ui.js';

const size=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n/1024)+' KiB';
const number=n=>new Intl.NumberFormat().format(Math.max(0,Math.floor(n||0)));
const wireMenu=(model,transport)=>hp39TransferMenus(model,transport).wire;
function TransferError({error,errorCode,errorValues,small=false}){
  const {t}=useTranslation();if(!error&&!errorCode)return null;
  const message=t('fileTransferError_'+(errorCode||'unknown'),{...errorValues,defaultValue:t('fileTransferError_unknown')});
  return <div><Text size={small?'xs':'sm'} c="red" style={{overflowWrap:'anywhere'}}>{message}</Text>
    {error&&error!==message&&<details className="transfer-error-details"><summary>{t('details')}</summary><pre>{error}</pre></details>}
  </div>;
}
export function TransferStatus({state,compact=false,onOpen}){
  const {t}=useTranslation(),transfer=state.transfer,batch=state.uploadBatch;
  const [wall,setWall]=useState(Date.now);
  const active=Boolean(transfer?.active||batch?.active),moving=active&&transfer?.phase!=='serving';
  useEffect(()=>{
    setWall(Date.now());if(!moving)return;
    const timer=setInterval(()=>setWall(Date.now()),1000);return()=>clearInterval(timer);
  },[moving,transfer?.request,transfer?.name]);
  const wireRecovery=transfer?.protocol==='hp39-wire'&&['cancelled','error'].includes(transfer.phase);
  if(!transfer||compact&&(!active&&!['error','complete'].includes(transfer.phase)&&!wireRecovery))return null;
  const complete=transfer.phase==='serving'&&transfer.hostedTotal>0&&transfer.hostedTransferred>=transfer.hostedTotal;
  const elapsed=Math.max(0,Math.floor((wall-(transfer.fileStartedAt??transfer.startedAt??wall))/1000));
  const idle=Math.max(0,Math.floor((wall-(transfer.progressAt??wall))/1000));
  const total=batch?.active?batch.total:transfer.total,transferred=batch?.active?batch.transferred:transfer.transferred;
  const progress=total?Math.min(100,100*(transferred||0)/total):0;
  return <Stack gap={4} role="status" aria-live="polite" data-testid={compact?'transfer-summary':'transfer-status'}
    style={compact?{padding:'6px 20px',background:'var(--mantine-color-default-hover)',flexShrink:0}:undefined}>
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c={complete?'teal':undefined} style={{overflowWrap:'anywhere',minWidth:0}}>
        {t(complete?'fileTransfer39Uploaded':transfer.protocol==='hp39-wire'&&transfer.phase==='negotiating'?(transfer.autoReceive?'fileTransferAutoReceiving':transfer.objectKind==='C'?'fileTransferWireNoteNext':'fileTransferWireNext'):'transferPhase_'+transfer.phase,{menu:wireMenu(state.model.id,transfer.transport)})}
      </Text>
      {compact&&<Button variant="subtle" size="compact-xs" onClick={onOpen} style={{flexShrink:0}}>{t('fileTransferDetails')}</Button>}
    </Group>
    {transfer.name&&transfer.phase!=='serving'&&<Text size="sm" style={{overflowWrap:'anywhere'}}>{transfer.name}</Text>}
    {(compact||!batch)&&total>0&&<><Progress value={progress} aria-label={t('transferProgress')}/>
      <Text size="xs" c="dimmed">{t('fileTransferBytes',{transferred:number(transferred),total:number(total)})}</Text></>}
    {!total&&transfer.phase==='receiving'&&<Text size="xs" c="dimmed">{t('fileTransferReceivedBytes',{transferred:number(transferred)})}</Text>}
    {!compact&&transfer.hostedTotal>0&&transfer.phase!=='serving'&&<Text size="xs" c="dimmed">
      {t('fileTransfer39Overall',{completed:transfer.filesCompleted||0,count:transfer.filesTotal||0,
        transferred:number(transfer.hostedTransferred),total:number(transfer.hostedTotal)})}
    </Text>}
    {moving&&<Group gap="xs" aria-live="off"><Text size="xs" c="dimmed">{t('fileTransferElapsed',{seconds:elapsed})}</Text>
      {idle>=5&&<Text size="xs" c="dimmed">{t('fileTransferWaiting',{seconds:idle})}</Text>}</Group>}
    {active&&state.transferBoosted&&<Text size="xs" c="teal">{t('fileTransferBoosted')}</Text>}
    {transfer.noteConverted&&<Text size="xs" c="dimmed">{t('fileTransferNoteConverted')}</Text>}
    <TransferError error={transfer.error} errorCode={transfer.errorCode} errorValues={transfer.errorValues}/>
    {batch?.recoverable&&<Text size="xs">{t('fileTransferQueueRecovery')}</Text>}
    {wireRecovery&&<Text size="xs">{t(batch?.recoverable?'fileTransferWireRetry':'fileTransferWireRecovery',{menu:wireMenu(state.model.id,transfer.transport)})}</Text>}
  </Stack>;
}
export function FileTransfer({controller,state,transport}){
  const {t}=useTranslation(),input=useRef(null),[files,setFiles]=useState([]),[name,setName]=useState('');
  const [protocol,setProtocol]=useState(()=>state.transfer?.protocol==='hp39-wire'?'wire':'disk');
  const [autoReceive,setAutoReceive]=useState(false),menus=hp39TransferMenus(state.model.id,transport);
  const file=files[0]?.file,multiple=files.length>1,batch=state.uploadBatch;
  const transfer=state.transfer,active=Boolean(transfer?.active||batch?.active),connected=transport==='usb'?state.usbReady:state.serial;
  const capabilities=transferCapabilities(state.model.id,transport),supported=capabilities.send,hp39=capabilities.serve;
  const wire=hp39&&protocol==='wire';
  const available=supported&&connected&&state.ready&&state.loaded&&!state.busy&&!state.stopped&&!active;
  const canRecover=state.ready&&state.loaded&&!state.busy&&!state.stopped&&
    (transfer?.transport==='usb'?state.usbReady:state.serial);
  return <Stack gap="sm">
    {hp39&&<NativeSelect label={t('fileTransferMode')} value={protocol} onChange={e=>setProtocol(e.currentTarget.value)} disabled={active}
      data={[{value:'disk',label:t('fileTransferDisk',{disk:menus.disk})},{value:'wire',label:t('fileTransferWire',{menu:menus.wire})}]}/>}
    <Text size="sm" c="dimmed">{t(wire?'fileTransferWireHelp':hp39?'fileTransfer39Help':!supported?'fileTransferUnavailable':transport==='serial'?'fileTransferSerialHelp':'fileTransferHelp',{menu:menus.wire,disk:menus.disk})}</Text>
    {wire&&transport==='usb'&&[1,2].includes(state.model.id)&&<Switch label={t('fileTransferAutoReceive')} description={t('fileTransferAutoReceiveHelp')}
      checked={autoReceive} disabled={active} onChange={event=>setAutoReceive(event.currentTarget.checked)}/>}
    {supported&&<>
      <Group align="end"><Button variant="default" disabled={active} onClick={()=>{input.current.value='';input.current.click();}}>{t('chooseTransferFile')}</Button>
        <Text size="sm" style={{overflowWrap:'anywhere',flex:1,minWidth:100}}>{multiple?t('selectedTransferFiles',{count:files.length}):file?`${file.name} (${size(file.size)})`:t('noTransferFile')}</Text></Group>
      <input ref={input} type="file" multiple data-testid="transfer-file" hidden onChange={e=>{const next=Array.from(e.target.files||[],file=>({file,name:file.name}));setFiles(next);setName(next.length===1?next[0].name:'');}}/>
      {multiple&&!hp39&&<Stack gap="xs" style={{maxHeight:260,overflowY:'auto'}}>{files.map((entry,index)=><Group key={index} align="end" wrap="nowrap">
        <TextInput label={t('calculatorFileName')} description={entry.file.name} aria-label={t('fileTransferObjectName',{name:entry.file.name})} value={entry.name} maxLength={64} disabled={active} style={{flex:1,minWidth:0}}
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
      <Group><Button disabled={!available||!file} onClick={()=>hp39?controller.startHp39Server(transport,files,{protocol,autoReceive}):multiple?controller.startUploadBatch(transport,files):controller.startTransfer('send',transport,{file,name})}>{t(wire?'uploadHp39Wire':hp39?'hostHp39Files':'uploadFile')}</Button>
        {capabilities.receive&&!wire&&<Button variant="light" disabled={!available} onClick={()=>controller.startTransfer('receive',transport)}>{t(hp39?'receiveHp39Files':'receiveFiles')}</Button>}
        {capabilities.get&&<Button variant="light" disabled={!available||!name.trim()} onClick={()=>controller.startTransfer('get',transport,{name})}>{t('getNamedFile')}</Button>}
        {active&&<Button color="red" variant="light" onClick={()=>controller.cancelTransfer()}>{t(hp39&&!wire?'stopHp39Server':'cancelTransfer')}</Button>}</Group>
      {(capabilities.directory||capabilities.finish)&&<Group>
        {capabilities.directory&&<Button variant="subtle" disabled={!available} onClick={()=>controller.startTransfer('directory',transport)}>{t('listCalculatorFiles')}</Button>}
        {capabilities.finish&&<Button variant="subtle" disabled={!available} onClick={()=>controller.startTransfer('finish',transport)}>{t('finishCalculatorServer')}</Button>}
      </Group>}
      {!connected&&<Text size="xs" c="dimmed">{t('fileConnectFirst')}</Text>}
    </>}
    <TransferStatus state={state}/>
    {batch&&<Stack gap="xs" data-testid="upload-batch">
      <Text size="sm">{t('uploadBatchProgress',{completed:batch.completed,count:batch.items.length})}</Text>
      <Progress value={batch.total?100*batch.transferred/batch.total:0} aria-label={t('transferProgress')}/>
      <Stack gap="xs" style={{maxHeight:220,overflowY:'auto'}}>{batch.items.map((entry,index)=><Group key={index} justify="space-between" wrap="nowrap">
        <Stack gap={2} style={{minWidth:0}}><Text size="sm" style={{overflowWrap:'anywhere'}}>{entry.storedName||entry.name}</Text>
          <TransferError error={entry.error} errorCode={entry.errorCode} errorValues={entry.errorValues} small/></Stack>
        <Text size="xs" c={entry.phase==='error'?'red':entry.phase==='complete'?'green':'dimmed'} style={{flexShrink:0}}>{t('uploadPhase_'+entry.phase)}</Text>
      </Group>)}</Stack>
      {batch.recoverable&&<Group>
        <Button disabled={!canRecover} onClick={()=>controller.retryUploadFile()}>{t('retryUploadFile')}</Button>
        <Button variant="light" disabled={!canRecover} onClick={()=>controller.skipUploadFile()}>{t('skipUploadFile')}</Button>
        <Button variant="subtle" onClick={()=>controller.cancelTransfer()}>{t('discardUploadQueue')}</Button>
      </Group>}
    </Stack>}
    {state.receivedFiles.length>0&&<Stack gap="xs"><Group justify="space-between"><Text size="sm" fw={600}>{t('receivedFiles')}</Text>
      <Group gap="xs">{hp39&&<Button variant="light" size="compact-xs" onClick={()=>controller.downloadHp39Package()}>{t('downloadHp39Package')}</Button>}
      <Button variant="subtle" size="compact-xs" disabled={active} onClick={()=>controller.clearTransferredFiles()}>{t('clearReceivedFiles')}</Button></Group></Group>
      {state.receivedFiles.map(f=><Group key={f.id} justify="space-between" wrap="nowrap"><Text size="sm" style={{overflowWrap:'anywhere',minWidth:0}}>{f.name} <Text span size="xs" c="dimmed">({size(f.size)})</Text></Text>
        <Button size="compact-sm" variant="light" onClick={()=>controller.downloadTransferredFile(f.id)}>{t('downloadFile')}</Button></Group>)}
    </Stack>}
    {state.transferListing&&<pre className="link-log">{state.transferListing}</pre>}
  </Stack>;
}
