/* SPDX-License-Identifier: MIT
 * Original ARMv4T interpreter. References: Samsung S3C2410A manual chapters
 * 2-4, ARM DDI 0151C chapters 2-3. No external emulator implementation. */
#include "internal.h"

static unsigned bank_index(uint32_t mode) {
    switch (mode & 31u) {
    case O_FIQ: return 1;
    case O_IRQ: return 2;
    case O_SVC: return 3;
    case O_ABT: return 4;
    case O_UND: return 5;
    default: return 0;
    }
}
bool o_mode_valid(uint32_t mode) {
    mode &= 31u;
    return mode == O_USR || mode == O_SYS || bank_index(mode) != 0;
}
void o_set_cpsr(o_cpu *c, uint32_t value) {
    unsigned old = bank_index(c->cpsr), next = bank_index(value);
    if (old != next) {
        uint32_t *old_sp = old == 0 ? &c->usr[5] : old == 1 ? &c->fiq[5] : c->bank[old - 2];
        old_sp[0] = c->r[13];
        old_sp[1] = c->r[14];
        if (old == 1 || next == 1) {
            for (unsigned i = 0; i < 5; ++i) {
                (old == 1 ? c->fiq : c->usr)[i] = c->r[i + 8];
                c->r[i + 8] = (next == 1 ? c->fiq : c->usr)[i];
            }
        }
        uint32_t *new_sp = next == 0 ? &c->usr[5] : next == 1 ? &c->fiq[5] : c->bank[next - 2];
        c->r[13] = new_sp[0];
        c->r[14] = new_sp[1];
    }
    c->cpsr = value;
}
uint32_t *o_spsr(o_cpu *c) {
    unsigned b = bank_index(c->cpsr);
    return b ? &c->spsr[b - 1] : NULL;
}
void o_cpu_reset(o_cpu *c) {
    o_zero(c, sizeof(*c));
    c->cpsr = O_SVC | O_I | O_F;
    c->control = 0x78; /* ARM920T reserved-one bits; MMU/caches disabled. */
}
void o_exception(o_cpu *c, unsigned mode, uint32_t vector, uint32_t link) {
    uint32_t old = c->cpsr;
    o_set_cpsr(c, (old & ~(31u | O_T)) | mode | O_I | (mode == O_FIQ ? O_F : 0));
    uint32_t *s = o_spsr(c);
    if (s) *s = old;
    c->r[14] = link;
    c->r[15] = (c->control & (1u << 13) ? 0xffff0000u : 0) + vector;
    c->sleeping = false;
    ++c->exceptions;
}
uint32_t o_getr(const o_cpu *c, unsigned r) {
    return r == 15 ? c->r[15] + (c->cpsr & O_T ? 4u : 8u) : c->r[r];
}
void o_putr(o_cpu *c, unsigned r, uint32_t value) {
    if (r == 15) c->next_pc = value & (c->cpsr & O_T ? ~1u : ~3u);
    else c->r[r] = value;
}
uint32_t o_get_user(const o_cpu *c, unsigned r) {
    if (r >= 8 && r <= 12 && (c->cpsr & 31u) == O_FIQ) return c->usr[r - 8];
    if (r >= 13 && r <= 14 && bank_index(c->cpsr)) return c->usr[r - 8];
    return o_getr(c, r);
}
void o_put_user(o_cpu *c, unsigned r, uint32_t value) {
    if (r >= 8 && r <= 12 && (c->cpsr & 31u) == O_FIQ) c->usr[r - 8] = value;
    else if (r >= 13 && r <= 14 && bank_index(c->cpsr)) c->usr[r - 8] = value;
    else o_putr(c, r, value);
}
uint32_t o_ror(uint32_t n, unsigned amount) {
    amount &= 31u;
    return amount ? (n >> amount) | (n << (32u - amount)) : n;
}
bool o_condition(const o_cpu *c, unsigned condition) {
    bool n = (c->cpsr & O_N) != 0, z = (c->cpsr & O_Z) != 0;
    bool carry = (c->cpsr & O_C) != 0, v = (c->cpsr & O_V) != 0;
    switch (condition) {
    case 0: return z;
    case 1: return !z;
    case 2: return carry;
    case 3: return !carry;
    case 4: return n;
    case 5: return !n;
    case 6: return v;
    case 7: return !v;
    case 8: return carry && !z;
    case 9: return !carry || z;
    case 10: return n == v;
    case 11: return n != v;
    case 12: return !z && n == v;
    case 13: return z || n != v;
    case 14: return true;
    default: return false; /* NV is not ARMv5's unconditional extension space. */
    }
}
void o_nz(o_cpu *c, uint32_t value) {
    c->cpsr = (c->cpsr & ~(O_N | O_Z)) | (value & O_N) | (value ? 0 : O_Z);
}
uint32_t o_add(o_cpu *c, uint32_t a, uint32_t b, unsigned carry, bool flags) {
    uint64_t result = (uint64_t)a + b + carry;
    uint32_t value = (uint32_t)result;
    if (flags) {
        o_nz(c, value);
        c->cpsr = (c->cpsr & ~(O_C | O_V)) | (result >> 32 ? O_C : 0) |
                  ((~(a ^ b) & (a ^ value) & O_N) ? O_V : 0);
    }
    return value;
}
uint32_t o_shift(uint32_t value, unsigned kind, unsigned amount, bool immediate, bool *carry) {
    if (!immediate && amount == 0) return value;
    switch (kind) {
    case 0: /* LSL */
        if (!amount) return value;
        *carry = amount <= 32 && ((value >> (32u - amount)) & 1u);
        return amount < 32 ? value << amount : 0;
    case 1: /* LSR #0 encodes #32. */
        if (!amount) amount = 32;
        *carry = amount <= 32 && ((value >> (amount - 1u)) & 1u);
        return amount < 32 ? value >> amount : 0;
    case 2: /* Arithmetic shift, without signed implementation-defined shifts. */
        if (!amount) amount = 32;
        if (amount >= 32) {
            *carry = (value & O_N) != 0;
            return *carry ? UINT32_MAX : 0;
        }
        *carry = ((value >> (amount - 1u)) & 1u) != 0;
        return (value >> amount) | (value & O_N ? UINT32_MAX << (32u - amount) : 0);
    default:
        if (immediate && !amount) {
            bool old = *carry;
            *carry = (value & 1u) != 0;
            return (value >> 1) | (old ? O_N : 0);
        }
        amount &= 31u;
        value = o_ror(value, amount);
        *carry = (value & O_N) != 0;
        return value;
    }
}
static uint32_t operand2(o_cpu *c, uint32_t op, bool *carry) {
    if (op & (1u << 25)) {
        unsigned rotation = ((op >> 8) & 15u) * 2u;
        uint32_t value = o_ror(op & 255u, rotation);
        if (rotation) *carry = (value & O_N) != 0;
        return value;
    }
    bool regshift = (op & 16u) != 0;
    unsigned rm = op & 15u;
    uint32_t value = o_getr(c, rm);
    if (regshift && rm == 15) value += 4; /* PC + 12 for register-shift Rm. */
    unsigned amount = regshift ? o_getr(c, (op >> 8) & 15u) & 255u : (op >> 7) & 31u;
    return o_shift(value, (op >> 5) & 3u, amount, !regshift, carry);
}
static void unpredictable(orchard_machine *m, uint32_t op) {
    o_stop(m, ORCHARD_UNPREDICTABLE, m->cpu.r[15], op);
}
static bool restore_spsr(orchard_machine *m) {
    uint32_t *s = o_spsr(&m->cpu);
    if (!s || !o_mode_valid(*s)) {
        unpredictable(m, s ? *s : 0);
        return false;
    }
    o_set_cpsr(&m->cpu, *s);
    return true;
}
static void data_processing(orchard_machine *m, uint32_t op) {
    o_cpu *c = &m->cpu;
    unsigned rd = (op >> 12) & 15u, rn = (op >> 16) & 15u;
    unsigned kind = (op >> 21) & 15u;
    bool test = kind >= 8 && kind <= 11;
    bool flags = (op & (1u << 20)) != 0;
    if ((test && !flags) || (!(op & (1u << 25)) && (op & 16u) &&
        ((op & 128u) || ((op >> 8) & 15u) == 15))) {
        unpredictable(m, op);
        return;
    }
    bool carry = (c->cpsr & O_C) != 0;
    uint32_t b = operand2(c, op, &carry), a = o_getr(c, rn), result = 0;
    if (!(op & (1u << 25)) && (op & 16u) && rn == 15) a += 4;
    bool arithmetic = false;
    bool alu_flags = flags && (rd != 15 || test);
    unsigned cin = (c->cpsr & O_C) != 0;
    switch (kind) {
    case 0: case 8: result = a & b; break;
    case 1: case 9: result = a ^ b; break;
    case 2: case 10: result = o_add(c, a, ~b, 1, alu_flags); arithmetic = true; break;
    case 3: result = o_add(c, b, ~a, 1, alu_flags); arithmetic = true; break;
    case 4: case 11: result = o_add(c, a, b, 0, alu_flags); arithmetic = true; break;
    case 5: result = o_add(c, a, b, cin, alu_flags); arithmetic = true; break;
    case 6: result = o_add(c, a, ~b, cin, alu_flags); arithmetic = true; break;
    case 7: result = o_add(c, b, ~a, cin, alu_flags); arithmetic = true; break;
    case 12: result = a | b; break;
    case 13: result = b; break;
    case 14: result = a & ~b; break;
    case 15: result = ~b; break;
    }
    if (alu_flags && !arithmetic) {
        o_nz(c, result);
        c->cpsr = (c->cpsr & ~O_C) | (carry ? O_C : 0);
    }
    if (!test) {
        if (rd == 15 && flags && !restore_spsr(m)) return;
        o_putr(c, rd, result);
    }
}
static void psr_transfer(orchard_machine *m, uint32_t op, bool read) {
    o_cpu *c = &m->cpu;
    bool saved = (op & (1u << 22)) != 0;
    uint32_t *target = saved ? o_spsr(c) : &c->cpsr;
    if (!target) { unpredictable(m, op); return; }
    if (read) {
        unsigned rd = (op >> 12) & 15u;
        if (rd == 15) { unpredictable(m, op); return; }
        c->r[rd] = *target;
        return;
    }
    if (!(op & (1u << 25)) && (op & 15u) == 15) {
        unpredictable(m, op); return;
    }
    uint32_t mask = 0;
    for (unsigned b = 0; b < 4; ++b)
        if (op & (1u << (16u + b))) mask |= 255u << (b * 8u);
    mask &= ((c->cpsr & 31u) == O_USR) ? 0xf0000000u :
            (saved ? 0xf00000ffu : 0xf00000dfu);
    bool carry = false;
    uint32_t value = (op & (1u << 25)) ? operand2(c, op, &carry) : o_getr(c, op & 15u);
    value = (*target & ~mask) | (value & mask);
    /* SPSR stores a saved bit pattern, not the current execution mode.
       Suspend code may restore an unused bank's reset/unknown mode bits.
       Validate them only when an exception return actually copies the SPSR
       to CPSR; a direct CPSR mode change still requires a valid mode. */
    if (!saved && !o_mode_valid(value)) { unpredictable(m, op); return; }
    if (saved) *target = value;
    else o_set_cpsr(c, value);
}
static void multiply(orchard_machine *m, uint32_t op, bool wide) {
    o_cpu *c = &m->cpu;
    unsigned rm = op & 15u, rs = (op >> 8) & 15u;
    unsigned hi = (op >> 16) & 15u, lo = (op >> 12) & 15u;
    /* ARMv4T, Samsung manual 3-23/3-26: Rm must not overlap the
       destination; long multiply requires RdHi, RdLo and Rm distinct. */
    if (rm == 15 || rs == 15 || hi == 15 || hi == rm ||
        (wide && (lo == 15 || hi == lo || lo == rm))) {
        unpredictable(m, op); return;
    }
    bool accumulate = (op & (1u << 21)) != 0;
    uint64_t result;
    if (wide && (op & (1u << 22))) {
        /* Exact sign extension using unsigned arithmetic. */
        uint64_t a = c->r[rm], b = c->r[rs];
        if (a & O_N) a |= UINT64_C(0xffffffff00000000);
        if (b & O_N) b |= UINT64_C(0xffffffff00000000);
        result = a * b;
    } else result = (uint64_t)c->r[rm] * c->r[rs];
    if (wide) {
        if (accumulate) result += ((uint64_t)c->r[hi] << 32) | c->r[lo];
        c->r[hi] = (uint32_t)(result >> 32);
        c->r[lo] = (uint32_t)result;
        if (op & (1u << 20))
            c->cpsr = (c->cpsr & ~(O_N | O_Z)) | (c->r[hi] & O_N) | (result ? 0 : O_Z);
    } else {
        if (accumulate) {
            if (lo == 15) { unpredictable(m, op); return; }
            result += c->r[lo];
        }
        c->r[hi] = (uint32_t)result;
        if (op & (1u << 20)) o_nz(c, c->r[hi]);
    }
}
static void single_transfer(orchard_machine *m, uint32_t op, bool half) {
    o_cpu *c = &m->cpu;
    unsigned rn = (op >> 16) & 15u, rd = (op >> 12) & 15u;
    bool pre = (op & (1u << 24)) != 0, up = (op & (1u << 23)) != 0;
    bool wb = (op & (1u << 21)) != 0, load = (op & (1u << 20)) != 0;
    uint32_t base = o_getr(c, rn), offset;
    unsigned width = 4, sign = 0;
    if (half) {
        offset = op & (1u << 22) ? ((op >> 4) & 0xf0u) | (op & 15u) : o_getr(c, op & 15u);
        unsigned kind = (op >> 5) & 3u;
        if (!kind || (!load && kind != 1) || rd == 15) { unpredictable(m, op); return; }
        width = kind == 2 ? 1 : 2;
        sign = kind >= 2 ? width * 8u : 0;
    } else {
        if (op & (1u << 25)) {
            if (op & 16u) { unpredictable(m, op); return; }
            bool carry = (c->cpsr & O_C) != 0;
            offset = o_shift(o_getr(c, op & 15u), (op >> 5) & 3u, (op >> 7) & 31u, true, &carry);
        } else offset = op & 0xfffu;
        if (op & (1u << 22)) width = 1;
        if (width == 1 && rd == 15) { unpredictable(m, op); return; }
    }
    if ((!pre || wb) && (rn == 15 || (load && rn == rd))) { unpredictable(m, op); return; }
    uint32_t adjusted = up ? base + offset : base - offset;
    uint32_t address = pre ? adjusted : base;
    bool user = !half && !pre && wb;
    uint32_t value = o_getr(c, rd);
    if (!load && rd == 15) value += 4;
    if (load) {
        if (!o_load(m, address, width, user, &value)) return;
        if (sign && (value & (1u << (sign - 1u)))) value |= UINT32_MAX << sign;
    } else if (!o_store(m, address, width, user, value)) return;
    if (!pre || wb) c->r[rn] = adjusted;
    if (load) o_putr(c, rd, value);
}
static void block_transfer(orchard_machine *m, uint32_t op) {
    o_cpu *c = &m->cpu;
    unsigned rn = (op >> 16) & 15u;
    uint32_t list = op & 0xffffu;
    unsigned count = 0;
    for (unsigned i = 0; i < 16; ++i) count += (list >> i) & 1u;
    bool load = (op & (1u << 20)) != 0, wb = (op & (1u << 21)) != 0;
    bool special = (op & (1u << 22)) != 0, up = (op & (1u << 23)) != 0;
    bool pre = (op & (1u << 24)) != 0;
    if (!count || rn == 15 || (load && wb && (list & (1u << rn))) ||
        (special && !bank_index(c->cpsr))) { unpredictable(m, op); return; }
    uint32_t base = c->r[rn], adjusted = up ? base + count * 4u : base - count * 4u;
    uint32_t address = up ? base + (pre ? 4u : 0u) : adjusted + (pre ? 0u : 4u);
    bool user = special && (!load || !(list & 0x8000u));
    uint32_t loaded_pc = 0;
    unsigned first = 0;
    while (!(list & (1u << first))) ++first;
    if (!load && wb && (list & (1u << rn)) && rn != first) {
        unpredictable(m, op); return;
    }
    for (unsigned r = 0; r < 16; ++r) {
        if (!(list & (1u << r))) continue;
        uint32_t value;
        if (load) {
            if (!o_load(m, address, 4, false, &value)) return;
            if (r == 15) loaded_pc = value;
            else if (user) o_put_user(c, r, value);
            else c->r[r] = value;
        } else {
            value = user ? o_get_user(c, r) : o_getr(c, r);
            if (r == 15) value += 4;
            if (!o_store(m, address, 4, false, value)) return;
        }
        address += 4;
    }
    if (wb) c->r[rn] = adjusted;
    if (load && (list & 0x8000u)) {
        if (special && !restore_spsr(m)) return;
        o_putr(c, 15, loaded_pc);
    }
}
static void arm(orchard_machine *m, uint32_t op) {
    o_cpu *c = &m->cpu;
    if (!o_condition(c, op >> 28)) return;
    if ((op & 0x0ffffff0u) == 0x012fff10u) {
        unsigned rm = op & 15u;
        if (rm == 15) { unpredictable(m, op); return; }
        uint32_t target = c->r[rm];
        c->cpsr = (c->cpsr & ~O_T) | (target & 1u ? O_T : 0);
        o_putr(c, 15, target);
    } else if ((op & 0x0fbf0fffu) == 0x010f0000u) psr_transfer(m, op, true);
    else if ((op & 0x0fb0fff0u) == 0x0120f000u || (op & 0x0fb0f000u) == 0x0320f000u)
        psr_transfer(m, op, false);
    else if ((op & 0x0f8000f0u) == 0x00800090u) multiply(m, op, true);
    else if ((op & 0x0fc000f0u) == 0x00000090u) multiply(m, op, false);
    else if ((op & 0x0fb00ff0u) == 0x01000090u) {
        unsigned rn = (op >> 16) & 15u, rd = (op >> 12) & 15u, rm = op & 15u;
        if (rn == 15 || rd == 15 || rm == 15 || rn == rd || rn == rm) {
            unpredictable(m, op); return;
        }
        unsigned width = op & (1u << 22) ? 1 : 4;
        uint32_t value;
        if (o_load(m, c->r[rn], width, false, &value) &&
            o_store(m, c->r[rn], width, false, c->r[rm])) c->r[rd] = value;
    } else if ((op & 0x0e000090u) == 0x00000090u) single_transfer(m, op, true);
    else if ((op & 0x0c000000u) == 0) data_processing(m, op);
    else if ((op & 0x0c000000u) == 0x04000000u) single_transfer(m, op, false);
    else if ((op & 0x0e000000u) == 0x08000000u) block_transfer(m, op);
    else if ((op & 0x0e000000u) == 0x0a000000u) {
        uint32_t offset = (op & 0xffffffu) << 2;
        if (offset & (1u << 25)) offset |= 0xfc000000u;
        if (op & (1u << 24)) c->r[14] = c->r[15] + 4u;
        c->next_pc = c->r[15] + 8u + offset;
    } else if ((op & 0x0f000010u) == 0x0e000010u) {
        if (((op >> 8) & 15u) != 15 || !o_cp15(m, op))
            o_stop(m, ORCHARD_UNSUPPORTED_CP15, c->r[15], op);
    } else if ((op & 0x0f000000u) == 0x0f000000u) {
        uint32_t link = c->r[15] + 4u;
        o_exception(c, O_SVC, 8, link);
        c->next_pc = c->r[15];
    } else o_stop(m, ORCHARD_UNSUPPORTED_INSTRUCTION, c->r[15], op);
}
/* These classes cannot call the bus, change a register bank, or raise a
 * diagnostic stop. Potentially faulting instructions are handled separately.
 * Classification is deliberately conservative; execution uses the SAME ALU
 * helper as the reference path, not a second implementation of arithmetic. */
