/* SPDX-License-Identifier: MIT
 * Functional bring-up peripherals, not a complete or cycle-accurate S3C2410.
 * Register definitions: Samsung S3C2410A manual, chapters 5/7/9/10/11/14/15. */
#include "internal.h"

bool o_q_push(o_queue *q, uint8_t byte) {
    if (q->count == O_QUEUE) return false;
    q->data[(q->head + q->count) % O_QUEUE] = byte;
    ++q->count;
    return true;
}
bool o_q_pop(o_queue *q, uint8_t *byte) {
    if (!q->count) return false;
    *byte = q->data[q->head];
    q->head = (q->head + 1u) % O_QUEUE;
    --q->count;
    return true;
}
void o_soc_reset(o_soc *s) {
    o_zero(s, sizeof(*s));
    s->intmsk = UINT32_MAX;
    o_gpio_reset(s);
    o_rtc_reset(s);
    o_adc_reset(&s->adc);
    o_usb_reset(&s->usb);
    o_sdi_reset(&s->sdi);
    o_lcd_reset(s);
    s->intsubmsk = 0x7ff;
    s->priority = 0x7f;
    o_watchdog_reset(s);
    s->clock[0] = 0xffffff; /* LOCKTIME */
    s->clock[1] = 0x5c080;  /* MPLLCON */
    s->clock[2] = 0x28080;  /* UPLLCON */
    s->clock[3] = 0x7fff0;  /* CLKCON */
    s->clock[4] = 4;        /* CLKSLOW; slow mode itself is initially off. */
    s->clock[5] = 0;        /* CLKDIVN; Fin feeds the core before MPLL setup. */
    for (unsigned i = 1; i <= 6; ++i) s->memc[i] = 0x700;
    s->memc[7] = s->memc[8] = 0x18008;
    s->memc[9] = 0xac0000;
}
static unsigned timer_shift(unsigned channel) { return channel ? 4u * channel + 4u : 0; }
bool o_pclk_ratio(const o_soc *s, uint32_t *num, uint32_t *den) {
    /* Samsung 7-4/7-8/7-11/7-22. This is a functional, settled-source
       model using Fin = the existing reference timebase, not a measurement
       of a board crystal or of PLL lock duration. The reset MPLL word is
       inert until the first software write, including a write of that word. */
    unsigned div=s->clock[5]&7u;
    *num=1; *den=1;
    if(div>4u)return false;
    unsigned bus=div==4u?4u:(1u+((div>>1)&1u))*(1u+(div&1u));
    uint32_t slow=s->clock[4];
    if(slow&0x10u) {
        unsigned v=slow&7u;
        *den=(v?2u*v:1u)*bus;
    } else if(s->mpll_configured) {
        if(slow&0x20u)return false;
        uint32_t pll=s->clock[1];
        *num=((pll>>12)&255u)+8u;
        *den=(((pll>>4)&63u)+2u)*(1u<<(pll&3u))*bus;
    } else *den=bus;
    uint32_t a=*num,b=*den;
    while(b){uint32_t r=a%b;a=b;b=r;}
    *num/=a;*den/=a;
    /* Successful ratios always have nonzero operands; make that contract
       explicit for callers and static range analysis after reduction. */
    return *num!=0u && *den!=0u;
}
uint32_t o_pclk_advance(o_soc *s, uint32_t reference_ticks) {
    uint32_t num,den;
    if(!o_pclk_ratio(s,&num,&den))return 0;
    uint64_t total=(uint64_t)s->pclk_phase+(uint64_t)reference_ticks*num;
    s->pclk_phase=(uint32_t)(total%den);
    return (uint32_t)(total/den);
}
static void pwm_tick(orchard_machine *m) {
    o_soc *s=&m->soc;
    if(!(s->clock[3]&0x100u))return;
    for(unsigned ch=0;ch<5;++ch) {
        unsigned shift=timer_shift(ch);
        if(!(s->tcon&(1u<<shift)))continue;
        unsigned mux=(s->tcfg1>>(ch*4u))&15u;
        if(mux>3u) {
            o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,0x51000004u,s->tcfg1);return;
        }
        unsigned prescaler=((s->tcfg0>>(ch<2?0u:8u))&255u)+1u;
        unsigned divisor=prescaler*(2u<<mux);
        if(++s->phase[ch]<divisor)continue;
        s->phase[ch]=0;
        if(s->reload_pending&(1u<<ch)) {
            /* Values were captured at zero, before the IRQ handler can write
               the next buffers. Clearing auto-reload after that IRQ cannot
               cancel this already scheduled reload. */
            s->count[ch]=s->pending_count[ch];
            if(ch<4)s->active_compare[ch]=s->pending_compare[ch];
            s->reload_pending&=~(1u<<ch);
        } else if(s->count[ch]) --s->count[ch];
        if(!s->count[ch]) {
            s->srcpnd|=1u<<(10u+ch);
            unsigned autoreload=shift+(ch==4?2u:3u);
            if(s->tcon&(1u<<autoreload)) {
                s->pending_count[ch]=s->tcntb[ch];
                if(ch<4)s->pending_compare[ch]=s->tcmpb[ch];
                s->reload_pending|=1u<<ch;
            } else s->tcon&=~(1u<<shift);
        }
        if(ch==2)o_buzzer_observe(m);
    }
}
void o_soc_tick(orchard_machine *m) {
    o_soc *s = &m->soc;
    bool power_off=(s->clock[3]&8u)!=0;
    m->power_wake=0;
    o_eint_tick(m);
    if (m->stop.status != ORCHARD_OK) return;
    o_rtc_tick(m);
    if (m->stop.status != ORCHARD_OK) return;
    if (power_off) {
        m->cpu.sleeping=true;
        if (m->power_wake) o_power_wake(m,m->power_wake);
        return;
    }
    o_usb_tick(m);
    o_lcd_tick(m);
    if (m->stop.status != ORCHARD_OK) return;
    uint32_t num,den;
    if(!o_pclk_ratio(s,&num,&den)) {
        uint32_t address=(s->clock[5]&7u)>4u?0x4c000014u:0x4c000010u;
        o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,s->clock[(address&255u)/4u]);return;
    }
    unsigned edges=o_pclk_advance(s,1);
    for(unsigned i=0;i<edges;i++) {
        if(s->sdi.remaining||s->sdi.data_remaining||s->sdi.interrupt_mask)o_sdi_tick(m);
        if(s->clock[3]&0x8000u)o_adc_tick(m);
        o_watchdog_tick(m);
        if(m->stop.status!=ORCHARD_OK)return;
        pwm_tick(m);
        if(m->stop.status!=ORCHARD_OK)return;
    }
    if (s->rx.count && (s->uart[0][1] & 3u) == 1u) s->subsrcpnd |= 1u;
    /* S3C2410A 11-11/12/15: non-FIFO TX-empty is a level source when
       UCON0[9]=1 and TX mode[3:2]=01. UTXH0 writes immediately leave the
       functional transmitter; tx is a host capture queue, not the holding
       register. SUBSRCPND latches even while INTSUBMSK masks propagation.
       Pulse, FIFO and baud timing are outside this functional subset. */
    if ((s->uart[0][1] & 0x20cu) == 0x204u && !(s->uart[0][2] & 1u))
        s->subsrcpnd |= 2u;
}
static uint32_t *plain_register(o_soc *s, uint32_t address) {
    if (address >= 0x48000000u && address <= 0x48000030u) return &s->memc[(address & 0xffu) / 4u];
    if (address >= 0x4c000000u && address <= 0x4c000014u) return &s->clock[(address & 0xffu) / 4u];
    return NULL;
}
static bool timer_register(orchard_machine *m, uint32_t address, uint32_t *value, bool write) {
    o_soc *s = &m->soc;
    uint32_t off = address - 0x51000000u;
    uint32_t *reg = NULL;
    if (off == 0) reg = &s->tcfg0;
    else if (off == 4) reg = &s->tcfg1;
    else if (off == 8) {
        if (write) {
            s->tcon = *value;
            for (unsigned ch = 0; ch < 5; ++ch)
                if (*value & (1u << (timer_shift(ch) + 1u))) {
                    s->count[ch] = s->tcntb[ch]; s->phase[ch] = 0;
                    if(ch<4)s->active_compare[ch]=s->tcmpb[ch];
                    s->reload_pending&=~(1u<<ch);
                }
            o_buzzer_observe(m);
        } else *value = s->tcon;
        return true;
    } else if (off >= 0x0cu && off <= 0x40u) {
        unsigned ch = (off - 0x0cu) / 12u, slot = (off - 0x0cu) % 12u;
        if (ch > 4) return false;
        if (slot == 0) reg = &s->tcntb[ch];
        else if (ch < 4 && slot == 4) reg = &s->tcmpb[ch];
        else if ((ch < 4 && slot == 8) || (ch == 4 && slot == 4)) {
            if (write) return false;
            *value = s->count[ch]; return true;
        }
    }
    if (!reg) return false;
    if (write) *reg = off > 8 ? *value & 0xffffu : *value;
    else *value = *reg;
    return true;
}
static bool uart_register(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value, bool write) {
    if (address < 0x50000000u || address >= 0x5000c000u) return false;
    unsigned ch = (address - 0x50000000u) / 0x4000u;
    unsigned off = address & 0x3fffu;
    if ((off & 3u) || off > 0x28u) return false;
    o_soc *s = &m->soc;
    if (off != 0x20 && off != 0x24 && width != 4) return false;
    if (write) {
        if (off == 0x20 && ch == 0) {
            if (!o_q_push(&s->tx, (uint8_t)*value)) {
                o_stop(m, ORCHARD_IO_FULL, address, *value); return false;
            }
            return true;
        }
        if (off <= 0x0c || off == 0x28) {
            s->uart[ch][off / 4] = *value;
            if (off == 8 && ch == 0 && (*value & 2u)) o_zero(&s->rx, sizeof(s->rx));
            return true;
        }
        return false;
    }
    if (off <= 0x0c || off == 0x28) *value = s->uart[ch][off / 4];
    else if (off == 0x10) *value = 6u | ((ch == 0 && s->rx.count) ? 1u : 0u);
    else if (off == 0x14) *value = 0; /* No line errors in the functional byte stream. */
    else if (off == 0x18) {
        unsigned n = ch == 0 ? s->rx.count : 0;
        *value = n >= 16 ? 1u << 8 : n;
    } else if (off == 0x24 && ch == 0) {
        uint8_t byte = 0;
        (void)o_q_pop(&s->rx, &byte);
        *value = byte;
    } else return false;
    return true;
}
bool o_mmio_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    o_schedule_sync(m);
    o_soc *s = &m->soc;
    if (o_lcd_register(m, address, width, value, false)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_usb_register(m, address, width, value, false)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_sdi_register(m, address, width, value, false)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_adc_register(m, address, width, value, false)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_rtc_register(m, address, width, value, false)) return true;
    if (uart_register(m, address, width, value, false)) return true;
    if (width == 4 && !(address & 3u)) {
        /* These NOR-booting boards expose no NAND medium. The bounded
           controller subset retains only the disabled NFCONF=0 state;
           startup/suspend may read it before disabling unused peripherals.
           NAND command/address/data and enabled modes remain unsupported. */
        if (address == 0x4e000000u) { *value = 0; return true; }
        if (o_watchdog_register(s, address, value, false)) return true;
        if (o_gpio_register(m, address, value, false)) return true;
        if (m->stop.status != ORCHARD_OK) return false;
        uint32_t *reg = plain_register(s, address);
        if (reg) { *value = *reg; return true; }
        if (address >= 0x51000000u && address <= 0x51000040u && timer_register(m, address, value, false)) return true;
        switch (address) {
        case 0x4a000000: *value = s->srcpnd; return true;
        case 0x4a000004: *value = s->intmod; return true;
        case 0x4a000008: *value = s->intmsk; return true;
        case 0x4a00000c: *value = s->priority; return true;
        case 0x4a000010: *value = s->intpnd; return true;
        case 0x4a000014:
            *value = 0;
            if (s->intpnd) while (!(s->intpnd & (1u << *value))) ++*value;
            return true;
        case 0x4a000018: *value = s->subsrcpnd; return true;
        case 0x4a00001c: *value = s->intsubmsk; return true;
        default: break;
        }
    }
    o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, width);
    return false;
}
bool o_mmio_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value) {
    o_schedule_sync(m);
    o_soc *s = &m->soc;
    if (o_lcd_register(m, address, width, &value, true)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_usb_register(m, address, width, &value, true)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_sdi_register(m, address, width, &value, true)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_adc_register(m, address, width, &value, true)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (o_rtc_register(m, address, width, &value, true)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (uart_register(m, address, width, &value, true)) return true;
    if (m->stop.status != ORCHARD_OK) return false;
    if (width == 4 && !(address & 3u)) {
        /* S3C2410A 6-6: NFCONF bit 15 enables the NAND controller. A zero
           write disables this unused block; it is not a NAND transaction. */
        if (address == 0x4e000000u && value == 0) return true;
        if (o_watchdog_register(s, address, &value, true)) return true;
        if (o_gpio_register(m, address, &value, true)) return true;
        if (m->stop.status != ORCHARD_OK) return false;
        uint32_t *reg = plain_register(s, address);
        if (reg) {
            uint32_t old_num,old_den,new_num,new_den;
            bool clock_change=address==0x4c000004u||address==0x4c000010u||address==0x4c000014u;
            bool old_valid=clock_change&&o_pclk_ratio(s,&old_num,&old_den);
            *reg = value;
            if(address==0x4c000004u)s->mpll_configured=1;
            if(clock_change) {
                /* Preserve fractional edge progress to the resolution of the
                   new rational denominator. Divider/mux switches can lose less
                   than one PCLK edge of phase; no past edges are fabricated.
                   Peripheral prescaler/counter phase is retained exactly. */
                if(old_valid&&o_pclk_ratio(s,&new_num,&new_den))
                    s->pclk_phase=(uint32_t)((uint64_t)s->pclk_phase*new_den/old_den);
                else s->pclk_phase=0;
            }
            /* S3C2410A manual 7-11, 7-17 and 7-21: a CLKCON.IDLE write
               requests core sleep; peripherals keep running until an interrupt
               wakes the CPU. The bit is not automatically cleared on wake.
               Trigger on each write, never on the sticky register level. The
               functional model enters after the writing instruction completes;
               CPU-wrapper ACK latency is not calibrated. Legacy runners retain
               their original register-only semantics. */
            if (m->idle_write_enabled && address == 0x4c00000cu && (value & 4u))
                m->cpu.sleeping = true;
            if (address == 0x4c00000cu && (value & 8u)) m->cpu.sleeping = true;
            return true;
        }
        if (address >= 0x51000000u && address <= 0x51000040u && timer_register(m, address, &value, true)) return true;
        switch (address) {
        case 0x4a000000: s->srcpnd &= ~value; return true;
        case 0x4a000004: s->intmod = value; return true;
        case 0x4a000008: s->intmsk = value; return true;
        case 0x4a00000c: s->priority = value & 0x1fffffu; return true;
        case 0x4a000010: s->intpnd &= ~value; return true;
        case 0x4a000018: s->subsrcpnd &= ~value; return true;
        case 0x4a00001c: s->intsubmsk = value & 0x7ffu; return true;
        default: break;
        }
    }
    o_stop(m, ORCHARD_UNIMPLEMENTED_MMIO, address, value);
    return false;
}
