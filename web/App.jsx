// SPDX-License-Identifier: MIT
import React,{memo,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import '@mantine/core/styles.css';
import {MantineProvider,createTheme,Button,Group,Modal,Select,Slider,Switch,Tabs,Text,Textarea,Tooltip,Menu,Stack,CloseButton,ComboboxChevron,ActionIcon} from '@mantine/core';
import {useMediaQuery} from '@mantine/hooks';
import {KeyboardSettings} from './KeyboardSettings.jsx';
import {TraditionalKeypad,MODEL_SLUGS} from './traditional-keypad.js';
import {RecordingControl} from './RecordingControl.jsx';
import {SDCard} from './SDCard.jsx';
import {ROMSettings,ROMAccessNotice} from './ROMSettings.jsx';
import {FileTransfer,TransferStatus} from './FileTransfer.jsx';
import {IrDAConnection} from './IrDAConnection.jsx';
import {useTranslation} from 'react-i18next';
import i18n,{LANG_KEY} from './i18n.js';
import {CALCULATORS} from './catalog.js';
import {SkinView} from './skin.js';
import {bindLifecycle} from './lifecycle.js';
import {resolveKeyBinding,validatePreferences} from './preferences.js';
import {capturePNG,captureName,createLCDRenderer,displayFrame} from './capture.js';
import {createScreenScaler,SCREEN_SCALING} from './screen-scaling.js';
import styles from './App.module.css';
import './react.css';
import './keyboards.css';
export function downloadFile(data,name){const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type:'application/octet-stream'}));
 const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
// Shapes follow HP's 39gs User's Guide, section 1-3. Keep vector
// geometry independent of the host font; levels still come from the guest.
function Indicators(){return <svg className="annunciator-strip" viewBox="0 0 393 18" aria-hidden="true">
 <g data-segment="1" transform="translate(22 9)"><path d="M-9-1-2-7v4h6c5 0 7 4 7 9H7c0-3-1-5-4-5h-5v4Z"/></g>
 <g data-segment="2" transform="translate(89 9) scale(-1 1)"><path d="M-9-1-2-7v4h6c5 0 7 4 7 9H7c0-3-1-5-4-5h-5v4Z"/></g>
 <g data-segment="3" transform="translate(156 9)"><path d="M5-5 2 4C.5 7-4 7-5 3-6-1-3-6 0-5c4 0 3 11 7 10M5-5 2 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></g>
 <g data-segment="4" transform="translate(223 9)"><circle r="2.4"/><path d="M-5-6c-2 4-2 8 0 12M-9-8c-3 5-3 11 0 16M5-6c2 4 2 8 0 12M9-8c3 5 3 11 0 16" fill="none" stroke="currentColor" strokeWidth="1.5"/></g>
 <g data-segment="5" transform="translate(290 9)"><path d="M-7-8H7M-7 8H7M-5-7c0 4 1 5 5 7-4 2-5 3-5 7M5-7c0 4-1 5-5 7 4 2 5 3 5 7" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="m-4 6 4-5 4 5ZM-3-4h6L0-1Z"/></g>
 <g data-segment="0" transform="translate(357 9)"><path d="m1-7 8 7-8 7-3-3 5-4-5-4ZM-3-7l3 3-5 4 5 4-3 3-8-7Z"/></g>
 </svg>;}
function HelpIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.6a2.7 2.7 0 0 1 5.3.7c0 2-2.8 2-2.8 4.2"/><circle cx="12" cy="16.5" r=".8" fill="currentColor" stroke="none"/></svg>;}
function PauseIcon(){return <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="5" y="3" width="3" height="14" rx=".7"/><rect x="12" y="3" width="3" height="14" rx=".7"/></svg>;}
const traditional=view=>view.startsWith('traditional');
const CalculatorDisplay=memo(function CalculatorDisplay({controller,model,prefs,enabled,pointerReset}){
 const stage=useRef(null),workspace=useRef(null),host=useRef(null),view=useRef(null),keypadHost=useRef(null),softHost=useRef(null),keypad=useRef(null),ensureKeypadRef=useRef(null),prefsRef=useRef(prefs);
 prefsRef.current=prefs;
 useEffect(()=>{
  let disposed=false,raf=0,last=null,painted=null,ink='',active=null,keypadSpec=null,paintMode='';
  const live={press:(scan,source)=>{controller.keyDown(source,scan);host.current.focus({preventScroll:true});},release:(source,cancel)=>controller.keyUp(source,cancel)};
  const skin=new SkinView(stage.current,scan=>controller.tap([scan]),live);view.current=skin;
  // Background execution can leave these views enabled. Worker release alone
  // cannot clear their DOM capture or local pointer owners.
  const releasePointers=()=>{skin.releaseInputs();keypad.current?.releaseInputs();};
  pointerReset.current=releasePointers;
  const canvas=stage.current.querySelector('canvas'),paintLCD=createLCDRenderer(canvas.getContext('2d',{alpha:false})),scaleLCD=createScreenScaler();
  function skinError(e){if(!disposed){skin.glass.hidden=false;controller.report('skinError',e.message);}}
  // SVG text/shape measurements are needed only when this view is requested.
  function ensureKeypad(){
   if(disposed||keypad.current||!keypadSpec||!traditional(prefsRef.current.view))return;
   try{
    keypad.current=new TraditionalKeypad(keypadHost.current,keypadSpec,scan=>{controller.tap([scan]);host.current.focus({preventScroll:true});},{softHost:softHost.current,...live});
    keypad.current.setLayout(prefsRef.current.view==='traditional-landscape');
    keypad.current.setEnabled(controller.state.loaded&&controller.state.running&&!controller.state.busy);
    keypad.current.update(last?.active??null,last?.activeKeys);
   }catch(e){skinError(e);}
  }
  ensureKeypadRef.current=ensureKeypad;
  function fit(){if(disposed)return;const p=prefsRef.current,box=workspace.current,[w,h]=skin.setLayout(p.view==='immersive-landscape');
   keypad.current?.setLayout(p.view==='traditional-landscape');
   const boxStyle=getComputedStyle(box),width=Math.max(64,box.clientWidth-parseFloat(boxStyle.paddingLeft)-parseFloat(boxStyle.paddingRight)),
    height=Math.max(64,box.clientHeight-parseFloat(boxStyle.paddingTop)-parseFloat(boxStyle.paddingBottom)),dpr=window.devicePixelRatio||1;
   const caseWidth=Math.round(Math.min(width,height*(w/h||.497))*p.zoom/100*dpr)/dpr;
   host.current.style.setProperty('--case-width',`${caseWidth}px`);
   const lcdHeight=last?.height??(model.id>=5?80:64),lcdWidth=last?.width??131;
   // Traditional keys now use measured SVG geometry. Fit the LCD and that
   // geometry together; the old HTML-row height does not resize an SVG keypad.
   const bounds=keypad.current?.bounds,keyRatio=bounds?bounds.height/bounds.width:1.5,
    stacked=p.view==='traditional-landscape'&&width<600&&(height>width||innerHeight>innerWidth),landscape=p.view==='traditional-landscape'&&!stacked;
   host.current.dataset.stacked=String(stacked);
   const leftRatio=lcdHeight/lcdWidth+18/393+(keypad.current?.softBounds?keypad.current.softBounds.height/keypad.current.softBounds.width:.16);
   // A short landscape viewport must scroll a usable keyboard instead of
   // shrinking its entire geometry to the remaining height.
   const plain=stacked?Math.min(width,500)*p.zoom/100:landscape?Math.min(width,1000,Math.max(320,(height-44)/Math.max(leftRatio,keyRatio))*2+64)*p.zoom/100:
    Math.min(width,500,Math.max(lcdWidth/dpr,(height-74)/(lcdHeight/lcdWidth+18/393+keyRatio))+46)*p.zoom/100;
   host.current.style.setProperty('--plain-width',`${plain}px`);
   const available=landscape?(plain-64)/2:plain-46;
   const screenWidth=landscape?Math.min(available,Math.max(lcdWidth,(height-64)/leftRatio)):available;
   host.current.style.setProperty('--screen-width',`${screenWidth}px`);
   // A stacked LCD must leave enough viewport for the keys below it. This
   // matters when Connections takes half of a portrait phone's workspace.
   host.current.dataset.sticky=String(p.view==='traditional-landscape'&&leftRatio*screenWidth+52<height-(stacked?80:0));
   host.current.style.setProperty('--lcd-width',`${Math.max(50,screenWidth)}px`);
   if(last&&!raf)raf=requestAnimationFrame(paint);
  }
  function paint(){raf=0;if(!last||disposed)return;const d=last;
   const mode=prefsRef.current.screenScaling||'nearest',width=mode==='nearest'?d.width:Math.max(1,Math.min(d.width*6,Math.round(canvas.getBoundingClientRect().width*(devicePixelRatio||1)))),height=mode==='nearest'?d.height:Math.max(1,Math.round(width*d.height/d.width));
   const changed=!painted||paintMode!==mode||canvas.width!==width||canvas.height!==height||ink!==skin.rgb.join(',')||painted.width!==d.width||painted.height!==d.height||painted.frameStatus!==d.frameStatus||
    (d.pixels? !painted.pixels||painted.pixels.length!==d.pixels.length||d.pixels.some((v,i)=>v!==painted.pixels[i]):painted.pixels!==null);
   if(changed){
    if(canvas.width!==width)canvas.width=width;
    if(canvas.height!==height)canvas.height=height;
    canvas.style.aspectRatio=`${d.width}/${d.height}`;
    paintLCD(scaleLCD(displayFrame(d),width,height,mode),skin.rgb);painted=d;ink=skin.rgb.join(',');paintMode=mode;}
   controller.screenRGB=skin.rgb;skin.update(d.active,d.annunciators,d.annunciatorStatus,model.id,d.activeKeys);
   const pressed=(d.activeKeys??(d.active===null?[]:[d.active])).join(',');
   if(active!==pressed){keypad.current?.update(d.active,d.activeKeys);active=pressed;}
  }
  const unframe=controller.onFrame(d=>{last=d;if(!raf)raf=requestAnimationFrame(paint);});
  skin.show(model.id).then(async()=>{if(disposed)return;const m=await skin.manifest;if(disposed)return;
   keypadSpec=m.models[MODEL_SLUGS[model.id]];ensureKeypad();
   fit();paint();skin.setEnabled(controller.state.loaded&&controller.state.running&&!controller.state.busy&&!traditional(prefsRef.current.view));
  }).catch(skinError);
  const resize=new ResizeObserver(fit);resize.observe(workspace.current);window.addEventListener('resize',fit);fit();
  return()=>{disposed=true;++skin.epoch;skin.setEnabled(false);if(pointerReset.current===releasePointers)pointerReset.current=null;if(ensureKeypadRef.current===ensureKeypad)ensureKeypadRef.current=null;keypad.current?.destroy();keypad.current=null;cancelAnimationFrame(raf);unframe();resize.disconnect();window.removeEventListener('resize',fit);};
 },[controller,model.id,pointerReset]);
 useEffect(()=>{ensureKeypadRef.current?.();view.current?.setEnabled(enabled&&!traditional(prefs.view));keypad.current?.setEnabled(enabled&&traditional(prefs.view));window.dispatchEvent(new Event('resize'));},[enabled,prefs.view,prefs.zoom,prefs.screenScaling]);
 return <main id="workspace" ref={workspace}><section id="calculator" ref={host} tabIndex={0} data-view={prefs.view} data-scaling={prefs.screenScaling}>
  <div className="calculator-screen">
  <div className="calculator-stage" ref={stage} id="skin-stage">
   <div className="skin-screen"><div className="skin-content"><img className="skin-image" alt={model.name} hidden/><svg className="skin-keys skin-screen-keys"/>
    <div className="glass-overlay"><Indicators/><canvas id="lcd" width="131" height={model.id>=5?80:64}/></div></div></div>
   <div className="skin-keyboard"><div className="skin-content"><img className="skin-keyboard-image" alt="" aria-hidden="true" hidden/><svg className="skin-keys"/></div></div>
  </div>
  <div className="traditional-softkeys" ref={softHost}/>
  </div>
  <div className="traditional-keypad" ref={keypadHost}/>
 </section></main>;
});
// Mantine's Modal inserts a scroll-area wrapper between Content and Body.
// Keep that wrapper in the flex chain so only the active panel scrolls.
function SettingsViewport({children,...props}){return <div {...props} className={styles.settingsViewport}>{children}</div>;}
function Settings({controller,state,onClose}){
 const {t}=useTranslation(),small=useMediaQuery('(max-width: 48em)');const [draft,setDraft]=useState(()=>validatePreferences(state.prefs)),[language,setLanguage]=useState(i18n.resolvedLanguage),[tab,setTab]=useState('general');
 const set=(k,v)=>setDraft(p=>({...p,[k]:v}));
 return <Modal opened trapFocus={!state.dialog} onClose={onClose} title={t('settings')} size={tab==='keyboard'?'min(1440px, calc(100vw - 48px))':'min(880px, calc(100vw - 48px))'} fullScreen={small} scrollAreaComponent={SettingsViewport} closeButtonProps={{'aria-label':t('close')}} classNames={{content:styles.settingsDialog,header:styles.settingsHeader,body:styles.settingsBody}}>
  <Tabs value={tab} onChange={setTab} keepMounted={false} className={styles.settingsTabs}><Tabs.List className={styles.settingsTabList}>{['general','keyboard','transferSettings','storage'].map(k=><Tabs.Tab key={k} value={k}>{t(k)}</Tabs.Tab>)}</Tabs.List>
   <Tabs.Panel value="general" pt="md" className={styles.settingsPanel}><div className={styles.generalSettings}>
    <Stack gap="md"><Text fw={600} size="sm">{t('displaySettings')}</Text>
     <Select allowDeselect={false} label={t('view')} value={draft.view} onChange={v=>set('view',v)} data={['immersive','immersive-landscape','traditional','traditional-landscape'].map(k=>({value:k,label:t({'immersive-landscape':'immersiveLandscape','traditional-landscape':'traditionalLandscape'}[k]||k)}))}/>
     <div><Group justify="space-between" mb={4}><Text size="sm">{t('size')}</Text><Text size="sm" c="dimmed">{draft.zoom}%</Text></Group><Slider min={50} max={180} step={5} value={draft.zoom} onChange={v=>set('zoom',v)} thumbLabel={t('size')}/></div>
     <Select allowDeselect={false} label={t('screenScaling')} value={draft.screenScaling} onChange={v=>set('screenScaling',v)} data={SCREEN_SCALING.map(value=>({value,label:t(`screenScaling_${value}`)}))}/>
     <Select allowDeselect={false} label={t('lcdResponse')} value={draft.lcdResponse} onChange={v=>set('lcdResponse',v)} data={['instant','smooth'].map(value=>({value,label:t(`lcdResponse_${value}`)}))}/>
    </Stack>
    <Stack gap="md"><Text fw={600} size="sm">{t('runtimeSettings')}</Text>
     <Select allowDeselect={false} label={t('language')} value={language} onChange={setLanguage} data={[{value:'zh',label:'简体中文'},{value:'en',label:'English'}]}/>
     <Select allowDeselect={false} label={t('speed')} value={String(draft.speed)} onChange={v=>set('speed',Number(v))} data={[[.5,'half'],[1,'normal'],[2,'double'],[0,'unlimited']].map(([v,k])=>({value:String(v),label:t(k)}))}/>
     <Switch label={t('pauseBlur')} checked={draft.pauseOnBlur} onChange={e=>set('pauseOnBlur',e.currentTarget.checked)}/><Switch label={t('pauseHidden')} checked={draft.pauseOnHidden} onChange={e=>set('pauseOnHidden',e.currentTarget.checked)}/>
     <Text fw={600} size="sm" mt="xs">{t('audioSettings')}</Text>
     <Switch label={t('sound')} checked={draft.sound} onChange={e=>set('sound',e.currentTarget.checked)}/>
     <div><Group justify="space-between" mb={4}><Text size="sm">{t('volume')}</Text><Text size="sm" c="dimmed">{Math.round(draft.volume*100)}%</Text></Group><Slider min={0} max={100} step={5} value={Math.round(draft.volume*100)} disabled={!draft.sound} onChange={v=>set('volume',v/100)} thumbLabel={t('volume')}/></div>
    </Stack>
   </div></Tabs.Panel>
   <Tabs.Panel value="keyboard" pt="md" className={styles.settingsPanel}><KeyboardSettings model={state.model} draft={draft} onChange={setDraft}/></Tabs.Panel>
   <Tabs.Panel value="transferSettings" pt="md" className={styles.settingsPanel}><Stack>
    <Switch label={t('fileTransferUnlimited')} description={t('fileTransferUnlimitedHelp')} checked={draft.transferUnlimited} onChange={e=>set('transferUnlimited',e.currentTarget.checked)}/>
   </Stack></Tabs.Panel>
   <Tabs.Panel value="storage" pt="md" className={styles.settingsPanel}><Stack><ROMSettings controller={controller} state={state} remember={draft.rememberROM} onChange={v=>set('rememberROM',v)}/><Switch label={t('autosave')} checked={draft.autosave} onChange={e=>set('autosave',e.currentTarget.checked)}/><Select allowDeselect={false} label={t('interval')} value={String(draft.interval)} disabled={!draft.autosave} onChange={v=>set('interval',Number(v))} data={[15,30,60,120].map(v=>({value:String(v),label:t('seconds',{count:v})}))}/><Text size="sm" c="dimmed">{t('storagePrivacy')}</Text><Button variant="light" color="red" onClick={()=>controller.clearSaves()}>{t('deleteSaves')}</Button></Stack></Tabs.Panel>
  </Tabs><Group justify="flex-end" className={styles.settingsActions}><Button variant="default" onClick={onClose}>{t('cancel')}</Button><Button onClick={()=>{controller.setPreferences(draft);void i18n.changeLanguage(language);try{controller.storage?.setItem(LANG_KEY,language);}catch{}onClose();}}>{t('apply')}</Button></Group>
 </Modal>;
}
function Connections({controller,state,target,onTargetChange}){
 const {t}=useTranslation();const [format,setFormat]=useState('hex'),[text,setText]=useState(''),[tab,setTab]=useState('files');
 const active=Boolean(state.transfer?.active||state.uploadBatch?.active);
 function send(){try{let bytes;if(format==='text')bytes=new TextEncoder().encode(text);else{const value=text.trim();if(!/^[a-f\d]{2}(?:\s+[a-f\d]{2})*$/i.test(value))throw Error('hex');bytes=Uint8Array.from(value.split(/\s+/).map(x=>parseInt(x,16)));}
  if(bytes.length>(target==='serial'?1024:64))throw Error('length');controller.send(target==='serial'?'uart':'usb-send',{bytes});}catch{controller.report('invalidBytes');}}
 return <Stack>
  <Tabs value={tab} onChange={setTab} keepMounted keepMountedMode="display-none"><Tabs.List><Tabs.Tab value="files">{t('transferFiles')}</Tabs.Tab><Tabs.Tab value="irda">{t('irda')}</Tabs.Tab><Tabs.Tab value="bytes">{t('rawConnection')}</Tabs.Tab></Tabs.List>
  {tab!=='irda'&&<Stack mt="md">
  <Group justify="space-between"><div><Text size="sm" fw={500}>{t('serial')}</Text><Text size="xs" c="dimmed">{t(state.serial?'connected':'disconnected')}</Text></div><Button variant="default" aria-label={`${t(state.serial?'disconnect':'connect')} ${t('serial')}`} onClick={()=>controller.connectLink('serial',!state.serial)}>{t(state.serial?'disconnect':'connect')}</Button></Group>
  <Group justify="space-between"><div><Text size="sm" fw={500}>USB</Text><Text size="xs" c="dimmed">{t(state.usbReady?'connected':state.usb?'connecting':'disconnected')}</Text></div><Button variant="default" aria-label={`${t(state.usb?'disconnect':'connect')} USB`} onClick={()=>controller.connectLink('usb',!state.usb)}>{t(state.usb?'disconnect':'connect')}</Button></Group>
  {state.usbInfo&&<Text size="xs" c="dimmed">{[state.usbInfo.manufacturer,state.usbInfo.name].filter(Boolean).join(' ')} ({state.usbInfo.vendor.toString(16).padStart(4,'0')}:{state.usbInfo.product.toString(16).padStart(4,'0')})</Text>}
  <Select label={t('target')} value={target} onChange={value=>{if(value)onTargetChange(value);}} disabled={active} data={['serial','usb'].map(k=>({value:k,label:t(k)}))}/>
  </Stack>}
  <Tabs.Panel value="files" pt="md"><FileTransfer controller={controller} state={state} transport={target}/></Tabs.Panel>
  <Tabs.Panel value="irda" pt="md"><IrDAConnection controller={controller} state={state}/></Tabs.Panel>
  <Tabs.Panel value="bytes" pt="md"><Stack><Text size="sm" c="dimmed">{t('linkNotice')}</Text>
  <Select label={t('format')} value={format} onChange={setFormat} disabled={active} data={['hex','text'].map(k=>({value:k,label:t(k)}))}/>
  <Textarea label={t('data')} value={text} onChange={e=>setText(e.currentTarget.value)} maxLength={4096}/>
  <Group><Button disabled={active||(target==='serial'?!state.serial:!state.usbReady)} onClick={send}>{t('send')}</Button><Button variant="light" disabled={active||!state.usbReady} onClick={()=>controller.send('usb-read')}>{t('receive')}</Button><Button variant="subtle" onClick={()=>controller.patch({log:''})}>{t('clear')}</Button></Group>
  {state.log&&<pre className="link-log">{state.log}</pre>}</Stack></Tabs.Panel>
  </Tabs></Stack>;
}
export function App({controller}){
 const {t}=useTranslation(),compact=useMediaQuery('(max-width: 48em), (max-height: 500px) and (orientation: landscape)'),state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot),[settings,setSettings]=useState(false),[panel,setPanel]=useState(null),[connectionTarget,setConnectionTarget]=useState('usb');
 const rom=useRef(null),session=useRef(null),inputReset=useRef(null),pointerReset=useRef(null),modalOpen=settings||Boolean(state.dialog),modalRef=useRef(modalOpen);modalRef.current=modalOpen;
 const connections=panel==='connections',hasSD=[5,6].includes(state.model.id);
 useEffect(()=>{if(panel==='sd'&&!hasSD)setPanel('connections');},[panel,hasSD]);
 useEffect(()=>{const held=new Map(),release=()=>{held.clear();pointerReset.current?.();controller.release();};
  inputReset.current=release;
  // Paired calculator tabs must both keep running while focus moves between
  // them. An explicit Pause remains authoritative and stored preferences do
  // not change. Keep the historical host transport's lifecycle behavior too.
  const unbind=bindLifecycle(window,document,()=>controller.pause(),{preferences:()=>controller.state.hostBridge?.active||controller.state.irda?.active?
   {...controller.state.prefs,pauseOnBlur:false,pauseOnHidden:false}:controller.state.prefs,release,save:()=>controller.requestAuto()});
  const key=e=>{if(e.defaultPrevented||e.repeat||e.isComposing||modalRef.current||e.target.closest('input,textarea,select,[contenteditable="true"],[role="menu"],[role="menuitem"],[role="tablist"],[role="slider"],[role="listbox"],[aria-haspopup="menu"]')||e.target.closest('button,[role="button"]')&&(e.key==='Enter'||e.key===' '))return;
   const s=controller.state,seq=resolveKeyBinding(s.prefs,s.model.id,e);if(seq?.length&&s.loaded&&s.running&&!s.busy){
    e.preventDefault();held.set(e.code,seq.length===1?seq[0]:null);
    const scans=[...held.values()];if(scans.includes(56)&&scans.includes(38)){controller.systemChord('self-test');return;}
    if(scans.includes(56)&&scans.includes(37)){controller.systemChord('warm-restart');return;}
    if(seq.length===1)controller.keyDown(`keyboard:${e.code||e.key}`,seq[0]);else controller.tap(seq);}};
  const keyUp=e=>{if(held.get(e.code)!==undefined&&held.get(e.code)!==null)controller.keyUp(`keyboard:${e.code||e.key}`);held.delete(e.code);};
  const storage=e=>controller.foreignSave(e.key),unlockAudio=()=>controller.unlockAudio?.();
  window.addEventListener('pointerdown',unlockAudio,true);window.addEventListener('keydown',unlockAudio,true);
  window.addEventListener('keydown',key);window.addEventListener('keyup',keyUp);window.addEventListener('storage',storage);
  return()=>{release();inputReset.current=null;unbind();window.removeEventListener('pointerdown',unlockAudio,true);window.removeEventListener('keydown',unlockAudio,true);window.removeEventListener('keydown',key);window.removeEventListener('keyup',keyUp);window.removeEventListener('storage',storage);};},[controller]);
 useEffect(()=>{if(!state.running||state.busy||modalOpen)inputReset.current?.();},[state.running,state.busy,modalOpen]);
 useEffect(()=>{inputReset.current?.();},[state.model.id,state.prefs.view]);
 useEffect(()=>{document.documentElement.lang=i18n.resolvedLanguage==='zh'?'zh-CN':'en';},[i18n.resolvedLanguage]);
 async function capture(scale){try{downloadFile(await capturePNG(controller.last,scale,controller.screenRGB),captureName(state.model.id));}catch(e){controller.report('captureError',e.message);}}
 const enabled=state.loaded&&state.running&&!state.stopped&&!state.busy;
 const paused=state.loaded&&!state.running&&!state.stopped&&!state.busy,systemDisabled=!state.loaded||state.busy||state.stopped||state.transfer?.active||state.uploadBatch?.active;
 return <div className={`app-shell ${styles.shell}`}><header className="app-header"><a className="brand" href="./">Orchard<span> BETA</span></a>
  <Select aria-label={t('model')} value={String(state.model.id)} onChange={v=>controller.select(v)} data={CALCULATORS.map(c=>({value:String(c.id),label:c.name}))} disabled={!state.ready||state.busy} w={132}/>
  <Button onClick={()=>controller.chooseROM(()=>{rom.current.value='';rom.current.click();})} disabled={!state.ready||state.busy}>{t('open')}</Button><div className="header-spacer"/>
  <Text size="xs" c="dimmed" role="status">{t(state.busy?'loading':!state.ready?'loading':state.stopped?'stopped':!state.loaded?'noROM':state.running?'running':'paused')}</Text>
  <Tooltip label={<><div>{t('helpText')}</div><div>{t('boot'+state.model.id)}</div></>} multiline w={320} events={{hover:true,focus:true,touch:true}}><ActionIcon variant="subtle" color="gray" aria-label={t('help')}><HelpIcon/></ActionIcon></Tooltip>
  <Button variant="default" onClick={()=>setSettings(true)}>{t('settings')}</Button></header>
  <div className="app-toolbar"><Group gap="xs"><Button variant="light" disabled={!state.loaded||state.busy||state.stopped} onClick={()=>controller.toggle()}>{t(state.running?'pause':'resume')}</Button><Button variant="subtle" disabled={!state.loaded||state.busy} onClick={()=>controller.restart()}>{t('restart')}</Button>
   {!compact&&<Button.Group><Tooltip label={t('selfTestHelp')} multiline w={300}><Button variant="subtle" disabled={systemDisabled} onClick={()=>controller.systemChord('self-test')}>{t('selfTest')}</Button></Tooltip>
    <Menu><Menu.Target><Button variant="subtle" px={7} aria-label={t('selfTestActions')} disabled={systemDisabled}><ComboboxChevron/></Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={()=>controller.systemChord('warm-restart')}>{t('selfTestExit')}</Menu.Item></Menu.Dropdown></Menu>
   </Button.Group>}</Group>
   <Group gap="xs">{!compact&&<><Button variant="default" disabled={!state.loaded||state.busy} onClick={()=>controller.save()}>{t('save')}</Button><Button variant="default" disabled={!state.loaded||state.busy} onClick={()=>{session.current.value='';session.current.click();}}>{t('restore')}</Button>
   <Menu><Menu.Target><Button variant="default" disabled={!state.loaded}>{t('capture')}</Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={()=>capture(1)}>{t('screen1')}</Menu.Item><Menu.Item onClick={()=>capture(4)}>{t('screen4')}</Menu.Item></Menu.Dropdown></Menu>
   </>}
   {compact&&<Menu position="bottom-end"><Menu.Target><Button variant="default" rightSection={<ComboboxChevron/>} disabled={!state.loaded||state.busy}>{t('calculatorActions')}</Button></Menu.Target><Menu.Dropdown>
    <Menu.Item onClick={()=>controller.save()}>{t('save')}</Menu.Item><Menu.Item onClick={()=>{session.current.value='';session.current.click();}}>{t('restore')}</Menu.Item><Menu.Divider/>
    <Menu.Item onClick={()=>capture(1)}>{t('screen1')}</Menu.Item><Menu.Item onClick={()=>capture(4)}>{t('screen4')}</Menu.Item><Menu.Divider/>
    <Menu.Item disabled={systemDisabled} onClick={()=>controller.systemChord('self-test')}>{t('selfTest')}</Menu.Item><Menu.Item disabled={systemDisabled} onClick={()=>controller.systemChord('warm-restart')}>{t('selfTestExit')}</Menu.Item>
   </Menu.Dropdown></Menu>}
   <RecordingControl controller={controller} state={state} onDownload={downloadFile} compact={compact}/>
   <Button variant={connections?'light':'subtle'} aria-expanded={connections} aria-controls="device-sidebar" disabled={!state.loaded||state.busy} onClick={()=>setPanel(connections?null:'connections')}>{t('connections')}</Button></Group><Text size="xs" c="dimmed" role="status">{state.note?t(state.note):''}</Text></div>
  {!settings&&<ROMAccessNotice controller={controller} state={state}/>}
  {!connections&&<TransferStatus state={state} compact onOpen={()=>{setConnectionTarget(state.transfer.transport||'usb');setPanel('connections');}}/>}
  {paused&&<div className={styles.pausedBar} role="status"><PauseIcon/><Text size="sm" fw={600}>{t('paused')}</Text><Button variant="default" size="compact-sm" onClick={()=>controller.toggle()}>{t('resumeSimulation')}</Button></div>}
  <div className="calculator-body" data-panel-open={Boolean(panel)}>
   <CalculatorDisplay controller={controller} model={state.model} prefs={state.prefs} enabled={enabled} pointerReset={pointerReset}/>
   <aside id="device-sidebar" className="device-sidebar" aria-label={t('deviceSidebar')} hidden={!panel}>
    <Group justify="space-between" className="device-sidebar-header"><Text fw={600}>{t('deviceSidebar')}</Text><CloseButton aria-label={t('closeSidebar')} onClick={()=>setPanel(null)}/></Group>
    <Tabs value={panel||'connections'} onChange={setPanel} keepMounted keepMountedMode="display-none" className="device-sidebar-tabs">
     <Tabs.List><Tabs.Tab value="connections">{t('connections')}</Tabs.Tab>{hasSD&&<Tabs.Tab value="sd">{t('sdTitle')}</Tabs.Tab>}</Tabs.List>
     <Tabs.Panel value="connections" pt="md"><Connections controller={controller} state={state} target={connectionTarget} onTargetChange={setConnectionTarget}/></Tabs.Panel>
     {hasSD&&<Tabs.Panel value="sd" pt="md"><SDCard key={state.model.id} controller={controller} state={state}/></Tabs.Panel>}
    </Tabs>
   </aside>
  </div>
  <footer><span className={styles.footerLinks}><span>Orchard</span><a href="LICENSE">MIT</a><a href="debug.html">{t('developer')}</a></span><span className={styles.footerLinks}><span>{t('artwork')} <a href="https://github.com/zyf722/hp-calcs-svg">hp-calcs-svg</a></span><a href="licenses/hp-calcs-svg/NOTICE.txt">Apache-2.0 / NOTICE</a><span>{t('copyright')}</span></span></footer>
  <input ref={rom} id="rom" type="file" hidden onChange={e=>controller.open(e.target.files[0])}/><input ref={session} id="session-file" type="file" accept=".ord,.orchard" hidden onChange={e=>controller.restore(e.target.files[0])}/>
  {settings&&<Settings controller={controller} state={state} onClose={()=>setSettings(false)}/>}
  <Modal opened={Boolean(state.dialog)} onClose={()=>controller.answer(null)} title={state.dialog?t(state.dialog.title):''} zIndex={400} centered closeButtonProps={{'aria-label':t('close')}}>
   {state.dialog&&<><Text>{t(state.dialog.message,state.dialog.values)}</Text>{state.dialog.values.detail&&<details className="error-details"><summary>{t('details')}</summary><pre>{state.dialog.values.detail}</pre></details>}
    <Group justify="flex-end" mt="lg">{state.dialog.cancel&&<Button variant="default" onClick={()=>controller.answer(false)}>{t(state.dialog.cancel)}</Button>}<Button onClick={()=>controller.answer(true)}>{t(state.dialog.ok)}</Button></Group></>}
  </Modal>
 </div>;
}
const theme=createTheme({primaryColor:'teal',defaultRadius:'sm',fontFamily:'system-ui, sans-serif',fontSizes:{xs:'0.75rem',sm:'0.875rem',md:'1rem'},
 components:{Button:Button.extend({defaultProps:{size:'sm'}}),Modal:Modal.extend({defaultProps:{padding:'lg',overlayProps:{backgroundOpacity:.25,blur:0}},styles:{title:{fontWeight:600},header:{paddingBottom:'var(--mantine-spacing-md)'}}}),
 Tabs:Tabs.extend({styles:{tab:{fontWeight:500}}}),Select:Select.extend({defaultProps:{comboboxProps:{withinPortal:true}}})}});
export function Root({controller}){return <MantineProvider theme={theme}><App controller={controller}/></MantineProvider>;}
