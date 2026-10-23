// SPDX-License-Identifier: MIT
// Offline real-canvas witness. Uses the production app/controller/recorder;
// its frames are synthetic and contain no calculator firmware pixels.
import './ui-fixture.jsx';
import {capturePNG} from '../web/capture.js';
import {LCDRecorder} from '../web/recording.js';
window.__captureLCD=()=>capturePNG(window.__controller.last,1,window.__controller.screenRGB);
window.__recordLCD=()=>{
  const c=window.__controller,r=new LCDRecorder(c.last,{scale:1,background:c.screenRGB});
  const off=c.onFrame(frame=>r.update(frame,c.screenRGB));
  r.finished.finally(off);window.__recording=r;return true;
};
