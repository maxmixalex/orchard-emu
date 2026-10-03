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

/* Documented LCD register and functional single-scan timing model.
   No LCD FIFO/bus arbitration or physical panel model is implied. */
#define LCD_LINE_MASK (0x3ffu << 18)
#define LCD_FRAME_BIT 2u
void o_lcd_reset(o_soc *s) {
    o_zero(s->lcd, sizeof(s->lcd));
    s->lcd[0x5c / 4] = 3;
    s->lcd[0x60 / 4] = 4;
    s->lcd_line = s->lcd_phase = 0;
    s->lcd_frames = 0;
    s->lcd_probe68_reads = 0;
    s->lcd_probe68_idle_zero = false;
}
static void lcd_irq(o_soc *s) {
    if (s->lcd[0x54 / 4]) s->srcpnd |= 1u << 16;
}
void o_lcd_tick(orchard_machine *m) {
    o_soc *s = &m->soc;
    uint32_t *r = s->lcd;
    lcd_irq(s);
    if (!(r[0] & 1u)) return;
    unsigned mode = (r[0] >> 5) & 3u, clk = (r[0] >> 8) & 0x3ffu;
    if (mode == 0 || mode == 3 || ((r[0] >> 1) & 15u) > 2 || clk < 2 ||
        (r[1] & ~0xffc000u) || (r[2] & 0x3e00000u) || (r[3] & 0xfcu)) {
        o_stop(m, ORCHARD_UNSUPPORTED_LCD, 0x4d000000u, r[0]); return;
    }
    /* Manual 15-4 line formula; WLH/WDLY table values in 15-28/29.
       The formula's superscripts disagree with those tables for codes 2/3;
       this functional model uses the explicit 16/32/48/64-HCLK tables. */
    uint32_t period = 2u * clk * (((r[2] >> 8) & 0x7ffu) + 1u) +
        16u * ((r[3] & 3u) + 1u) + 16u * (((r[2] >> 19) & 3u) + 1u) +
        8u * (r[2] & 255u);
    if (++s->lcd_phase < period) return;
    s->lcd_phase = 0;
    if (s->lcd_line) --s->lcd_line;
    else {
        s->lcd_line = (r[1] >> 14) & 0x3ffu;
        ++s->lcd_frames;
        r[0x58 / 4] |= LCD_FRAME_BIT;
        r[0x54 / 4] |= LCD_FRAME_BIT & ~r[0x5c / 4];
        lcd_irq(s);
    }
}
bool o_lcd_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write) {
    if (!write && o_lcd_probe68_read(m, address, width, value)) return true;
    if (width != 4 || (address & 3u) || address < 0x4d000000u || address > 0x4d000060u)
        return false;
    uint32_t off = address - 0x4d000000u;
    if (off > 0x28u && off < 0x4cu) return false;
    o_soc *s = &m->soc;
    uint32_t *r = s->lcd, index = off / 4;
    if (!write) {
        *value = off ? r[index] : (r[0] & ~LCD_LINE_MASK) | (s->lcd_line << 18);
        return true; /* Reading is observational; never advance the line counter. */
    }
    switch (off) {
    case 0:
        if (!((r[0] ^ *value) & 1u)) {
            /* Live clock/mode reprogramming not assigned guessed scan timing. */
            if ((r[0] & 1u) && ((r[0] ^ *value) & 0x3fffeu)) {
                o_stop(m, ORCHARD_UNSUPPORTED_LCD, address, *value); return false;
            }
        } else if (*value & 1u) {
            s->lcd_phase = 0;
            s->lcd_line = (r[1] >> 14) & 0x3ffu;
        }
        r[0] = *value & 0x3ffffu;
        return true;
    case 4: case 8: case 12:
        if ((r[0] & 1u) && r[index] != *value) {
            o_stop(m, ORCHARD_UNSUPPORTED_LCD, address, *value); return false;
        }
        r[index] = *value; return true;
    case 0x4c:
        if (*value & 0x7ffffu) break;
        r[index] = 0; return true;
    case 0x50:
        if (*value & 0x1000000u) break; /* TFT temporary palette unsupported. */
        r[index] = *value & 0xffffffu; return true;
    case 0x54: case 0x58:
        r[index] &= ~(*value & 3u); /* W1C; source and pending are separate latches. */
        return true;
    case 0x5c:
        if (!(*value & 1u)) break; /* Do not advertise a nonexistent FIFO IRQ. */
        /* Only newly unmasked sources latch here. Acknowledging INTPND
           before SRCPND must not relatch the same old event every tick. */
        r[0x54 / 4] |= r[0x58 / 4] & r[index] & ~*value & 3u;
        r[index] = *value & 7u;
        lcd_irq(s);
        return true;
    case 0x60:
        if (*value & 1u) break; /* LPC3600 is not present in the model. */
        r[index] = (*value & 2u) | 4u; return true;
    default:
        r[index] = *value; return true;
    }
    o_stop(m, ORCHARD_UNSUPPORTED_LCD, address, *value);
    return false;
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

orchard_status orchard_annunciators(const orchard_machine *m, uint8_t levels[6]) {
    if (!m || !m->profile || !levels) return ORCHARD_BAD_ARGUMENT;
    o_zero(levels, 6);
    const uint32_t *r = m->soc.lcd;
    if (!(r[0] & 1u)) return ORCHARD_OK;
    unsigned mode = (r[0] >> 1) & 15u, panel = (r[0] >> 5) & 3u;
    if (mode > 2 || panel == 0 || panel == 3) return ORCHARD_UNSUPPORTED_LCD;
    unsigned bpp = 1u << mode, page = r[7] & 0x7ffu;
    unsigned stride = (page + ((r[7] >> 11) & 0x7ffu)) * 2u;
    unsigned lines = ((r[1] >> 14) & 0x3ffu) + 1u;
    if (page * 16u != 160u * bpp || lines < 6) return ORCHARD_UNSUPPORTED_LCD;
    uint32_t start = (r[5] & 0x3fffffffu) << 1;
    uint32_t end = (start & 0xffc00000u) | ((r[6] & 0x1fffffu) << 1);
    uint8_t result[6];
    for (unsigned segment = 0; segment < 6; ++segment) {
        uint32_t address = start + segment * stride + (131u * bpp) / 8u;
        uint8_t byte;
        if (end <= start || address < start || address >= end ||
            orchard_read_memory(m, address, &byte, 1) != ORCHARD_OK) return ORCHARD_BUS_ERROR;
        unsigned level = (byte >> ((131u * bpp) & 7u)) & ((1u << bpp) - 1u);
        result[segment] = bpp == 2 ? (uint8_t)(((r[10] >> (level * 4u)) & 15u) * 17u)
                                  : (uint8_t)(level * 255u / ((1u << bpp) - 1u));
    }
    o_copy(levels, result, 6);
    return ORCHARD_OK;
}
