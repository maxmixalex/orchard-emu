// SPDX-License-Identifier: MIT
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Badge,Button,Group,Select,Stack,Text,TextInput} from '@mantine/core';
import {useTranslation} from 'react-i18next';
import {CALCULATORS} from './catalog.js';
import {keyRows} from './hp48.js';
import {PCKeyboardView,PC_KEYS} from './pc-keyboard-view.js';
import {bindingCode,bindingLabel,capturedKey,keyLabel,previewBindings,readKeyboardLayout} from './pc-keyboard.js';
import {TraditionalKeypad,MODEL_SLUGS} from './traditional-keypad.js';
const EMPTY_SEQUENCE=Object.freeze([]),EMPTY_MAPPING=Object.freeze({});
const STANDARD_KEYS=new Set(PC_KEYS.map(key=>key.token));

function useKeyboardLayout(){
 const [layout,setLayout]=useState({status:'loading',labels:{}}),[observed,setObserved]=useState({});
 const generation=useRef(0),alive=useRef(false),lastLabels=useRef('');
 const refresh=useCallback(async(clear=false)=>{
  const token=++generation.current,result=await readKeyboardLayout();
  if(!alive.current||token!==generation.current)return;
  const signature=JSON.stringify(result.labels);
  if(clear||lastLabels.current&&lastLabels.current!==signature)setObserved({});
  lastLabels.current=signature;setLayout(result);
 },[]);
 useEffect(()=>{
  alive.current=true;void refresh();
  const keyboard=globalThis.navigator?.keyboard,changed=()=>void refresh(true),focused=()=>void refresh();
  keyboard?.addEventListener?.('layoutchange',changed);window.addEventListener('focus',focused);
  return()=>{alive.current=false;++generation.current;keyboard?.removeEventListener?.('layoutchange',changed);window.removeEventListener('focus',focused);};
 },[refresh]);
 function observe(event){
  const captured=capturedKey(event);if(!captured)return null;
  setObserved(old=>({...old,[captured.code]:{key:captured.key,altGraph:captured.altGraph}}));return captured.code;
 }
 const labels=useMemo(()=>{
  const result={...layout.labels};
  for(const [code,{key}] of Object.entries(observed))if(!code.includes('+')&&key.length===1)result[code]=key;
  return result;
 },[layout.labels,observed]);
 return {status:layout.status,labels,observed,observe,refresh};
}

function KeyboardMap({selected,mods,onChoose,labels,map,custom,related,describe}){
 const host=useRef(null),view=useRef(null),choose=useRef(onChoose);choose.current=onChoose;
 useEffect(()=>{view.current=new PCKeyboardView(host.current,token=>choose.current(token));return()=>view.current.destroy();},[]);
 useEffect(()=>{view.current?.update(selected,mods,{layout:labels,map,custom,related,describe});},[selected,mods,labels,map,custom,related,describe]);
 return <div className="pc-keyboard"><div ref={host}/></div>;
}

function CalculatorMap({spec,target,sequence,byScan,labels,onChoose}){
 const {t}=useTranslation(),host=useRef(null),view=useRef(null),choose=useRef(onChoose);choose.current=onChoose;
 useEffect(()=>{
  if(!spec)return;
  const keypad=new TraditionalKeypad(host.current,spec,scan=>choose.current(scan));view.current=keypad;keypad.setEnabled(true);
  for(const button of keypad.buttons){
   const shape=button.querySelector('.key-outline'),box=shape.getBBox(),badge=document.createElementNS('http://www.w3.org/2000/svg','text');
   badge.setAttribute('class','mapping-binding-badge');badge.setAttribute('text-anchor','middle');badge.setAttribute('font-size','14');
   badge.setAttribute('x',box.x+box.width/2);badge.setAttribute('y',box.y+13);button.append(badge);button.dataset.bindingWidth=box.width-8;
   const face=button.querySelector('.key-face');button.dataset.faceY=face?.getAttribute('y')??'';button.dataset.faceOffset=box.height*.15;
   button.dataset.originalLabel=button.getAttribute('aria-label');
  }
  return()=>{keypad.destroy();view.current=null;};
 },[spec]);
 useEffect(()=>{
  const keypad=view.current;if(!keypad)return;keypad.update(target);
  for(const button of keypad.buttons){
   const scan=Number(button.dataset.scan),codes=byScan.get(scan)??[],names=codes.map(code=>bindingLabel(code,labels));
   const badge=button.querySelector('.mapping-binding-badge'),face=button.querySelector('.key-face'),first=names[0]??'';
   const duplicate=names.length===1&&first.toUpperCase()===face?.textContent.toUpperCase();
   badge.textContent=first&&!duplicate?(first.length>10?first.slice(0,9)+'…':first)+(names.length>1?` +${names.length-1}`:''):'';
   if(face)face.setAttribute('y',Number(button.dataset.faceY)+(badge.textContent?Number(button.dataset.faceOffset):0));
   badge.removeAttribute('textLength');badge.removeAttribute('lengthAdjust');
   if(badge.getComputedTextLength()>Number(button.dataset.bindingWidth)){badge.setAttribute('textLength',button.dataset.bindingWidth);badge.setAttribute('lengthAdjust','spacingAndGlyphs');}
   button.classList.toggle('mapping-key-bound',codes.length>0);button.classList.toggle('mapping-key-sequence',sequence.includes(scan));
   button.dataset.bindings=codes.join(' ');button.setAttribute('aria-label',button.dataset.originalLabel+(names.length?' · '+t('keyboardKeyBindings',{bindings:names.join(', ')}):''));
  }
 },[spec,target,sequence,byScan,labels,t]);
 return <div className="mapping-calculator" ref={host}/>;
}

