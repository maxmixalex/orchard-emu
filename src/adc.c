/* SPDX-License-Identifier: MIT
 * Original normal-mode ADC model. Samsung S3C2410A manual 16-4..16-11,
 * 14-17: five conversion clocks, selected AIN code, completion subsource 10.
 * Explicit ideal sample codes are test conditions, not measured analog pins.
 */
#include "internal.h"

void o_adc_reset(o_adc *a) {
    o_zero(a, sizeof(*a));
    a->con = 0x3fc4;
    a->tsc = 0x58;
    a->delay = 0xff;
}
orchard_status orchard_adc_input(orchard_machine *m, unsigned channel,
                                  bool known, unsigned code) {
    if (!m || !m->profile || channel >= 8 || code > 1023 || (!known && code))
        return ORCHARD_BAD_ARGUMENT;
    o_adc *a = &m->soc.adc;
    a->inputs[channel] = (uint16_t)code;
    a->known = (uint8_t)((a->known & ~(1u << channel)) | (known ? 1u << channel : 0));
    return ORCHARD_OK;
}
static bool start(orchard_machine *m, uint32_t control, uint32_t address) {
    o_adc *a = &m->soc.adc;
    if (control & 4u) return true; /* Standby: no sample and no new completion. */
    if (a->remaining || (a->tsc & 7u)) {
        o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, control); return false;
    }
    unsigned channel = (control >> 3) & 7u;
    if (!(a->known & (1u << channel))) {
        o_stop(m, ORCHARD_UNRESOLVED_ANALOG, address, channel); return false;
    }
    unsigned divisor = control & 0x4000u ? ((control >> 6) & 255u) + 1u : 1u;
    if ((control & 0x4000u) && divisor == 1) {
        o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, control); return false;
    }
    /* Sample-and-hold at start; later stimuli affect the next sample.
       remaining is measured in the shared functional PCLK domain. */
    a->sample = a->inputs[channel];
    a->remaining = 5u * divisor;
    a->con &= ~0x8000u;
    return true;
}
void o_adc_tick(orchard_machine *m) {
    o_adc *a = &m->soc.adc;
    if (!a->remaining || (a->con & 4u)) return;
    if (--a->remaining) return;
    a->data = a->sample;
    a->valid = true;
    a->con |= 0x8000u;
    m->soc.subsrcpnd |= 1u << 10;
}
bool o_adc_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write) {
    if (address < 0x58000000u || address > 0x58000010u || (address & 3u) || width != 4)
        return false;
    o_adc *a = &m->soc.adc;
    if (write) {
        if (address == 0x58000000u) {
            uint32_t next = *value & 0x7ffeu; /* RO completion and self-clearing start. */
            /* Mid-conversion mux/clock/retrigger semantics need separate evidence.
               Standby alone can pause/resume the held conversion. */
            if (a->remaining && (((next ^ a->con) & 0x7ffau) || (*value & 1u))) {
                o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, *value); return false;
            }
            if ((*value & 1u) && !(next & 2u) && !start(m, next, address)) return false;
            a->con = (a->con & 0x8000u) | next;
            return true;
        }
        if (address == 0x58000004u) {
            /* No touch panel in this model; do not simulate touch modes by zero. */
            if ((*value & 0x107u) || a->remaining) {
                o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, *value); return false;
            }
            a->tsc = *value & 0xf8u;
            return true;
        }
        if (address == 0x58000008u) {
            if (!(*value & 0xffffu)) {
                o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, *value); return false;
            }
            a->delay = *value & 0xffffu; /* Touch sequencing only, not normal ADC. */
            return true;
        }
        return false; /* Data registers are read-only. */
    }
    if (address == 0x58000000u) *value = a->con;
    else if (address == 0x58000004u) *value = a->tsc;
    else if (address == 0x58000008u) *value = a->delay;
    else if (address == 0x5800000cu) {
        if (!a->valid) {
            o_stop(m, ORCHARD_UNRESOLVED_ANALOG, address, 0x100u); return false;
        }
        uint32_t previous = a->data;
        if ((a->con & 2u) && !start(m, a->con, address)) return false;
        *value = previous; /* READ_START returns the old sample, then starts anew. */
    } else {
        /* DAT1 and touch status have no defined normal-conversion result. */
        o_stop(m, ORCHARD_UNRESOLVED_ANALOG, address, 0x101u); return false;
    }
    return true;
}
