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
/* Reflected CRC-32 (polynomial 0xedb88320), advanced eight bits at once.
 * Generated from the same bit recurrence as the independent test reference.
 * Recompute both ROM and payload checksums on every call: no stale hash cache.
 * Wire bytes/version remain unchanged; this is not an authentication primitive.
 */
static const uint32_t crc_byte[256] = {
    0x00000000u, 0x77073096u, 0xee0e612cu, 0x990951bau, 0x076dc419u, 0x706af48fu, 0xe963a535u, 0x9e6495a3u,
    0x0edb8832u, 0x79dcb8a4u, 0xe0d5e91eu, 0x97d2d988u, 0x09b64c2bu, 0x7eb17cbdu, 0xe7b82d07u, 0x90bf1d91u,
    0x1db71064u, 0x6ab020f2u, 0xf3b97148u, 0x84be41deu, 0x1adad47du, 0x6ddde4ebu, 0xf4d4b551u, 0x83d385c7u,
    0x136c9856u, 0x646ba8c0u, 0xfd62f97au, 0x8a65c9ecu, 0x14015c4fu, 0x63066cd9u, 0xfa0f3d63u, 0x8d080df5u,
    0x3b6e20c8u, 0x4c69105eu, 0xd56041e4u, 0xa2677172u, 0x3c03e4d1u, 0x4b04d447u, 0xd20d85fdu, 0xa50ab56bu,
    0x35b5a8fau, 0x42b2986cu, 0xdbbbc9d6u, 0xacbcf940u, 0x32d86ce3u, 0x45df5c75u, 0xdcd60dcfu, 0xabd13d59u,
    0x26d930acu, 0x51de003au, 0xc8d75180u, 0xbfd06116u, 0x21b4f4b5u, 0x56b3c423u, 0xcfba9599u, 0xb8bda50fu,
    0x2802b89eu, 0x5f058808u, 0xc60cd9b2u, 0xb10be924u, 0x2f6f7c87u, 0x58684c11u, 0xc1611dabu, 0xb6662d3du,
    0x76dc4190u, 0x01db7106u, 0x98d220bcu, 0xefd5102au, 0x71b18589u, 0x06b6b51fu, 0x9fbfe4a5u, 0xe8b8d433u,
    0x7807c9a2u, 0x0f00f934u, 0x9609a88eu, 0xe10e9818u, 0x7f6a0dbbu, 0x086d3d2du, 0x91646c97u, 0xe6635c01u,
    0x6b6b51f4u, 0x1c6c6162u, 0x856530d8u, 0xf262004eu, 0x6c0695edu, 0x1b01a57bu, 0x8208f4c1u, 0xf50fc457u,
    0x65b0d9c6u, 0x12b7e950u, 0x8bbeb8eau, 0xfcb9887cu, 0x62dd1ddfu, 0x15da2d49u, 0x8cd37cf3u, 0xfbd44c65u,
    0x4db26158u, 0x3ab551ceu, 0xa3bc0074u, 0xd4bb30e2u, 0x4adfa541u, 0x3dd895d7u, 0xa4d1c46du, 0xd3d6f4fbu,
    0x4369e96au, 0x346ed9fcu, 0xad678846u, 0xda60b8d0u, 0x44042d73u, 0x33031de5u, 0xaa0a4c5fu, 0xdd0d7cc9u,
    0x5005713cu, 0x270241aau, 0xbe0b1010u, 0xc90c2086u, 0x5768b525u, 0x206f85b3u, 0xb966d409u, 0xce61e49fu,
    0x5edef90eu, 0x29d9c998u, 0xb0d09822u, 0xc7d7a8b4u, 0x59b33d17u, 0x2eb40d81u, 0xb7bd5c3bu, 0xc0ba6cadu,
    0xedb88320u, 0x9abfb3b6u, 0x03b6e20cu, 0x74b1d29au, 0xead54739u, 0x9dd277afu, 0x04db2615u, 0x73dc1683u,
    0xe3630b12u, 0x94643b84u, 0x0d6d6a3eu, 0x7a6a5aa8u, 0xe40ecf0bu, 0x9309ff9du, 0x0a00ae27u, 0x7d079eb1u,
    0xf00f9344u, 0x8708a3d2u, 0x1e01f268u, 0x6906c2feu, 0xf762575du, 0x806567cbu, 0x196c3671u, 0x6e6b06e7u,
    0xfed41b76u, 0x89d32be0u, 0x10da7a5au, 0x67dd4accu, 0xf9b9df6fu, 0x8ebeeff9u, 0x17b7be43u, 0x60b08ed5u,
    0xd6d6a3e8u, 0xa1d1937eu, 0x38d8c2c4u, 0x4fdff252u, 0xd1bb67f1u, 0xa6bc5767u, 0x3fb506ddu, 0x48b2364bu,
    0xd80d2bdau, 0xaf0a1b4cu, 0x36034af6u, 0x41047a60u, 0xdf60efc3u, 0xa867df55u, 0x316e8eefu, 0x4669be79u,
    0xcb61b38cu, 0xbc66831au, 0x256fd2a0u, 0x5268e236u, 0xcc0c7795u, 0xbb0b4703u, 0x220216b9u, 0x5505262fu,
    0xc5ba3bbeu, 0xb2bd0b28u, 0x2bb45a92u, 0x5cb36a04u, 0xc2d7ffa7u, 0xb5d0cf31u, 0x2cd99e8bu, 0x5bdeae1du,
    0x9b64c2b0u, 0xec63f226u, 0x756aa39cu, 0x026d930au, 0x9c0906a9u, 0xeb0e363fu, 0x72076785u, 0x05005713u,
    0x95bf4a82u, 0xe2b87a14u, 0x7bb12baeu, 0x0cb61b38u, 0x92d28e9bu, 0xe5d5be0du, 0x7cdcefb7u, 0x0bdbdf21u,
    0x86d3d2d4u, 0xf1d4e242u, 0x68ddb3f8u, 0x1fda836eu, 0x81be16cdu, 0xf6b9265bu, 0x6fb077e1u, 0x18b74777u,
    0x88085ae6u, 0xff0f6a70u, 0x66063bcau, 0x11010b5cu, 0x8f659effu, 0xf862ae69u, 0x616bffd3u, 0x166ccf45u,
    0xa00ae278u, 0xd70dd2eeu, 0x4e048354u, 0x3903b3c2u, 0xa7672661u, 0xd06016f7u, 0x4969474du, 0x3e6e77dbu,
    0xaed16a4au, 0xd9d65adcu, 0x40df0b66u, 0x37d83bf0u, 0xa9bcae53u, 0xdebb9ec5u, 0x47b2cf7fu, 0x30b5ffe9u,
    0xbdbdf21cu, 0xcabac28au, 0x53b39330u, 0x24b4a3a6u, 0xbad03605u, 0xcdd70693u, 0x54de5729u, 0x23d967bfu,
    0xb3667a2eu, 0xc4614ab8u, 0x5d681b02u, 0x2a6f2b94u, 0xb40bbe37u, 0xc30c8ea1u, 0x5a05df1bu, 0x2d02ef8du,
};
static uint32_t crc(const uint8_t *p, size_t n) {
    uint32_t v=UINT32_MAX;
    for(size_t i=0;i<n;i++) v=(v>>8)^crc_byte[(v^p[i])&255u];
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
    m->idle_write_enabled=false;
    o_zero(m->translations,sizeof m->translations);
    m->boot_memo_epoch=m->boot_memo_active=m->boot_memo_pages=0;
    return ORCHARD_OK;
}
