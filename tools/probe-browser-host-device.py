#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original ROM in the production Chrome page/Worker -> HTTP -> USB/IP -> Kermit.

This is a private original-firmware acceptance probe. The external peer is a
user-space USB/IP client, not an OS USB driver or Conn3x. It observes Worker
messages, uses real UI actions and never changes guest memory or core APIs.
"""
import argparse
import functools
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('local_workflows',ROOT/'tools/probe-local-workflows-browser.py')
local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)
helper=local.helper
OBSERVE=helper.OBSERVE.replace("d.type==='file-transfer-status'||", "d.type==='host-bridge-status'||d.type==='file-transfer-status'||")
FLAGS=(
 (57,37,57,40,58,4,12,12,23,45,6), # CF(-33): binary
 (57,37,57,40,58,4,24,17,23,45,6), # CF(-78): USB
 (57,15,57,40,58,4,12,18,23,45,6), # SF(-35): overwrite
)
SERVER=(57,15,57,39,57,22,57,30,57,39,57,22,6)

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--rom',type=Path,required=True)
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--expected-wasm',required=True)
 args=parser.parse_args()
 model=helper.model_identity(args.rom)
 assets={name:helper.sha((ROOT/'dist'/name).read_bytes()) for name in sorted(local.pages.ASSETS)}
 if assets['orchard.wasm']!=args.expected_wasm:parser.error('Production WASM identity differs')
 args.output.mkdir(parents=True,exist_ok=False)
 report={'schema':'orchard-browser-host-device-v1','passed':False,'model':model,'assets':assets,
  'production_page':True,'production_worker':True,'guest_memory_modified':False,
  'os_driver_attached':False,'conn3x_tested':False,'public_https_local_network_permission_ui_tested':False,
  'tool_sha256':helper.sha(Path(__file__).read_bytes()),
  'peer_tool_sha256':helper.sha((ROOT/'tools/probe-usbip-kermit.mjs').read_bytes())}
 server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(helper.Handler,directory=str(ROOT/'dist')))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 origin=f'http://127.0.0.1:{server.server_port}'
 bridge=subprocess.Popen(['node','--input-type=module','-e',
  "import {createHostBridge} from './host/bridge.mjs';const bridge=createHostBridge({origins:[process.argv[1]]});"
  "const ports=await bridge.listen({http:0,usbip:0});console.log(JSON.stringify({...ports,token:bridge.token}));"
  "process.once('SIGTERM',()=>void bridge.close());",origin],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 peer=None;page=None;errors=[];requests=[];responses=[]
 def stage(name):report['stage']=name;print('STAGE',name,flush=True)
 def response_finished(request):
  if request.url.startswith(origin+'/'):
   name=request.url[len(origin)+1:]
   if name in assets:
    response=request.response();item={'name':name,'status':response.status}
    try:item['sha256']=helper.sha(response.body())
    except Exception as error:item['error']=str(error)
    responses.append(item)
 try:
  connection=json.loads(bridge.stdout.readline()) # The token stays in memory.
  with sync_playwright() as p:
   chrome=os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
   if not chrome:raise RuntimeError('Set CHROMIUM to an installed browser')
   browser=p.chromium.launch(executable_path=chrome,headless=True,args=['--no-sandbox'])
   report['browser_version']=browser.version
   try:
    context=browser.new_context(viewport={'width':1360,'height':940},locale='en-US')
    page=context.new_page();page.set_default_timeout(30000)
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.context.on('request',lambda request:requests.append({'url':request.url,'method':request.method}))
    page.context.on('requestfinished',response_finished)
    page.add_init_script(OBSERVE);page.goto(origin)
    stage('cold-boot-original-rom')
    page.get_by_role('button',name='Settings',exact=True).click()
    page.get_by_role('combobox',name='Speed',exact=True).click()
    page.get_by_role('option',name='Unlimited',exact=True).click()
    page.get_by_role('tab',name='Storage',exact=True).click()
    page.get_by_role('switch',name='Save automatically on this device',exact=True).uncheck()
    page.get_by_role('switch',name='Remember local ROMs',exact=False).uncheck()
    page.get_by_role('button',name='Apply',exact=True).click()
    page.locator('#rom').set_input_files(str(args.rom.resolve()))
    page.wait_for_function('window.__transferProbe.snapshot?.loaded===true')
    helper.verify_model(page,model);local.cold_boot(page,model)
    for scans in FLAGS:helper.physical_keys(page,scans)
    helper.physical_keys(page,SERVER);local.settle(page,10000000)
    page.screenshot(path=str(args.output/'original-server.png'))
    # The external client has a wall clock; run the guest at the normal setting.
    page.get_by_role('button',name='Settings',exact=True).click()
    page.get_by_role('combobox',name='Speed',exact=True).click()
    page.get_by_role('option',name='Normal',exact=True).click()
    page.get_by_role('button',name='Apply',exact=True).click()
    stage('production-ui-connect')
    page.get_by_role('button',name='Connections',exact=True).click()
    sidebar=page.locator('#device-sidebar');sidebar.get_by_role('tab',name='Local device',exact=True).click()
    sidebar.get_by_role('textbox',name='Local bridge address',exact=True).fill(f'http://127.0.0.1:{connection["httpPort"]}')
    sidebar.get_by_label('Access token',exact=True).fill(connection['token'])
    sidebar.get_by_role('button',name='Connect local device',exact=True).click()
    page.wait_for_function('window.__transferProbe.events.some(e=>e.type==="host-bridge-status"&&e.ready)',timeout=90000)
    report['enumerated']=True
    # Hide and restore the real sidebar without resetting its connection.
    page.get_by_role('button',name='Close sidebar',exact=True).click()
    page.get_by_role('button',name='Connections',exact=True).click()
    sidebar.get_by_text('Ready for a USB/IP client',exact=True).wait_for()
    report['sidebar_hide_reopen_preserves_connection']=True
    stage('external-usbip-kermit')
    # Change focus before starting the external peer, so a short transfer cannot
    # complete before the focus-loss condition has actually been established.
    other=page.context.new_page();other.goto('about:blank');other.bring_to_front()
    # Playwright enables focus emulation on every Chromium page by default.
    # Restore native focus reporting for these two test-owned targets; do not
    # dispatch synthetic blur events or alter browser security/network policy.
    for target in (page,other):
     page.context.new_cdp_session(target).send('Emulation.setFocusEmulationEnabled',{'enabled':False})
    other.bring_to_front()
    report['playwright_always_focused_emulation_disabled']=True
    def focus_state():
     return {'calculator':page.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState})'),
             'other':other.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState})')}
    report['focus_before_transfer']=focus_state()
    assert not report['focus_before_transfer']['calculator']['focused']
    assert report['focus_before_transfer']['other']['focused']
    peer=subprocess.Popen(['node','tools/probe-usbip-kermit.mjs','--port',str(connection['usbipPort']),
      '--output',str((args.output/'usbip-kermit.json').resolve())],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    page.wait_for_function('window.__transferProbe.events.some(e=>e.type==="host-bridge-status"&&e.attached)',timeout=30000)
    deadline=time.monotonic()+180
    while peer.poll() is None:
     if time.monotonic()>deadline:raise TimeoutError('USB/IP Kermit peer did not finish')
     page.wait_for_timeout(200)
    output,diagnostic=peer.communicate();assert peer.returncode==0,(output,diagnostic)
    report['bulk']=json.loads((args.output/'usbip-kermit.json').read_text());assert report['bulk']['passed']
    assert report['bulk']['received_name']=='OR22B'
    assert report['bulk']['received_header']==('HPHP49-C' if model['id']==5 else 'HPHP49-B')
    if model['id']==5:assert report['bulk']['all_bytes_equal']
    report['focus_after_transfer']=focus_state()
    assert not report['focus_after_transfer']['calculator']['focused']
    assert report['focus_after_transfer']['other']['focused']
    report['transfer_while_another_tab_focused']=True
    other.close();page.bring_to_front()
    page.screenshot(path=str(args.output/'bridge-complete.png'))
    stage('disconnect-and-calculator-usable')
    sidebar.get_by_role('button',name='Disconnect local device',exact=True).click()
    sidebar.get_by_text('Local device disconnected',exact=True).wait_for()
    page.get_by_role('button',name='Close sidebar',exact=True).click()
    helper.physical_keys(page,(26,5,26,6));local.settle(page,12000000)
    page.screenshot(path=str(args.output/'home-arithmetic.png'))
    report['arithmetic_frame']=local.frame(page);report['arithmetic_requires_visual_review']=True
    report['worker_observation']=page.evaluate('window.__transferProbe')
    assert not report['worker_observation']['errors'] and not report['worker_observation']['snapshot']['stopped']
    assert not errors,errors
    assert all(request['url'].startswith((origin+'/',f'http://127.0.0.1:{connection["httpPort"]}/')) for request in requests)
    assert all(item.get('sha256')==assets[item['name']] for item in responses),responses
    seen={item['name'] for item in responses}
    assert {'calculator.js','worker.js','orchard.wasm','host-bridge-client.js','host-bridge-protocol.js','usb-device.js'}<=seen,seen
    assert {name:helper.sha((ROOT/'dist'/name).read_bytes()) for name in assets}==assets
    assert helper.sha(args.rom.read_bytes())==model['rom_sha256']
    report['network_scope']='production assets and authenticated loopback USB transactions only'
    report['responses']=responses;report['errors']=errors;report['passed']=True
   except Exception as error:
    report['error']=str(error)
    if page:
     report['worker_observation']=page.evaluate('window.__transferProbe')
     page.screenshot(path=str(args.output/'failure.png'))
    raise
   finally:browser.close()
 finally:
  if peer and peer.poll() is None:peer.terminate();peer.wait(timeout=10)
  bridge.terminate()
  try:bridge.wait(timeout=10)
  except subprocess.TimeoutExpired:bridge.kill();bridge.wait(timeout=5)
  server.shutdown();server.server_close();thread.join(timeout=5)
  (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps({'passed':report['passed'],'stage':report.get('stage'),'error':report.get('error')}),flush=True)

if __name__=='__main__':main()
