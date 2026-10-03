/* SPDX-License-Identifier: MIT
 * Read/Software-ID subsets: SST39VF1601 (S71223-05-000 Tables 3/6)
 * and SST39VF800A (Microchip DS20005001B pp. 9-11).
 * Selection is explicit: file size is not evidence of the installed chip.
 * Program/erase/CFI/security operations are diagnostic stops, never success.
 */
#include "internal.h"
orchard_status orchard_nor_select(orchard_machine *m, orchard_nor_device device) {
    if (!m || !m->profile || (unsigned)device > ORCHARD_NOR_SST39VF800A ||
        (device == ORCHARD_NOR_SST39VF1601 && m->profile->flash_bytes != 0x200000) ||
        (device == ORCHARD_NOR_SST39VF800A && m->profile->flash_bytes != 0x100000))
        return ORCHARD_BAD_ARGUMENT;
    m->nor_device = device;
    m->nor_sequence = 0;
    m->nor_id_mode = false;
    return ORCHARD_OK;
}
bool o_nor_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value) {
    /* The explicitly selected x16 part receives two little-endian halfword
       cycles for an aligned CPU word store (S3C2410A, Fig. 5-7). Both go
       through SDP decoding; this is not a generic ROM-write discard. A stop
       on either cycle preserves preceding command effects, as two bus cycles
       would. Physical range validation belongs to o_phys_write(). */
    if (width == 4 && !(address & 3u) && (m->nor_device == ORCHARD_NOR_SST39VF1601 || m->nor_device == ORCHARD_NOR_SST39VF800A)) {
        return o_nor_write(m, address, 2, value & 0xffffu) &&
               o_nor_write(m, address + 2, 2, value >> 16);
    }
    if (width != 2 || (address & 1u)) goto unsupported;
    unsigned byte = value & 255u;
    if (byte == 0xf0) {
        m->nor_sequence = 0; m->nor_id_mode = false;
        return true;
    }
    if (m->nor_device == ORCHARD_NOR_UNSPECIFIED) goto unsupported;
    uint32_t command_address = (address >> 1) & 0x7fffu;
    if (m->nor_sequence == 0 && command_address == 0x5555 && byte == 0xaa) {
        m->nor_sequence = 1; return true;
    }
    if (m->nor_sequence == 1 && command_address == 0x2aaa && byte == 0x55) {
        m->nor_sequence = 2; return true;
    }
    if (m->nor_sequence == 2 && command_address == 0x5555) {
        if (byte == 0x90) {
            m->nor_sequence = 0; m->nor_id_mode = true; return true;
        }
        /* Recognized but unimplemented commands must remain visible. */
        if (byte == 0xa0 || byte == 0x80 || byte == 0x98 || byte == 0x88 ||
            byte == 0xa5 || byte == 0x85) goto unsupported;
    }
    /* Invalid SDP sequence returns to array-read mode per the data sheet. */
    m->nor_sequence = 0; m->nor_id_mode = false;
    return true;
unsupported:
    o_stop(m, ORCHARD_UNIMPLEMENTED_FLASH, address, value);
    return false;
}
bool o_nor_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    if (m->nor_id_mode) {
        if (address >= 4 || width > 4u - address) {
            o_stop(m, ORCHARD_UNIMPLEMENTED_FLASH, address, width); return false;
        }
        uint32_t id = m->nor_device == ORCHARD_NOR_SST39VF800A ? UINT32_C(0x278100bf) : UINT32_C(0x234b00bf);
        *value = id >> (8u * address);
        if (width < 4) *value &= (1u << (width * 8u)) - 1u;
        return true;
    }
    *value = 0;
    for (unsigned i = 0; i < width; ++i) *value |= (uint32_t)m->flash[address + i] << (8u * i);
    return true;
}
