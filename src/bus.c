/* SPDX-License-Identifier: MIT */
#include "internal.h"

static uint32_t read_le(const uint8_t *p, unsigned width) {
    uint32_t value = 0;
    for (unsigned i = 0; i < width; ++i) value |= (uint32_t)p[i] << (i * 8u);
    return value;
}
bool o_phys_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    if (!value || (width != 1 && width != 2 && width != 4)) return false;
    if (address < m->profile->flash_bytes && width <= m->profile->flash_bytes - address) {
        return o_nor_read(m, address, width, value);
    }
    if (address >= O_RAM_BASE && address - O_RAM_BASE < m->profile->ram_bytes &&
        width <= m->profile->ram_bytes - (address - O_RAM_BASE)) {
        *value = read_le(m->ram + address - O_RAM_BASE, width);
        return true;
    }
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE < O_BOOT_SRAM_SIZE &&
        width <= O_BOOT_SRAM_SIZE - (address - O_BOOT_SRAM_BASE)) {
        *value = read_le(m->boot_sram + address - O_BOOT_SRAM_BASE, width);
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
    if (address >= O_RAM_BASE && address - O_RAM_BASE < m->profile->ram_bytes &&
        width <= m->profile->ram_bytes - (address - O_RAM_BASE)) {
        for (unsigned i = 0; i < width; ++i)
            m->ram[address - O_RAM_BASE + i] = (uint8_t)(value >> (i * 8u));
        return true;
    }
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
orchard_status orchard_framebuffer(const orchard_machine *m, uint8_t *pixels, size_t capacity) {
    if (!m || !pixels || capacity < m->profile->lcd_width * m->profile->lcd_height)
        return ORCHARD_BAD_ARGUMENT;
    unsigned width = m->profile->lcd_width, height = m->profile->lcd_height;
    o_zero(pixels, width * height);
    const uint32_t *r = m->soc.lcd;
    if (!(r[0] & 1u)) return ORCHARD_OK;
    unsigned mode = (r[0] >> 1) & 15u;
    if (mode > 2 || ((r[0] >> 5) & 3u) == 0 || ((r[0] >> 5) & 3u) == 3) return ORCHARD_UNSUPPORTED_LCD;
    unsigned bpp = 1u << mode;
    unsigned page = r[7] & 0x7ffu, offset = (r[7] >> 11) & 0x7ffu;
    unsigned stride = (page + offset) * 2u;
    unsigned lines = ((r[1] >> 14) & 0x3ffu) + 1u;
    if (page * 16u < width * bpp || !stride) return ORCHARD_UNSUPPORTED_LCD;
    uint32_t start = (r[5] & 0x3fffffffu) << 1;
    uint32_t end = (start & 0xffc00000u) | ((r[6] & 0x1fffffu) << 1);
    if (end <= start) return ORCHARD_UNSUPPORTED_LCD;
    for (unsigned y = 0; y < height && y < lines; ++y) {
        for (unsigned x = 0; x < width; ++x) {
            uint32_t byte_offset = y * stride + (x * bpp) / 8u;
            /* Unswept STN streams the most significant bit of each word
               first (manual 15-9); SRAM stores that word little-endian.
               BSWP reverses four bytes, HWSWP exchanges 16-bit halves. */
            byte_offset ^= 3u;
            if (r[4] & 1u) byte_offset ^= 2u;
            if (r[4] & 2u) byte_offset ^= 3u;
            uint32_t address = start + byte_offset;
            uint8_t byte;
            if (address < start || address >= end ||
                orchard_read_memory(m, address, &byte, 1) != ORCHARD_OK)
                return ORCHARD_BUS_ERROR;
            unsigned shift = 8u - bpp - ((x * bpp) & 7u);
            unsigned level = (byte >> shift) & ((1u << bpp) - 1u);
            pixels[y * width + x] = (uint8_t)(level * 255u / ((1u << bpp) - 1u));
        }
    }
    return ORCHARD_OK;
}
