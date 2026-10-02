/* SPDX-License-Identifier: MIT */
#include "internal.h"

/* Profile facts and confidence are recorded in docs/development/models.md. */
static const orchard_profile profiles[] = {
    {1, "hp39gplus", "HP 39g+", "hp39", 0x100000, 0x40000, 131, 64, false},
    {2, "hp39gs", "HP 39gs", "hp39", 0x100000, 0x40000, 131, 64, false},
    {3, "hp40gs", "HP 40gs", "hp39", 0x200000, 0x40000, 131, 64, false},
    {4, "hp48gii", "HP 48gII (USB revision)", "hp48", 0x200000, 0x40000, 131, 64, false},
    {5, "hp49gplus", "HP 49g+", "hp4950", 0x200000, 0x80000, 131, 80, true},
    {6, "hp50g", "HP 50g", "hp4950", 0x200000, 0x80000, 131, 80, true}
};

void o_zero(void *p, size_t size) {
    uint8_t *b = p;
    for (size_t i = 0; i < size; ++i) b[i] = 0;
}
void o_copy(void *dst, const void *src, size_t size) {
    uint8_t *d = dst;
    const uint8_t *s = src;
    for (size_t i = 0; i < size; ++i) d[i] = s[i];
}
const orchard_profile *orchard_get_profile(unsigned id) {
    return id >= 1 && id <= 6 ? &profiles[id - 1] : NULL;
}
size_t orchard_machine_size(void) { return sizeof(orchard_machine); }
size_t orchard_machine_alignment(void) { return _Alignof(orchard_machine); }
const char *orchard_status_string(orchard_status s) {
    static const char *const names[] = {
        "ready", "bad argument", "full-NOR size mismatch", "not a full ARM NOR image",
        "no ROM loaded", "unsupported instruction", "unsupported CP15 operation",
        "unimplemented MMIO", "unimplemented NOR command", "unpredictable ARM operation",
        "UART host queue full", "big-endian mode not implemented", "unsupported LCD mode",
        "physical memory outside implemented banks",
        "watchdog reset requested; reset propagation not implemented",
        "contradictory external GPIO drives"
    };
    return (unsigned)s < sizeof(names) / sizeof(names[0]) ? names[s] : "unknown status";
}
orchard_machine *orchard_init(void *arena, size_t bytes, unsigned model_id) {
    if (!arena || bytes < sizeof(orchard_machine) ||
        (uintptr_t)arena % _Alignof(orchard_machine) != 0 || !orchard_get_profile(model_id))
        return NULL;
    orchard_machine *m = arena;
    o_zero(m, sizeof(*m));
    m->profile = orchard_get_profile(model_id);
    orchard_reset(m);
    return m;
}
void orchard_reset(orchard_machine *m) {
    if (!m) return;
    o_cpu_reset(&m->cpu);
    o_soc_reset(&m->soc);
    o_zero(m->ram, m->profile->ram_bytes);
    o_zero(m->boot_sram, sizeof(m->boot_sram));
    o_zero(&m->stop, sizeof(m->stop));
    m->ticks = 0;
    m->nor_sequence = 0; m->nor_id_mode = false;
}
orchard_status orchard_load_rom(orchard_machine *m, const void *bytes, size_t length) {
    if (!m || !bytes) return ORCHARD_BAD_ARGUMENT;
    if (length != m->profile->flash_bytes) return ORCHARD_BAD_ROM_SIZE;
    const uint8_t *data = bytes;
    uint32_t first = (uint32_t)data[0] | (uint32_t)data[1] << 8 |
                     (uint32_t)data[2] << 16 | (uint32_t)data[3] << 24;
    /* Exclude erased images, nibble images, LFS/ELF/archive/update headers.
       A full dump starts with an ARM reset branch or PC-relative vector load.
       This is a format plausibility check, not firmware/model authentication. */
    if ((first & 0xff000000u) != 0xea000000u &&
        (first & 0xff7ff000u) != 0xe51ff000u)
        return ORCHARD_BAD_ROM_FORMAT;
    o_copy(m->flash, data, length);
    m->loaded = true;
    orchard_reset(m);
    return ORCHARD_OK;
}
void o_stop(orchard_machine *m, orchard_status status, uint32_t address, uint32_t detail) {
    if (m->stop.status != ORCHARD_OK) return;
    m->stop.status = status;
    m->stop.pc = m->cpu.r[15];
    m->stop.address = address;
    m->stop.detail = detail;
}
orchard_stop orchard_run(orchard_machine *m, uint32_t budget) {
    if (!m) return (orchard_stop){.status = ORCHARD_BAD_ARGUMENT};
    if (!m->loaded) return (orchard_stop){.status = ORCHARD_NO_ROM};
    for (uint32_t i = 0; i < budget && m->stop.status == ORCHARD_OK; ++i) {
        ++m->ticks;
        o_soc_tick(m);
        if (m->stop.status != ORCHARD_OK) break;
        o_irq_update(&m->soc);
        uint32_t pending = m->soc.srcpnd & ~m->soc.intmsk;
        if (pending) m->cpu.sleeping = false;
        if ((pending & m->soc.intmod) && !(m->cpu.cpsr & O_F))
            o_exception(&m->cpu, O_FIQ, 0x1c, m->cpu.r[15] + 4u);
        else if (m->soc.intpnd && !(m->cpu.cpsr & O_I))
            o_exception(&m->cpu, O_IRQ, 0x18, m->cpu.r[15] + 4u);
        else if (!m->cpu.sleeping) o_cpu_step(m);
    }
    return m->stop;
}
void orchard_get_state(const orchard_machine *m, orchard_state *state) {
    if (!m || !state) return;
    o_zero(state, sizeof(*state));
    o_copy(state->registers, m->cpu.r, sizeof(m->cpu.r));
    state->cpsr = m->cpu.cpsr;
    state->cp15_control = m->cpu.control;
    state->fault_status = m->cpu.dfsr;
    state->fault_address = m->cpu.far;
    state->instructions = m->cpu.instructions;
    state->ticks = m->ticks;
    state->exceptions = m->cpu.exceptions;
    state->sleeping = m->cpu.sleeping;
    state->rom_loaded = m->loaded;
    state->stop = m->stop;
}
orchard_status orchard_read_memory(const orchard_machine *m, uint32_t address,
                                   void *destination, size_t length) {
    if (!m || (!destination && length)) return ORCHARD_BAD_ARGUMENT;
    if (address < m->profile->flash_bytes && length <= m->profile->flash_bytes - address) {
        o_copy(destination, m->flash + address, length);
        return ORCHARD_OK;
    }
    if (address >= O_RAM_BASE && address - O_RAM_BASE < m->profile->ram_bytes &&
        length <= m->profile->ram_bytes - (address - O_RAM_BASE)) {
        o_copy(destination, m->ram + address - O_RAM_BASE, length);
        return ORCHARD_OK;
    }
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE < O_BOOT_SRAM_SIZE &&
        length <= O_BOOT_SRAM_SIZE - (address - O_BOOT_SRAM_BASE)) {
        o_copy(destination, m->boot_sram + address - O_BOOT_SRAM_BASE, length);
        return ORCHARD_OK;
    }
    return ORCHARD_BUS_ERROR;
}
size_t orchard_uart_send(orchard_machine *m, const uint8_t *data, size_t length) {
    if (!m || (!data && length)) return 0;
    size_t n = 0;
    while (n < length && o_q_push(&m->soc.rx, data[n])) ++n;
    return n;
}
size_t orchard_uart_receive(orchard_machine *m, uint8_t *data, size_t capacity) {
    if (!m || (!data && capacity)) return 0;
    size_t n = 0;
    while (n < capacity && o_q_pop(&m->soc.tx, &data[n])) ++n;
    return n;
}
