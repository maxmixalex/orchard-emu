/* SPDX-License-Identifier: MIT
 * ARM920T page-table walks; cache/TLB timing and lockdown are not simulated. */
#include "internal.h"

void o_fault(o_cpu *c, uint32_t address, unsigned status, unsigned domain, bool fetch) {
    uint32_t fsr = (status & 15u) | ((domain & 15u) << 4);
    if (fetch) { c->ifsr = fsr; c->prefetch_abort = true; }
    else { c->dfsr = fsr; c->far = address; c->data_abort = true; }
}
static bool permission(o_cpu *c, unsigned ap, bool user, bool write) {
    if (ap == 3) return true;
    if (ap == 2) return !user || !write;
    if (ap == 1) return !user;
    unsigned sr = (c->control >> 8) & 3u;
    return !write && (sr == 2 || (sr == 1 && !user));
}
bool o_translate(orchard_machine *m, uint32_t address, bool write, bool fetch,
                 bool user, uint32_t *physical) {
    o_cpu *c = &m->cpu;
    if (!(c->control & 1u)) { *physical = address; return true; }
    uint32_t va = address;
    if (va < 0x02000000u) va |= c->pid & 0xfe000000u;
    uint32_t l1;
    uint32_t l1addr = (c->ttb & 0xffffc000u) | ((va >> 18) & 0x3ffcu);
    if (!o_phys_read(m, l1addr, 4, &l1)) {
        o_fault(c, va, 12, 0, fetch); return false;
    }
    unsigned type = l1 & 3u, domain = (l1 >> 5) & 15u;
    unsigned access = (c->domain >> (domain * 2u)) & 3u;
    unsigned ap;
    bool section = type == 2;
    if (!type) { o_fault(c, va, 5, 0, fetch); return false; }
    if (section) {
        *physical = (l1 & 0xfff00000u) | (va & 0xfffffu);
        ap = (l1 >> 10) & 3u;
    } else {
        uint32_t l2, l2addr = type == 1
            ? (l1 & 0xfffffc00u) | ((va >> 10) & 0x3fcu)
            : (l1 & 0xfffff000u) | ((va >> 8) & 0xffcu);
        if (!o_phys_read(m, l2addr, 4, &l2)) {
            o_fault(c, va, 14, domain, fetch); return false;
        }
        switch (l2 & 3u) {
        case 1:
            *physical = (l2 & 0xffff0000u) | (va & 0xffffu);
            ap = (l2 >> (4u + 2u * ((va >> 14) & 3u))) & 3u;
            break;
        case 2:
            *physical = (l2 & 0xfffff000u) | (va & 0xfffu);
            ap = (l2 >> (4u + 2u * ((va >> 10) & 3u))) & 3u;
            break;
        case 3:
            if (type != 3) { o_fault(c, va, 7, domain, fetch); return false; }
            *physical = (l2 & 0xfffffc00u) | (va & 0x3ffu);
            ap = (l2 >> 4) & 3u;
            break;
        default: o_fault(c, va, 7, domain, fetch); return false;
        }
    }
    if (access == 0 || access == 2) {
        o_fault(c, va, section ? 9 : 11, domain, fetch); return false;
    }
    if (access != 3 && !permission(c, ap, user, write)) {
        o_fault(c, va, section ? 13 : 15, domain, fetch); return false;
    }
    return true;
}
static bool aligned(orchard_machine *m, uint32_t address, unsigned width) {
    if (!(address & (width - 1u))) return true;
    if (m->cpu.control & 2u) {
        o_fault(&m->cpu, address, 1, 0, false);
        return false;
    }
    if (width == 2) {
        /* Misaligned halfwords are architecturally unpredictable in ARMv4T. */
        o_stop(m, ORCHARD_UNPREDICTABLE, address, width);
        return false;
    }
    return true;
}
bool o_load(orchard_machine *m, uint32_t address, unsigned width, bool user, uint32_t *value) {
    if (!aligned(m, address, width)) return false;
    uint32_t physical;
    user = user || (m->cpu.cpsr & 31u) == O_USR;
    if (!o_translate(m, address, false, false, user, &physical)) return false;
    if (!o_phys_read(m, physical & ~(width - 1u), width, value)) {
        if (m->stop.status == ORCHARD_OK) o_fault(&m->cpu, address, 8, 0, false);
        return false;
    }
    if (width == 4) *value = o_ror(*value, (address & 3u) * 8u);
    return true;
}
bool o_store(orchard_machine *m, uint32_t address, unsigned width, bool user, uint32_t value) {
    if (!aligned(m, address, width)) return false;
    uint32_t physical;
    user = user || (m->cpu.cpsr & 31u) == O_USR;
    if (!o_translate(m, address, true, false, user, &physical)) return false;
    if (!o_phys_write(m, physical & ~(width - 1u), width, value)) {
        if (m->stop.status == ORCHARD_OK) o_fault(&m->cpu, address, 8, 0, false);
        return false;
    }
    return true;
}
bool o_cp15(orchard_machine *m, uint32_t op) {
    o_cpu *c = &m->cpu;
    if ((c->cpsr & 31u) == O_USR || ((op >> 21) & 7u)) return false;
    bool read = (op & (1u << 20)) != 0;
    unsigned crn = (op >> 16) & 15u, rd = (op >> 12) & 15u;
    unsigned crm = op & 15u, op2 = (op >> 5) & 7u;
    uint32_t value = o_getr(c, rd);
    if (read) {
        if (crn == 0 && crm == 0 && op2 == 0) value = 0x41129200u;
        else if (crn == 0 && crm == 0 && op2 == 1) value = 0x0d172172u;
        else if (crn == 1 && crm == 0 && op2 == 0) value = c->control;
        else if (crn == 2 && crm == 0 && op2 == 0) value = c->ttb;
        else if (crn == 3 && crm == 0 && op2 == 0) value = c->domain;
        else if (crn == 5 && crm == 0 && op2 <= 1) value = op2 ? c->ifsr : c->dfsr;
        else if (crn == 6 && crm == 0 && op2 == 0) value = c->far;
        else if (crn == 13 && crm == 0 && op2 == 0) value = c->pid;
        else if (crn == 7 && (crm == 10 || crm == 14) && op2 == 3)
            value = O_Z; /* Test-and-clean: the functional model has no dirty cache. */
        else return false;
        if (rd == 15) c->cpsr = (c->cpsr & 0x0fffffffu) | (value & 0xf0000000u);
        else c->r[rd] = value;
        return true;
    }
    if (rd == 15) return false;
    if (crn == 1 && crm == 0 && op2 == 0) {
        if (value & 128u) {
            o_stop(m, ORCHARD_UNSUPPORTED_ENDIAN, c->r[15], value);
            return true;
        }
        c->control = value | 0x78u;
    } else if (crn == 2 && crm == 0 && op2 == 0) c->ttb = value & 0xffffc000u;
    else if (crn == 3 && crm == 0 && op2 == 0) c->domain = value;
    else if (crn == 5 && crm == 0 && op2 <= 1) {
        if (op2) c->ifsr = value; else c->dfsr = value;
    } else if (crn == 6 && crm == 0 && op2 == 0) c->far = value;
    else if (crn == 13 && crm == 0 && op2 == 0) c->pid = value & 0xfe000000u;
    else if (crn == 7 && crm == 0 && op2 == 4) c->sleeping = true;
    else if (crn == 7 && ((crm == 5 && op2 <= 2) || (crm == 6 && op2 <= 2) ||
             (crm == 7 && op2 == 0) || (crm == 10 && (op2 == 1 || op2 == 2 || op2 == 4)) ||
             (crm == 14 && (op2 == 1 || op2 == 2)))) {
        /* Coherent functional memory: maintenance has no dirty data to flush. */
    } else if (crn == 8 && (crm == 5 || crm == 6 || crm == 7) && op2 <= 1) {
        /* No cached translations. The next access always walks guest tables. */
    } else return false;
    return true;
}
