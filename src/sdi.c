/* SPDX-License-Identifier: MIT
 * S3C2410A User's Manual (March 2004), chapter 19; SD Physical Layer
 * Simplified Specification v2.00, chapters 4 and 5. Functional, clocked PIO
 * SD interface with an explicitly inserted, host-owned SDSC image. The FIFO
 * is a controller resource even without a card: firmware may initialize it
 * before checking the board's card-detect pin. No guest code is replaced.
 */
#include "internal.h"

enum { DATA_NONE, DATA_TIMEOUT, DATA_READ, DATA_WRITE, DATA_BUSY };
enum { CARD_NONE, CARD_READ, CARD_WRITE, CARD_SCR, CARD_STATUS };

bool o_sd_size_valid(size_t n) {
    return n >= 1024u*1024u && n <= ORCHARD_SD_MAX_BYTES && !(n & (n-1u));
}
static bool overlaps(const void *p, size_t n, const void *q, size_t z) {
    uintptr_t a=(uintptr_t)p, b=(uintptr_t)q;
    return n && z && (a<=b ? b-a<n : a-b<z);
}
static void card_reset(o_sdi *s) {
    s->card_state=0; s->card_rca=1; s->card_block_size=512; s->card_bus_width=1;
    s->app_command=false; s->multi_block=false; s->transfer_kind=CARD_NONE;
    s->transfer_left=s->transfer_total=s->transfer_offset=s->write_count=0;
    s->erase_start=s->erase_end=0;
}
orchard_status orchard_sd_bind(orchard_machine *m, void *storage, size_t capacity) {
    if (!m || !m->profile || !m->profile->sd_slot || m->sd_bytes ||
        ((!storage)!=(capacity==0)) || capacity>ORCHARD_SD_MAX_BYTES ||
        overlaps(storage,capacity,m,sizeof(*m))) return ORCHARD_BAD_ARGUMENT;
    m->sd_storage=storage; m->sd_capacity=capacity;
    return ORCHARD_OK;
}
orchard_status orchard_sd_insert(orchard_machine *m, size_t length, bool protected) {
    if (!m || !m->profile || !m->profile->sd_slot || m->sd_bytes ||
        !m->sd_storage || !o_sd_size_valid(length) || length>m->sd_capacity)
        return ORCHARD_BAD_ARGUMENT;
    o_schedule_sync(m);
    m->sd_bytes=(uint32_t)length; m->sd_write_protected=protected; m->sd_dirty=false;
    card_reset(&m->soc.sdi);
    return ORCHARD_OK;
}
orchard_status orchard_sd_eject(orchard_machine *m) {
    if (!m || !m->profile || !m->profile->sd_slot) return ORCHARD_BAD_ARGUMENT;
    o_schedule_sync(m);
    o_sdi *s=&m->soc.sdi;
    if (s->remaining) { s->status=(s->status&~0x100u)|0x400u; s->command&=~0x100u; }
    if (s->data_remaining) s->data_status=(s->data_status&~3u)|0x20u;
    s->remaining=s->response_remaining=s->phase=s->data_remaining=s->data_event=0;
    s->fifo_head=s->fifo_count=0; card_reset(s);
    m->sd_bytes=0; m->sd_write_protected=m->sd_dirty=false;
    return ORCHARD_OK;
}
void orchard_get_sd_state(const orchard_machine *m, orchard_sd_state *out) {
    if (!out) return;
    o_zero(out,sizeof(*out));
    if (!m) return;
    const o_sdi *s=&m->soc.sdi;
    out->bytes=m->sd_bytes; out->present=m->sd_bytes!=0;
    out->write_protected=m->sd_write_protected; out->dirty=m->sd_dirty;
    out->card_state=s->card_state; out->last_command=s->last_command;
    out->commands=s->commands; out->read_blocks=s->read_blocks; out->written_blocks=s->written_blocks;
}
void o_sdi_reset(o_sdi *s) {
    o_zero(s,sizeof(*s)); s->data_timer=0x2000; card_reset(s);
}
static uint32_t divisor(const o_sdi *s) { return 2u*(s->prescaler+1u); }
static uint32_t byte_period(const o_sdi *s) { return divisor(s)*((s->data_control&0x10000u)?2u:8u); }
static uint32_t fifo_status(const o_sdi *s) {
    uint32_t v=s->fifo_count, mode=(s->data_control>>12)&3u;
    if (mode==3u) {
        if (s->fifo_count<64) v|=0x2000;
        if (s->fifo_count<=32) v|=0x800;
        if (!s->fifo_count) v|=0x400;
    } else if (mode==2u) {
        if (s->fifo_count) v|=0x1000;
        if (s->fifo_count && !s->transfer_left && (s->data_status&0x10u)) v|=0x200;
        if (s->fifo_count==64) v|=0x100;
        if (s->fifo_count>=32) v|=0x80;
    }
    return v;
}
static void sdi_irq(o_soc *soc) {
    o_sdi *s=&soc->sdi;
    uint32_t sources=((s->status&0x1e00u)<<5)|((s->data_status&0x7f8u)<<3)|
                     ((fifo_status(s)&0xf80u)>>7);
    if (sources&s->interrupt_mask) soc->srcpnd|=1u<<21;
}
static void data_stop(o_sdi *s, uint32_t reason) {
    s->data_remaining=s->data_event=0; s->data_status=(s->data_status&~3u)|reason;
    s->transfer_kind=CARD_NONE; s->transfer_left=0; s->write_count=0;
    if (s->card_state>=5u) s->card_state=4;
}
static void data_start(orchard_machine *m) {
    o_sdi *s=&m->soc.sdi;
    uint32_t mode=(s->data_control>>12)&3u;
    if (!mode || (s->data_control&0x4000u)) return;
    if (s->data_event==DATA_READ || s->data_event==DATA_WRITE) return;
    s->data_status&=~3u;
    s->data_event=DATA_TIMEOUT;
    s->data_remaining=(s->data_timer+1u)*divisor(s);
    if (mode==1u) {
        if (m->sd_bytes) { s->data_event=DATA_BUSY; s->data_remaining=8u*divisor(s); }
        return;
    }
    s->data_status|=mode==2u?1u:2u;
    if (!m->sd_bytes || !s->transfer_kind ||
        (s->transfer_kind==CARD_WRITE && m->sd_write_protected)) return;
    uint32_t blocks=s->data_control&0xfffu, block=s->block_size;
    if (!blocks || !block || !(s->data_control&0x20000u) ||
        (mode==3u)!=(s->transfer_kind==CARD_WRITE)) return;
    uint32_t total=blocks*block;
    if (s->transfer_kind==CARD_SCR || s->transfer_kind==CARD_STATUS) {
        if (s->transfer_offset || blocks!=1u || block!=(s->transfer_kind==CARD_SCR?8u:64u)) return;
    } else if (block!=512u || (!s->multi_block && blocks!=1u) ||
               s->transfer_offset>m->sd_bytes || total>m->sd_bytes-s->transfer_offset) return;
    s->transfer_left=s->transfer_total=total; s->write_count=0;
    s->data_event=mode==2u?DATA_READ:DATA_WRITE; s->data_remaining=byte_period(s);
}
static uint32_t card_status(const o_sdi *s) {
    return (s->card_state<<9)|(s->card_state==7u?0u:0x100u);
}
static void bits(uint32_t out[4], unsigned high, unsigned low, uint32_t value) {
    for (unsigned bit=low;bit<=high;bit++) if (value&(1u<<(bit-low))) out[3u-bit/32u]|=1u<<(bit&31u);
}
static uint8_t crc7_byte(uint8_t crc, uint8_t byte) {
    for (unsigned i=0;i<8;i++) {
        bool top=((crc>>6)^(byte>>7))&1u;
        crc=(uint8_t)((crc<<1)&0x7fu); if (top) crc^=9u; byte<<=1;
    }
    return crc;
}
static void register_crc(uint32_t out[4]) {
    uint8_t c=0;
    for (unsigned i=0;i<15;i++) c=crc7_byte(c,(uint8_t)(out[i/4u]>>(24u-8u*(i&3u))));
    out[3]=(out[3]&~255u)|((uint32_t)c<<1)|1u;
}
static void card_csd(const orchard_machine *m, uint32_t out[4]) {
    uint32_t units=m->sd_bytes/2048u, mult=0;
    while (units>4096u) { units>>=1; ++mult; }
    bits(out,119,112,0x26); bits(out,103,96,0x32); bits(out,95,84,0x5b5);
    bits(out,83,80,9); bits(out,73,62,units-1u); bits(out,61,59,7); bits(out,58,56,7);
    bits(out,55,53,7); bits(out,52,50,7); bits(out,49,47,mult); bits(out,46,46,1);
    bits(out,45,39,127); bits(out,28,26,2); bits(out,25,22,9);
    if (m->sd_write_protected) bits(out,12,12,1);
    register_crc(out);
}
static void card_cid(uint32_t out[4]) {
    /* Explicitly virtual manufacturer/product, not an identity of a real card. */
    out[0]=0x7f4f524fu; out[1]=0x52434844u; out[2]=0x10000000u; out[3]=0x0101a100u;
    register_crc(out);
}
static void card_command(orchard_machine *m) {
    o_sdi *s=&m->soc.sdi;
    unsigned cmd=s->command&63u; uint32_t arg=s->argument;
    bool app=s->app_command; s->app_command=false;
    s->last_command=cmd; ++s->commands;
    o_zero(s->pending_response,sizeof(s->pending_response)); s->response_valid=false;
    if (!m->sd_bytes) return;
    s->response_valid=true; s->response_index=cmd;
    uint32_t *r=s->pending_response; r[0]=card_status(s);
    if (app) {
        switch (cmd) {
        case 41:
            if (s->card_state<=1u) {
                if (arg&0x00ff8000u) s->card_state=1;
                r[0]=0x80ff8000u; s->response_index=63;
            } else r[0]|=1u<<22;
            break;
        case 6:
            if (s->card_state==4u && (arg==0u || arg==2u)) s->card_bus_width=arg?4u:1u;
            else r[0]|=1u<<22;
            break;
        case 23: if (s->card_state!=4u) r[0]|=1u<<22; break;
        case 13: case 51:
            if (s->card_state==4u) {
                s->transfer_kind=cmd==51u?CARD_SCR:CARD_STATUS;
                s->transfer_offset=s->transfer_total=s->transfer_left=0;
                s->multi_block=false; s->card_state=5;
            } else r[0]|=1u<<22;
            break;
        default: r[0]|=1u<<22; break;
        }
    } else switch (cmd) {
    case 0: data_stop(s,0); card_reset(s); s->response_valid=false; break;
    case 8:
        if (s->card_state==0u && (arg&0xf00u)==0x100u) r[0]=arg&0xfffu;
        else s->response_valid=false;
        break;
    case 2:
        if (s->card_state==1u) { s->card_state=2; card_cid(r); s->response_index=63; }
        else s->response_valid=false;
        break;
    case 3:
        if (s->card_state==2u || s->card_state==3u) { s->card_state=3; r[0]=(s->card_rca<<16)|0x700u; }
        else s->response_valid=false;
        break;
    case 7:
        if ((arg>>16)==s->card_rca) { s->card_state=4; r[0]=card_status(s); }
        else { data_stop(s,0); s->card_state=3; s->response_valid=false; }
        break;
    case 9: case 10:
        if ((arg>>16)!=s->card_rca) s->response_valid=false;
        else { o_zero(r,16); if (cmd==9u) card_csd(m,r); else card_cid(r); s->response_index=63; }
        break;
    case 12: data_stop(s,0); s->card_state=4; r[0]=card_status(s); break;
    case 13: if ((arg>>16)!=s->card_rca) s->response_valid=false; break;
    case 16: if (arg!=512u) r[0]|=1u<<29; else s->card_block_size=512; break;
    case 17: case 18: case 24: case 25:
        if (s->card_state!=4u) r[0]|=1u<<22;
        else if (arg&511u) r[0]|=1u<<30;
        else if (arg>=m->sd_bytes) r[0]|=1u<<31;
        else if (cmd>=24u && m->sd_write_protected) r[0]|=1u<<26;
        else {
            s->transfer_kind=cmd>=24u?CARD_WRITE:CARD_READ; s->transfer_offset=arg;
            s->transfer_total=s->transfer_left=0;
            s->multi_block=cmd==18u || cmd==25u; s->card_state=cmd>=24u?6u:5u;
        }
        break;
    case 32: case 33:
        if (s->card_state!=4u) r[0]|=1u<<22;
        else if ((arg&511u) || arg>=m->sd_bytes) r[0]|=1u<<30;
        else if (cmd==32u) s->erase_start=arg; else s->erase_end=arg;
        break;
    case 38:
        if (s->card_state!=4u) r[0]|=1u<<22;
        else if (m->sd_write_protected) r[0]|=1u<<26;
        else if (s->erase_start>s->erase_end || s->erase_end>=m->sd_bytes) r[0]|=1u<<28;
        else { o_zero(m->sd_storage+s->erase_start,s->erase_end-s->erase_start+512u); m->sd_dirty=true; }
        break;
    case 55: s->app_command=true; r[0]|=0x20; break;
    default: r[0]|=1u<<22; break;
    }
    if (!(s->command&0x400u)) {
        uint8_t c=crc7_byte(0,(uint8_t)s->response_index);
        for (unsigned i=0;i<4;i++) c=crc7_byte(c,(uint8_t)(r[0]>>(24u-i*8u)));
        r[1]=((uint32_t)c*2u+1u)<<24;
    }
}
static void data_tick(orchard_machine *m) {
    o_sdi *s=&m->soc.sdi;
    if (s->data_event==DATA_TIMEOUT) { data_stop(s,0x20); return; }
    if (s->data_event==DATA_BUSY) { data_stop(s,8); return; }
    if (!m->sd_bytes || !s->transfer_left) { data_stop(s,0x20); return; }
    /* Clocked FIFO flow control: neither MMIO polling nor host calls move
     * data. A full RX/empty TX FIFO waits for the next serial byte opportunity. */
    if ((s->data_event==DATA_READ && s->fifo_count<64u) ||
        (s->data_event==DATA_WRITE && s->fifo_count)) {
        if (s->data_event==DATA_READ) {
            uint8_t value=0;
            if (s->transfer_kind==CARD_READ) value=m->sd_storage[s->transfer_offset];
            else if (s->transfer_kind==CARD_SCR) {
                static const uint8_t scr[8]={2,5,0,0,0,0,0,0}; value=scr[s->transfer_offset];
            } else if (s->transfer_kind==CARD_STATUS && !s->transfer_offset && s->card_bus_width==4u) value=0x80;
            s->fifo[(s->fifo_head+s->fifo_count)&63u]=value; ++s->fifo_count;
        } else {
            s->write_block[s->write_count++]=s->fifo[s->fifo_head];
            s->fifo_head=(s->fifo_head+1u)&63u; --s->fifo_count;
        }
        ++s->transfer_offset; --s->transfer_left;
        if (s->transfer_kind==CARD_WRITE && s->write_count==512u) {
            o_copy(m->sd_storage+s->transfer_offset-512u,s->write_block,512);
            s->write_count=0; ++s->written_blocks; m->sd_dirty=true;
        } else if (s->transfer_kind==CARD_READ && !(s->transfer_offset&511u)) ++s->read_blocks;
        if (!s->transfer_left) {
            s->data_status=(s->data_status&~3u)|0x10u; s->data_event=DATA_NONE;
            s->transfer_kind=CARD_NONE; if (!s->multi_block) s->card_state=4;
            return;
        }
    }
    s->data_remaining=byte_period(s);
}
void o_sdi_tick(orchard_machine *m) {
    o_sdi *s=&m->soc.sdi;
    if (m->soc.clock[3]&0x200u) {
        if (s->remaining && !--s->remaining) {
            if (s->phase==1u) {
                s->status|=0x800u; card_command(m);
                if (s->response_remaining) {
                    s->remaining=(s->response_valid?((s->command&0x400u)?136u:48u):64u)*divisor(s);
                    s->response_remaining=0; s->phase=2;
                }
            } else if (s->response_valid) {
                o_copy(s->response,s->pending_response,sizeof(s->response));
                s->status=(s->status&~255u)|s->response_index|0x200u;
                if ((s->transfer_kind && !s->transfer_total) || ((s->data_control>>12)&3u)==1u) data_start(m);
            } else s->status|=0x400u;
            if (!s->remaining) { s->phase=0; s->status&=~0x100u; s->command&=~0x100u; }
        }
        if (s->data_remaining && !--s->data_remaining) data_tick(m);
    }
    sdi_irq(&m->soc);
}
static bool fifo_access(o_sdi *s, unsigned width, uint32_t *value, bool write) {
    if (width!=1 && width!=4) return false;
    uint32_t out=0;
    for (unsigned i=0;i<width;i++) {
        unsigned shift=8u*((s->control&0x10u)?width-1u-i:i);
        if (write) {
            if (s->fifo_count<64u) {
                s->fifo[(s->fifo_head+s->fifo_count)&63u]=(uint8_t)(*value>>shift); ++s->fifo_count;
            } else s->data_status|=0x100;
        } else if (s->fifo_count) {
            out|=(uint32_t)s->fifo[s->fifo_head]<<shift; s->fifo_head=(s->fifo_head+1u)&63u; --s->fifo_count;
        } else s->data_status|=0x100;
    }
    if (!write) *value=out;
    return true;
}
bool o_sdi_register(orchard_machine *m, uint32_t address, unsigned width,
                    uint32_t *value, bool write) {
    if (address<0x5a000000u || address>0x5a000040u) return false;
    o_sdi *s=&m->soc.sdi;
    if (address==0x5a00003cu) {
        bool ok=fifo_access(s,width,value,write); sdi_irq(&m->soc); return ok;
    }
    if (width!=4 || (address&3u)) return false;
    uint32_t offset=address-0x5a000000u, mask=0, *reg=NULL;
    switch (offset) {
    case 0: reg=&s->control; mask=0x1f; break;
    case 4: reg=&s->prescaler; mask=0xff; break;
    case 8: reg=&s->argument; mask=UINT32_MAX; break;
    case 0xc: reg=&s->command; mask=0x1fff; break;
    case 0x10:
        if (write) s->status&=~(*value&0x1e00u); else *value=s->status;
        sdi_irq(&m->soc); return true;
    case 0x14: case 0x18: case 0x1c: case 0x20:
        if (write) return false;
        *value=s->response[(offset-0x14u)/4u]; return true;
    case 0x24: reg=&s->data_timer; mask=0xffff; break;
    case 0x28: reg=&s->block_size; mask=0xfff; break;
    case 0x2c: reg=&s->data_control; mask=0x3fffff; break;
    case 0x30:
        if (write) return false;
        *value=s->block_size?((s->transfer_left/s->block_size)<<12)|(s->transfer_left%s->block_size):0;
        return true;
    case 0x34:
        if (write) s->data_status&=~(*value&0x7f8u); else *value=s->data_status;
        sdi_irq(&m->soc); return true;
    case 0x38: if (write) return false; *value=fifo_status(s); return true;
    case 0x40: reg=&s->interrupt_mask; mask=0x3ffdf; break;
    default: return false;
    }
    if (!write) { *value=*reg; return true; }
    uint32_t next=*value&mask;
    if ((offset==0xc && (next&0x100u) && s->remaining) ||
        (offset==0x2c && (next&0x8000u) && !(next&0x4000u))) {
        o_stop(m,ORCHARD_UNIMPLEMENTED_MMIO,address,*value); return false;
    }
    *reg=next;
    if (offset==0) {
        if (next&2u) s->fifo_head=s->fifo_count=0;
        s->control&=~2u;
    }
    if (offset==0x2c) {
        if (!(next&0x3000u) || (next&0x4000u)) data_stop(s,0);
        else if (!(next&0x1c0000u) || s->transfer_kind) data_start(m);
    }
    if (offset==0xc && (next&0x100u)) {
        s->status=(s->status&~0x1ffu)|0x100u; s->phase=1;
        s->remaining=48u*divisor(s); s->response_remaining=(next&0x200u)?64u*divisor(s):0;
    }
    sdi_irq(&m->soc); return true;
}
