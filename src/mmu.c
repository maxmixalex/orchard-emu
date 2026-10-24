/* SPDX-License-Identifier: MIT
 * ARM920T page-table walks and separate 64-entry instruction/data TLBs.
 * Functional translation/lockdown state; cache contents and timing are not modeled. */
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
static bool matches(const o_tlb_entry *entry, uint32_t va) {
    return entry->valid && (va & ~entry->mask) == entry->virtual_base;
}
static bool translated_access(orchard_machine *m, const o_tlb_entry *entry, uint32_t va,
                              bool write, bool fetch, bool user, uint32_t *physical) {
    o_cpu *c = &m->cpu;
    unsigned access = (c->domain >> (entry->domain * 2u)) & 3u;
    bool section = entry->mask == 0xfffffu;
    if (access == 0 || access == 2) {
        o_fault(c, va, section ? 9 : 11, entry->domain, fetch); return false;
    }
    if (access != 3 && !permission(c, entry->ap, user, write)) {
        o_fault(c, va, section ? 13 : 15, entry->domain, fetch); return false;
    }
    *physical = entry->physical_base | (va & entry->mask);
    return true;
}
/* A completed walk supplies a translation, including its protection bits.
 * Invalid descriptors and failed bus reads never manufacture a TLB entry.
 * Domain/AP decisions on a hit use current DACR/S/R/mode/access values. */
