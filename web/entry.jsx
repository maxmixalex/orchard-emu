// SPDX-License-Identifier: MIT
import React from 'react';
import {createRoot} from 'react-dom/client';
import i18n,{initialLanguage} from './i18n.js';
import {Root,downloadFile} from './App.jsx';
import {CalculatorController} from './controller.js';
let storage=null;try{storage=window.localStorage;}catch{}
await i18n.changeLanguage(initialLanguage(storage,navigator.language));
const controller=new CalculatorController({worker:new Worker(new URL('worker.js',import.meta.url),{type:'module'}),storage,locks:navigator.locks,
 mayRun:p=>(!p.pauseOnHidden||!document.hidden)&&(!p.pauseOnBlur||document.hasFocus()),download:downloadFile});
class Boundary extends React.Component{state={error:null};static getDerivedStateFromError(error){return {error};}render(){return this.state.error?<main style={{padding:24}}><h1>Orchard</h1><p>{i18n.t('workerFailure')}</p><details><summary>{i18n.t('details')}</summary><pre>{this.state.error.message}</pre></details></main>:this.props.children;}}
createRoot(document.getElementById('root')).render(<Boundary><Root controller={controller}/></Boundary>);
