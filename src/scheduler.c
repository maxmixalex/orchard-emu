/* SPDX-License-Identifier: MIT
 * Host-only lazy phase accounting. A quiet interval ends strictly before the
 * next peripheral transition. MMIO and every run boundary materialize phases.
 * This is an optimization of the existing functional clock, not a new clock.
 */
#include "internal.h"

static unsigned timer_shift(unsigned ch) { return ch ? 4u * ch + 4u : 0; }
static uint32_t distance(uint32_t period, uint32_t phase) {
    return phase < period ? period - phase : 1u;
}
static void bound(uint32_t *n, uint32_t candidate) {
    if (candidate < *n) *n = candidate;
}
static uint32_t lcd_period(const o_soc *s) {
    const uint32_t *r = s->lcd;
    return 2u * ((r[0] >> 8) & 0x3ffu) * (((r[2] >> 8) & 0x7ffu) + 1u) +
        16u * ((r[3] & 3u) + 1u) + 16u * (((r[2] >> 19) & 3u) + 1u) + 8u * (r[2] & 255u);
}
void o_schedule_plan(orchard_machine *m) {
    const o_soc *s = &m->soc;
    /* The RTC oscillator remains running even with its calendar held reset. */
    uint32_t n = s->rtc.phase < O_FUNCTIONAL_TIMEBASE_HZ ?
        (O_FUNCTIONAL_TIMEBASE_HZ - s->rtc.phase + 32767u) / 32768u : 1u;
    if (s->adc.remaining && !(s->adc.con & 4u)) bound(&n, s->adc.remaining);
    if (s->lcd[0] & 1u) bound(&n, distance(lcd_period(s), s->lcd_phase));
    if (s->wtcon & 32u) {
        uint32_t d = (((s->wtcon >> 8) & 255u) + 1u) * (16u << ((s->wtcon >> 3) & 3u));
        bound(&n, distance(d, s->wtphase));
    }
    for (unsigned ch = 0; ch < 5; ++ch) if (s->tcon & (1u << timer_shift(ch))) {
        unsigned mux = (s->tcfg1 >> (ch * 4u)) & 15u;
        if (mux > 3u) { n = 1; break; }
        uint32_t d = (((s->tcfg0 >> (ch < 2 ? 0u : 8u)) & 255u) + 1u) * (2u << mux);
        bound(&n, distance(d, s->phase[ch]));
    }
    m->quiet_left = n > 0 ? n - 1u : 0;
}
void o_schedule_sync(orchard_machine *m) {
    uint32_t n = m->deferred_ticks;
    m->quiet_left = m->deferred_ticks = 0;
    if (!n) return;
    o_soc *s = &m->soc;
    /* plan() guarantees none of these additions reaches a transition. */
    s->rtc.phase += n * 32768u;
    if (s->adc.remaining && !(s->adc.con & 4u)) s->adc.remaining -= n;
    if (s->lcd[0] & 1u) s->lcd_phase += n;
    if (s->wtcon & 32u) s->wtphase += n;
    for (unsigned ch = 0; ch < 5; ++ch)
        if (s->tcon & (1u << timer_shift(ch))) s->phase[ch] += n;
}
