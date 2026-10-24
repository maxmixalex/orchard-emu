/* SPDX-License-Identifier: MIT
 * S3C2410A manual (2004), chapter 11: three independent UARTs, holding/FIFO
 * registers, polling/IRQ sources, internal loopback and modem input status.
 * The host boundary carries decoded octets. It does not synthesize optical
 * reflection, serial line errors, baud timing or an unmeasured UEXTCLK rate.
 */
#include "internal.h"

#define UART_BASE 0x50000000u
static o_queue *input(o_soc *s,unsigned ch) { return ch ? &s->uart_rx[ch-1u] : &s->rx; }
static o_queue *output(o_soc *s,unsigned ch) { return ch ? &s->uart_tx[ch-1u] : &s->tx; }
static bool clocked(const o_soc *s,unsigned ch) { return (s->clock[3]&(0x400u<<ch))!=0; }
static unsigned capacity(const o_soc *s,unsigned ch) { return s->uart[ch][2]&1u?16u:1u; }
static unsigned rx_level(const o_soc *s,unsigned ch) { return s->uart[ch][2]&1u?4u*(((s->uart[ch][2]>>4u)&3u)+1u):1u; }
static unsigned tx_level(const o_soc *s,unsigned ch) { return s->uart[ch][2]&1u?4u*((s->uart[ch][2]>>6u)&3u):0u; }
static uint8_t data_mask(const o_soc *s,unsigned ch) { return (uint8_t)((1u<<(5u+(s->uart[ch][0]&3u)))-1u); }
orchard_status orchard_irda_attach(orchard_machine *m,bool attached) {
    if(!m||!m->profile||(attached&&m->profile->id!=5u&&m->profile->id!=6u))return ORCHARD_BAD_ARGUMENT;
    o_schedule_sync(m);m->soc.irda_attached=attached;return ORCHARD_OK;
}
void o_irda_gpio_sample(const orchard_machine *m,unsigned port,
                       uint32_t *known,uint32_t *levels,uint32_t *conflicts) {
    const o_soc *s=&m->soc;
    if(!s->irda_attached||(port!=ORCHARD_GPIO_E&&port!=ORCHARD_GPIO_H))return;
    /* HP49GP_IO_PORT board notes identify SPIMOSI0/GPE12 and TXD2/GPH6
       as the same IrDA TX connection. This is an explicitly attached board
       net, never a generic S3C2410 pin alias. No optical peer is implied. */
    unsigned strong=0,weak=0;bool unresolved=false;
    for(unsigned end=0;end<2;end++) {
        unsigned p=end?ORCHARD_GPIO_H:ORCHARD_GPIO_E,pin=end?6u:12u;
        uint32_t bit=1u<<pin,fn=(s->gpio[p*4]>>(pin*2u))&3u;
        if(s->gpio_input_known[p]&bit)strong|=(s->gpio_input_levels[p]&bit)?2u:1u;
        if(!(s->gpio[p*4+2]&bit))weak|=2u;
        if(s->gpio_bias_known[p]&bit)weak|=(s->gpio_bias_levels[p]&bit)?2u:1u;
        if(fn==1u)strong|=(s->gpio[p*4+1]&bit)?2u:1u;
        else if(end&&fn==2u&&clocked(s,2)&&(s->uart[2][1]&12u)) {
            /* Decoded-byte operations finish atomically: at their observable
               boundary UART TX is idle. IR idle is low; serial mark is high.
               This does not model 3/16-bit optical pulses or SPI printing. */
            strong|=(s->uart[2][0]&64u)?1u:2u;
        } else if(fn!=0u)unresolved=true;
    }
    uint32_t bit=1u<<(port==ORCHARD_GPIO_E?12u:6u);
    *known&=~bit;*levels&=~bit;*conflicts&=~bit;
    if(strong==3u)*conflicts|=bit;
    else if(!unresolved&&(strong||weak==1u||weak==2u)) {
        *known|=bit;if(strong==2u||(!strong&&weak==2u))*levels|=bit;
    }
}
static void push(uint8_t *data,uint32_t head,uint32_t *count,uint8_t byte) {
    data[(head+*count)&15u]=byte; ++*count;
}
static uint8_t pop(uint8_t *data,uint32_t *head,uint32_t *count) {
    uint8_t value=data[*head]; *head=(*head+1u)&15u; --*count; return value;
}
static void receive(o_soc *s,unsigned ch,uint8_t byte) {
    o_uart *u=&s->uart_state[ch];
    unsigned limit=capacity(s,ch),before=u->rx_count;
    if(before==limit) {
        u->errors|=1u;
        /* A non-FIFO overrun replaces the unread holding byte. In FIFO mode
           the full queue retains its unread entries and rejects the new byte. */
        if(limit==1u)u->rx[u->rx_head]=byte&data_mask(s,ch);
        return;
    }
    push(u->rx,u->rx_head,&u->rx_count,byte&data_mask(s,ch));
    if(before<rx_level(s,ch)&&u->rx_count>=rx_level(s,ch))u->rx_event=1u;
}
static bool modem(orchard_machine *m,unsigned ch,bool required) {
    if(ch>=2u)return true;
    o_soc *s=&m->soc; o_uart *u=&s->uart_state[ch];
    if(!required&&!u->modem_known)return true;
    unsigned pin=ch?7u:0u,fn=ch?3u:2u;
    uint32_t mask=1u<<pin,known,levels,conflicts;
    if(((s->gpio[ORCHARD_GPIO_H*4]>>(pin*2u))&3u)!=fn) {
        if(!required){u->modem_known=0;return true;}
        o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,UART_BASE+ch*0x4000u+0x1cu,mask);return false;
    }
    o_gpio_sample(m,ORCHARD_GPIO_H,&known,&levels,&conflicts);
    if(conflicts&mask) {
        o_stop(m,ORCHARD_GPIO_CONTENTION,0x56000074u,mask);return false;
    }
    if(!(known&mask)) {
        if(!required){u->modem_known=0;return true;}
        o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,UART_BASE+ch*0x4000u+0x1cu,mask);return false;
    }
    uint32_t active=(levels&mask)?0u:1u;
    if(u->modem_known&&active!=(u->modem&1u))u->modem|=16u;
    u->modem=(u->modem&16u)|active;u->modem_known=1u;return true;
}
static bool service(orchard_machine *m,unsigned ch) {
    o_soc *s=&m->soc; o_uart *u=&s->uart_state[ch];uint32_t control=s->uart[ch][1];
    if(!clocked(s,ch))return true;
    if(!modem(m,ch,ch<2u&&(s->uart[ch][3]&16u)!=0))return false;
    /* Host staging is flow-controlled; these queued octets have not arrived
       at the chip yet. Only the 1/16-byte hardware receive buffer is visible. */
    if((control&3u)&&!(control&32u)) {
        uint8_t byte;
        while(u->rx_count<capacity(s,ch)&&o_q_pop(input(s,ch),&byte))receive(s,ch,byte);
    }
    if(!(control&12u)||(ch<2u&&(s->uart[ch][3]&16u)&&!(u->modem&1u)))return true;
    while(u->tx_count) {
        unsigned before=u->tx_count;
        uint8_t byte=u->tx[u->tx_head]&data_mask(s,ch);
        if(!(control&32u)&&!o_q_push(output(s,ch),byte)) {
            o_stop(m,ORCHARD_IO_FULL,UART_BASE+ch*0x4000u+0x20u,byte);return false;
        }
        (void)pop(u->tx,&u->tx_head,&u->tx_count);
        if(control&32u) {
            /* Only UCON's documented internal loopback can reflect a byte.
               An unattached IrDA port never receives its own transmission. */
            if(control&3u)receive(s,ch,byte);
        }
        if(before>tx_level(s,ch)&&u->tx_count<=tx_level(s,ch))u->tx_event=1u;
    }
    return true;
}
void o_uart_tick(orchard_machine *m) {
    o_soc *s=&m->soc;
    for(unsigned ch=0;ch<3;ch++) {
        if(!service(m,ch))return;
        if(!clocked(s,ch))continue;
        o_uart *u=&s->uart_state[ch];uint32_t control=s->uart[ch][1],shift=ch*3u;
        if((control&3u)==1u&&((control&0x100u)?u->rx_count>=rx_level(s,ch):u->rx_event))s->subsrcpnd|=1u<<shift;
        if((control&12u)==4u&&((control&0x200u)?u->tx_count<=tx_level(s,ch):u->tx_event))s->subsrcpnd|=2u<<shift;
        if((control&0x40u)&&u->errors)s->subsrcpnd|=4u<<shift;
        u->rx_event=u->tx_event=0;
    }
}
bool o_uart_pending(const o_soc *s) {
    for(unsigned ch=0;ch<3;ch++) {
        const o_uart *u=&s->uart_state[ch];uint32_t control=s->uart[ch][1];
        const o_queue *rx=ch?&s->uart_rx[ch-1u]:&s->rx;
        if(!clocked(s,ch))continue;
        if(u->rx_event||u->tx_event)return true;
        if((control&3u)&&!(control&32u)&&rx->count&&u->rx_count<capacity(s,ch))return true;
        if((control&12u)&&u->tx_count&&!(ch<2u&&(s->uart[ch][3]&16u)&&!(u->modem&1u)))return true;
    }
    return false;
}
bool o_uart_register(orchard_machine *m,uint32_t address,unsigned width,uint32_t *value,bool write) {
    if(address<UART_BASE||address>=UART_BASE+0xc000u)return false;
    unsigned ch=(address-UART_BASE)/0x4000u,off=address&0x3fffu;
    if((off&3u)||off>0x28u||(off!=0x20u&&off!=0x24u&&width!=4u))return false;
    if(off==0x20u||off==0x24u)if(width!=1u&&width!=2u&&width!=4u)return false;
    o_soc *s=&m->soc; o_uart *u=&s->uart_state[ch];
    if(!service(m,ch))return false;
    if(write) {
        if(off==0x20u) {
            if(u->tx_count>=capacity(s,ch)) {
                o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value);return false;
            }
            push(u->tx,u->tx_head,&u->tx_count,(uint8_t)*value);return service(m,ch);
        }
        if(off==0u)s->uart[ch][0]=*value&0x7fu;
        else if(off==4u) {
            /* Byte streams cannot supply a break waveform or DMA requests.
               FIFO idle timeout additionally needs measured baud timing. */
            if((*value&16u)||(*value&3u)>1u||((*value>>2u)&3u)>1u||
               ((*value&128u)&&(s->uart[ch][2]&1u))) {
                o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value);return false;
            }
            s->uart[ch][1]=*value&0x7efu;
        }
        else if(off==8u) {
            if((*value&1u)&&(s->uart[ch][1]&128u)) {
                o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value);return false;
            }
            if(!(*value&1u)&&(((*value&2u)?0u:u->rx_count)>1u||
                              ((*value&4u)?0u:u->tx_count)>1u)) {
                o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value);return false;
            }
            /* UFCON resets the chip FIFO, not future host-staged octets.
               Clearing input here made delivery depend on host chunking:
               a following IrLAP frame could disappear with the old FIFO. */
            if(*value&2u)u->rx_head=u->rx_count=u->errors=u->rx_event=0;
            if(*value&4u)u->tx_head=u->tx_count=u->tx_event=0;
            s->uart[ch][2]=*value&0xf1u;
        } else if(off==0xcu) {
            /* UART2's reserved modem location retains the old zero-only
               compatibility behavior; no CTS/RTS capability is invented. */
            if(ch==2u&&*value){o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value);return false;}
            s->uart[ch][3]=ch==2u?0u:*value&17u;
        } else if(off==0x28u)s->uart[ch][10]=*value&0xffffu;
        else return false;
        return service(m,ch);
    }
    if(off<=0xcu||off==0x28u)*value=s->uart[ch][off/4u];
    else if(off==0x10u)*value=(u->tx_count?0u:6u)|(u->rx_count?1u:0u);
    else if(off==0x14u){*value=u->errors;u->errors=0;}
    else if(off==0x18u)*value=(u->rx_count==16u?0x100u:u->rx_count)|
        (u->tx_count==16u?0x200u:u->tx_count<<4u);
    else if(off==0x1cu&&ch<2u) {
        if(!modem(m,ch,true))return false;
        *value=u->modem;u->modem&=1u;
    } else if(off==0x24u) {
        *value=u->rx_count?pop(u->rx,&u->rx_head,&u->rx_count):0u;
        return service(m,ch);
    } else return false;
    return true;
}
size_t orchard_uart_send_channel(orchard_machine *m,unsigned channel,const uint8_t *data,size_t length) {
    if(!m||!m->profile||channel>=3u||(!data&&length))return 0;
    o_schedule_sync(m);size_t n=0;
    while(n<length&&o_q_push(input(&m->soc,channel),data[n]))++n;
    return n;
}
size_t orchard_uart_receive_channel(orchard_machine *m,unsigned channel,uint8_t *data,size_t capacity_) {
    if(!m||!m->profile||channel>=3u||(!data&&capacity_))return 0;
    o_schedule_sync(m);size_t n=0;
    while(n<capacity_&&o_q_pop(output(&m->soc,channel),&data[n]))++n;
    return n;
}
