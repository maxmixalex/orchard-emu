/* SPDX-License-Identifier: MIT */
#include "internal.h"

static void fail(orchard_machine *m, uint16_t op) {
    o_stop(m, ORCHARD_UNSUPPORTED_INSTRUCTION, m->cpu.r[15], op);
}
static void memop(orchard_machine *m, unsigned kind, unsigned rd, uint32_t address) {
    o_cpu *c = &m->cpu;
    static const unsigned widths[8] = {4, 2, 1, 1, 4, 2, 1, 2};
    unsigned width = widths[kind];
    if (kind < 3) {
        (void)o_store(m, address, width, false, c->r[rd]);
        return;
    }
    uint32_t value;
    if (!o_load(m, address, width, false, &value)) return;
    if ((kind == 3 || kind == 7) && (value & (1u << (width * 8u - 1u))))
        value |= UINT32_MAX << (width * 8u);
    c->r[rd] = value;
}
void o_thumb(orchard_machine *m, uint16_t op) {
    o_cpu *c = &m->cpu;
    unsigned rd = op & 7u, rs = (op >> 3) & 7u;
    if ((op & 0xf800u) == 0x1800u) {
        uint32_t b = op & 0x400u ? (op >> 6) & 7u : c->r[(op >> 6) & 7u];
        bool sub = (op & 0x200u) != 0;
        c->r[rd] = o_add(c, c->r[rs], sub ? ~b : b, sub ? 1 : 0, true);
    } else if ((op & 0xe000u) == 0) {
        bool carry = (c->cpsr & O_C) != 0;
        c->r[rd] = o_shift(c->r[rs], (op >> 11) & 3u, (op >> 6) & 31u, true, &carry);
        o_nz(c, c->r[rd]);
        c->cpsr = (c->cpsr & ~O_C) | (carry ? O_C : 0);
    } else if ((op & 0xe000u) == 0x2000u) {
        rd = (op >> 8) & 7u;
        uint32_t imm = op & 255u;
        switch ((op >> 11) & 3u) {
        case 0: c->r[rd] = imm; o_nz(c, imm); break;
        case 1: (void)o_add(c, c->r[rd], ~imm, 1, true); break;
        case 2: c->r[rd] = o_add(c, c->r[rd], imm, 0, true); break;
        case 3: c->r[rd] = o_add(c, c->r[rd], ~imm, 1, true); break;
        }
    } else if ((op & 0xfc00u) == 0x4000u) {
        uint32_t a = c->r[rd], b = c->r[rs], value = 0;
        unsigned kind = (op >> 6) & 15u;
        unsigned cin = (c->cpsr & O_C) != 0;
        bool carry = cin != 0, arithmetic = false, store = true, shift = false;
        switch (kind) {
        case 0: value = a & b; break;
        case 1: value = a ^ b; break;
        case 2: case 3: case 4:
            value = o_shift(a, kind - 2, b & 255u, false, &carry); shift = true; break;
        case 5: value = o_add(c, a, b, cin, true); arithmetic = true; break;
        case 6: value = o_add(c, a, ~b, cin, true); arithmetic = true; break;
        case 7: value = o_shift(a, 3, b & 255u, false, &carry); shift = true; break;
        case 8: value = a & b; store = false; break;
        case 9: value = o_add(c, 0, ~b, 1, true); arithmetic = true; break;
        case 10: value = o_add(c, a, ~b, 1, true); arithmetic = true; store = false; break;
        case 11: value = o_add(c, a, b, 0, true); arithmetic = true; store = false; break;
        case 12: value = a | b; break;
        case 13: value = a * b; break;
        case 14: value = a & ~b; break;
        case 15: value = ~b; break;
        }
        if (!arithmetic) o_nz(c, value);
        if (shift) c->cpsr = (c->cpsr & ~O_C) | (carry ? O_C : 0);
        if (store) c->r[rd] = value;
    } else if ((op & 0xfc00u) == 0x4400u) {
        rd |= (op >> 4) & 8u;
        rs = (op >> 3) & 15u;
        unsigned kind = (op >> 8) & 3u;
        uint32_t a = o_getr(c, rd), b = o_getr(c, rs);
        if (kind == 0) o_putr(c, rd, a + b);
        else if (kind == 1) (void)o_add(c, a, ~b, 1, true);
        else if (kind == 2) o_putr(c, rd, b);
        else {
            if ((op & 0x87u) || rs == 15) { fail(m, op); return; }
            c->cpsr = (c->cpsr & ~O_T) | (b & 1u ? O_T : 0);
            o_putr(c, 15, b);
        }
    } else if ((op & 0xf800u) == 0x4800u) {
        memop(m, 4, (op >> 8) & 7u, ((c->r[15] + 4u) & ~3u) + (op & 255u) * 4u);
    } else if ((op & 0xf000u) == 0x5000u) {
        memop(m, (op >> 9) & 7u, rd, c->r[rs] + c->r[(op >> 6) & 7u]);
    } else if ((op & 0xe000u) == 0x6000u) {
        bool byte = (op & 0x1000u) != 0, load = (op & 0x800u) != 0;
        unsigned kind = (load ? 4u : 0u) + (byte ? 2u : 0u);
        memop(m, kind, rd, c->r[rs] + ((op >> 6) & 31u) * (byte ? 1u : 4u));
    } else if ((op & 0xf000u) == 0x8000u) {
        memop(m, op & 0x800u ? 5 : 1, rd, c->r[rs] + ((op >> 6) & 31u) * 2u);
    } else if ((op & 0xf000u) == 0x9000u) {
        memop(m, op & 0x800u ? 4 : 0, (op >> 8) & 7u, c->r[13] + (op & 255u) * 4u);
    } else if ((op & 0xf000u) == 0xa000u) {
        uint32_t base = op & 0x800u ? c->r[13] : (c->r[15] + 4u) & ~3u;
        c->r[(op >> 8) & 7u] = base + (op & 255u) * 4u;
    } else if ((op & 0xff00u) == 0xb000u) {
        uint32_t offset = (op & 127u) * 4u;
        c->r[13] = op & 128u ? c->r[13] - offset : c->r[13] + offset;
    } else if ((op & 0xf600u) == 0xb400u) {
        bool pop = (op & 0x800u) != 0;
        uint32_t list = op & 255u;
        if (op & 0x100u) list |= 1u << (pop ? 15u : 14u);
        unsigned count = 0;
        for (unsigned i = 0; i < 16; ++i) count += (list >> i) & 1u;
        if (!count) { fail(m, op); return; }
        uint32_t address = pop ? c->r[13] : c->r[13] - count * 4u;
        for (unsigned r = 0; r < 16; ++r) {
            if (!(list & (1u << r))) continue;
            uint32_t value;
            if (pop) {
                if (!o_load(m, address, 4, false, &value)) return;
                o_putr(c, r, value); /* ARMv4T POP PC stays in Thumb state. */
            } else if (!o_store(m, address, 4, false, c->r[r])) return;
            address += 4;
        }
        c->r[13] = pop ? c->r[13] + count * 4u : c->r[13] - count * 4u;
    } else if ((op & 0xf000u) == 0xc000u) {
        unsigned rb = (op >> 8) & 7u;
        uint32_t list = op & 255u, address = c->r[rb];
        bool load = (op & 0x800u) != 0;
        if (!list || (!load && (list & (1u << rb)) && (list & ((1u << rb) - 1u)))) {
            fail(m, op); return;
        }
        for (unsigned r = 0; r < 8; ++r) {
            if (!(list & (1u << r))) continue;
            if (load) {
                if (!o_load(m, address, 4, false, &c->r[r])) return;
            } else if (!o_store(m, address, 4, false, c->r[r])) return;
            address += 4;
        }
        if (!load || !(list & (1u << rb))) c->r[rb] = address;
    } else if ((op & 0xf000u) == 0xd000u) {
        unsigned condition = (op >> 8) & 15u;
        if (condition == 15) {
            uint32_t link = c->r[15] + 2u;
            o_exception(c, O_SVC, 8, link);
            c->next_pc = c->r[15];
        } else if (condition == 14) fail(m, op);
        else if (o_condition(c, condition)) {
            uint32_t offset = (op & 255u) << 1;
            if (offset & 256u) offset |= 0xfffffe00u;
            c->next_pc = c->r[15] + 4u + offset;
        }
    } else if ((op & 0xf800u) == 0xe000u) {
        uint32_t offset = (op & 0x7ffu) << 1;
        if (offset & 0x800u) offset |= 0xfffff000u;
        c->next_pc = c->r[15] + 4u + offset;
    } else if ((op & 0xf800u) == 0xf000u) {
        uint32_t offset = (uint32_t)(op & 0x7ffu) << 12;
        if (offset & 0x400000u) offset |= 0xff800000u;
        c->r[14] = c->r[15] + 4u + offset;
    } else if ((op & 0xf800u) == 0xf800u) {
        uint32_t target = c->r[14] + (op & 0x7ffu) * 2u;
        c->r[14] = (c->r[15] + 2u) | 1u;
        o_putr(c, 15, target);
    } else fail(m, op);
}
