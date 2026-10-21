# SPDX-License-Identifier: MIT
"""Generated guest stop -> real Worker Save -> diagnostic decode regression.

Uses the existing React component fixture and the production Worker/WASM.
The generated ROM is introduced through the fixture's controller in strict
mode; this is not original-ROM compatibility or latency acceptance.
"""
from __future__ import annotations

import argparse
import base64
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError as BrowserTimeout, expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('latency_probe', ROOT / 'tools/probe-browser-latency.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

BUNDLE = r'''
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const source=await readFile('tests/ui-fixture.jsx','utf8');
assert(source.includes("import {Root} from '../web/App.jsx';"));
assert(source.includes('window.__controller=c;'));
const contents=source.replace("import {Root}","import {Root,downloadFile}")
 .replace('window.__controller=c;','window.__controller=c;window.__downloadFile=downloadFile;');
await build({stdin:{contents,resolveDir:resolve('tests'),sourcefile:'stop-recovery-fixture.jsx',loader:'jsx'},
 bundle:true,format:'iife',target:'es2022',outfile:process.argv[2],
 define:{'process.env.NODE_ENV':'"production"','import.meta.url':'"https://offline.invalid/calculator.js"'}});
'''


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, diagnostic_trace=False, **kwargs):
        self.diagnostic_trace = diagnostic_trace
        super().__init__(*args, **kwargs)

    def log_message(self, *_args):
        pass

    def do_GET(self):
        # Serve dedicated-Worker module requests through the same explicit
        # test-server boundary as the original-ROM probe.
        if self.diagnostic_trace:
            path = urlsplit(self.path).path
            body = None
            if path == '/__orchard-trace.mjs':
                body = (ROOT / 'tools/browser-core-trace.mjs').read_bytes()
            elif path == '/__orchard-runtime-trace.mjs':
                body = (ROOT / 'tools/browser-runtime-trace.mjs').read_bytes()
            elif path == '/worker.js':
                body = probe.instrument_worker_source(
                    (Path(self.directory) / 'worker.js').read_text(), './__orchard-trace.mjs').encode()
            if body is not None:
                self.send_response(200)
                self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        super().do_GET()


