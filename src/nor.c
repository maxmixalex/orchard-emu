/* SPDX-License-Identifier: MIT
 * Selected x16 SST parts: Microchip DS25028A pp.6-11 and DS20005001B pp.7-11.
 * Array, ID, word program, sector/block/chip erase and VF1601 erase suspend.
 * Typical internal timings use the existing 12 MHz functional timebase;
 * these are not measurements of a particular calculator's flash or clocks.
 * WP# is deasserted in this bounded board model. CFI/security remain explicit.
 */
#include "internal.h"

enum { PROGRAM=1, SECTOR_ERASE=2, BLOCK_ERASE=3, CHIP_ERASE=4 };
enum { UNLOCK1=1, UNLOCK2=2, PROGRAM_DATA=3, ERASE_UNLOCK1=4,
       ERASE_UNLOCK2=5, ERASE_COMMAND=6 };

void o_nor_reset(orchard_machine *m) {
    m->nor_sequence=0; m->nor_id_mode=false; o_zero(&m->nor,sizeof m->nor);
}
orchard_status orchard_nor_select(orchard_machine *m, orchard_nor_device device) {
    if (!m || !m->profile || (unsigned)device > ORCHARD_NOR_SST39VF800A ||
        (device == ORCHARD_NOR_SST39VF1601 && m->profile->flash_bytes != 0x200000) ||
        (device == ORCHARD_NOR_SST39VF800A && m->profile->flash_bytes != 0x100000))
        return ORCHARD_BAD_ARGUMENT;
    m->nor_device=device; o_nor_reset(m); return ORCHARD_OK;
}
static void begin(orchard_machine *m, unsigned kind, uint32_t address, uint32_t data) {
    o_nor *n=&m->nor;
    n->kind=kind; n->data=data&65535u; n->toggle=0; n->suspend_wait=0;
    if(kind==PROGRAM) {
        n->address=address; n->length=2;
        n->remaining=m->nor_device==ORCHARD_NOR_SST39VF800A?168u:84u;
    } else {
        n->length=kind==SECTOR_ERASE?4096u:kind==BLOCK_ERASE?65536u:m->profile->flash_bytes;
        n->address=address&~(n->length-1u);
        n->remaining=kind==CHIP_ERASE?(m->nor_device==ORCHARD_NOR_SST39VF800A?840000u:480000u):216000u;
    }
    m->nor_sequence=0; m->nor_id_mode=false;
    o_zero(m->translations,sizeof m->translations);
}
void o_nor_tick(orchard_machine *m) {
    o_nor *n=&m->nor;
    if(!n->remaining)return;
    if(!--n->remaining) {
        if(n->kind==PROGRAM) {
            m->flash[n->address]&=(uint8_t)n->data;
            m->flash[n->address+1]&=(uint8_t)(n->data>>8);
        } else for(uint32_t i=0;i<n->length;i++)m->flash[n->address+i]=255;
        n->kind=n->address=n->length=n->data=n->suspend_wait=0;
        o_zero(m->translations,sizeof m->translations);
    } else if(n->suspend_wait && !--n->suspend_wait) {
        n->erase_remaining=n->remaining; n->erase_address=n->address; n->erase_length=n->length;
        n->kind=n->remaining=n->address=n->length=n->data=0;
    }
}
static bool suspended_address(const o_nor *n,uint32_t address) {
    return n->erase_remaining && address>=n->erase_address && address-n->erase_address<n->erase_length;
}
bool o_nor_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value) {
    /* An aligned ARM word store is two x16 bus writes, not one command. */
    if(width==4 && !(address&3u) && m->nor_device!=ORCHARD_NOR_UNSPECIFIED)
        return o_nor_write(m,address,2,value&65535u) && o_nor_write(m,address+2,2,value>>16);
    if(width!=2 || (address&1u))goto unsupported;
    unsigned byte=value&255u;
    o_nor *n=&m->nor;
    if(n->remaining) {
        /* Writes ignore commands except the documented sector/block suspend. */
        if(byte==0xb0 && m->nor_device==ORCHARD_NOR_SST39VF1601 &&
           (n->kind==SECTOR_ERASE || n->kind==BLOCK_ERASE) && !n->suspend_wait)
            n->suspend_wait=240;
        return true;
    }
    /* The fourth cycle is data even when its low byte happens to be F0. */
    if(m->nor_sequence==PROGRAM_DATA) {
        m->nor_sequence=0;
        if(!suspended_address(n,address))begin(m,PROGRAM,address,value);
        return true;
    }
    if(byte==0xf0) {m->nor_sequence=0;m->nor_id_mode=false;return true;}
    if(m->nor_device==ORCHARD_NOR_UNSPECIFIED)goto unsupported;
    if(n->erase_remaining && !m->nor_sequence && byte==0x30) {
        n->kind=n->erase_length==4096?SECTOR_ERASE:BLOCK_ERASE;
        n->remaining=n->erase_remaining;n->address=n->erase_address;n->length=n->erase_length;
        n->erase_remaining=n->erase_address=n->erase_length=0;n->data=0;n->toggle=0;
        return true;
    }
    uint32_t ca=(address>>1)&0x7fffu;
    if(m->nor_sequence==0 && ca==0x5555 && byte==0xaa) {m->nor_sequence=UNLOCK1;return true;}
    if(m->nor_sequence==UNLOCK1 && ca==0x2aaa && byte==0x55) {m->nor_sequence=UNLOCK2;return true;}
    if(m->nor_sequence==UNLOCK2 && ca==0x5555) {
        if(byte==0x90 && !n->erase_remaining) {m->nor_sequence=0;m->nor_id_mode=true;return true;}
        if(byte==0xa0) {m->nor_sequence=PROGRAM_DATA;m->nor_id_mode=false;return true;}
        if(byte==0x80 && !n->erase_remaining) {m->nor_sequence=ERASE_UNLOCK1;m->nor_id_mode=false;return true;}
        if(byte==0x98 || byte==0x88 || byte==0xa5 || byte==0x85)goto unsupported;
    }
    if(m->nor_sequence==ERASE_UNLOCK1 && ca==0x5555 && byte==0xaa) {m->nor_sequence=ERASE_UNLOCK2;return true;}
    if(m->nor_sequence==ERASE_UNLOCK2 && ca==0x2aaa && byte==0x55) {m->nor_sequence=ERASE_COMMAND;return true;}
    if(m->nor_sequence==ERASE_COMMAND) {
        if(byte==0x30) {begin(m,SECTOR_ERASE,address,0);return true;}
        if(byte==0x50) {begin(m,BLOCK_ERASE,address,0);return true;}
        if(byte==0x10 && ca==0x5555) {begin(m,CHIP_ERASE,0,0);return true;}
    }
    m->nor_sequence=0;m->nor_id_mode=false;return true;
unsupported:
    o_stop(m,ORCHARD_UNIMPLEMENTED_FLASH,address,value);return false;
}
bool o_nor_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    o_nor *n=&m->nor;
    if(n->remaining || n->erase_remaining) {
        if(width==4) {
            uint32_t lo,hi;
            if(!o_nor_read(m,address,2,&lo)||!o_nor_read(m,address+2,2,&hi))return false;
            *value=lo|(hi<<16);return true;
        }
        uint32_t status=0;
        if(suspended_address(n,address)) {n->toggle^=4u;status=0x40u|(n->toggle&4u);}
        else if(n->remaining) {
            n->toggle^=0x40u;status=n->toggle&0x40u;
            if(n->kind==PROGRAM)status|=(~n->data)&0x80u;
            else if(m->nor_device==ORCHARD_NOR_SST39VF1601 && address>=n->address && address-n->address<n->length) {
                n->toggle^=4u;status|=n->toggle&4u;
            }
        } else {*value=o_read_le(m->flash+address,width);return true;}
        *value=width==1 && (address&1u)?0:status;return true;
    }
    if(m->nor_id_mode) {
        if(address>=4 || width>4u-address) {o_stop(m,ORCHARD_UNIMPLEMENTED_FLASH,address,width);return false;}
        uint32_t id=m->nor_device==ORCHARD_NOR_SST39VF800A?UINT32_C(0x278100bf):UINT32_C(0x234b00bf);
        *value=id>>(8u*address);if(width<4)*value&=(1u<<(width*8u))-1u;return true;
    }
    *value=o_read_le(m->flash+address,width);return true;
}
