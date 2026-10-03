/* SPDX-License-Identifier: MIT
 * Versioned little-endian checkpoints. Explicit field order, no C padding,
 * host pointers, translation/EINT caches or immutable NOR bytes. Two-phase
 * import validates header, CRC and all index-bearing state before mutation.
 */
#include "internal.h"
#define HEADER 32u
#define VERSION 1u
static const uint8_t magic[8] = {'O','R','C','H','S','T','0','1'};
typedef struct {
    o_cpu cpu;
    o_soc soc;
    uint64_t ticks, reads, writes;
    uint32_t nor, decode, sequence, status, pc, instruction, address, detail;
    bool id_mode;
} saved;
typedef struct { uint8_t *out; const uint8_t *in; size_t pos; bool ok; } codec;
static uint64_t scalar(codec *c, uint64_t v, unsigned width) {
    if (c->in) { v=0; for(unsigned i=0;i<width;i++) v|=(uint64_t)c->in[c->pos+i]<<(i*8u); }
    else if(c->out) for(unsigned i=0;i<width;i++) c->out[c->pos+i]=(uint8_t)(v>>(i*8u));
    c->pos+=width; return v;
}
static void bytes(codec *c, uint8_t *p, size_t n) {
    if(c->in) o_copy(p,c->in+c->pos,n);
    else if(c->out) o_copy(c->out+c->pos,p,n);
    c->pos+=n;
}
#define U32(x) do { (x)=(uint32_t)scalar(c,(x),4); } while(0)
#define U64(x) do { (x)=scalar(c,(x),8); } while(0)
#define U16(x) do { (x)=(uint16_t)scalar(c,(x),2); } while(0)
#define U8(x) do { (x)=(uint8_t)scalar(c,(x),1); } while(0)
#define BOOL(x) do { uint64_t b=scalar(c,(x)?1u:0u,1); if(b>1)c->ok=false; (x)=b!=0; } while(0)
#define A32(x,n) do { for(unsigned ai=0;ai<(n);ai++) U32((x)[ai]); } while(0)
static void fields(codec *c, saved *s) {
    o_cpu *p=&s->cpu; o_soc *d=&s->soc;
    A32(p->r,16); U32(p->cpsr); A32(p->usr,7); A32(p->fiq,7);
    for(unsigned i=0;i<4;i++) A32(p->bank[i],2);
    A32(p->spsr,5); U32(p->control); U32(p->ttb); U32(p->domain);
    U32(p->dfsr); U32(p->ifsr); U32(p->far); U32(p->pid); U32(p->next_pc);
    U64(p->instructions); U64(p->exceptions); BOOL(p->sleeping); BOOL(p->data_abort); BOOL(p->prefetch_abort);
    U64(s->ticks); U64(s->reads); U64(s->writes); U32(s->nor); U32(s->decode);
    U32(s->sequence); BOOL(s->id_mode); U32(s->status); U32(s->pc);
    U32(s->instruction); U32(s->address); U32(s->detail);
    U32(d->srcpnd); U32(d->intmod); U32(d->intmsk); U32(d->intpnd);
    U32(d->subsrcpnd); U32(d->intsubmsk); U32(d->priority);
    A32(d->memc,13); A32(d->clock,6); A32(d->gpio,48); A32(d->lcd,25);
    U32(d->lcd_phase); U32(d->lcd_line); U64(d->lcd_frames);
    o_adc *a=&d->adc;
    U32(a->con); U32(a->tsc); U32(a->delay); U32(a->remaining);
    for(unsigned i=0;i<8;i++) U16(a->inputs[i]);
    U16(a->sample); U16(a->data); U8(a->known); BOOL(a->valid);
    o_usb *u=&d->usb;
    for(unsigned i=0;i<5;i++) {
        o_usb_ep *e=&u->ep[i]; bytes(c,e->tx,64); bytes(c,e->rx,64);
        U32(e->tx_count); U32(e->rx_count); U32(e->rx_pos);
        U8(e->maxp); U8(e->in1); U8(e->in2); U8(e->out1); U8(e->out2);
        U8(e->tx_toggle); U8(e->rx_toggle); bytes(c,e->dma,6);
    }
    U8(u->address); U8(u->active_address); U8(u->power); U8(u->index);
    U8(u->ep_pending); U8(u->bus_pending); U8(u->ep_enable); U8(u->bus_enable);
    U16(u->frame); U16(u->control_length); U32(u->phase); BOOL(u->connected); BOOL(u->control_in);
    U64(u->resets); U64(u->setups); U64(u->in_packets); U64(u->out_packets);
    A32(d->gpio_input_known,8); A32(d->gpio_input_levels,8);
    A32(d->gpio_bias_known,8); A32(d->gpio_bias_levels,8);
    BOOL(d->lcd_probe68_idle_zero); U64(d->lcd_probe68_reads);
    BOOL(d->keyboard_attached); U64(d->keyboard_switches); U32(d->keyboard_direct);
    U32(d->eint_known); U32(d->eint_levels);
    for(unsigned i=0;i<3;i++) A32(d->uart[i],11);
    U32(d->tcfg0); U32(d->tcfg1); U32(d->tcon);
    A32(d->tcntb,5); A32(d->tcmpb,4); A32(d->count,5); A32(d->phase,5);
    U32(d->wtcon); U32(d->wtdat); U32(d->wtcnt); U32(d->wtphase);
    bytes(c,d->rx.data,O_QUEUE); U32(d->rx.head); U32(d->rx.count);
    bytes(c,d->tx.data,O_QUEUE); U32(d->tx.head); U32(d->tx.count);
    bytes(c,d->rtc.reg,19); U32(d->rtc.phase); U32(d->rtc.divider); U32(d->rtc.tick_count);
}
static size_t scalar_size(void) { saved s; o_zero(&s,sizeof s); codec c={0}; fields(&c,&s); return c.pos; }
static uint32_t crc(const uint8_t *p, size_t n) {
    uint32_t v=UINT32_MAX;
    for(size_t i=0;i<n;i++) { v^=p[i]; for(unsigned b=0;b<8;b++) v=(v>>1)^((0u-(v&1u))&0xedb88320u); }
    return ~v;
}
static uint32_t word(const uint8_t *p) { return o_read_le(p,4); }
static void put(uint8_t *p, uint32_t v) { for(unsigned i=0;i<4;i++) p[i]=(uint8_t)(v>>(i*8u)); }
static bool overlap(const void *p, size_t n, const orchard_machine *m) {
    uintptr_t a=(uintptr_t)p,b=(uintptr_t)m;
    return a<=b ? b-a<n : a-b<sizeof(*m);
}
size_t orchard_checkpoint_size(const orchard_machine *m) {
    return m&&m->profile&&m->loaded ? HEADER+scalar_size()+m->profile->ram_bytes+O_BOOT_SRAM_SIZE : 0;
}
orchard_status orchard_checkpoint_save(const orchard_machine *m, void *buffer, size_t length) {
    size_t required=orchard_checkpoint_size(m);
    if(!required||!buffer||length!=required||overlap(buffer,length,m)||m->deferred_ticks)
        return ORCHARD_BAD_ARGUMENT;
    uint8_t *out=buffer;
    saved s; o_zero(&s,sizeof s); s.cpu=m->cpu; s.soc=m->soc;
    s.ticks=m->ticks; s.reads=m->sram_alias_reads; s.writes=m->sram_alias_writes;
    s.nor=m->nor_device; s.decode=m->sram_decode; s.sequence=m->nor_sequence; s.id_mode=m->nor_id_mode;
    s.status=m->stop.status; s.pc=m->stop.pc; s.instruction=m->stop.instruction;
    s.address=m->stop.address; s.detail=m->stop.detail;
    codec c={.out=out,.pos=HEADER,.ok=true}; fields(&c,&s);
    o_copy(out+c.pos,m->ram,m->profile->ram_bytes);c.pos+=m->profile->ram_bytes;
    o_copy(out+c.pos,m->boot_sram,O_BOOT_SRAM_SIZE);
    o_copy(out,magic,8);put(out+8,VERSION);put(out+12,(uint32_t)length);
    put(out+16,m->profile->id);put(out+20,crc(m->flash,m->profile->flash_bytes));
    put(out+24,m->profile->ram_bytes);put(out+28,crc(out+HEADER,length-HEADER));
    return ORCHARD_OK;
}
static bool valid(const saved *s, const orchard_machine *m) {
    const o_soc *d=&s->soc;
    if(!o_mode_valid(s->cpu.cpsr)||s->status>ORCHARD_UNSUPPORTED_USB||s->nor>ORCHARD_NOR_SST39VF800A||
        s->decode>ORCHARD_SRAM_BANK1_MIRROR||s->sequence>2||
        (s->nor==ORCHARD_NOR_SST39VF800A && m->profile->flash_bytes!=0x100000)||
        (s->nor==ORCHARD_NOR_SST39VF1601 && m->profile->flash_bytes!=0x200000))return false;
    if(d->rx.head>=O_QUEUE||d->rx.count>O_QUEUE||d->tx.head>=O_QUEUE||d->tx.count>O_QUEUE||
        d->lcd_line>1023||d->rtc.phase>=O_FUNCTIONAL_TIMEBASE_HZ||d->rtc.divider>32767||
        d->adc.remaining>1280||d->adc.data>1023||d->adc.sample>1023||
        d->usb.index>4||d->usb.active_address>127||d->usb.frame>2047||
        d->keyboard_switches>>56||d->keyboard_direct&~0x71u)return false;
    for(unsigned i=0;i<8;i++)if(d->adc.inputs[i]>1023)return false;
    for(unsigned i=0;i<5;i++) {
        const o_usb_ep *e=&d->usb.ep[i];
        if(e->tx_count>64||e->rx_count>64||e->rx_pos>e->rx_count||e->tx_toggle>1||e->rx_toggle>1)return false;
    }
    return true;
}
orchard_status orchard_checkpoint_load(orchard_machine *m, const void *buffer, size_t length) {
    size_t required=orchard_checkpoint_size(m);
    if(!required||!buffer||length!=required||overlap(buffer,length,m))return ORCHARD_BAD_ARGUMENT;
    const uint8_t *in=buffer;
    for(unsigned i=0;i<8;i++)if(in[i]!=magic[i])return ORCHARD_BAD_ARGUMENT;
    if(word(in+8)!=VERSION||word(in+12)!=length||word(in+16)!=m->profile->id||
        word(in+24)!=m->profile->ram_bytes||word(in+28)!=crc(in+HEADER,length-HEADER)||
        word(in+20)!=crc(m->flash,m->profile->flash_bytes))return ORCHARD_BAD_ARGUMENT;
    saved s; o_zero(&s,sizeof s); codec c={.in=in,.pos=HEADER,.ok=true};fields(&c,&s);
    if(!c.ok||!valid(&s,m))return ORCHARD_BAD_ARGUMENT;
    /* Validation complete. There are no fallible operations beyond this point. */
    m->cpu=s.cpu;m->soc=s.soc;m->ticks=s.ticks;
    m->sram_alias_reads=s.reads;m->sram_alias_writes=s.writes;
    m->nor_device=(orchard_nor_device)s.nor;m->sram_decode=(orchard_sram_decode)s.decode;
    m->nor_sequence=s.sequence;m->nor_id_mode=s.id_mode;
    m->stop=(orchard_stop){(orchard_status)s.status,s.pc,s.instruction,s.address,s.detail};
    o_copy(m->ram,in+c.pos,m->profile->ram_bytes);c.pos+=m->profile->ram_bytes;
    o_copy(m->boot_sram,in+c.pos,O_BOOT_SRAM_SIZE);
    m->quiet_left=m->deferred_ticks=0;
    o_zero(m->translations,sizeof m->translations);
    return ORCHARD_OK;
}
