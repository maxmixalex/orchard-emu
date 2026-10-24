// SPDX-License-Identifier: MIT
import React,{useEffect,useRef,useState} from 'react';
import {Button,Group,Text} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import i18n from './i18n.js';
import {LCDRecorder,recordingFormat,recordingName} from './recording.js';
i18n.addResourceBundle('en','translation',{recordLCD:'Record screen',stopRecording:'Stop recording',recordingError:'Unable to record the screen',recordingLimit:'Recording reached its size limit and was saved.',recordingUnavailable:'Screen recording is not supported by this browser'},true,false);
i18n.addResourceBundle('zh','translation',{recordLCD:'录制屏幕',stopRecording:'停止录制',recordingError:'无法录制屏幕',recordingLimit:'录屏达到大小上限，已保存。',recordingUnavailable:'当前浏览器不支持屏幕录制'},true,false);
export function RecordingControl({controller,state,onDownload,compact=false}){
  const {t}=useTranslation(),current=useRef(null),mounted=useRef(true),[active,setActive]=useState(false),[seconds,setSeconds]=useState(0);
  useEffect(()=>{
    mounted.current=true;
    const off=controller.onFrame(frame=>current.current?.update(frame,controller.screenRGB));
    const hide=()=>{void current.current?.stop('pagehide');};window.addEventListener('pagehide',hide);
    return()=>{mounted.current=false;off();window.removeEventListener('pagehide',hide);void current.current?.stop('unmount');};
  },[controller]);
  useEffect(()=>{if(current.current&&(state.busy||!state.loaded))void current.current.stop('model');},[state.busy,state.loaded,state.model.id]);
  function start(){
    const model=state.model.id,now=new Date();
    try{
      const recording=new LCDRecorder(controller.last,{background:controller.screenRGB,onProgress:s=>{if(mounted.current)setSeconds(Math.floor(s));}});
      current.current=recording;setSeconds(0);setActive(true);
      recording.finished.then(result=>{
        onDownload(result.blob,recordingName(model,result.type,now));
        if(result.reason==='limit'&&mounted.current)controller.report('recordingLimit');
      }).catch(error=>{if(mounted.current)controller.report('recordingError',error.message);}).finally(()=>{
        if(current.current===recording)current.current=null;if(mounted.current)setActive(false);
      });
    }catch(error){controller.report('recordingError',error.message);}
  }
  return <Group gap={6} wrap="nowrap"><Button variant={active?'filled':'default'} color={active?'red':undefined} aria-label={t(active?'stopRecording':'recordLCD')} disabled={!active&&(!state.loaded||state.busy||!recordingFormat())} title={!recordingFormat()?t('recordingUnavailable'):undefined} onClick={()=>active?void current.current?.stop():start()}>{t(compact?(active?'recordStopShort':'recordShort'):(active?'stopRecording':'recordLCD'))}</Button>{active&&<Text size="xs" className="recording-clock" role="timer">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</Text>}</Group>;
}