#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
static bool translate_walk(orchard_machine *m, uint32_t va, bool write, bool fetch,
                           bool user, uint32_t *physical, unsigned *filled) {
    o_cpu *c = &m->cpu;
    uint32_t l1;
    uint32_t l1addr = (c->ttb & 0xffffc000u) | ((va >> 18) & 0x3ffcu);
    if (!o_phys_read(m, l1addr, 4, &l1)) {
        o_fault(c, va, 12, 0, fetch); return false;
    }
    unsigned type = l1 & 3u, domain = (l1 >> 5) & 15u;
    o_tlb_entry entry = {.domain = (uint8_t)domain, .valid = true};
    if (!type) { o_fault(c, va, 5, 0, fetch); return false; }
    if (type == 2) {
        entry.mask = 0xfffffu;
        entry.physical_base = l1 & ~entry.mask;
        entry.ap = (uint8_t)((l1 >> 10) & 3u);
    } else {
        /* Figure 3-14/Table 3-9 put page translation faults before domain
         * faults: obtain and validate L2 even when the domain denies access. */
        uint32_t l2;
        uint32_t l2addr = type == 1
            ? (l1 & 0xfffffc00u) | ((va >> 10) & 0x3fcu)
            : (l1 & 0xfffff000u) | ((va >> 8) & 0xffcu);
        if (!o_phys_read(m, l2addr, 4, &l2)) {
            o_fault(c, va, 14, domain, fetch); return false;
        }
        unsigned shift = 0;
        switch (l2 & 3u) {
        case 1: entry.mask = 0xffffu; shift = 14; break;
        case 2: entry.mask = 0xfffu; shift = 10; break;
        case 3:
            if (type != 3) { o_fault(c, va, 7, domain, fetch); return false; }
            entry.mask = 0x3ffu; break;
        default: o_fault(c, va, 7, domain, fetch); return false;
        }
        entry.physical_base = l2 & ~entry.mask;
        entry.ap = (uint8_t)((l2 >> 4) & 3u);
        if (shift && ((l2 >> 4) & 255u) != entry.ap * 0x55u) {
            /* Equal APs occupy one whole-page entry. Unequal APs load only
             * the selected quarter (3.3.12), also defining MVA invalidation. */
            entry.ap = (uint8_t)((l2 >> (4u + 2u * ((va >> shift) & 3u))) & 3u);
            entry.mask >>= 2;
            entry.physical_base |= va & (3u << shift);
        }
    }
    entry.virtual_base = va & ~entry.mask;
    o_tlb *tlb = &m->tlb[fetch ? 1 : 0];
    unsigned victim = (tlb->lockdown >> 20) & 63u;
    entry.preserved = (tlb->lockdown & 1u) != 0;
    tlb->entry[victim] = entry;
    o_zero(m->translations[fetch ? 1 : 0], sizeof m->translations[0]);
    if (filled) *filled = victim;
    unsigned next = victim == 63u ? tlb->lockdown >> 26 : victim + 1u;
    tlb->lockdown = (tlb->lockdown & ~0x03f00000u) | (next << 20);
    /* A valid translation may still fail protection; retain it so a later
     * access checks the cached AP/domain, not a silently changed table. */
    return translated_access(m, &entry, va, write, fetch, user, physical);
}
static bool translate(orchard_machine *m, uint32_t address, bool write, bool fetch,
                       bool user, uint32_t *physical, bool hint) {
    o_cpu *c = &m->cpu;
    if (!(c->control & 1u)) { *physical = address; return true; }
    uint32_t va = address;
    if (va < 0x02000000u) va |= c->pid & 0xfe000000u;
    unsigned bank = fetch ? 1 : 0;
    o_tlb *tlb = &m->tlb[bank];
    unsigned slot = ((va >> 10) ^ (va >> 20)) & (O_TRANSLATIONS - 1u);
    o_tlb_hint *memo = &m->translations[bank][slot];
    if (hint) {
        const o_tlb_entry *entry = &tlb->entry[memo->index];
        if (memo->valid && memo->virtual_page == (va & ~1023u) && matches(entry, va))
            return translated_access(m, entry, va, write, fetch, user, physical);
    }
    for (unsigned i = 0; i < O_TLB_ENTRIES; ++i) {
        const o_tlb_entry *entry = &tlb->entry[i];
        if (matches(entry, va)) {
            if (hint) *memo = (o_tlb_hint){.virtual_page=va & ~1023u, .index=(uint8_t)i, .valid=true};
            return translated_access(m, entry, va, write, fetch, user, physical);
        }
    }
    unsigned filled = O_TLB_ENTRIES;
    bool ok = translate_walk(m, va, write, fetch, user, physical, &filled);
    if (hint && filled < O_TLB_ENTRIES)
        *memo = (o_tlb_hint){.virtual_page=va & ~1023u, .index=(uint8_t)filled, .valid=true};
    return ok;
}
bool o_translate_reference(orchard_machine *m, uint32_t address, bool write, bool fetch,
                           bool user, uint32_t *physical) {
    return translate(m, address, write, fetch, user, physical, false);
}
#if defined(__wasm__) && !defined(ORCHARD_REFERENCE) && (defined(__GNUC__) || defined(__clang__))
__attribute__((always_inline))
#endif
bool o_translate(orchard_machine *m, uint32_t address, bool write, bool fetch,
                 bool user, uint32_t *physical) {
#ifdef ORCHARD_REFERENCE
    return o_translate_reference(m, address, write, fetch, user, physical);
#else
    return translate(m, address, write, fetch, user, physical, true);
#endif
}
static void invalidate(orchard_machine *m, unsigned bank, bool single, uint32_t mva) {
    o_tlb *tlb = &m->tlb[bank];
    o_zero(m->translations[bank], sizeof m->translations[bank]);
    for (unsigned i = 0; i < O_TLB_ENTRIES; ++i) {
        o_tlb_entry *entry = &tlb->entry[i];
        if (single ? matches(entry, mva) : !entry->preserved) entry->valid = false;
    }
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
        else if (crn == 10 && crm == 0 && op2 <= 1) value = m->tlb[op2].lockdown;
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
    else if (crn == 10 && crm == 0 && op2 <= 1) m->tlb[op2].lockdown = value & O_TLB_LOCKDOWN_MASK;
    else if (crn == 7 && crm == 0 && op2 == 4) c->sleeping = true;
    else if (crn == 7 && ((crm == 5 && op2 <= 2) || (crm == 6 && op2 <= 2) ||
             (crm == 7 && op2 == 0) || (crm == 10 && (op2 == 1 || op2 == 2 || op2 == 4)) ||
             (crm == 14 && (op2 == 1 || op2 == 2)))) {
        /* Coherent functional memory: maintenance has no dirty data to flush. */
    } else if (crn == 8 && (((crm == 5 || crm == 6) && op2 <= 1) || (crm == 7 && op2 == 0))) {
        /* Rd is already an MVA; FCSE is not applied a second time. Neither
         * invalidation nor TTBR/DACR/PID/MMU writes reset replacement state. */
        if (crm == 6 || crm == 7) invalidate(m, 0, op2 != 0, value);
        if (crm == 5 || crm == 7) invalidate(m, 1, op2 != 0, value);
    } else return false;
    return true;
}
