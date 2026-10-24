#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Original-ROM, two-tab IrDA interruption, reconnect and byte-exact transfer.

Requires private ready sessions produced by prepare-irda-browser.mjs. All input
uses visible controls and physical skin keys. A passive Worker observer records
actual UART bytes; it never sends messages or fabricates protocol responses.
"""
import argparse
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import struct
import threading
import time
import traceback
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sha = lambda data: hashlib.sha256(data).hexdigest()
ALPHABET = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    (35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2)))
DIGITS = (27,26,19,12,25,18,11,24,17,10)
OBSERVE = r'''(() => {
  localStorage.setItem('orchard:preferences:v1',JSON.stringify({version:1,
    view:'immersive',zoom:100,speed:1,interval:30,mappings:{},
    pauseOnBlur:true,pauseOnHidden:true,rememberROM:false,autosave:false}));
  const NativeWorker = window.Worker;
  const observation = window.__irdaAcceptance = {
    events: [], snapshot: null, snapshots: 0, inputSerial: 0,
    wire: [], wireChunks: [], inputs: [], errors: [], lastPixels: null
  };
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({data:d}) => {
        if (d.type === 'snapshot') {
          observation.snapshot = {
            generation:d.generation, loaded:d.loaded, running:d.running,
            stopped:d.stopped, model:d.model, width:d.width, height:d.height,
            pending:d.pending, active:d.active, tick:d.tick,
            frameSerial:d.frameSerial, frameStatus:d.frameStatus,
            effectiveSpeed:d.effectiveSpeed
          };
          observation.snapshots++;
          if (d.pending || d.active !== null) observation.inputSerial++;
          if (d.pixels) observation.lastPixels = d.pixels.slice();
        } else if (d.type === 'irda-output') {
          if(observation.wireChunks.length<16384)
            observation.wireChunks.push({offset:observation.wire.length,length:d.bytes.length,tick:d.tick,epoch:d.epoch});
          else observation.errors.push('Private UART timing capture exceeded its bound');
          if (observation.wire.length + d.bytes.length <= 1024*1024)
            observation.wire.push(...d.bytes);
          else observation.errors.push('Private UART capture exceeded its bound');
        } else if (d.type === 'irda-input-result') {
          const result = {...d};
          observation.inputs.push(result);
          // A pause can discard input normally; only an explicit error fails.
          if (d.error) observation.errors.push({...result,message:`IrDA input failed: ${d.error}`});
        } else if (['checkpoint-restored','links-reset'].includes(d.type)) {
          observation.events.push({...d,last_observed_snapshot_tick:observation.snapshot?.tick});
        } else if (d.type === 'error' || d.type === 'fatal') {
          observation.errors.push(d.message);
        }
      });
    }
  };
})();'''


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def observe(page):
    return page.evaluate('''(() => {
      const {lastPixels, ...metadata} = window.__irdaAcceptance;
      return metadata;
    })()''')


def wait_condition(page, expression, arg=None, timeout=120000):
    failure = 'window.__irdaAcceptance.errors.length > 0 || window.__irdaAcceptance.snapshot?.stopped'
    page.wait_for_function(f'arg => ({expression}) || ({failure})', arg=arg, timeout=timeout, polling=50)
    assert page.evaluate(f'arg => ({expression})', arg), observe(page)
    assert not page.evaluate(f'({failure})'), observe(page)


def wait_ticks(page, amount):
    start = page.evaluate('window.__irdaAcceptance.snapshot.tick')
    wait_condition(page, 'window.__irdaAcceptance.snapshot.tick >= arg', start + amount)


def key(page, scan, report):
    # A user activates the tab before using its keypad. Background animation
    # frames can otherwise delay Playwright's actionability check by seconds,
    # long enough for the other stock calculator's discovery window to close.
    page.bring_to_front()
    before = page.evaluate('window.__irdaAcceptance.snapshot.tick')
    input_serial = page.evaluate('window.__irdaAcceptance.inputSerial')
    page.locator(f'.skin-key[data-scan="{scan}"]').click()
    count = page.evaluate('window.__irdaAcceptance.snapshots')
    wait_condition(page, '''window.__irdaAcceptance.snapshots > arg.count &&
      window.__irdaAcceptance.inputSerial > arg.input &&
      window.__irdaAcceptance.snapshot.pending === 0 &&
      window.__irdaAcceptance.snapshot.active === null &&
      window.__irdaAcceptance.snapshot.running''', {'count': count, 'input': input_serial})
    wait_ticks(page, 2000000)
    report['physical_keys'].append({'model': page.evaluate('window.__irdaAcceptance.snapshot.model'),
        'scan': scan, 'before_tick': before,
        'after_tick': page.evaluate('window.__irdaAcceptance.snapshot.tick')})


def letters(page, text, report):
    for character in text:
        key(page, 57, report)
        key(page, ALPHABET[character], report)


def command(page, text, report):
    letters(page, text, report)
    key(page, 6, report)
    wait_ticks(page, 3000000)


def name(page, text, report):
    key(page, 14, report)
    letters(page, text, report)
    key(page, 6, report)


def crc16(data, initial=0):
    crc = initial
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x8408 if crc & 1 else 0)
    return crc


def analyze_wire(raw):
    """Read-only IrLAP FCS, LSAP3 IrCOMM and Kermit packet observation."""
    stream, frame = [], []
    inside, escape, last = False, False, -1
    framing = {'complete_frames': 0, 'valid_frames': 0, 'malformed_frames': [], 'interrupted_frames': []}
    for offset, byte in enumerate(raw):
        if byte == 0xc0:
            if inside and frame:
                framing['interrupted_frames'].append({'end_offset': offset, 'unescaped': bytes(frame).hex()})
            frame, inside, escape = [], True, False
        elif byte == 0xc1:
            if inside:
                framing['complete_frames'] += 1
                residue = crc16(frame, 0xffff)
                if len(frame) < 4 or escape or residue != 0xf0b8:
                    framing['malformed_frames'].append({'end_offset': offset,
                        'unescaped': bytes(frame).hex(), 'fcs_residue': residue})
                else:
                    framing['valid_frames'] += 1
                    if len(frame) >= 8 and not frame[1] & 1 and frame[2:4] == [3,3]:
                        sequence = (frame[1] >> 1) & 7
                        if sequence != last:
                            last = sequence
                            if frame[5] == 0:
                                stream.extend(frame[6:-2])
            inside = False
        elif inside:
            if escape:
                frame.append(byte ^ 32)
                escape = False
            elif byte == 0x7d:
                escape = True
            else:
                frame.append(byte)
    result, i = [], 0
    while i + 1 < len(stream):
        if stream[i] != 1:
            i += 1
            continue
        length = stream[i+1] - 32
        packet = stream[i:i+length+2]
        if length < 3 or length > 94 or len(packet) != length + 2:
            i += 1
            continue
        crc = crc16(packet[1:-3])
        encoded = ((packet[-3]-32)*4096 + (packet[-2]-32)*64 + packet[-1]-32)
        total = sum(packet[1:-1])
        checksum = ((total + ((total & 192) >> 6)) & 63) + 32
        check = 3 if crc == encoded else 1 if checksum == packet[-1] else 0
        result.append({'sequence': packet[2]-32, 'type': chr(packet[3]),
            'check': check, 'data': packet[4:-check] if check else [],
            'raw': packet})
        i += length + 2
    framing['malformed_frame_count'] = len(framing['malformed_frames'])
    framing['interrupted_frame_count'] = len(framing['interrupted_frames'])
    return {'packets': result, 'ir_lap': framing}


def packets(raw):
    return analyze_wire(raw)['packets']


def decode_data(data):
    result, i = [], 0
    while i < len(data):
        byte = data[i]
        i += 1
        if byte == 35:
            assert i < len(data), 'Incomplete Kermit control quote'
            byte = data[i]
            i += 1
            if 63 <= byte <= 95:
                byte ^= 64
        result.append(byte)
    return bytes(result)


def transfer_result(sent, received, label, value):
    captures = {'sent': analyze_wire(sent), 'received': analyze_wire(received)}
    outgoing, incoming = captures['sent']['packets'], captures['received']['packets']
    unique = []
    for packet in outgoing:
        if packet['check'] != (1 if packet['type'] == 'S' else 3):
            continue
        if not any(p['sequence'] == packet['sequence'] and p['type'] == packet['type'] for p in unique):
            unique.append(packet)
    end = next((p for p in unique if p['type'] == 'B'), None)
    start = next((p for p in unique if p['type'] == 'S'), None)
    header = next((p for p in unique if p['type'] == 'F'), None)
    eof = next((p for p in unique if p['type'] == 'Z'), None)
    data_packets = [p for p in unique if p['type'] == 'D']
    if not all((start, header, eof, end)) or not data_packets:
        return None
    # These original peers negotiate block check 3. A coincidental checksum-1
    # match on a damaged CRC16 packet must never validate a file or its ACK.
    assert len(start['data']) >= 8 and start['data'][7] == ord('3'), start
    start_ack = next((p for p in incoming if p['type'] == 'Y' and p['sequence'] == start['sequence'] and p['check'] == 1), None)
    if not start_ack:
        return None
    assert len(start_ack['data']) >= 8 and start_ack['data'][7] == ord('3'), start_ack
    file_packets = [header, *data_packets, eof, end]
    expected = [start, *file_packets]
    assert [p for p in unique if p['type'] in 'SFDZB'] == expected, 'File packet ordering'
    assert all(b['sequence'] == (a['sequence']+1) % 64 for a,b in zip(expected,expected[1:])), 'File packet sequencing'
    if any(not any(p['type'] == 'Y' and p['sequence'] == packet['sequence'] and p['check'] == 3 for p in incoming) for packet in file_packets):
        return None
    assert eof['data'] == [] and end['data'] == [], 'Normal EOF and end-of-transfer'
    assert bytes(header['data']).decode('ascii') == label
    data = b''.join(decode_data(p['data']) for p in data_packets)
    assert data == f'%%HP: T(1)A(R)F(.);\r\n{value}'.encode('ascii'), data
    def malformed(packet, side):
        expected_crc = packet['type'] in 'FDZB' if side == 'sent' else packet['type'] == 'Y' and packet['sequence'] != start['sequence']
        return not packet['check'] or expected_crc and packet['check'] != 3
    return {'name': label, 'value': value, 'file_bytes': len(data), 'file_sha256': sha(data),
        'exact_file_equal': True, 'kermit_checksum_verified': True, 'ir_lap_fcs_verified': True,
        'start_acknowledged': True, 'header_acknowledged': True,
        'data_packets_acknowledged': len(data_packets), 'eof_acknowledged': True, 'end_acknowledged': True,
        'ir_lap': {side:capture['ir_lap'] for side,capture in captures.items()},
        'packets': [{k: (bytes(v).hex() if k in ('data','raw') else v) for k,v in p.items()} for p in unique],
        # A malformed ACK does not establish a failed transfer. Keep its exact
        # capture and let the unchanged peers exercise their own retries; only
        # the full valid S/F/D/Z/B and matching Y sequence completes the witness.
        'malformed_packets': {side: [{'sequence':p['sequence'], 'type':p['type'],
            'raw':bytes(p['raw']).hex(), 'reason':'checksum' if not p['check'] else 'negotiated-block-check'}
            for p in rows if malformed(p, side)]
            for side,rows in (('sent',outgoing),('received',incoming))},
        'malformed_packet_counts': {side: sum(malformed(p, side) for p in rows)
            for side,rows in (('sent',outgoing),('received',incoming))},
        'sent_wire_bytes': len(sent), 'received_wire_bytes': len(received)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--rom-dir', type=Path, required=True)
    parser.add_argument('--ready-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-wasm', required=True)
    args = parser.parse_args()
    dist = args.root.resolve() / 'dist'
    prep_path = args.ready_dir / 'preparation-report.json'
    prep = json.loads(prep_path.read_text())
    assert prep['passed'] and prep['cold_boot'] and prep['physical_input_only']
    assert not prep['guest_memory_patched'] and not prep['host_protocol_responses']
    assert sha((dist / 'orchard.wasm').read_bytes()) == args.expected_wasm
    args.output.mkdir()
    report = {'schema': 'orchard-irda-production-browser-v1', 'passed': False,
        'wasm_sha256': args.expected_wasm, 'production_worker': True,
        'synthetic_worker_messages': False, 'guest_memory_patched': False,
        'browser_cold_boot': False, 'prepared_from_cold_boot': True,
        'preparation_report_sha256': sha(prep_path.read_bytes()),
        'preparation_wasm_sha256': prep['wasm_sha256'],
        'physical_keys': [], 'inputs': {}, 'transfers': [], 'errors': [],
        'assets': {str(path.relative_to(dist)): sha(path.read_bytes())
            for path in sorted(dist.rglob('*')) if path.is_file()},
        'tool_sha256': sha(Path(__file__).read_bytes()),
        'performance_sample': False, 'hardware_validated': False}
    inputs = {}
    for model, filename in ((5, 'hp49gplus-full.bin'), (4, '48gii.bin')):
        rom, session = args.rom_dir / filename, args.ready_dir / f'ready-{model}.ord'
        digest = next(r['rom_sha256'] for r in prep['roms'] if r['model'] == model)
        assert sha(rom.read_bytes()) == digest
        frame = next(f for f in prep['frames'] if f['model'] == model and f['label'] == 'ready')
        data = session.read_bytes()
        assert sha(data) == frame['session_sha256'] and data[:8] == b'ORCHARD1'
        length, = struct.unpack_from('<I', data, 8)
        metadata = json.loads(data[12:12+length])
        assert metadata['model'] == model and metadata['romHash'] == digest
        assert sha(data[12+length:]) == metadata['stateHash']
        inputs[model] = {'rom': rom.resolve(), 'session': session.resolve()}
        report['inputs'][str(model)] = {'rom_sha256': digest, 'session_sha256': sha(data)}
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    pages = {}

    def stage(label):
        report['stage'] = label
        print('STAGE', label, flush=True)

    def pair(label):
        pages[5].get_by_role('button', name='Create connection', exact=True).click()
        code = pages[5].get_by_role('textbox', name='Pairing code', exact=True).input_value()
        pages[4].get_by_role('textbox', name='Pairing code', exact=True).fill(code)
        pages[4].get_by_role('button', name='Join', exact=True).click()
        for model, page in pages.items():
            page.get_by_text('Connected to HP ' + ('48gII' if model == 5 else '49g+'), exact=True).wait_for()
            wait_condition(page, 'window.__irdaAcceptance.snapshot.running')
            page.screenshot(path=str(args.output / f'{label}-{model}.png'))
        report.setdefault('pairing_codes', []).append(code)

    def wire(model, start=0):
        return pages[model].evaluate('n => window.__irdaAcceptance.wire.slice(n)', start)

    def exchange(source, label, value):
        target = 9 - source
        starts = {model: len(wire(model)) for model in pages}
        report.setdefault('exchange_starts', []).append({'name':label,'from':source,'to':target,'wire_offsets':starts})
        name(pages[source], label, report)
        letters(pages[source], 'SEND', report)
        letters(pages[target], 'RECV', report)
        key(pages[target], 6, report)
        key(pages[source], 6, report)
        print('WAIT', label, {m: pages[m].evaluate('window.__irdaAcceptance.snapshot.tick') for m in pages}, flush=True)
        deadline = time.monotonic() + 120
        result = None
        while time.monotonic() < deadline:
            for page in pages.values():
                data = observe(page)
                assert not data['errors'] and not data['snapshot']['stopped'], data
            result = transfer_result(wire(source, starts[source]), wire(target, starts[target]), label, value)
            if result:
                break
            pages[target].wait_for_timeout(250)
        assert result, {'label': label, 'source': packets(wire(source, starts[source])),
            'target': packets(wire(target, starts[target]))}
        # Stock SEND/RECV closes the IrLAP connection after its Kermit B/Y.
        wait_ticks(pages[source], 36000000)
        command(pages[target], label, report)
        wait_ticks(pages[target], 12000000)
        result.update({'from': source, 'to': target})
        report['transfers'].append(result)
        for model, page in pages.items():
            page.screenshot(path=str(args.output / f'{label.lower()}-recalled-{model}.png'))
            page.locator('#lcd').screenshot(path=str(args.output / f'{label.lower()}-lcd-{model}.png'))

    try:
        with sync_playwright() as playwright:
            executable = os.environ.get('CHROMIUM') or shutil.which('google-chrome') or shutil.which('chromium')
            assert executable, 'CHROMIUM is required'
            browser = playwright.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
            try:
                report['browser_version'] = browser.version
                context = browser.new_context(viewport={'width': 1360, 'height': 1000}, locale='en-US')
                stage('restore-original-send-and-receive')
                for model, entry in inputs.items():
                    page = context.new_page()
                    pages[model] = page
                    page.add_init_script(OBSERVE)
                    page.on('pageerror', lambda e, model=model: report['errors'].append({'model': model, 'error': str(e)}))
                    page.goto(f'http://127.0.0.1:{server.server_port}/')
                    page.get_by_role('button', name='Settings', exact=True).wait_for()
                    page.locator('#rom').set_input_files(str(entry['rom']))
                    wait_condition(page, 'window.__irdaAcceptance.snapshot?.loaded === true')
                    assert page.evaluate('window.__irdaAcceptance.snapshot.model') == model
                    page.locator('#session-file').set_input_files(str(entry['session']))
                    page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True).click()
                    wait_condition(page, "window.__irdaAcceptance.events.some(e => e.type === 'checkpoint-restored')")
                    page.get_by_role('button', name='Connections', exact=True).click()
                    page.get_by_role('tab', name='Infrared', exact=True).click()
                pair('initial-pair')

                stage('interrupt-active-firmware-transfer')
                key(pages[4], 6, report)
                key(pages[5], 6, report)
                wait_condition(pages[5], 'window.__irdaAcceptance.wire.length > 0')
                assert not any(p['type'] == 'B' for p in packets(wire(5))), 'Must interrupt before SEND completes'
                pages[5].get_by_role('button', name='Pause', exact=True).click()
                wait_condition(pages[5], '!window.__irdaAcceptance.snapshot.running')
                pages[4].get_by_text('The other calculator disconnected.', exact=True).wait_for()
                for model, page in pages.items():
                    page.get_by_role('button', name='Create connection', exact=True).wait_for()
                    assert page.get_by_role('button', name='Disconnect', exact=True).count() == 0
                    page.screenshot(path=str(args.output / f'interrupted-{model}.png'))
                report['manual_pause_ends_both_links'] = True
                report['interrupted_wire_bytes'] = {str(m): len(wire(m)) for m in pages}

                stage('resume-repair-and-abort-stock-wait')
                pages[5].get_by_role('button', name='Resume', exact=True).click()
                pair('repaired')
                assert report['pairing_codes'][0] != report['pairing_codes'][1]
                for page in pages.values():
                    key(page, 56, report)
                    wait_ticks(page, 12000000)
                    key(page, 56, report)
                report['stock_on_recovers_after_interruption'] = True

                stage('send-orchard-after-repair')
                exchange(5, 'ORCHARD', 12345)

                stage('store-and-send-reverse-object')
                for character in '54321':
                    key(pages[4], DIGITS[int(character)], report)
                key(pages[4], 6, report)
                name(pages[4], 'RETURN', report)
                command(pages[4], 'STO', report)
                exchange(4, 'RETURN', 54321)

                stage('disconnect-both-tabs')
                pages[4].get_by_role('button', name='Disconnect', exact=True).click()
                pages[5].get_by_text('The other calculator disconnected.', exact=True).wait_for()
                for model, page in pages.items():
                    page.get_by_role('button', name='Create connection', exact=True).wait_for()
                    assert page.get_by_role('button', name='Disconnect', exact=True).count() == 0
                    page.screenshot(path=str(args.output / f'disconnected-{model}.png'))
                    data = observe(page)
                    assert not data['errors'] and not data['snapshot']['stopped'], data
                    assert any(event.get('accepted', 0) > 0 for event in data['inputs'])
                report['disconnect_propagates'] = True
                assert not report['errors']
                report['passed'] = True
                stage('complete')
            except Exception:
                report['error'] = traceback.format_exc()
                for model, page in pages.items():
                    try:
                        page.screenshot(path=str(args.output / f'failure-{model}.png'), timeout=5000)
                    except Exception:
                        pass
                raise
            finally:
                for model, page in pages.items():
                    try:
                        report.setdefault('pages', {})[str(model)] = observe(page)
                    except Exception:
                        pass
                browser.close()
    finally:
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        server.shutdown()
    print(json.dumps({key: report[key] for key in ('passed', 'manual_pause_ends_both_links',
        'stock_on_recovers_after_interruption', 'transfers', 'disconnect_propagates')}, indent=2))


if __name__ == '__main__':
    main()
