/* SPDX-License-Identifier: MIT
 * S3C2410A User's Manual (March 2004), chapter 19. Empty-slot SDI controller.
 * Commands consume 48 serial clocks; a requested response times out after
 * another 64 clocks. No card, response bytes, sectors or successful data
 * transfers are invented. The clock uses the core's functional PCLK ticks.
 */
#include "internal.h"

void o_sdi_reset(o_sdi *s) {
    o_zero(s, sizeof(*s));
    s->data_timer = 0x2000;
}
static void sdi_irq(o_soc *soc) {
    o_sdi *s = &soc->sdi;
    uint32_t sources = ((s->status & 0x1e00u) << 5) |
                       ((s->data_status & 0x7f8u) << 3);
    if (sources & s->interrupt_mask) soc->srcpnd |= 1u << 21;
}
void o_sdi_tick(orchard_machine *m) {
    o_sdi *s = &m->soc.sdi;
    if ((m->soc.clock[3] & 0x200u) && s->remaining && !--s->remaining) {
        if (s->phase == 1u) {
            s->status |= 0x800u; /* Command sent, independent of response. */
            if (s->response_remaining) {
                s->remaining = s->response_remaining;
                s->response_remaining = 0;
                s->phase = 2;
            }
        } else s->status |= 0x400u; /* Empty slot cannot provide a response. */
        if (!s->remaining) {
            s->phase = 0;
            s->status &= ~0x100u;
            s->command &= ~0x100u;
        }
    }
    sdi_irq(&m->soc);
}
bool o_sdi_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write) {
    if (address < 0x5a000000u || address > 0x5a000040u) return false;
    if (width != 4 || (address & 3u)) return false;
    o_sdi *s = &m->soc.sdi;
    uint32_t offset = address - 0x5a000000u, mask = 0;
    uint32_t *reg = NULL;
    switch (offset) {
    case 0: reg = &s->control; mask = 0x1f; break;
    case 4: reg = &s->prescaler; mask = 0xff; break;
    case 8: reg = &s->argument; mask = UINT32_MAX; break;
    case 0x0c: reg = &s->command; mask = 0x1fff; break;
    case 0x10:
        if (write) s->status &= ~(*value & 0x1e00u);
        else *value = s->status;
        sdi_irq(&m->soc); return true;
    case 0x14: case 0x18: case 0x1c: case 0x20: case 0x30:
        if (write) return false;
        *value = 0; return true;
    case 0x24: reg = &s->data_timer; mask = 0xffff; break;
    case 0x28: reg = &s->block_size; mask = 0xfff; break;
    case 0x2c: reg = &s->data_control; mask = 0x3fffff; break;
    case 0x34:
        if (write) s->data_status &= ~(*value & 0x7f8u);
        else *value = s->data_status;
        sdi_irq(&m->soc); return true;
    case 0x38:
        if (write) return false;
        *value = 0; return true; /* No data transfer mode is active. */
    case 0x40: reg = &s->interrupt_mask; mask = 0x3ffdf; break;
    default: return false; /* FIFO data access is outside the empty-slot subset. */
    }
    if (!write) { *value = *reg; return true; }
    uint32_t next = *value & mask;
    if ((offset == 0x0c && (next & 0x100u) && s->remaining) ||
        (offset == 0x2c && (next & 0xb000u) && !(next & 0x4000u))) {
        o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, *value);
        return false;
    }
    *reg = next;
    if (offset == 0) s->control &= ~2u; /* FIFO reset is self-clearing. */
    if (offset == 0x0c && (next & 0x100u)) {
        uint32_t divisor = 2u * (s->prescaler + 1u);
        s->status = (s->status & ~0x1ffu) | 0x100u;
        s->phase = 1;
        s->remaining = 48u * divisor;
        s->response_remaining = (next & 0x200u) ? 64u * divisor : 0;
    }
    sdi_irq(&m->soc);
    return true;
}
