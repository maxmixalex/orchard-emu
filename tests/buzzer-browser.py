# SPDX-License-Identifier: MIT
"""Real Chromium Web Audio lifecycle. Optional private original-ROM trace.

ORCHARD_BUZZER_TRACE accepts the output of tools/verify-buzzer-stock.mjs;
the trace and report stay in the caller's private build directory. No ROM,
recorded sound, or LCD is packaged by this test.
"""
from pathlib import Path
import json, os, shutil, subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
bundle = subprocess.run(['node', '--input-type=module', '-e',
    "import{build}from'esbuild';const r=await build({entryPoints:['web/buzzer-audio.js'],bundle:true,format:'iife',globalName:'OrchardBuzzer',write:false});process.stdout.write(r.outputFiles[0].text);"],
    cwd=ROOT, check=True, capture_output=True, text=True).stdout
trace = os.environ.get('ORCHARD_BUZZER_TRACE')
if trace:
    evidence = json.loads(Path(trace).read_text())
    packets = evidence.get('buzzer_packets', evidence.get('records'))
    packets = [dict(tick=p['tick'], epoch=1, level=p['edges'][-1],
                    timebase=12000000, edges=p['edges']) for p in packets if p['edges']]
else:
    packets = [dict(tick=120000, epoch=1, level=0, timebase=12000000,
                    edges=[value for n in range(21) for value in (n*6000, n%2)])]
with sync_playwright() as p:
    chrome = os.environ.get('CHROMIUM') or next((shutil.which(n) for n in
        ['google-chrome', 'chromium', 'chromium-browser'] if shutil.which(n)), None)
    if not chrome:
        raise RuntimeError('Set CHROMIUM to a real Chromium executable')
    browser = p.chromium.launch(executable_path=chrome, headless=True, args=['--no-sandbox'])
    page = browser.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content('<button id="unlock">Enable firmware sound</button>')
    page.add_script_tag(content=bundle)
    page.evaluate('''()=>{
      window.audio=new OrchardBuzzer.BuzzerAudio();window.measure={buffers:0,nonzero:0,peak:0};
      document.querySelector('#unlock').onclick=async()=>{
        await audio.unlock();const context=audio.context,original=context.createBuffer.bind(context);
        context.createBuffer=(...args)=>{const b=original(...args),copy=b.copyToChannel.bind(b);
          b.copyToChannel=(samples,...rest)=>{measure.buffers++;for(const s of samples){measure.peak=Math.max(measure.peak,Math.abs(s));if(s!==0)measure.nonzero++;}copy(samples,...rest);};return b;};
        window.unlocked=context.state;
      };
    }''')
    assert page.evaluate('audio.context===null'), 'No AudioContext before user gesture'
    page.click('#unlock');page.wait_for_function("window.unlocked==='running'")
    page.evaluate('''packets=>{for(const p of packets)audio.receive({...p,edges:Float64Array.from(p.edges)});
      measure.sampleRate=audio.context.sampleRate;measure.state=audio.context.state;
      measure.scheduled=audio.sources.size;audio.reset();measure.afterPause=audio.sources.size;
      audio.dispose();measure.disposed=audio.dead;
    }''', packets)
    report = page.evaluate('measure')
    assert report['buffers'] > 0 and report['nonzero'] > 0 and report['peak'] > 0.1, report
    assert report['state'] == 'running' and report['afterPause'] == 0 and report['disposed'], report
    assert not errors, errors
    report['original_rom_trace'] = bool(trace)
    output = Path(os.environ.get('ORCHARD_BUZZER_BROWSER_REPORT', ROOT/'build/buzzer-browser.json'))
    output.parent.mkdir(parents=True, exist_ok=True);output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report));browser.close()
