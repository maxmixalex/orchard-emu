/* SPDX-License-Identifier: MIT
 * Original S3C2410A RTC subset; Samsung manual (2004), chapter 17.
 * Cold fixtures seed 2000-01-01 00:00:00 (weekday 7), not host wall time.
 * A provisional 12,000,000 scheduler-quanta/second timebase supplies exact
 * rational 32768-Hz edges. This is NOT a measured CPU/PCLK/PLL clock model.
 */
#include "internal.h"

static const uint8_t masks[19] = {
    15, 255, 0, 0, 127, 127, 127, 63, 63, 31, 255, 15,
    127, 127, 63, 63, 7, 31, 255
};
static unsigned decimal(uint8_t value) { return (value >> 4) * 10u + (value & 15u); }
static uint8_t bcd(unsigned value) { return (uint8_t)(((value / 10u) << 4) | (value % 10u)); }
static unsigned days(unsigned month, unsigned year) {
    static const unsigned length[12] = {31,28,31,30,31,30,31,31,30,31,30,31};
    return month >= 1 && month <= 12 ? length[month - 1] + (month == 2 && year % 4 == 0) : 0;
}
static bool valid_time(const uint8_t *r) {
    for (unsigned i = 12; i < 19; ++i) if ((r[i] & 15u) > 9) return false;
    unsigned month = decimal(r[17]), year = decimal(r[18]), date = decimal(r[15]);
    return decimal(r[12]) < 60 && decimal(r[13]) < 60 && decimal(r[14]) < 24 &&
           r[16] >= 1 && r[16] <= 7 && year <= 99 && date >= 1 && date <= days(month, year);
}
void o_rtc_reset(o_soc *s) {
    o_zero(&s->rtc, sizeof(s->rtc));
    s->rtc.reg[8] = s->rtc.reg[9] = 1; /* Alarm date/month reset values. */
    s->rtc.reg[15] = s->rtc.reg[17] = 1;
    s->rtc.reg[16] = 7;
}
static bool next_second(orchard_machine *m) {
    uint8_t *r = m->soc.rtc.reg;
    if (!valid_time(r)) {
        /* Preserve malformed guest data; do not silently normalize it. */
        o_stop(m, ORCHARD_UNPREDICTABLE, 0x57000070u, r[18]);
        return false;
    }
    unsigned sec = decimal(r[12]) + 1u, min = decimal(r[13]), hour = decimal(r[14]);
    unsigned date = decimal(r[15]), month = decimal(r[17]), year = decimal(r[18]);
    if (sec == 60) {
        sec = 0;
        if (++min == 60) {
            min = 0;
            if (++hour == 24) {
                hour = 0;
                r[16] = r[16] == 7 ? 1 : (uint8_t)(r[16] + 1u);
                if (++date > days(month, year)) {
                    date = 1;
                    if (++month == 13) { month = 1; year = (year + 1u) % 100u; }
                }
            }
        }
    }
    r[12] = bcd(sec); r[13] = bcd(min); r[14] = bcd(hour);
    r[15] = bcd(date); r[17] = bcd(month); r[18] = bcd(year);
    return true;
}
void o_rtc_clock(orchard_machine *m) {
    o_rtc *rtc = &m->soc.rtc;
    if (rtc->reg[0] & 8u) return;
    rtc->divider = (rtc->divider + 1u) & 32767u;
    if ((rtc->divider & 255u) == 0 && (rtc->reg[1] & 128u)) {
        if (++rtc->tick_count == (rtc->reg[1] & 127u) + 1u) {
            rtc->tick_count = 0;
            m->soc.srcpnd |= 1u << 8;
        }
    }
    if (rtc->divider || !next_second(m)) return;
    uint8_t alarm = rtc->reg[4];
    if (!(alarm & 64u)) return;
    static const unsigned fields[6] = {12, 13, 14, 15, 17, 18};
    for (unsigned bit = 0; bit < 6; ++bit)
        if ((alarm & (1u << bit)) && rtc->reg[5 + bit] != rtc->reg[fields[bit]]) return;
    m->soc.srcpnd |= 1u << 30;
}
void o_rtc_tick(orchard_machine *m) {
    o_rtc *rtc = &m->soc.rtc;
    rtc->phase += 32768u;
    if (rtc->phase >= O_FUNCTIONAL_TIMEBASE_HZ) {
        rtc->phase -= O_FUNCTIONAL_TIMEBASE_HZ;
        o_rtc_clock(m);
    }
}
bool o_rtc_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write) {
    if (address < 0x57000040u || address > 0x57000088u || (address & 3u) || (width != 1 && width != 4))
        return false;
    /* HP48gII bootloader PC 0x88 uses LDR of BCDYEAR. The low-byte
       lane aliases the same register; upper read lanes are chosen zero.
       The vendor programming guide recommends byte access only. */
    unsigned index = (address - 0x57000040u) / 4u;
    if (!masks[index]) return false;
    o_rtc *rtc = &m->soc.rtc;
    if (!write) { *value = rtc->reg[index]; return true; }
    uint8_t next = (uint8_t)(*value & masks[index]);
    if (index == 0) {
        if (next & 6u) {
            o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, next); return false;
        }
        if (next & 8u) rtc->divider = rtc->phase = rtc->tick_count = 0;
    } else if (!(rtc->reg[0] & 1u)) return true; /* RTCEN gates writes, not reads/counting. */
    if (index == 11 && (next & 8u)) {
        o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, next); return false; /* Round reset. */
    }
    if (index == 1) rtc->tick_count = 0;
    rtc->reg[index] = next;
    return true;
}
