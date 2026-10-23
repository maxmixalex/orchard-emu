/* SPDX-License-Identifier: MIT
 * S3C2410A functional SPI registers and master shift clock.
 * Samsung manual 22-3/4/7..10; PCLK gate 7-21; GPIO mux chapter 9.
 * No external SPI device, transfer response, loopback or test result is invented.
 */
#include "internal.h"

#define SPI_BASE 0x59000000u
#define SPI_READY 1u
#define SPI_COLLISION 4u
#define SPI_CLOCK 0x40000u

void o_spi_reset(o_spi *s) {
    o_zero(s,sizeof(*s)); s->status=SPI_READY; s->pin=2u;
}
static void start(o_spi *s,uint32_t value) {
    s->tx=value&255u; s->status&=~SPI_READY;
    s->remaining=s->prescaler+1u; s->half=0; s->shift=0;
}
static bool receive_bit(orchard_machine *m,unsigned channel,unsigned *value) {
    unsigned port=channel?ORCHARD_GPIO_G:ORCHARD_GPIO_E,pin=channel?5u:11u;
    uint32_t mask=1u<<pin,known,levels,conflicts;
    unsigned function=(m->soc.gpio[port*4]>>(pin*2u))&3u;
    if(function!=(channel?3u:2u)) {
        o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,SPI_BASE+channel*32u+0x14u,mask);return false;
    }
    o_gpio_sample(m,port,&known,&levels,&conflicts);
    if(conflicts&mask) {
        o_stop(m,ORCHARD_GPIO_CONTENTION,0x56000000u+port*16u+4u,mask);return false;
    }
    if(!(known&mask)) {
        o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,SPI_BASE+channel*32u+0x14u,mask);return false;
    }
    *value=(levels&mask)?1u:0u;return true;
}
void o_spi_tick(orchard_machine *m) {
    if(!(m->soc.clock[3]&SPI_CLOCK))return;
    for(unsigned channel=0;channel<2;channel++) {
        o_spi *s=&m->soc.spi[channel];
        /* A disconnected slave has no external SCK edges. ENSCK only gates
           the master's clock; it is not a reset or a fabricated completion. */
        if(!s->remaining||(s->control&0x18u)!=0x18u)continue;
        if(s->remaining>1u){--s->remaining;continue;}
        unsigned half=s->half+1u;
        bool sample=(half&1u)==((s->control&2u)?0u:1u);
        if(sample) {
            unsigned bit;
            if(!receive_bit(m,channel,&bit))return;
            s->shift=((s->shift<<1u)|bit)&255u;
        }
        if(half==16u) {
            s->rx=s->shift; s->remaining=s->half=s->shift=0;
            s->status|=SPI_READY;
            if((s->control&0x60u)==0x20u)m->soc.srcpnd|=1u<<(channel?29u:22u);
        } else {s->half=half;s->remaining=s->prescaler+1u;}
    }
}
bool o_spi_register(orchard_machine *m,uint32_t address,unsigned width,uint32_t *value,bool write) {
    if(address<SPI_BASE||address>SPI_BASE+0x34u||(address&3u)||
       (width!=1u&&width!=2u&&width!=4u))return false;
    unsigned channel=(address-SPI_BASE)/32u,offset=(address-SPI_BASE)%32u;
    if(offset>0x14u)return false;
    o_spi *s=&m->soc.spi[channel];
    if(!write) {
        switch(offset) {
        case 0: *value=s->control;return true;
        case 4: *value=s->status;s->status&=SPI_READY;return true;
        case 8: *value=s->pin;return true;
        case 12: *value=s->prescaler;return true;
        case 16: *value=s->tx;return true;
        case 20:
            *value=s->rx;
            if(s->remaining)s->status|=SPI_COLLISION;
            else if(s->control&1u)start(s,255u);
            return true;
        default:return false;
        }
    }
    uint32_t byte=*value&255u;
    switch(offset) {
    case 0:
        /* DMA/reserved SMOD and changing shift format mid-byte have no
           implemented semantics. Keep the entire old transfer on failure. */
        if(byte&0x80u||(byte&0x60u)>=0x40u||
           (s->remaining&&((byte^s->control)&~0x10u)))break;
        /* GPG5 shares the keyboard net resolver. Changing its SPI direction
           can change another connected EINT pad without a GPIO/key write. */
        if(channel==1u&&((s->control^byte)&8u))m->soc.eint_cache.valid=false;
        s->control=byte;return true;
    case 8:
        /* Multi-master arbitration needs an independently driven nSS input.
           It is explicitly outside the disconnected peripheral subset. */
        if(byte&~3u)break;
        s->pin=byte|2u;return true;
    case 12:
        if(s->remaining&&byte!=s->prescaler)break;
        s->prescaler=byte;return true;
    case 16:
        if(s->remaining)s->status|=SPI_COLLISION;
        else start(s,byte);
        return true;
    default:break;
    }
    o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value);return false;
}
