/* SPDX-License-Identifier: MIT
 * S3C2410A User's Manual (2004), chapter 9. Register/latch bring-up.
 * Board inputs and external interrupts are not inferred from a model name.
 */
#include "internal.h"

static const unsigned port_bits[8] = {23, 11, 16, 16, 16, 8, 16, 11};
orchard_status orchard_gpio_inputs(orchard_machine *m, orchard_gpio_port port,
                                   uint32_t known_mask, uint32_t levels) {
    if (!m || !m->profile || (unsigned)port < 1 || (unsigned)port > 7)
        return ORCHARD_BAD_ARGUMENT;
    uint32_t mask = (1u << port_bits[port]) - 1u;
    if ((known_mask & ~mask) || (levels & ~known_mask)) return ORCHARD_BAD_ARGUMENT;
    m->soc.gpio_input_known[port] = known_mask;
    m->soc.gpio_input_levels[port] = levels;
    return ORCHARD_OK;
}
orchard_status orchard_gpio_bias(orchard_machine *m, orchard_gpio_port port,
                                 uint32_t known_mask, uint32_t levels) {
    if (!m || !m->profile || (unsigned)port < 1 || (unsigned)port > 7)
        return ORCHARD_BAD_ARGUMENT;
    uint32_t mask = (1u << port_bits[port]) - 1u;
    if ((known_mask & ~mask) || (levels & ~known_mask)) return ORCHARD_BAD_ARGUMENT;
    m->soc.gpio_bias_known[port] = known_mask;
    m->soc.gpio_bias_levels[port] = levels;
    return ORCHARD_OK;
}
void o_gpio_reset(o_soc *s) {
    o_zero(s->gpio, sizeof(s->gpio));
    o_zero(s->gpio_input_known, sizeof(s->gpio_input_known));
    o_zero(s->gpio_input_levels, sizeof(s->gpio_input_levels));
    o_zero(s->gpio_bias_known, sizeof(s->gpio_bias_known));
    o_zero(s->gpio_bias_levels, sizeof(s->gpio_bias_levels));
    s->keyboard_attached = false;
    s->keyboard_switches = 0;
    s->keyboard_direct = s->eint_known = s->eint_levels = 0;
    s->gpio[0] = 0x7fffff;
    s->gpio[0x38 / 4] = 0xf000;
    s->gpio[0x68 / 4] = 0xf800;
    s->gpio[0x80 / 4] = 0x10330;
    s->gpio[0xa4 / 4] = 0xfffff0;
    s->gpio[0xb4 / 4] = 1;
    /* DAT reset values are unspecified: choose zero for repeatable latches.
       This choice is not a source for unknown externally driven input pins. */
}
bool o_gpio_register(orchard_machine *m, uint32_t address, uint32_t *value, bool write) {
    o_soc *s = &m->soc;
    if (address < 0x56000000u || address > 0x560000bcu || (address & 3u)) return false;
    unsigned off = address - 0x56000000u;
    uint32_t mask = UINT32_MAX;
    bool clear = false;
    if (off < 0x80) {
        unsigned port = off / 16u, field = off % 16u, bits = port_bits[port];
        if (field == 12 || (port == 0 && field == 8)) return false;
        mask = field == 0 && port != 0
            ? (bits == 16 ? UINT32_MAX : (1u << (bits * 2u)) - 1u)
            : (1u << bits) - 1u;
        if (field == 4 && !write && port != 0) {
            uint32_t config = s->gpio[port * 4], inputs = 0;
            for (unsigned pin = 0; pin < bits; ++pin)
                if (((config >> (pin * 2u)) & 3u) == 0 ||
                    (s->keyboard_attached && (port == ORCHARD_GPIO_F || port == ORCHARD_GPIO_G) &&
                     ((config >> (pin * 2u)) & 3u) == 2)) inputs |= 1u << pin;
            uint32_t known, levels, conflicts;
            o_gpio_sample(m, port, &known, &levels, &conflicts);
            if (conflicts & inputs) {
                o_stop(m, ORCHARD_GPIO_CONTENTION, address, conflicts & inputs);
                return false;
            }
            uint32_t unresolved = inputs & ~known;
            if (unresolved) {
                o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, unresolved);
                return false;
            }
            /* Output latches do not drive input reads. External levels do not
               overwrite latches; later direction changes keep those separate.
               Alternate-function readback remains an unspecified latch choice. */
            *value = ((s->gpio[off / 4] & ~inputs) |
                      (levels & inputs)) & mask;
            return true;
        }
    } else {
        switch (off) {
        case 0x80: mask = 0xf377bu; break;
        case 0x84: mask = 0x0ff30ff3u; break;
        case 0x88: case 0x8c: mask = 0x77777777u; break;
        case 0x90: case 0x9c: case 0xa0: break;
        case 0xa4: mask = 0xfffff0; break;
        case 0xa8: mask = 0xfffff0; clear = true; break;
        case 0xb4: mask = 7; clear = true; break;
        case 0xb8: case 0xbc: break;
        /* GSTATUS0 external pins and GSTATUS1 silicon revision unestablished. */
        default: return false;
        }
    }
    uint32_t *r = &s->gpio[off / 4];
    if (write) {
        uint32_t changed = *r ^ (*value & mask);
        if (clear) *r &= ~(*value & mask);
        else *r = *value & mask;
        if (off == 0x10 || off == 0x14) o_buzzer_observe(m);
        if (off == 0x50 || off == 0x60) {
            unsigned count = off == 0x50 ? 8 : 16, first = off == 0x50 ? 0 : 8;
            for (unsigned pin = 0; pin < count; ++pin)
                if (changed & (3u << (pin * 2u))) s->eint_known &= ~(1u << (first + pin));
        }
    } else *value = *r & mask;
    return true;
}
