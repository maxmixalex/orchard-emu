/* SPDX-License-Identifier: MIT
 * ARM920T page-table walks with live-descriptor host memoization.
 * Guest cache/TLB timing and lockdown are not simulated. */
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
static uint32_t table_offset(const orchard_machine *m, uint32_t address) {
    if (address < m->profile->flash_bytes && 4u <= m->profile->flash_bytes - address && !m->nor_id_mode)
        return (uint32_t)offsetof(orchard_machine, flash) + address;
    if (address >= O_RAM_BASE && address - O_RAM_BASE < m->profile->ram_bytes &&
        4u <= m->profile->ram_bytes - (address - O_RAM_BASE))
        return (uint32_t)offsetof(orchard_machine, ram) + address - O_RAM_BASE;
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE <= O_BOOT_SRAM_SIZE - 4u)
        return (uint32_t)offsetof(orchard_machine, boot_sram) + address - O_BOOT_SRAM_BASE;
    return 0; /* MMIO, an SRAM alias, or an unmapped span must use the bus. */
}
/* Keep the descriptor walk separate: inlining it into o_translate made every
 * hit pay a large call boundary in WASM and prevented LTO from specializing
 * fetch/load/store. This is a host code-layout choice, not a guest TLB change. */
#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
static bool translate_walk(orchard_machine *m, uint32_t address, bool write, bool fetch,
                           bool user, uint32_t *physical, o_translation *memo) {
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
    uint32_t l2 = 0, l2addr = 0;
    bool section = type == 2;
    if (!type) { o_fault(c, va, 5, 0, fetch); return false; }
    if (section) {
        *physical = (l1 & 0xfff00000u) | (va & 0xfffffu);
        ap = (l1 >> 10) & 3u;
    } else {
        l2addr = type == 1
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
    if (memo) {
        uint32_t first = table_offset(m, l1addr);
        uint32_t second = section ? 0 : table_offset(m, l2addr);
        memo->first_offset = 0;
        if (first && (section || second)) {
            memo->virtual_page = va & ~1023u;
            memo->physical_page = *physical & ~1023u;
            memo->control = c->control;
            memo->ttb = c->ttb;
            memo->domain = c->domain;
            memo->access = (unsigned)write | ((unsigned)user << 1);
            memo->first_word = l1;
            memo->second_offset = second;
            memo->second_word = l2;
            memo->first_offset = first;
        }
    }
    return true;
}
bool o_translate_reference(orchard_machine *m, uint32_t address, bool write, bool fetch,
                           bool user, uint32_t *physical) {
    return translate_walk(m, address, write, fetch, user, physical, NULL);
}
/* Specialize the small memo-hit path for instruction fetch/read/write under
 * WASM LTO. Native separate compilation and the reference walker stay intact. */
#if defined(__wasm__) && !defined(ORCHARD_REFERENCE) && (defined(__GNUC__) || defined(__clang__))
__attribute__((always_inline))
#endif
bool o_translate(orchard_machine *m, uint32_t address, bool write, bool fetch,
                 bool user, uint32_t *physical) {
#ifdef ORCHARD_REFERENCE
    return o_translate_reference(m, address, write, fetch, user, physical);
#else
    o_cpu *c = &m->cpu;
    if (!(c->control & 1u)) { *physical = address; return true; }
    uint32_t va = address;
    if (va < 0x02000000u) va |= c->pid & 0xfe000000u;
    unsigned access = (unsigned)write | ((unsigned)user << 1);
    o_translation *memo = &m->translations[((va >> 10) ^ (va >> 20) ^ (access * 21u)) & (O_TRANSLATIONS - 1u)];
    const uint8_t *bytes = (const uint8_t *)m;
    if (memo->first_offset && memo->virtual_page == (va & ~1023u) &&
        memo->control == c->control && memo->ttb == c->ttb &&
        memo->domain == c->domain && memo->access == access && !m->nor_id_mode &&
        o_read_le(bytes + memo->first_offset, 4) == memo->first_word &&
        (!memo->second_offset || o_read_le(bytes + memo->second_offset, 4) == memo->second_word)) {
        *physical = memo->physical_page | (va & 1023u);
        return true;
    }
    return translate_walk(m, address, write, fetch, user, physical, memo);
#endif
}
/* The caller owns this short-lived proof. A successful ordinary translation
 * has checked the full live context and descriptors. While it is retained,
 * the only intervening instructions are arm_without_checkpoint: they cannot
 * touch the bus, change privilege/CP15 or switch banks. The runner invalidates
 * before peripheral work and IRQ/FIQ acceptance; every other instruction
 * invalidates before execution. Thus no translation dependency can change.
 * A 1 KiB key retains ARM920T's smallest AP granularity, including FCSE.
 * This skips repeated validation, never the current instruction-byte read. */
#if defined(__wasm__) && !defined(ORCHARD_REFERENCE) && (defined(__GNUC__) || defined(__clang__))
__attribute__((always_inline))
#endif
bool o_translate_fetch_reuse(orchard_machine *m, uint32_t address,
                             uint32_t *physical, o_fetch_reuse *fetch) {
#ifndef ORCHARD_REFERENCE
    if (fetch->valid && fetch->virtual_page == (address & ~1023u)) {
        *physical = fetch->physical_page | (address & 1023u);
        return true;
    }
#endif
    fetch->valid = false;
    bool user = (m->cpu.cpsr & 31u) == O_USR;
    if (!o_translate(m, address, false, true, user, physical)) return false;
#ifndef ORCHARD_REFERENCE
    if (!(m->cpu.control & 1u) || m->nor_id_mode) return true;
    uint32_t va = address;
    if (va < 0x02000000u) va |= m->cpu.pid & 0xfe000000u;
    unsigned access = (unsigned)user << 1;
    const o_translation *memo = &m->translations[
        ((va >> 10) ^ (va >> 20) ^ (access * 21u)) & (O_TRANSLATIONS - 1u)];
    /* o_translate just selected this slot. On success it either validated a
     * matching entry, or the walker populated it with these exact inputs.
     * first_offset==0 rejects side-effecting/aliased descriptor storage. */
    if (!memo->first_offset) return true;
    uint32_t page = *physical & ~1023u;
    uint32_t first = table_offset(m, page);
    /* Admit only a full normal NOR/SRAM/boot-SRAM page. In particular an
     * instruction fetch from MMIO or a counted SRAM alias cannot seed reuse. */
    if (!first || table_offset(m, page + 1020u) != first + 1020u) return true;
    fetch->virtual_page = address & ~1023u;
    fetch->physical_page = page;
    fetch->valid = true;
#endif
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
        /* Host memo hits re-read their descriptors and context. No guest TLB
           is modeled; changed guest tables are visible even without maintenance. */
    } else return false;
    return true;
}
