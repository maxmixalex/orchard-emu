#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Optional independent ARMv4T-subset differential; no firmware or downloads.

Unicorn 2.1.4 is installed separately. This process loads only that engine;
Orchard runs in separate native and Node/WASM processes via fixed records.
CPU model TI925T is NOT an ARM920T board oracle. Exceptions, MMU, caches,
peripherals, undefined encodings and implementation-defined PC cases are out
of scope. Every generated accepted case must compare; none is silently skipped.
"""
from __future__ import annotations
import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess
import sys

CODE = 0x08000000
DATA = CODE + 0x2000
RECORD = 328
MASK32 = 0xffffffff
EDGE = (0, 1, 2, 31, 32, 33, 255, 256, 0x80000000, 0x7fffffff,
        MASK32, 0x55555555, 0xaaaaaaaa)
ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Case:
    opcode: int
    cpsr: int
    registers: tuple[int, ...]
    memory: bytes
    group: str
    cpsr_mask: int = MASK32

    def record(self) -> bytes:
        return struct.pack('<18I', self.opcode, self.cpsr, *self.registers) + self.memory


def generate(seed: int, samples: int) -> list[Case]:
    rng = random.Random(seed)
    cases: list[Case] = []

    def registers() -> list[int]:
        return [rng.choice(EDGE) if rng.randrange(3) == 0 else rng.getrandbits(32)
                for _ in range(16)]

    def add(op: int, group: str, thumb: bool = False,
            regs: list[int] | None = None, mask: int = MASK32, pc: int = CODE) -> None:
        r = registers() if regs is None else list(regs)
        r[15] = pc
        ps = (rng.randrange(16) << 28) | rng.choice((0x10, 0x1f)) | (0x20 if thumb else 0)
        memory = bytes(rng.getrandbits(8) for _ in range(256))
        cases.append(Case(op, ps, tuple(r), memory, group, mask))

    for _ in range(4 * samples):
        kind = rng.randrange(16)
        test = 8 <= kind <= 11
        # MOV/MVN Rn and test Rd fields must be zero. R15 with a register-
        # controlled shift is excluded rather than used to calibrate PC quirks.
        rn = 0 if kind in (13, 15) else rng.randrange(15)
        rd = 0 if test else rng.randrange(15)
        rm = rng.randrange(15)
        s = 1 if test else rng.randrange(2)
        form = rng.randrange(3)
        op = (rng.randrange(15) << 28) | (kind << 21) | (s << 20) | (rn << 16) | (rd << 12)
        if form == 0:
            op |= (1 << 25) | rng.randrange(4096)
        elif form == 1:
            op |= (rng.randrange(32) << 7) | (rng.randrange(4) << 5) | rm
        else:
            op |= (rng.randrange(15) << 8) | (rng.randrange(4) << 5) | 16 | rm
        add(op, f'arm-alu-{form}')
    for _ in range(2 * samples):
        op = 0x4000 | (rng.randrange(16) << 6) | (rng.randrange(8) << 3) | rng.randrange(8)
        # Keep the pre-ARMv6 multiply operand restriction and compare only
        # architecturally defined flags: v4 multiply C/V are not an oracle.
        multiply = (op >> 6) & 15 == 13
        if multiply and (op & 7) == ((op >> 3) & 7):
            op = (op & ~0x38) | (((op + 1) & 7) << 3)
        mask = MASK32 ^ 0x30000000 if multiply else MASK32
        add(op, 'thumb-alu', True, mask=mask)
    for _ in range(samples):
        kind = rng.randrange(3)
        if kind == 0:
            op = (rng.randrange(3) << 11) | (rng.randrange(32) << 6) | (rng.randrange(8) << 3) | rng.randrange(8)
        elif kind == 1:
            op = 0x1800 | rng.randrange(2048)
        else:
            op = 0x2000 | rng.randrange(8192)
        add(op, 'thumb-shift-immediate', True)
    for _ in range(samples):
        rn, rd, rm, rs = rng.sample(range(13), 4)
        wide, acc = rng.randrange(2), rng.randrange(2)
        if wide:
            op = 0xe0800090 | (rng.randrange(2) << 22) | (acc << 21) | (rd << 16) | (rn << 12) | (rs << 8) | rm
        else:
            op = 0xe0000090 | (acc << 21) | (rd << 16) | ((rn if acc else 0) << 12) | (rs << 8) | rm
        add(op, 'multiply')
    for _ in range(samples):
        r = registers()
        rn, rd = rng.sample(range(13), 2)
        r[rn] = DATA + 128
        byte = rng.randrange(2)
        offset = rng.randrange(16) * (1 if byte else 4)
        op = 0xe4000000 | (rng.randrange(2) << 24) | (rng.randrange(2) << 23) | (byte << 22) | (rng.randrange(2) << 21) | (rng.randrange(2) << 20) | (rn << 16) | (rd << 12) | offset
        add(op, 'arm-memory', regs=r)
    for _ in range(3 * samples // 2):
        r = registers()
        rn, rd, rm = rng.sample(range(13), 3)
        r[rn], r[rm] = DATA + 128, rng.randrange(16) * 2
        kind, immediate = rng.choice((1, 2, 3)), rng.randrange(2)
        load = 1 if kind != 1 else rng.randrange(2)
        offset = rng.randrange(16) * 2
        op = 0xe0000090 | (rng.randrange(2) << 24) | (rng.randrange(2) << 23) | (immediate << 22) | (rng.randrange(2) << 21) | (load << 20) | (rn << 16) | (rd << 12) | (kind << 5)
        # P=0,W=1 belongs to later unprivileged halfword encodings, not
        # the ordinary ARMv4T post-indexed form under comparison here.
        if not (op & (1 << 24)):
            op &= ~(1 << 21)
        op |= (offset & 15) | ((offset & 240) << 4) if immediate else rm
        add(op, 'arm-half-signed', regs=r)
    for _ in range(samples):
        r = registers()
        rn = rng.randrange(13)
        r[rn] = DATA + 128
        register_list = sum(1 << k for k in rng.sample([k for k in range(15) if k != rn], rng.randrange(1, 8)))
        op = 0xe8000000 | (rng.randrange(2) << 24) | (rng.randrange(2) << 23) | (rng.randrange(2) << 21) | (rng.randrange(2) << 20) | (rn << 16) | register_list
        add(op, 'arm-block', regs=r)
    for _ in range(samples // 2):
        r = registers()
        rn, rd, rm = rng.sample(range(13), 3)
        r[rn] = DATA + rng.randrange(64) * 4
        op = 0xe1000090 | (rng.randrange(2) << 22) | (rn << 16) | (rd << 12) | rm
        add(op, 'arm-swap', regs=r)
    for _ in range(3 * samples // 2):
        r = registers()
        rn, rd, rm = rng.sample(range(8), 3)
        r[rn], r[rm] = DATA + 128, rng.randrange(16) * 4
        op = 0x5000 | (rng.randrange(8) << 9) | (rm << 6) | (rn << 3) | rd
        add(op, 'thumb-memory', True, r)
    for _ in range(samples):
        r = registers()
        rn = rng.randrange(8)
        r[rn] = DATA + 128
        register_list = sum(1 << k for k in rng.sample([k for k in range(8) if k != rn], rng.randrange(1, 7)))
        op = 0xc000 | (rng.randrange(2) << 11) | (rn << 8) | register_list
        add(op, 'thumb-block', True, r)
    for _ in range(samples // 2):
        r = registers()
        r[13] = DATA + 128
        add(0xb400 | (rng.randrange(2) << 11) | rng.randrange(1, 256), 'thumb-stack', True, r)
    for _ in range(samples):
        op = (rng.randrange(15) << 28) | 0xa000000 | (rng.randrange(2) << 24) | rng.randrange(100)
        add(op, 'arm-branch')
    for _ in range(samples):
        add(0xd000 | (rng.randrange(14) << 8) | rng.randrange(128), 'thumb-branch', True)
    # Explicit state exchange and ordinary PC+8 reads, without the ambiguous
    # register-controlled PC operands encountered during exploratory generation.
    for thumb in (False, True):
        for target_thumb in (0, 1):
            for rm in range(15):
                r = registers()
                r[rm] = CODE + 0x100 + target_thumb
                add((0x4700 | (rm << 3)) if thumb else (0xe12fff10 | rm),
                    'branch-exchange', thumb, r, pc=CODE + (2 if thumb else 0))
    for rd in range(15):
        add(0xe28f0004 | (rd << 12), 'pc-immediate')
    return cases


def run_process(command: list[str], payload: bytes) -> bytes:
    result = subprocess.run(command, input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=90, check=False)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed ({result.returncode}): '
                           + result.stderr.decode('utf-8', 'replace')[-2000:])
    return result.stdout


def check_transport(native: Path, test_wasm: Path) -> int:
    commands = ([str(native)], ['node', str(ROOT / 'tools/cpu-oracle-wasm.mjs'), str(test_wasm)])
    words = [0xe3a00001, 0x1f] + [0] * 15 + [CODE]
    valid = struct.pack('<18I', *words) + bytes(256)
    malformed = [valid[:-1], valid + b'\0']
    for field, value in ((1, 0x13), (1, 0x11f), (17, CODE + 2), (17, CODE + 4)):
        wrong = list(words)
        wrong[field] = value
        malformed.append(struct.pack('<18I', *wrong) + bytes(256))
    checked = 0
    for command in commands:
        if run_process(command, b'') != b'':
            raise RuntimeError('Empty test stream produced output')
        for payload in malformed:
            result = subprocess.run(command, input=payload, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=15, check=False)
            if not result.returncode:
                raise RuntimeError('Malformed test transport record accepted')
            checked += 1
    return checked


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-dir', type=Path, default=ROOT / 'build')
    parser.add_argument('--native', type=Path, help='Override test runner for sanitizer/mutation checks')
    parser.add_argument('--seed', type=lambda text: int(text, 0), default=0x09202410)
    parser.add_argument('--samples', type=int, default=1000)
    parser.add_argument('--output', type=Path, help='New JSON report; existing paths are refused')
    args = parser.parse_args()
    if not 2 <= args.samples <= 5000 or not 0 <= args.seed <= MASK32:
        parser.error('samples must be 2..5000, seed must be an unsigned 32-bit integer')
    if args.output and args.output.exists():
        parser.error('report path already exists')
    try:
        import unicorn
        from unicorn import arm_const as arm
    except ImportError as exc:
        raise RuntimeError('Install the optional tools/requirements-oracle.txt in a separate environment') from exc
    if unicorn.__version__ != '2.1.4':
        raise RuntimeError(f'Expected pinned Unicorn 2.1.4, found {unicorn.__version__}')
    build = args.build_dir.resolve()
    native = (args.native or build / ('orchard-cpu-oracle.exe' if sys.platform == 'win32' else 'orchard-cpu-oracle')).resolve()
    test_wasm = build / 'cpu-oracle.wasm'
    rejected = check_transport(native, test_wasm)
    cases = generate(args.seed, args.samples)
    records = b''.join(case.record() for case in cases)
    native_output = run_process([str(native)], records)
    wasm_output = run_process(['node', str(ROOT / 'tools/cpu-oracle-wasm.mjs'), str(test_wasm)], records)
    if len(native_output) != len(records) or native_output != wasm_output:
        raise RuntimeError('Native/test-WASM record size or state mismatch')
    engine = unicorn.Uc(unicorn.UC_ARCH_ARM, unicorn.UC_MODE_ARM)
    # Must be selected before all other engine setup. No silent ARM926 default.
    engine.ctl_set_cpu_model(arm.UC_CPU_ARM_TI925T)
    engine.mem_map(CODE, 0x4000)
    engine.reg_write(arm.UC_ARM_REG_CPSR, 0x1f)
    baseline = engine.context_save()
    ids = [getattr(arm, f'UC_ARM_REG_R{i}') for i in range(16)]
    digest = hashlib.sha256()
    for index, case in enumerate(cases):
        engine.context_restore(baseline)
        engine.mem_write(CODE, bytes(0x2100))
        engine.mem_write(case.registers[15], struct.pack('<I', case.opcode))
        engine.mem_write(DATA, case.memory)
        engine.ctl_remove_cache(CODE, CODE + 8)
        engine.reg_write(arm.UC_ARM_REG_CPSR, case.cpsr)
        for reg, value in zip(ids, case.registers):
            engine.reg_write(reg, value)
        try:
            engine.emu_start(case.registers[15] | ((case.cpsr >> 5) & 1), CODE + 0x4000, count=1)
        except unicorn.UcError as exc:
            raise RuntimeError(f'Oracle rejected case {index} ({case.group}, {case.opcode:08x}); '
                               'case generation or model scope requires review; NOT skipped') from exc
        expected_regs = [engine.reg_read(reg) for reg in ids]
        expected_cpsr = engine.reg_read(arm.UC_ARM_REG_CPSR)
        expected_memory = bytes(engine.mem_read(DATA, 256))
        output = native_output[index * RECORD:(index + 1) * RECORD]
        status, cpsr, *actual_regs = struct.unpack('<18I', output[:72])
        if (status or (cpsr & case.cpsr_mask) != (expected_cpsr & case.cpsr_mask)
                or actual_regs != expected_regs or output[72:] != expected_memory):
            witness = {'case': index, 'group': case.group, 'opcode': f'{case.opcode:08x}',
                       'input_record': case.record().hex(), 'cpsr_mask': f'{case.cpsr_mask:08x}',
                       'orchard_status': status, 'orchard_cpsr': cpsr, 'oracle_cpsr': expected_cpsr,
                       'orchard_registers': actual_regs, 'oracle_registers': expected_regs,
                       'orchard_memory': output[72:].hex(), 'oracle_memory': expected_memory.hex()}
            raise RuntimeError('Independent CPU mismatch: ' + json.dumps(witness))
        digest.update(case.record())
        digest.update(struct.pack('<I', case.cpsr_mask))
        digest.update(case.group.encode('ascii') + b'\0')
    report = {'schema': 'orchard-cpu-differential-v1', 'unicorn': unicorn.__version__,
              'cpu_model': 'TI925T', 'target_scope': 'defined shared ARMv4T instruction subset',
              'seed': hex(args.seed), 'samples': args.samples, 'cases': len(cases),
              'transport_rejections': rejected,
              'groups': dict(sorted(Counter(c.group for c in cases).items())),
              'corpus_sha256': digest.hexdigest(), 'native_sha256': hashlib.sha256(native.read_bytes()).hexdigest(),
              'test_wasm_sha256': hashlib.sha256(test_wasm.read_bytes()).hexdigest(),
              'native_wasm_equal': True, 'unicorn_equal': True, 'mismatches': 0, 'skipped': 0,
              'arm920t_full_conformance': False, 'firmware_used': False}
    if args.output:
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
