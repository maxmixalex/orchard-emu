/* SPDX-License-Identifier: MIT
 * Host-only lazy phase accounting. A quiet interval ends strictly before the
 * next peripheral transition. MMIO and every run boundary materialize phases.
 * PCLK deadlines are converted to the reference-input domain; no event may
 * be skipped when the PCLK ratio supplies multiple edges in one quantum.
 */
#include "internal.h"

static unsigned timer_shift(unsigned ch) { return ch ? 4u * ch + 4u : 0; }
static uint32_t distance(uint32_t period, uint32_t phase) {
    return phase < period ? period - phase : 1u;
}
static void bound(uint32_t *n, uint32_t candidate) {
    if (candidate < *n) *n = candidate;
}
static void pclk_bound(uint32_t *n, uint32_t edges, const o_soc *s,
                       uint32_t num, uint32_t den) {
    uint64_t needed=(uint64_t)edges*den;
    uint32_t ticks=needed<=s->pclk_phase?1u:
        (uint32_t)((needed-s->pclk_phase+num-1u)/num);
    bound(n,ticks);
}
static uint32_t lcd_period(const o_soc *s) {
    const uint32_t *r = s->lcd;
    return 2u * ((r[0] >> 8) & 0x3ffu) * (((r[2] >> 8) & 0x7ffu) + 1u) +
        16u * ((r[3] & 3u) + 1u) + 16u * (((r[2] >> 19) & 3u) + 1u) + 8u * (r[2] & 255u);
}
void o_schedule_plan(orchard_machine *m) {
    const o_soc *s = &m->soc;
    /* The reset pulse is brief and has a separate held-reset domain. Keep
       its 128 edges explicit; never defer active peripheral transitions. */
    if(s->wtreset){m->quiet_left=0;return;}
    if(m->nor.remaining||o_uart_pending(s)){m->quiet_left=0;return;}
    /* The RTC oscillator remains running even with its calendar held reset. */
    uint32_t n = s->rtc.phase < O_FUNCTIONAL_TIMEBASE_HZ ?
        (O_FUNCTIONAL_TIMEBASE_HZ - s->rtc.phase + 32767u) / 32768u : 1u;
    if (s->clock[3]&8u) { m->quiet_left=n>0?n-1u:0; return; }
    uint32_t num,den;
    if(!o_pclk_ratio(s,&num,&den)){m->quiet_left=0;return;}
    if(s->clock[3]&0x40000u)for(unsigned channel=0;channel<2;channel++)
        if(s->spi[channel].remaining&&(s->spi[channel].control&0x18u)==0x18u)
            pclk_bound(&n,s->spi[channel].remaining,s,num,den);
    if ((s->clock[3] & 0x200u) && s->sdi.remaining) pclk_bound(&n,s->sdi.remaining,s,num,den);
    if ((s->clock[3] & 0x200u) && s->sdi.data_remaining) pclk_bound(&n,s->sdi.data_remaining,s,num,den);
    if ((s->clock[3] & 0x8000u) && s->adc.remaining && !(s->adc.con & 4u)) pclk_bound(&n,s->adc.remaining,s,num,den);
    if (s->lcd[0] & 1u) bound(&n, distance(lcd_period(s), s->lcd_phase));
    if (s->wtcon & 32u) {
        uint32_t d = (((s->wtcon >> 8) & 255u) + 1u) * (16u << ((s->wtcon >> 3) & 3u));
        pclk_bound(&n,distance(d,s->wtphase),s,num,den);
    }
    for (unsigned ch = 0; ch < 5; ++ch) if ((s->clock[3]&0x100u) && (s->tcon & (1u << timer_shift(ch)))) {
        unsigned mux = (s->tcfg1 >> (ch * 4u)) & 15u;
        if (mux > 3u) { n = 1; break; }
        uint32_t d = (((s->tcfg0 >> (ch < 2 ? 0u : 8u)) & 255u) + 1u) * (2u << mux);
        pclk_bound(&n,distance(d,s->phase[ch]),s,num,den);
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
    if (s->clock[3]&8u) return;
    uint32_t pclk=o_pclk_advance(s,n);
    if(s->clock[3]&0x40000u)for(unsigned channel=0;channel<2;channel++)
        if(s->spi[channel].remaining&&(s->spi[channel].control&0x18u)==0x18u)
            s->spi[channel].remaining-=pclk;
    if ((s->clock[3] & 0x200u) && s->sdi.remaining) s->sdi.remaining -= pclk;
    if ((s->clock[3] & 0x200u) && s->sdi.data_remaining) s->sdi.data_remaining -= pclk;
    if ((s->clock[3] & 0x8000u) && s->adc.remaining && !(s->adc.con & 4u)) s->adc.remaining -= pclk;
    if (s->lcd[0] & 1u) s->lcd_phase += n;
    if (s->wtcon & 32u) s->wtphase += pclk;
    for (unsigned ch = 0; ch < 5; ++ch)
        if ((s->clock[3]&0x100u) && (s->tcon & (1u << timer_shift(ch)))) s->phase[ch] += pclk;
}
