/* SPDX-License-Identifier: MIT
 * Original LCD inspection and narrowly scoped bring-up hypothesis.
 * Samsung S3C2410A manual 15-9, 15-14, 15-31 through 15-34.
 * The +0x68 name/function remains unknown; see docs/development/lcd.md.
 */
#include "internal.h"

orchard_status orchard_lcd_probe68(orchard_machine *m, bool idle_zero) {
    if (!m || !m->profile) return ORCHARD_BAD_ARGUMENT;
    m->soc.lcd_probe68_idle_zero = idle_zero;
    return ORCHARD_OK;
}
uint64_t orchard_lcd_probe68_reads(const orchard_machine *m) {
    return m && m->profile ? m->soc.lcd_probe68_reads : 0;
}
bool o_lcd_probe68_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    if (address != 0x4d000068u || width != 4 || !m->soc.lcd_probe68_idle_zero ||
        (m->soc.lcd[0] & 1u)) return false;
    *value = 0;
    ++m->soc.lcd_probe68_reads;
    return true;
}

orchard_status orchard_framebuffer_view(const orchard_machine *m, orchard_frame_view view,
                                        uint8_t *pixels, size_t capacity) {
    if (!m || !m->profile || !pixels || (unsigned)view > ORCHARD_FRAME_PACKED_LSB || capacity < m->profile->lcd_width * m->profile->lcd_height)
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
            uint32_t logical = start + byte_offset;
            if (logical < start || logical >= end) return ORCHARD_BUS_ERROR;
            uint32_t address = logical;
            if (view == ORCHARD_FRAME_CONTROLLER) {
                /* Apply lanes to the absolute 32-bit bus word, not the
                   buffer-relative offset: LCDBASEU can be halfword-aligned.
                   A swapped lane may precede start within that fetched word. */
                unsigned lanes = 3u;
                if (r[4] & 1u) lanes ^= 2u;
                if (r[4] & 2u) lanes ^= 3u;
                address ^= lanes;
            }
            uint8_t byte;
            if (orchard_read_memory(m, address, &byte, 1) != ORCHARD_OK)
                return ORCHARD_BUS_ERROR;
            unsigned shift = view == ORCHARD_FRAME_PACKED_LSB
                ? (x * bpp) & 7u : 8u - bpp - ((x * bpp) & 7u);
            unsigned level = (byte >> shift) & ((1u << bpp) - 1u);
            /* The 4-level STN palette is BLUELUT (manual 15-14/15-34).
               This is an ideal intensity, not temporal grayscale/contrast. */
            pixels[y * width + x] = bpp == 2
                ? (uint8_t)(((r[10] >> (level * 4u)) & 15u) * 17u)
                : (uint8_t)(level * 255u / ((1u << bpp) - 1u));
        }
    }
    return ORCHARD_OK;
}

orchard_status orchard_framebuffer(const orchard_machine *m, uint8_t *pixels, size_t capacity) {
    return orchard_framebuffer_view(m, ORCHARD_FRAME_CONTROLLER, pixels, capacity);
}
