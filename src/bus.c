/* SPDX-License-Identifier: MIT */
#include "internal.h"

bool o_phys_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    if (!value || (width != 1 && width != 2 && width != 4)) return false;
    if (address < m->profile->flash_bytes && width <= m->profile->flash_bytes - address) {
        return o_nor_read(m, address, width, value);
    }
    if (o_sram_read(m, address, width, value)) return true;
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE < O_BOOT_SRAM_SIZE &&
        width <= O_BOOT_SRAM_SIZE - (address - O_BOOT_SRAM_BASE)) {
        *value = o_read_le(m->boot_sram + address - O_BOOT_SRAM_BASE, width);
        return true;
    }
    if (address >= 0x48000000u && address < 0x60000000u)
        return o_mmio_read(m, address, width, value);
    return false;
}
bool o_phys_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value) {
    if (width != 1 && width != 2 && width != 4) return false;
    if (address < m->profile->flash_bytes && width <= m->profile->flash_bytes - address) {
        return o_nor_write(m, address, width, value);
    }
    if (o_sram_write(m, address, width, value)) return true;
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE < O_BOOT_SRAM_SIZE &&
        width <= O_BOOT_SRAM_SIZE - (address - O_BOOT_SRAM_BASE)) {
        for (unsigned i = 0; i < width; ++i)
            m->boot_sram[address - O_BOOT_SRAM_BASE + i] = (uint8_t)(value >> (i * 8u));
        return true;
    }
    if (address >= 0x48000000u && address < 0x60000000u)
        return o_mmio_write(m, address, width, value);
    return false;
}
