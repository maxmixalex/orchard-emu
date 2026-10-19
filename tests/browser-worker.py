# SPDX-License-Identifier: MIT
"""Browser-native timer tests plus real HTTP production Worker/WASM regression.

--offline-timers needs no network navigation and tests native Window/Worker
receivers only. It is not a substitute for the mandatory default HTTP suite.
"""
from __future__ import annotations
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent


def browser_path():
    requested = os.environ.get('CHROMIUM')
    if requested:
        return requested
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'):
        path = shutil.which(name)
        if path:
            return path
    raise RuntimeError('A real Chrome/Chromium executable is required; set CHROMIUM')


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def offline(page):
    scheduler = (ROOT/'web/task-scheduler.js').read_text().replace('export class TaskScheduler', 'class TaskScheduler')
    test = (ROOT/'tests/browser-scheduler-check.js').read_text().replace('export async function', 'async function')
    # Only strip module export syntax for offline delivery. Native timer APIs,
    # MessageChannel, scheduling code and shared assertions remain untouched.
    return page.evaluate(r'''async ({scheduler,test})=>{
      const code=scheduler+'\n'+test;
      const windowScheduler=await eval('(async()=>{'+code+';return await checkScheduler(TaskScheduler)})()');
      const url=URL.createObjectURL(new Blob([code+';checkScheduler(TaskScheduler).then(result=>postMessage({result}),e=>postMessage({error:e.message,stack:e.stack}));'],{type:'text/javascript'}));
      const worker=new Worker(url);let timer;
      try{
        const workerScheduler=await new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(Error('Offline native Worker timeout')),10000);
          worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
          worker.onerror=e=>reject(Error(e.message||'Offline Worker failed'));
        });
        return {passed:true,transport:'inline native timer components',windowScheduler,workerScheduler,browser:navigator.userAgent,firmwareUsed:false};
      }finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);}
    }''', {'scheduler': scheduler, 'test': test})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline-timers', action='store_true')
    args = parser.parse_args()
    output = ROOT/'build'; output.mkdir(exist_ok=True)
    server = None
    report = {'passed': False, 'mode': 'offline' if args.offline_timers else 'HTTP'}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=browser_path(), headless=True, args=['--no-sandbox'])
            try:
                page = browser.new_page(viewport={'width': 1360, 'height': 940}, locale='en-US')
                errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
                if args.offline_timers:
                    page.set_content('<body>Native timer regression</body>')
                    report = offline(page)
                else:
                    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
                    threading.Thread(target=server.serve_forever, daemon=True).start()
                    base = f'http://127.0.0.1:{server.server_port}'
                    page.goto(base+'/tests/browser-worker.html')
                    page.wait_for_function('globalThis.__orchardBrowserResult !== undefined', timeout=120000)
                    report = page.evaluate('globalThis.__orchardBrowserResult')
                    assert report['passed'], json.dumps(report, indent=2)
                    # The real production page, not the previous fake controller.
                    page.goto(base+'/dist/'); page.get_by_role('button', name='Settings', exact=True).wait_for()
                    page.get_by_role('button', name='Settings', exact=True).click()
                    page.get_by_role('tab', name='Keyboard', exact=True).click()
                    page.locator('[data-code="KeyA"]').click()
                    assert page.locator('.pc-physical-key').count() == 104
                    page.screenshot(path=str(output/'browser-ui.png'))
                    report['productionUI'] = {'settings': True, 'physicalKeys': 104}
                report['pageErrors'] = errors
                assert not errors, errors
                assert report['passed'], report
            finally:
                browser.close()
    except Exception as error:
        report['passed'] = False; report['failure'] = str(error)
        raise
    finally:
        if server:
            server.shutdown(); server.server_close()
        path = output/('browser-timers.json' if args.offline_timers else 'browser-worker.json')
        path.write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
