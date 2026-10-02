/* SPDX-License-Identifier: MIT
 * Samsung S3C2410A manual (2004), chapter 18. Functional countdown model:
 * one scheduler tick supplies one provisional PCLK quantum, not elapsed time.
 * Clock-tree timing and reset propagation are deliberately not approximated
 * by a fabricated full-machine cold reset.
 */
#include "internal.h"

void o_watchdog_reset(o_soc *s) {
    s->wtcon = 0x8021;
    s->wtdat = s->wtcnt = 0x8000;
    s->wtphase = 0;
}
void o_watchdog_tick(orchard_machine *m) {
    o_soc *s = &m->soc;
    if (!(s->wtcon & (1u << 5))) return;
    unsigned divisor = (((s->wtcon >> 8) & 255u) + 1u) *
                       (16u << ((s->wtcon >> 3) & 3u));
    if (++s->wtphase < divisor) return;
    s->wtphase = 0;
    if (s->wtcnt) --s->wtcnt;
    if (s->wtcnt) return;
    s->wtcnt = s->wtdat;
    if (s->wtcon & 4u) s->srcpnd |= 1u << 9;
    if (s->wtcon & 1u)
        o_stop(m, ORCHARD_UNIMPLEMENTED_RESET, 0x53000000u, s->wtcon);
}
bool o_watchdog_register(o_soc *s, uint32_t address, uint32_t *value, bool write) {
    switch (address) {
    case 0x53000000u:
        if (write) {
            uint32_t next = *value & 0xff3du;
            /* Deterministic phase on enable/divider changes. Sub-divider
               transition phase is not a hardware-validated timing claim. */
            if ((s->wtcon ^ next) & 0xff38u) s->wtphase = 0;
            s->wtcon = next;
        } else *value = s->wtcon;
        return true;
    case 0x53000004u:
        if (write) s->wtdat = *value & 0xffffu;
        else *value = s->wtdat;
        return true;
    case 0x53000008u:
        if (write) { s->wtcnt = *value & 0xffffu; s->wtphase = 0; }
        else *value = s->wtcnt;
        return true;
    default:
        return false;
    }
}