def check_active_diagnostic_recovery(page, tmp, dist, errors):
    """A running timeout must preserve its observation before a verified Pause."""
    rom = bytearray(b'\xff' * 1048576)
    # Disable the watchdog, then run a branch loop with no expected LCD result.
    for address, word in [(0, 0xea000002), (16, 0xe59f0008), (20, 0xe3a01000),
                          (24, 0xe5801000), (28, 0xeafffffe), (32, 0x53000000)]:
        struct.pack_into('<I', rom, address, word)
    rom_path = tmp / 'generated-running.bin'
    rom_path.write_bytes(rom)

    def start():
        page.evaluate('''encoded=>{
          const rom=Uint8Array.from(atob(encoded),ch=>ch.charCodeAt(0));
          const c=window.__controller;c.create({...c.state.model,preset:'strict'},rom.buffer);
        }''', base64.b64encode(rom).decode())
        probe.wait_probe(page, '''p.traceEpoch&&p.snap?.loaded&&p.snap.running&&
          !p.snap.stopped&&p.traceEpoch.generation===p.generation''')

    start()
    try:
        probe.wait_probe(page, 'false', timeout=100)
        raise AssertionError('Generated running scene did not time out')
    except BrowserTimeout:
        pass
    assert probe.capture_failure_evidence(page, tmp, 'active-timeout', errors) == []
    original = tmp / 'active-timeout-failure.json'
    before = original.read_bytes()
    assert json.loads(before)['probe']['snapshot']['running']
    result = probe.export_diagnostic_failure(page, tmp / 'active-timeout-trace.json', dist, rom_path)
    assert result['recovery_action'] == 'pause-then-capture', result
    assert result['complete'] and result['runtime_complete'] and result['replay_passed'], result
    assert result['replay']['run_calls'] > 0 and result['replay']['stop'][0] == 0
    assert result['replay']['complete_checkpoint_equal']
    assert original.read_bytes() == before, 'Diagnostic recovery replaced the original timeout'
    assert not page.evaluate('globalThis.__orchardProbe.snap.running')

    class AlterPauseAcknowledgement:
        def __init__(self, field):
            self.field = field
            self.pause_confirmed = False

        def get_by_role(self, role, **kwargs):
            locator = page.get_by_role(role, **kwargs)
            if role != 'button' or kwargs.get('name') != 'Pause':
                return locator
            field = self.field
            isolated = self

            class Button:
                def click(self, **click_kwargs):
                    # Install before the real Pause. An ack arriving after
                    # click() returns must remain hidden for the entire wait.
                    page.evaluate('''field=>{
                      const p=globalThis.__orchardProbe;
                      const descriptor=Object.getOwnPropertyDescriptor(p,field);
                      const hook={p,field,descriptor,latest:descriptor.value,acks:0};
                      if(globalThis.__orchardPauseIsolation)throw Error('Pause isolation already installed');
                      globalThis.__orchardPauseIsolation=hook;
                      const isolated=field==='pauseSnapshot'?null:descriptor.value+1;
                      Object.defineProperty(p,field,{configurable:true,enumerable:descriptor.enumerable,
                        get:()=>isolated,set:value=>{hook.latest=value;if(value!==null)++hook.acks;}});
                    }''', field)
                    locator.click(**click_kwargs)
                    # The controller independently receives the real Worker
                    # snapshot. Prove Pause happened before testing rejection.
                    page.wait_for_function('''()=>{
                      const s=window.__controller.last,h=globalThis.__orchardPauseIsolation;
                      return s?.loaded&&!s.running&&!s.stopped&&
                        (h.field!=='pauseSnapshot'||h.acks>0);
                    }''', timeout=5000)
                    isolated.pause_confirmed = True

            return Button()

        def restore(self):
            return page.evaluate('''()=>{
              const h=globalThis.__orchardPauseIsolation;
              if(!h)return null;
              Object.defineProperty(h.p,h.field,{...h.descriptor,value:h.latest});
              delete globalThis.__orchardPauseIsolation;
              const restored=Object.getOwnPropertyDescriptor(h.p,h.field);
              return {field:h.field,acks:h.acks,restored:!restored.get&&!restored.set&&
                restored.value===h.latest};
            }''')

        def __getattr__(self, name):
            return getattr(page, name)

    # Real Pause still runs, but its acknowledgement is unavailable or belongs
    # to another generation. A merely paused-looking UI must not pass either.
    for name, field, expected in [
        ('missing-pause-ack', 'pauseSnapshot', 'Timeout'),
        ('changed-generation', 'generation', 'identity changed'),
    ]:
        start()
        path = tmp / (name + '.json')
        isolated = AlterPauseAcknowledgement(field)
        try:
            probe.export_diagnostic_failure(isolated, path,
                                            dist, rom_path, pause_timeout_ms=500)
            raise AssertionError(name + ' incorrectly exported a trace')
        except (BrowserTimeout, ValueError) as error:
            assert expected in str(error), (name, str(error))
        finally:
            restored = isolated.restore()
        assert isolated.pause_confirmed, name + ' timed out before the real Pause acknowledgement'
        assert restored and restored['field'] == field and restored['restored'], restored
        if field == 'pauseSnapshot':
            assert restored['acks'] > 0, 'Negative test never intercepted a real Pause acknowledgement'
        assert not path.exists(), name + ' wrote an unconfirmed trace'
    return {'complete_checkpoint_equal': True, 'original_observation_preserved': True,
            'missing_pause_ack_rejected': True, 'changed_generation_rejected': True,
            'replay': result['replay']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / 'dist')
    parser.add_argument('--diagnostic-trace', action='store_true', help='Also verify opt-in immediate-stop API capture and replay')
    parser.add_argument('--new-report', type=Path, help='Write a new report and sibling screenshot without replacing prior evidence')
    args = parser.parse_args()
    dist = args.dist.resolve()
    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    name = 'browser-stop-trace-recovery' if args.diagnostic_trace else 'browser-stop-recovery'
    report_path = args.new_report.resolve() if args.new_report else build / f'{name}.json'
    screenshot_path = report_path.with_name(report_path.stem + '-before.png')
    if args.new_report and (report_path.exists() or screenshot_path.exists()):
        parser.error('Report and sibling screenshot must be new paths')
    report_path.parent.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(
        Handler, directory=str(dist), diagnostic_trace=args.diagnostic_trace))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'passed': False, 'generated_guest': True, 'production_worker': not args.diagnostic_trace,
              'production_worker_source': True, 'instrumented': args.diagnostic_trace, 'performance_sample': False,
              'ui': 'React component fixture with the production controller and download helper',
              'probe_sha256': hashlib.sha256(Path(probe.__file__).read_bytes()).hexdigest(),
              'original_rom_reproduced': False}
    try:
        with tempfile.TemporaryDirectory(prefix='orchard-stop-recovery-') as tmp:
            tmp = Path(tmp)
            bundle = tmp / 'ui.js'
            subprocess.run(['node', '--input-type=module', '-', str(bundle)], input=BUNDLE,
                           cwd=ROOT, text=True, check=True, timeout=60)
            rom = bytearray(b'\xff' * 1048576)
            struct.pack_into('<I', rom, 0, 0xea000002)  # ARM branch to 0x10.
            struct.pack_into('<I', rom, 16, 0xe7f000f0)  # Explicit diagnostic stop.
            rom_path = tmp / 'generated-stop.bin'
            rom_path.write_bytes(rom)
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=probe.chrome_path(), headless=True,
                                           args=['--no-sandbox'])
                try:
                    page = browser.new_page(viewport={'width': 1360, 'height': 940}, locale='en-US')
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    base = f'http://127.0.0.1:{server.server_port}'
                    # Establish a same-origin HTTP page, then mount the isolated
                    # component fixture instead of the calculator entry script.
                    page.route(base + '/stop-recovery-fixture', lambda route: route.fulfill(
                        status=200, content_type='text/html', body='<div id="root"></div>'))
                    page.goto(base + '/stop-recovery-fixture')
                    page.evaluate('(m)=>window.__manifest=m', json.loads((dist / 'skins/manifest.json').read_text()))
                    page.evaluate('(m)=>window.__skins=m', {x.name: base64.b64encode(x.read_bytes()).decode()
                                                          for x in (dist / 'skins').glob('*.svg')})
                    page.add_style_tag(content=bundle.with_suffix('.css').read_text())
                    page.add_script_tag(content=bundle.read_text())
                    expect(page.get_by_role('button', name='Settings', exact=True)).to_be_visible()
                    page.add_script_tag(content=(
                        'globalThis.__orchardDiagnosticRuntime=true;\n' if args.diagnostic_trace else '') + probe.OBSERVER)
                    page.evaluate('''url=>{
                      const c=window.__controller;
                      c.worker=new Worker(url,{type:'module'});
                      c.worker.onmessage=({data})=>c.receive(data);
                      c.worker.onerror=e=>{throw Error(e.message);};
                      c.download=window.__downloadFile;
                      c.patch({ready:false,prefs:{...c.state.prefs,autosave:false,speed:0,
                        pauseOnBlur:false,pauseOnHidden:false}});
                    }''', base + '/worker.js')
                    page.wait_for_function('globalThis.__orchardProbe.snap&&!globalThis.__orchardProbe.snap.loaded')
                    page.evaluate('''encoded=>{
                      const rom=Uint8Array.from(atob(encoded),ch=>ch.charCodeAt(0));
                      const c=window.__controller;c.create({...c.state.model,preset:'strict'},rom.buffer);
                    }''', base64.b64encode(rom).decode())
                    page.wait_for_function('globalThis.__orchardProbe.snap?.stopped===true')
                    expect(page.get_by_role('dialog')).to_be_visible()
                    original = tmp / 'original-failure.json'
                    original.write_text(json.dumps(probe.probe_summary(page), indent=2))
                    before = original.read_bytes()
                    page.screenshot(path=str(screenshot_path))
                    trace_report = None
                    if args.diagnostic_trace:
                        trace_report = probe.export_core_trace(page, tmp / 'generated-core-trace.json', dist, rom_path)
                        assert trace_report['complete'] and trace_report['replay_passed'], trace_report
                        assert trace_report['reason'] == 'core-stop'
                        assert trace_report['replay']['end_tick'] == 2
                        assert trace_report['replay']['complete_checkpoint_equal']
                        assert trace_report['replay']['stop'] == [9, 16, 0xe7f000f0, 16, 0xe7f000f0]
                    # Losing the screenshot must not skip the original JSON or
                    # the independent LCD capture attempt.
                    class ScreenshotFailure:
                        def screenshot(self, **_kwargs):
                            raise RuntimeError('Injected screenshot failure')

                        def __getattr__(self, name):
                            return getattr(page, name)

                    capture_errors = probe.capture_failure_evidence(
                        ScreenshotFailure(), tmp, 'screenshot-negative', errors)
                    assert capture_errors == [{'artifact': 'screenshot', 'error': 'Injected screenshot failure'}]
                    captured = json.loads((tmp / 'screenshot-negative-failure.json').read_text())
                    assert captured['probe'] == json.loads(before), 'Screenshot failure skipped the original observation'
                    assert captured['capture_errors'] == capture_errors
                    if captured['probe']['snapshot']['frameStatus'] == 0:
                        assert (tmp / 'screenshot-negative-failure.pgm').is_file(), 'Screenshot failure skipped the LCD artifact'
                    save_floor = page.evaluate('''()=>{const p=globalThis.__orchardProbe;
                      return {seq:p.seq,workerId:p.workerId,generation:p.generation};}''')
                    recovery = probe.export_stopped_failure(page, tmp / 'generated-failure.ord', dist, rom_path)
                    save_ack = page.wait_for_function('''floor=>{
                      const p=globalThis.__orchardProbe;
                      if(p.errors.length)throw Error(p.errors.join('; '));
                      const same=e=>e.workerId===floor.workerId&&e.generation===floor.generation;
                      const command=p.events.find(e=>e.seq>floor.seq&&same(e)&&
                        e.direction==='send'&&e.type==='checkpoint-save');
                      if(!command)return false;
                      const saved=p.events.find(e=>e.seq>command.seq&&same(e)&&
                        e.direction==='receive'&&e.type==='checkpoint-saved');
                      const snap=p.snap;
                      if(!saved||!snap||!same(snap)||snap.seq<=saved.seq||
                         !snap.loaded||snap.running||!snap.stopped)return false;
                      return {worker:floor.workerId,generation:floor.generation,
                        command_seq:command.seq,saved_marker_seq:saved.seq,snapshot_seq:snap.seq};
                    }''', arg=save_floor).json_value()
                    diagnostic = json.loads(Path(recovery['diagnostic_file']).read_text())
                    assert diagnostic['stop'] == {'code': 9, 'pc': '00000010', 'instruction': 'e7f000f0',
                                                  'address': '00000010', 'detail': 'e7f000f0'}, diagnostic
                    assert diagnostic['rom_sha256'] == hashlib.sha256(rom).hexdigest()
                    assert len(diagnostic['words']) == 33
                    assert original.read_bytes() == before, 'Recovery replaced the original failed observation'
                    worker_errors = page.evaluate('globalThis.__orchardProbe.errors')
                    assert not worker_errors, worker_errors
                    # The guard must not click Save or create a file for an
                    # unstopped observation, even if the page has loaded a ROM.
                    page.evaluate('globalThis.__orchardProbe.snap={...globalThis.__orchardProbe.snap,stopped:false}')
                    skipped = tmp / 'must-not-exist.ord'
                    assert probe.export_stopped_failure(page, skipped, dist, rom_path) is None
                    assert not skipped.exists()
                    assert not errors, errors
                    report.update({'browser': browser.version, 'page_errors': errors,
                                   'worker_errors': worker_errors, 'save_ack': save_ack,
                                   'screenshot_failure_preserves_observation': True,
                                   'original_observation_preserved': True, 'unstopped_guard': True,
                                   'stop': diagnostic['stop'], 'ticks': diagnostic['ticks'],
                                   'session_bytes': recovery['session_bytes'],
                                   'session_sha256': diagnostic['session_sha256'],
                                   'checkpoint_sha256': diagnostic['checkpoint_sha256'],
                                   'wasm_sha256': diagnostic['wasm_sha256']})
                    if trace_report is not None:
                        report['immediate_stop_trace'] = trace_report['replay']
                        report['active_timeout_trace'] = check_active_diagnostic_recovery(
                            page, tmp, dist, errors)
                    assert not errors, errors
                    assert not page.evaluate('globalThis.__orchardProbe.errors')
                    report['passed'] = True
                finally:
                    browser.close()
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        server.shutdown()
        server.server_close()
        with report_path.open('x' if args.new_report else 'w') as out:
            out.write(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
