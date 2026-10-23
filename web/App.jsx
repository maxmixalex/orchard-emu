// SPDX-License-Identifier: MIT
import React,{memo,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {MantineProvider,Button,Group,Modal,Select,Slider,Switch,Tabs,Text,TextInput,Textarea,Tooltip,Menu,Stack} from '@mantine/core';
import {useMediaQuery} from '@mantine/hooks';
import {PCKeyboardView} from './pc-keyboard-view.js';
import {TraditionalKeypad,MODEL_SLUGS} from './traditional-keypad.js';
import {RecordingControl} from './RecordingControl.jsx';
import {SDCard} from './SDCard.jsx';
import {FileTransfer,TransferStatus} from './FileTransfer.jsx';
import {useTranslation} from 'react-i18next';
import i18n,{LANG_KEY} from './i18n.js';
import {CALCULATORS} from './catalog.js';
import {keyRows} from './hp48.js';
import {SkinView} from './skin.js';
import {bindLifecycle} from './lifecycle.js';
import {bindings,keyCode,validatePreferences} from './preferences.js';
import {bindingCode} from './pc-keyboard.js';
import {capturePNG,captureName,createLCDRenderer} from './capture.js';
import '@mantine/core/styles.css';
import './react.css';
import './keyboards.css';
export function downloadFile(data,name){const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type:'application/octet-stream'}));
 const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Indicators(){return <svg className="annunciator-strip" viewBox="0 0 393 18" aria-label="LCD status">
 <g data-segment="1" transform="translate(22 9)"><path d="M9 -3H-1V-7L-9 0l8 7V3H9Z"/></g>
 <g data-segment="2" transform="translate(89 9)"><path d="M-9 -3H1V-7L9 0 1 7V3H-9Z"/></g>
 <g data-segment="3" transform="translate(156 9)"><text textAnchor="middle" y="5">α</text></g>
 <g data-segment="4" transform="translate(223 9)"><rect x="-9" y="-5" width="16" height="10" rx="1" fill="none" stroke="currentColor"/><path d="M8 -2h3v4H8zM-7 -3h3v6h-3z"/></g>
 <g data-segment="5" transform="translate(290 9)"><path d="M-6 -7H6M-6 7H6M-5 -6L5 6M5 -6L-5 6" stroke="currentColor"/></g>
 <g data-segment="0" transform="translate(357 9)"><path d="M-10 -4H7M3 -8l5 4-5 4M10 4H-7M-3 0l-5 4 5 4" fill="none" stroke="currentColor"/></g>
 </svg>;}