static bool arm_without_checkpoint(orchard_machine *m, uint32_t op) {
    o_cpu *c = &m->cpu;
    if ((op >> 28) != 14u && !o_condition(c, op >> 28)) {
        c->next_pc = c->r[15] + 4u;
        return true;
    }
    if ((op & 0x0e000000u) == 0x0a000000u) {
        uint32_t offset = (op & 0xffffffu) << 2;
        if (offset & (1u << 25)) offset |= 0xfc000000u;
        if (op & (1u << 24)) c->r[14] = c->r[15] + 4u;
        c->next_pc = c->r[15] + 8u + offset;
        return true;
    }
    if (op & 0x0c000000u) return false;
    unsigned kind = (op >> 21) & 15u;
    bool test = kind >= 8 && kind <= 11;
    bool flags = (op & (1u << 20)) != 0;
    if (test && !flags) return false; /* PSR, BX and miscellaneous encodings. */
    if (!test && flags && ((op >> 12) & 15u) == 15) return false; /* SPSR return. */
    if (!(op & (1u << 25)) && (op & 16u) &&
        ((op & 128u) || ((op >> 8) & 15u) == 15)) return false;
    c->next_pc = c->r[15] + 4u;
    data_processing(m, op);
    return true;
}
static void cpu_step(orchard_machine *m, bool fast) {
    o_cpu *c = &m->cpu;
    uint32_t pc = c->r[15], physical = 0, instruction = 0;
    unsigned width = c->cpsr & O_T ? 2 : 4;
    c->data_abort = c->prefetch_abort = false;
    if (pc & (width - 1u)) {
        o_stop(m, ORCHARD_UNPREDICTABLE, pc, width); return;
    }
    if (!o_translate(m, pc, false, true, (c->cpsr & 31u) == O_USR, &physical) ||
        !o_phys_read(m, physical, width, &instruction)) {
        if (m->stop.status != ORCHARD_OK) return;
        if (!c->prefetch_abort) o_fault(c, pc, 8, 0, true);
        o_exception(c, O_ABT, 0xc, pc + 4u);
        return;
    }
    if (fast && width == 4 && arm_without_checkpoint(m, instruction)) {
        c->r[15] = c->next_pc;
        ++c->instructions;
        return;
    }
    /* Word/byte single transfers commit GPRs and writeback only after their
     * last fallible bus operation. Keep just the speculative PC and fault
     * registers, rather than copying all banks/CP15 state on every LDR/STR.
     * The preceding path already consumed condition-failed instructions.
     * Halfword/SWP/LDM/STM/Thumb and bank-changing instructions stay below. */
    if (fast && width == 4 && (instruction & 0x0c000000u) == 0x04000000u) {
        uint32_t previous_pc = c->next_pc, previous_far = c->far, previous_fsr = c->dfsr;
        c->next_pc = pc + 4u;
        single_transfer(m, instruction, false);
        if (m->stop.status != ORCHARD_OK) {
            /* A descriptor read can raise both a bus diagnostic and a fault. */
            c->next_pc = previous_pc; c->far = previous_far; c->dfsr = previous_fsr;
            c->data_abort = false;
            m->stop.instruction = instruction;
            return;
        }
        if (c->data_abort) {
            c->next_pc = previous_pc;
            c->data_abort = false;
            o_exception(c, O_ABT, 0x10, pc + 8u);
        } else c->r[15] = c->next_pc;
        ++c->instructions;
        return;
    }
    o_cpu before = *c;
    c->next_pc = pc + width;
    if (width == 2) o_thumb(m, (uint16_t)instruction);
    else arm(m, instruction);
    if (m->stop.status != ORCHARD_OK) {
        m->stop.instruction = instruction;
        *c = before;
        return;
    }
    if (c->data_abort) {
        uint32_t far = c->far, fsr = c->dfsr;
        *c = before;
        c->far = far;
        c->dfsr = fsr;
        o_exception(c, O_ABT, 0x10, pc + 8u);
    } else c->r[15] = c->next_pc;
    ++c->instructions;
}

void o_cpu_step_reference(orchard_machine *m) { cpu_step(m, false); }
void o_cpu_step(orchard_machine *m) {
#ifdef ORCHARD_REFERENCE
    cpu_step(m, false);
#else
    cpu_step(m, true);
#endif
}
