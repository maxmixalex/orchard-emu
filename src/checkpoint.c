/* SPDX-License-Identifier: MIT
 * The v1 wire codec is retained verbatim. V2 adds the SDIPRE latch at the end
 * only for SD-slot boards; HP39/HP48 exports remain byte-for-byte v1. Imports
 * of existing v1 states remain supported, with SDIPRE at its reset value.
 */
#define orchard_checkpoint_size o_checkpoint_v1_size
#define orchard_checkpoint_save o_checkpoint_v1_save
#define orchard_checkpoint_load o_checkpoint_v1_load
#include "checkpoint-v1.inc"
#undef orchard_checkpoint_size
#undef orchard_checkpoint_save
#undef orchard_checkpoint_load

size_t orchard_checkpoint_size(const orchard_machine *m) {
    size_t n=o_checkpoint_v1_size(m);
    return n ? n+(m->profile->sd_slot?4u:0u) : 0;
}
orchard_status orchard_checkpoint_save(const orchard_machine *m, void *buffer, size_t length) {
    size_t n=orchard_checkpoint_size(m);
    if(!n||!buffer||length!=n||overlap(buffer,length,m))return ORCHARD_BAD_ARGUMENT;
    if(!m->profile->sd_slot)return o_checkpoint_v1_save(m,buffer,length);
    if(m->soc.sdi_prescaler>255u)return ORCHARD_BAD_ARGUMENT;
    orchard_status status=o_checkpoint_v1_save(m,buffer,length-4u);
    if(status!=ORCHARD_OK)return status;
    uint8_t *out=buffer;
    put(out+length-4u,m->soc.sdi_prescaler);
    put(out+8,2);put(out+12,(uint32_t)length);
    put(out+28,crc(out+HEADER,length-HEADER));
    return ORCHARD_OK;
}
orchard_status orchard_checkpoint_load(orchard_machine *m, const void *buffer, size_t length) {
    size_t base=o_checkpoint_v1_size(m);
    if(!base||!buffer||overlap(buffer,length,m))return ORCHARD_BAD_ARGUMENT;
    if(length==base)return o_checkpoint_v1_load(m,buffer,length);
    if(!m->profile->sd_slot||length!=base+4u)return ORCHARD_BAD_ARGUMENT;
    const uint8_t *in=buffer;
    for(unsigned i=0;i<8;i++)if(in[i]!=magic[i])return ORCHARD_BAD_ARGUMENT;
    if(word(in+8)!=2u||word(in+12)!=length||word(in+16)!=m->profile->id||
        word(in+24)!=m->profile->ram_bytes||word(in+28)!=crc(in+HEADER,length-HEADER)||
        word(in+20)!=crc(m->flash,m->profile->flash_bytes))return ORCHARD_BAD_ARGUMENT;
    saved s; o_zero(&s,sizeof s); codec c={.in=in,.pos=HEADER,.ok=true};fields(&c,&s);
    s.soc.sdi_prescaler=word(in+length-4u);
    if(!c.ok||!valid(&s,m)||s.soc.sdi_prescaler>255u)return ORCHARD_BAD_ARGUMENT;
    /* All validation precedes mutation, including the appended register. */
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