export function KeyboardSettings({model,draft,onChange}){
 const {t}=useTranslation(),layout=useKeyboardLayout();
 const [modelId,setModelId]=useState(model.id),[selected,setSelected]=useState('KeyA'),[mods,setMods]=useState([]),[chosenTarget,setChosenTarget]=useState(null);
 const [manifest,setManifest]=useState(null),[manifestFailed,setManifestFailed]=useState(false);
 useEffect(()=>{setModelId(model.id);setChosenTarget(null);},[model.id]);
 useEffect(()=>{
  let disposed=false;
  fetch(new URL('skins/manifest.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Keyboard metadata');return r.json();})
   .then(value=>{if(!disposed)setManifest(value);}).catch(()=>{if(!disposed)setManifestFailed(true);});
  return()=>{disposed=true;};
 },[]);
 const code=bindingCode(selected,mods),editingModel=CALCULATORS.find(c=>c.id===modelId)??model;
 const map=useMemo(()=>previewBindings(draft,modelId,layout.labels,layout.observed),[draft,modelId,layout.labels,layout.observed]);
 const custom=draft.mappings[String(modelId)]??EMPTY_MAPPING,sequence=map[code]??EMPTY_SEQUENCE,target=chosenTarget??sequence.at(-1)??null;
 const names=useMemo(()=>keyRows(modelId).flat().map(([label,scan])=>({value:String(scan),label})),[modelId]);
 const name=useCallback(scan=>names.find(n=>n.value===String(scan))?.label??String(scan),[names]);
 const spec=manifest?.models?.[MODEL_SLUGS[modelId]],byScan=useMemo(()=>{
  const result=new Map();for(const [binding,steps] of Object.entries(map))if(steps.length){const scan=steps.at(-1);result.set(scan,[...(result.get(scan)??[]),binding]);}return result;
 },[map]);
 const targetCodes=byScan.get(target)??EMPTY_SEQUENCE,related=useMemo(()=>targetCodes.map(binding=>binding.split('+').at(-1)),[targetCodes]);
 const extraKeys=[...new Set([...Object.keys(layout.labels),...Object.keys(custom).map(binding=>binding.split('+').at(-1)),...Object.keys(layout.observed).map(binding=>binding.split('+').at(-1))])].filter(token=>!STANDARD_KEYS.has(token));
 function setSequence(next){onChange({...draft,mappings:{...draft.mappings,[modelId]:{...custom,[code]:next}}});}
 function selectBinding(value){const parts=value.split('+');setSelected(parts.pop());setMods(parts);setChosenTarget(null);}
 function choose(token){
  setChosenTarget(null);
  if(token.startsWith('{')){const mod=token.slice(1,-1);setMods(old=>old.includes(mod)?old.filter(x=>x!==mod):[...old,mod]);}else setSelected(token);
 }
 function capture(event){
  if(event.key==='Tab'&&!event.ctrlKey&&!event.altKey&&!event.metaKey)return;
  event.preventDefault();event.stopPropagation();const value=layout.observe(event);if(value)selectBinding(value);
 }
 function resetBinding(){const next={...custom};delete next[code];onChange({...draft,mappings:{...draft.mappings,[modelId]:next}});}
 const describe=useCallback(steps=>steps.length?steps.map(name).join(' → '):t('unassigned'),[name,t]);
 return <Stack className="keyboard-settings" gap="sm">
  <Group className="mapping-topline" align="end" justify="space-between">
   <Select allowDeselect={false} label={t('keyboardModel')} value={String(modelId)} data={CALCULATORS.map(c=>({value:String(c.id),label:c.name}))} onChange={value=>{if(value){setModelId(Number(value));setChosenTarget(null);}}}/>
   <Text size="sm" c="dimmed" className="mapping-model-hint">{t('keyboardModelHint')}</Text>
  </Group>
  <div className="mapping-workspace">
   <Stack className="mapping-pc" gap="sm">
    <div className="mapping-layout-status" role="status" data-layout-status={layout.status}>
     <Group align="start" justify="space-between" wrap="nowrap"><Text size="sm">{t(layout.status==='ready'?'keyboardLayoutReady':layout.status==='loading'?'keyboardLayoutLoading':'keyboardLayoutUnavailable')}</Text><Button size="compact-xs" variant="subtle" onClick={()=>void layout.refresh(true)}>{t('keyboardRefreshLayout')}</Button></Group>
     <Text size="xs" c="dimmed" mt={4}>{t('keyboardLayoutHelp')}</Text>
    </div>
    <KeyboardMap selected={selected} mods={mods} onChoose={choose} labels={layout.labels} map={map} custom={custom} related={related} describe={describe}/>
    {!!extraKeys.length&&<Group className="mapping-extra-keys" gap="xs"><Text size="xs">{t('keyboardExtraKeys')}</Text>{extraKeys.map(token=><Button key={token} size="compact-xs" variant={selected===token?'filled':'default'} onClick={()=>choose(token)}>{keyLabel(token,layout.labels)}</Button>)}</Group>}
    <Group className="mapping-legend" gap="md"><span><i className="legend-mapped"/>{t('keyboardMapped')}</span><span><i className="legend-custom"/>{t('keyboardCustom')}</span><span><i className="legend-other"/>{t('keyboardOtherModifiers')}</span></Group>
    <Group align="start" className="mapping-selection">
     <TextInput className="mapping-capture" label={t('pcKey')} value={code} readOnly onKeyDown={capture} description={t('keyboardCaptureHint')}/>
     <div className="mapping-summary"><Text size="sm">{t('keyboardCurrentLabel',{label:bindingLabel(code,layout.labels)})}</Text><Text fw={600} size="sm" mt={4}>{describe(sequence)}</Text><Badge size="sm" mt={6} variant="light">{t(Object.hasOwn(custom,code)?'keyboardCustom':sequence.length?'keyboardDefault':'unassigned')}</Badge></div>
    </Group>
    {!Object.hasOwn(map,code)&&<Text size="xs" c="dimmed">{t('keyboardUnknownCombo')}</Text>}
    <div className="mapping-sequence-editor"><Text size="sm" fw={600} mb="xs">{t('sequence')} · {sequence.length}/8</Text>
     <Stack gap="xs">{sequence.map((scan,index)=><Group key={index} wrap="nowrap" gap="xs"><Text size="xs" c="dimmed" className="mapping-step-number">{index+1}</Text><Select aria-label={`${t('sequence')} ${index+1}`} data={names} value={String(scan)} onChange={value=>{if(value){const next=[...sequence];next[index]=Number(value);setSequence(next);}}} style={{flex:1,minWidth:0}}/><Button size="compact-sm" variant="subtle" onClick={()=>setSequence(sequence.filter((_,i)=>i!==index))} aria-label={`${t('removeStep')} ${index+1}`}>−</Button></Group>)}</Stack>
    </div>
    <Group gap="xs"><Button size="xs" variant="light" disabled={sequence.length>=8} onClick={()=>setSequence([...sequence,target??6])}>{t('addStep')}</Button><Button size="xs" variant="subtle" onClick={()=>setSequence([])}>{t('unassign')}</Button><Button size="xs" variant="subtle" disabled={!Object.hasOwn(custom,code)} onClick={resetBinding}>{t('defaultKey')}</Button></Group>
    <Text size="xs" c="dimmed">{t('keyboardPhysicalHint')} {t('keyStateHint')}</Text>
   </Stack>
   <Stack className="mapping-calculator-panel" gap="xs">
    <Text size="sm" fw={600}>{t('keyboardCalculator',{model:editingModel.name})}</Text>
    <Text size="xs" c="dimmed">{t('keyboardCalculatorHelp')}</Text>
    {spec?<CalculatorMap spec={spec} target={target} sequence={sequence} byScan={byScan} labels={layout.labels} onChoose={setChosenTarget}/>:<Text size="sm" role="status">{t(manifestFailed||manifest?'keyboardCalculatorUnavailable':'keyboardCalculatorLoading')}</Text>}
    <Text size="xs" c="dimmed">{t('keyboardSequenceHint')}</Text>
    <div className="mapping-target" aria-live="polite">
     <Text size="sm" fw={600}>{target===null?t('keyboardTargetHint'):t('keyboardBindingList',{label:name(target)})}</Text>
     {target!==null&&<><Group mt="xs" gap="xs"><Button size="compact-xs" onClick={()=>setSequence([target])}>{t('keyboardBindTarget')}</Button><Button size="compact-xs" variant="light" disabled={sequence.length>=8} onClick={()=>setSequence([...sequence,target])}>{t('keyboardAppendTarget')}</Button></Group>
      <Group className="mapping-target-bindings" mt="xs" gap={5}>{targetCodes.length?targetCodes.map(binding=><Button key={binding} size="compact-xs" variant={binding===code?'filled':'default'} title={binding} onClick={()=>selectBinding(binding)}>{bindingLabel(binding,layout.labels)}</Button>):<Text size="xs" c="dimmed">{t('keyboardBindingEmpty')}</Text>}</Group></>}
    </div>
   </Stack>
  </div>
 </Stack>;
}