const CalculatorDisplay=memo(function CalculatorDisplay({controller,model,prefs,enabled}){
 const stage=useRef(null),workspace=useRef(null),host=useRef(null),view=useRef(null),keypadHost=useRef(null),keypad=useRef(null),ensureKeypadRef=useRef(null),prefsRef=useRef(prefs);
 prefsRef.current=prefs;
 useEffect(()=>{
  let disposed=false,raf=0,last=null,painted=null,ink='',active=null,keypadSpec=null;
  const skin=new SkinView(stage.current,scan=>controller.tap([scan]));view.current=skin;
  const canvas=stage.current.querySelector('canvas'),paintLCD=createLCDRenderer(canvas.getContext('2d',{alpha:false}));
  function skinError(e){if(!disposed){skin.glass.hidden=false;controller.report('skinError',e.message);}}
  // SVG text/shape measurements are needed only when this view is requested.
  function ensureKeypad(){
   if(disposed||keypad.current||!keypadSpec||prefsRef.current.view!=='traditional')return;
   try{
    keypad.current=new TraditionalKeypad(keypadHost.current,keypadSpec,scan=>{controller.tap([scan]);host.current.focus({preventScroll:true});});
    keypad.current.setEnabled(controller.state.loaded&&controller.state.running&&!controller.state.busy);
    keypad.current.update(last?.active??null);
   }catch(e){skinError(e);}
  }
  ensureKeypadRef.current=ensureKeypad;
  function fit(){if(disposed)return;const p=prefsRef.current,box=workspace.current,[w,h]=skin.stage.style.aspectRatio.split('/').map(Number);
   const width=Math.max(180,box.clientWidth-32),height=Math.max(240,box.clientHeight-24),dpr=window.devicePixelRatio||1;
   const caseWidth=Math.round(Math.min(width,height*(w/h||.497))*p.zoom/100*dpr)/dpr;
   host.current.style.setProperty('--case-width',`${caseWidth}px`);
   const lcdHeight=last?.height??(model.id>=5?80:64),lcdWidth=last?.width??131;
   // Traditional keys now use measured SVG geometry. Fit the LCD and that
   // geometry together; the old HTML-row height does not resize an SVG keypad.
   const bounds=keypad.current?.bounds,keyRatio=bounds?bounds.height/bounds.width:1.5;
   const inner=Math.max(lcdWidth/dpr,(height-74)/(lcdHeight/lcdWidth+18/393+keyRatio));
   const plain=Math.min(width,500,inner+46)*p.zoom/100;host.current.style.setProperty('--plain-width',`${plain}px`);
   host.current.style.setProperty('--lcd-width',`${Math.max(lcdWidth/dpr,Math.floor((plain-46)*dpr/lcdWidth)*lcdWidth/dpr)}px`);
  }
  function paint(){raf=0;if(!last||disposed)return;const d=last;
   const changed=!painted||ink!==skin.rgb.join(',')||painted.width!==d.width||painted.height!==d.height||
    (d.pixels? !painted.pixels||painted.pixels.length!==d.pixels.length||d.pixels.some((v,i)=>v!==painted.pixels[i]):painted.pixels!==null);
   if(changed){
    if(canvas.width!==d.width)canvas.width=d.width;
    if(canvas.height!==d.height)canvas.height=d.height;
    const frame=d.pixels?d:{...d,pixels:new Uint8Array(d.width*d.height),frameStatus:0};
    paintLCD(frame,skin.rgb);painted=d;ink=skin.rgb.join(',');}
   controller.screenRGB=skin.rgb;skin.update(d.active,d.annunciators,d.annunciatorStatus,model.id);
   if(active!==d.active){for(const button of host.current.querySelectorAll('.traditional-key'))button.setAttribute('aria-pressed',String(Number(button.dataset.scan)===d.active));active=d.active;}
  }
  const unframe=controller.onFrame(d=>{last=d;if(!raf)raf=requestAnimationFrame(paint);});
  skin.show(model.id).then(async()=>{if(disposed)return;const m=await skin.manifest;if(disposed)return;
   keypadSpec=m.models[MODEL_SLUGS[model.id]];ensureKeypad();
   fit();paint();skin.setEnabled(controller.state.loaded&&controller.state.running&&!controller.state.busy&&prefsRef.current.view==='immersive');
  }).catch(skinError);
  const resize=new ResizeObserver(fit);resize.observe(workspace.current);window.addEventListener('resize',fit);fit();
  return()=>{disposed=true;++skin.epoch;if(ensureKeypadRef.current===ensureKeypad)ensureKeypadRef.current=null;keypad.current?.destroy();keypad.current=null;cancelAnimationFrame(raf);unframe();resize.disconnect();window.removeEventListener('resize',fit);};
 },[controller,model.id]);
 useEffect(()=>{ensureKeypadRef.current?.();view.current?.setEnabled(enabled&&prefs.view==='immersive');keypad.current?.setEnabled(enabled&&prefs.view==='traditional');window.dispatchEvent(new Event('resize'));},[enabled,prefs.view,prefs.zoom]);
 return <main id="workspace" ref={workspace}><section id="calculator" ref={host} tabIndex={0} data-view={prefs.view}>
  <div className="calculator-stage" ref={stage} id="skin-stage"><img className="skin-image" alt={model.name} hidden/><svg className="skin-keys"/>
   <div className="glass-overlay"><Indicators/><canvas id="lcd" width="131" height={model.id>=5?80:64}/></div></div>
  <div className="traditional-keypad" ref={keypadHost}/>
 </section></main>;
});
function KeyboardMap({selected,mods,onChoose}){
 const host=useRef(null),view=useRef(null),choose=useRef(onChoose);choose.current=onChoose;
 useEffect(()=>{view.current=new PCKeyboardView(host.current,token=>choose.current(token));return()=>view.current.destroy();},[]);
 useEffect(()=>{view.current?.update(selected,mods);},[selected,mods]);
 return <div className="pc-keyboard"><div ref={host}/></div>;
}
function MappingEditor({model,draft,onChange}){
 const {t}=useTranslation();const [selected,setSelected]=useState('KeyA'),[mods,setMods]=useState([]);
 const code=bindingCode(selected,mods),map=bindings(draft,model.id),sequence=map[code]||[],names=keyRows(model.id).flat().map(([label,s])=>({value:String(s),label}));
 function setSequence(next){onChange({...draft,mappings:{...draft.mappings,[model.id]:{...draft.mappings[model.id],[code]:next}}});}
 function choose(token){if(token.startsWith('{')){const mod=token.slice(1,-1);setMods(m=>m.includes(mod)?m.filter(x=>x!==mod):[...m,mod]);}else setSelected(token);}
 function capture(e){e.preventDefault();e.stopPropagation();const value=keyCode(e);if(!value)return;const parts=value.split('+');setSelected(parts.pop());setMods(parts);}
 return <Stack gap="sm"><Text size="sm" c="dimmed">{t('keyboardHint')}</Text>
  <KeyboardMap selected={selected} mods={mods} onChoose={choose}/>
  <Group grow><TextInput label={t('pcKey')} value={code} readOnly onKeyDown={capture} description={t('captureKey')}/><Text size="sm">{sequence.map(s=>names.find(n=>n.value===String(s))?.label).join(' → ')||t('unassigned')}</Text></Group>
  <Text size="sm" fw={600}>{t('sequence')}</Text>
  {sequence.map((scan,i)=><Group key={i} wrap="nowrap"><Select aria-label={`${t('sequence')} ${i+1}`} data={names} value={String(scan)} onChange={v=>{if(v){const n=[...sequence];n[i]=Number(v);setSequence(n);}}} style={{flex:1}}/><Button variant="subtle" onClick={()=>setSequence(sequence.filter((_,j)=>j!==i))} aria-label={t('removeStep')}>−</Button></Group>)}
  <Group><Button size="xs" variant="light" disabled={sequence.length>=8} onClick={()=>setSequence([...sequence,6])}>{t('addStep')}</Button><Button size="xs" variant="subtle" onClick={()=>setSequence([])}>{t('unassign')}</Button><Button size="xs" variant="subtle" onClick={()=>{const m={...draft.mappings[model.id]};delete m[code];onChange({...draft,mappings:{...draft.mappings,[model.id]:m}});}}>{t('defaultKey')}</Button></Group>
  <Text size="xs" c="dimmed">{t('keyStateHint')}</Text></Stack>;
}
function Settings({controller,state,onClose}){
 const {t}=useTranslation(),small=useMediaQuery('(max-width: 48em)');const [draft,setDraft]=useState(()=>validatePreferences(state.prefs)),[language,setLanguage]=useState(i18n.resolvedLanguage);
 const set=(k,v)=>setDraft(p=>({...p,[k]:v}));
 return <Modal opened trapFocus={!state.dialog} onClose={onClose} title={t('settings')} size="xl" fullScreen={small} closeButtonProps={{'aria-label':t('close')}}>
  <Tabs defaultValue="general" keepMounted={false}><Tabs.List>{['general','keyboard','storage'].map(k=><Tabs.Tab key={k} value={k}>{t(k)}</Tabs.Tab>)}</Tabs.List>
   <Tabs.Panel value="general" pt="md"><Stack><Select label={t('language')} value={language} onChange={setLanguage} data={[{value:'zh',label:'简体中文'},{value:'en',label:'English'}]}/>
    <Select label={t('view')} value={draft.view} onChange={v=>set('view',v)} data={['immersive','traditional'].map(k=>({value:k,label:t(k)}))}/>
    <div><Text size="sm">{t('size')} · {draft.zoom}%</Text><Slider min={50} max={180} step={5} value={draft.zoom} onChange={v=>set('zoom',v)} aria-label={t('size')}/></div>
    <Switch label={t('pauseBlur')} checked={draft.pauseOnBlur} onChange={e=>set('pauseOnBlur',e.currentTarget.checked)}/><Switch label={t('pauseHidden')} checked={draft.pauseOnHidden} onChange={e=>set('pauseOnHidden',e.currentTarget.checked)}/>
    <Select label={t('speed')} value={String(draft.speed)} onChange={v=>set('speed',Number(v))} data={[[.5,'half'],[1,'normal'],[2,'double'],[0,'unlimited']].map(([v,k])=>({value:String(v),label:t(k)}))}/>
   </Stack></Tabs.Panel>
   <Tabs.Panel value="keyboard" pt="md"><MappingEditor model={state.model} draft={draft} onChange={setDraft}/></Tabs.Panel>
   <Tabs.Panel value="storage" pt="md"><Stack><Switch label={t('autosave')} checked={draft.autosave} onChange={e=>set('autosave',e.currentTarget.checked)}/><Select label={t('interval')} value={String(draft.interval)} onChange={v=>set('interval',Number(v))} data={[15,30,60,120].map(v=>({value:String(v),label:t('seconds',{count:v})}))}/><Text size="sm" c="dimmed">{t('storagePrivacy')}</Text><Button variant="light" color="red" onClick={()=>controller.clearSaves()}>{t('deleteSaves')}</Button></Stack></Tabs.Panel>
  </Tabs><Group justify="flex-end" mt="lg"><Button variant="default" onClick={onClose}>{t('cancel')}</Button><Button onClick={()=>{controller.setPreferences(draft);void i18n.changeLanguage(language);try{controller.storage?.setItem(LANG_KEY,language);}catch{}onClose();}}>{t('apply')}</Button></Group>
 </Modal>;
}
function Connections({controller,state,target,onTargetChange,onClose}){
 const {t}=useTranslation();const [format,setFormat]=useState('hex'),[text,setText]=useState('');
 const active=Boolean(state.transfer?.active||state.uploadBatch?.active);
 function send(){try{let bytes;if(format==='text')bytes=new TextEncoder().encode(text);else{const value=text.trim();if(!/^[a-f\d]{2}(?:\s+[a-f\d]{2})*$/i.test(value))throw Error('hex');bytes=Uint8Array.from(value.split(/\s+/).map(x=>parseInt(x,16)));}
  if(bytes.length>(target==='serial'?1024:64))throw Error('length');controller.send(target==='serial'?'uart':'usb-send',{bytes});}catch{controller.report('invalidBytes');}}
 return <Modal opened trapFocus={!state.dialog} onClose={onClose} title={t('connections')} size="lg" closeButtonProps={{'aria-label':t('close')}}><Stack>
  <Group justify="space-between"><Text>{t('serial')} · {t(state.serial?'connected':'disconnected')}</Text><Button variant="light" aria-label={`${t(state.serial?'disconnect':'connect')} ${t('serial')}`} onClick={()=>controller.connectLink('serial',!state.serial)}>{t(state.serial?'disconnect':'connect')}</Button></Group>
  <Group justify="space-between"><Text>USB · {t(state.usbReady?'connected':state.usb?'connecting':'disconnected')}</Text><Button variant="light" aria-label={`${t(state.usb?'disconnect':'connect')} USB`} onClick={()=>controller.connectLink('usb',!state.usb)}>{t(state.usb?'disconnect':'connect')}</Button></Group>
  {state.usbInfo&&<Text size="sm">{state.usbInfo.manufacturer} · {state.usbInfo.name} · {state.usbInfo.vendor.toString(16).padStart(4,'0')}:{state.usbInfo.product.toString(16).padStart(4,'0')}</Text>}
  <Select label={t('target')} value={target} onChange={value=>{if(value)onTargetChange(value);}} disabled={active} data={['serial','usb'].map(k=>({value:k,label:t(k)}))}/>
  <Tabs defaultValue="files" keepMounted><Tabs.List><Tabs.Tab value="files">{t('transferFiles')}</Tabs.Tab><Tabs.Tab value="bytes">{t('rawConnection')}</Tabs.Tab></Tabs.List>
  <Tabs.Panel value="files" pt="md"><FileTransfer controller={controller} state={state} transport={target}/></Tabs.Panel>
  <Tabs.Panel value="bytes" pt="md"><Stack><Text size="sm" c="dimmed">{t('linkNotice')}</Text>
  <Select label={t('format')} value={format} onChange={setFormat} disabled={active} data={['hex','text'].map(k=>({value:k,label:t(k)}))}/>
  <Textarea label={t('data')} value={text} onChange={e=>setText(e.currentTarget.value)} maxLength={4096}/>
  <Group><Button disabled={active||(target==='serial'?!state.serial:!state.usbReady)} onClick={send}>{t('send')}</Button><Button variant="light" disabled={active||!state.usbReady} onClick={()=>controller.send('usb-read')}>{t('receive')}</Button><Button variant="subtle" onClick={()=>controller.patch({log:''})}>{t('clear')}</Button></Group>
  <pre className="link-log">{state.log||'—'}</pre></Stack></Tabs.Panel></Tabs></Stack></Modal>;
}
export function App({controller}){
 const {t}=useTranslation(),state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot),[settings,setSettings]=useState(false),[connections,setConnections]=useState(false),[sdOpen,setSDOpen]=useState(false),[connectionTarget,setConnectionTarget]=useState('usb');
 const rom=useRef(null),session=useRef(null),modalOpen=settings||connections||sdOpen||Boolean(state.dialog),modalRef=useRef(modalOpen);modalRef.current=modalOpen;
 useEffect(()=>{const unbind=bindLifecycle(window,document,()=>controller.pause(),{preferences:()=>controller.state.prefs,release:()=>controller.release(),save:()=>controller.requestAuto()});
  const key=e=>{if(e.repeat||e.isComposing||modalRef.current||e.target.closest('input,textarea,select,[contenteditable="true"]')||e.target.closest('button,[role="button"]')&&(e.key==='Enter'||e.key===' '))return;
   const s=controller.state,code=keyCode(e),seq=code?bindings(s.prefs,s.model.id)[code]:null;if(seq?.length&&s.loaded&&s.running&&!s.busy){e.preventDefault();controller.tap(seq);}};
  const storage=e=>controller.foreignSave(e.key);window.addEventListener('keydown',key);window.addEventListener('storage',storage);
  return()=>{unbind();window.removeEventListener('keydown',key);window.removeEventListener('storage',storage);};},[controller]);
 useEffect(()=>{document.documentElement.lang=i18n.resolvedLanguage==='zh'?'zh-CN':'en';},[i18n.resolvedLanguage]);
 async function capture(scale){try{downloadFile(await capturePNG(controller.last,scale,controller.screenRGB),captureName(state.model.id));}catch(e){controller.report('captureError',e.message);}}
 const enabled=state.loaded&&state.running&&!state.stopped&&!state.busy;
 return <div className="app-shell"><header className="app-header"><a className="brand" href="./">Orchard<span> BETA</span></a>
  <Select aria-label={t('model')} value={String(state.model.id)} onChange={v=>controller.select(v)} data={CALCULATORS.map(c=>({value:String(c.id),label:c.name}))} disabled={!state.ready||state.busy} w={132}/>
  <Button onClick={()=>{rom.current.value='';rom.current.click();}} disabled={!state.ready||state.busy}>{t('open')}</Button><div className="header-spacer"/>
  <Text size="xs" c="dimmed" role="status">{t(state.busy?'loading':!state.ready?'loading':state.stopped?'stopped':!state.loaded?'noROM':state.running?'running':'paused')}</Text>
  <Tooltip label={<><div>{t('helpText')}</div><div>{t('boot'+state.model.id)}</div></>} multiline w={320} events={{hover:true,focus:true,touch:true}}><Button variant="subtle" aria-label={t('help')}>?</Button></Tooltip>
  <Button variant="default" onClick={()=>setSettings(true)}>{t('settings')}</Button></header>
  <div className="app-toolbar"><Group gap="xs"><Button variant="light" disabled={!state.loaded||state.busy||state.stopped} onClick={()=>controller.toggle()}>{t(state.running?'pause':'resume')}</Button><Button variant="subtle" disabled={!state.loaded||state.busy} onClick={()=>controller.restart()}>{t('restart')}</Button></Group>
   <Group gap="xs"><Button variant="default" disabled={!state.loaded||state.busy} onClick={()=>controller.save()}>{t('save')}</Button><Button variant="default" disabled={!state.loaded||state.busy} onClick={()=>{session.current.value='';session.current.click();}}>{t('restore')}</Button>
   <Menu><Menu.Target><Button variant="default" disabled={!state.loaded}>{t('capture')}</Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={()=>capture(1)}>{t('screen1')}</Menu.Item><Menu.Item onClick={()=>capture(4)}>{t('screen4')}</Menu.Item></Menu.Dropdown></Menu>
   {[5,6].includes(state.model.id)&&<Button variant="default" disabled={!state.loaded||state.busy} onClick={()=>setSDOpen(true)}>{t('sdTitle')}</Button>}
   <RecordingControl controller={controller} state={state} onDownload={downloadFile}/>
   <Button variant="subtle" disabled={!state.loaded||state.busy} onClick={()=>setConnections(true)}>{t('connections')}</Button></Group><Text size="xs" c="dimmed" role="status">{state.note?t(state.note):''}</Text></div>
  {!connections&&<TransferStatus state={state} compact onOpen={()=>{setConnectionTarget(state.transfer.transport||'usb');setConnections(true);}}/>}
  <CalculatorDisplay controller={controller} model={state.model} prefs={state.prefs} enabled={enabled}/>
  <footer><span>Orchard · <a href="LICENSE">MIT</a> · <a href="debug.html">{t('developer')}</a></span><span>{t('artwork')} <a href="https://github.com/zyf722/hp-calcs-svg">hp-calcs-svg</a> · <a href="licenses/hp-calcs-svg/NOTICE.txt">Apache-2.0 / NOTICE</a> · {t('copyright')}</span></footer>
  <input ref={rom} id="rom" type="file" accept=".bin,.rom,.raw" hidden onChange={e=>controller.open(e.target.files[0])}/><input ref={session} id="session-file" type="file" accept=".ord,.orchard" hidden onChange={e=>controller.restore(e.target.files[0])}/>
  {settings&&<Settings controller={controller} state={state} onClose={()=>setSettings(false)}/>}{connections&&<Connections controller={controller} state={state} target={connectionTarget} onTargetChange={setConnectionTarget} onClose={()=>setConnections(false)}/>}
  {sdOpen&&[5,6].includes(state.model.id)&&<SDCard controller={controller} state={state} onClose={()=>setSDOpen(false)}/>}
  <Modal opened={Boolean(state.dialog)} onClose={()=>controller.answer(null)} title={state.dialog?t(state.dialog.title):''} zIndex={400} centered closeButtonProps={{'aria-label':t('close')}}>
   {state.dialog&&<><Text>{t(state.dialog.message,state.dialog.values)}</Text>{state.dialog.values.detail&&<details className="error-details"><summary>{t('details')}</summary><pre>{state.dialog.values.detail}</pre></details>}
    <Group justify="flex-end" mt="lg">{state.dialog.cancel&&<Button variant="default" onClick={()=>controller.answer(false)}>{t(state.dialog.cancel)}</Button>}<Button onClick={()=>controller.answer(true)}>{t(state.dialog.ok)}</Button></Group></>}
  </Modal>
 </div>;
}
export function Root({controller}){return <MantineProvider theme={{primaryColor:'teal',defaultRadius:'md',fontFamily:'system-ui, sans-serif'}}><App controller={controller}/></MantineProvider>;}
