// SPDX-License-Identifier: MIT
// Identical private game checkpoint, three read-only display observers.
// Shared by Node and the real-browser witness; no calculator program is bundled.
import {LCDFrames} from '../web/lcd-frames.js';
import {applySetup,setupHash} from '../web/hp48.js';

const check=(value,message)=>{if(!value)throw Error(message);};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];

export async function measureLCDGame({wasm,rom,checkpoint,model,preset,ticks=12000000,repeats=3}){
  check(Number.isSafeInteger(ticks)&&ticks>=1200000&&ticks<=120000000,'Use 0.1–10 reference seconds');
  check(Number.isInteger(repeats)&&repeats>=1&&repeats<=7,'Use 1–7 repeats');
  const romHash=await digest(rom);check(romHash===setupHash(preset),'An admitted original NOR is required');
  const module=await WebAssembly.compile(wasm);
  const modes=['after-slice','scan-boundary','scan-boundary-smooth'];
  const replay=async(mode,inspect)=>{
    // Fresh instances are essential: restoring a checkpoint deliberately does
    // not disable a host observer that was enabled by an earlier run.
    const c=(await WebAssembly.instantiate(module,{})).exports;
    check(c.create(model)===0,'create');
    new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.byteLength).set(new Uint8Array(rom));
    check(c.load(rom.byteLength)===0,'load');applySetup(c,model,preset);
    new Uint8Array(c.memory.buffer,c.checkpoint_buffer(checkpoint.byteLength),checkpoint.byteLength).set(new Uint8Array(checkpoint));
    check(c.checkpoint_load(checkpoint.byteLength)===0,'checkpoint_load');
    const snapshot=()=>new Uint32Array(c.memory.buffer,c.snapshot(),33).slice();
    const initial=snapshot(),start=initial[22]+initial[23]*4294967296;
    const hz=c.timebase_hz(),period=Math.round(hz/60),source=new LCDFrames();
    source.configure({response:mode==='scan-boundary-smooth'?'smooth':'instant'});
    // The old host cache samples live RAM after each run slice. Hiding only
    // the new observer export reproduces that path without changing the guest.
    const readCore=mode==='after-slice'?{...c,lcd_observe:undefined}:c;
    let tick=start,next=start,previous=null,changes=0,sameScanChanges=0,maxScanGap=0,sourceChanges=0,frame;
    const samples=[];
    frame=source.read(readCore,model,1,tick,true);
    const sample=()=>{
      if(!inspect)return;
      check(frame.frameStatus===0&&frame.pixels,'LCD decode');
      const pixels=frame.pixels.slice();let sum=0,step=0,changed=false;
      for(let i=0;i<pixels.length;i++){
        sum+=pixels[i];if(previous){step+=Math.abs(pixels[i]-previous.pixels[i]);changed ||= pixels[i]!==previous.pixels[i];}
      }
      if(changed){changes++;if(previous.serial===frame.frameSerial)sameScanChanges++;}
      if(previous)maxScanGap=Math.max(maxScanGap,frame.frameSerial-previous.serial);
      samples.push({tick:tick-start,serial:frame.frameSerial,mean_ink:sum/pixels.length,mean_pixel_step:step/pixels.length,pixels});
      previous={pixels,serial:frame.frameSerial};
    };
    const began=performance.now();
    while(tick<start+ticks){
      if(tick===next){sample();next+=period;}
      const count=Math.min(1024,next-tick,start+ticks-tick);
      const status=c.run(count);check(status===0,`Guest stopped: ${status}, snapshot ${Array.from(snapshot())}`);
      tick+=count;c.uart_receive();
      const image=source.read(readCore,model,1,tick);if(image!==frame)sourceChanges++;
      frame=image;
    }
    sample();const wall=performance.now()-began,final=snapshot();
    check(c.checkpoint_save()===0,'checkpoint_save');
    const finalBytes=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
    const checkpointHash=await digest(finalBytes);
    const summary={mode,wall_ms:wall,ticks,reference_seconds:ticks/hz,reference_speed:(ticks/hz)/(wall/1000),
      instructions:(final[20]+final[21]*4294967296)-(initial[20]+initial[21]*4294967296),
      start_tick:start,end_tick:tick,final_checkpoint_sha256:checkpointHash,source_updates:sourceChanges};
    if(inspect){
      const frames=await Promise.all(samples.map(async({pixels,...item})=>({...item,sha256:await digest(pixels)})));
      Object.assign(summary,{samples:frames.length,changed_samples:changes,same_scan_changes:sameScanChanges,max_scans_between_samples:maxScanGap,
        min_mean_ink:Math.min(...frames.map(x=>x.mean_ink)),max_mean_ink:Math.max(...frames.map(x=>x.mean_ink)),
        white_samples:frames.filter(x=>x.mean_ink===0).length,
        mean_pixel_step:frames.slice(1).reduce((sum,x)=>sum+x.mean_pixel_step,0)/Math.max(1,frames.length-1),
        max_pixel_step:Math.max(...frames.map(x=>x.mean_pixel_step)),frames});
    }
    return summary;
  };
  const evidence=[];
  for(const mode of modes)evidence.push(await replay(mode,true));
  const hash=evidence[0].final_checkpoint_sha256;
  check(evidence.every(x=>x.final_checkpoint_sha256===hash),'Display observer changed guest state');
  const timing=Object.fromEntries(modes.map(x=>[x,[]]));
  // The evidence replay warms every variant; alternate order afterwards.
  for(let round=0;round<repeats;round++)for(const mode of round%2?[...modes].reverse():modes){
    const result=await replay(mode,false);check(result.final_checkpoint_sha256===hash,'Timing replay diverged');timing[mode].push(result.wall_ms);
  }
  return {schema:'orchard-lcd-game-v1',passed:true,model,preset,rom_sha256:romHash,wasm_sha256:await digest(wasm),
    checkpoint_sha256:await digest(checkpoint),ticks,repeats,sample_hz:60,max_run_slice:1024,
    guest_state_equal:true,canonical_hardware_speed:false,
    scope:'Production WASM and LCDFrames, identical private checkpoint, 60 Hz output samples. Measures core and host publication; excludes Worker messaging, canvas and compositor. 12 MHz functional reference, not physical ARM/LCD calibration.',
    variants:evidence,timing_ms:timing,median_ms:Object.fromEntries(modes.map(x=>[x,median(timing[x])]))};
}
