/* SPDX-License-Identifier: MIT
 * nGCS1 address decoding, independent from allocated SRAM capacity.
 * The mirror mode is an explicit board-wiring hypothesis, not a model default.
 * See docs/development/startup.md for evidence and limitations.
 */
#include "internal.h"

orchard_status orchard_sram_select(orchard_machine *m, orchard_sram_decode decode) {
    if (!m || !m->profile || (unsigned)decode > ORCHARD_SRAM_BANK1_MIRROR)
        return ORCHARD_BAD_ARGUMENT;
    m->sram_decode = decode;
    return ORCHARD_OK;
}
uint64_t orchard_sram_alias_reads(const orchard_machine *m) {
    return m && m->profile ? m->sram_alias_reads : 0;
}
uint64_t orchard_sram_alias_writes(const orchard_machine *m) {
    return m && m->profile ? m->sram_alias_writes : 0;
}
/* The full requested span must lie within this chip-select window. Modulo
   applies to connected chip address pins, never to unrelated physical banks. */
static bool span(const orchard_machine *m, uint32_t address, size_t length, uint32_t *offset) {
    if (!m || !m->profile || address < O_RAM_BASE) return false;
    uint32_t range = m->sram_decode == ORCHARD_SRAM_BANK1_MIRROR
        ? O_RAM_BANK_SIZE : m->profile->ram_bytes;
    uint32_t delta = address - O_RAM_BASE;
    if (delta >= range || length > range - delta) return false;
    *offset = delta & (m->profile->ram_bytes - 1u);
    return true;
}
static bool aliased(const orchard_machine *m, uint32_t address, size_t length) {
    uint32_t delta = address - O_RAM_BASE;
    return delta >= m->profile->ram_bytes || length > m->profile->ram_bytes - delta;
}
bool o_sram_copy(const orchard_machine *m, uint32_t address, void *destination, size_t length) {
    uint32_t offset;
    if ((!destination && length) || !span(m, address, length, &offset)) return false;
    uint8_t *out = destination;
    while (length) {
        size_t chunk = m->profile->ram_bytes - offset;
        if (chunk > length) chunk = length;
        o_copy(out, m->ram + offset, chunk);
        out += chunk; length -= chunk; offset = 0;
    }
    return true;
}
bool o_sram_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
#ifndef ORCHARD_REFERENCE
    uint32_t offset;
    if (!value || (width != 1 && width != 2 && width != 4) ||
        !span(m, address, width, &offset)) return false;
    if (width <= m->profile->ram_bytes - offset) {
        *value = o_read_le(m->ram + offset, width);
    } else {
        /* A mirrored unaligned span may wrap within the physical chip. */
        uint32_t result = 0, mask = m->profile->ram_bytes - 1u;
        for (unsigned i = 0; i < width; ++i)
            result |= (uint32_t)m->ram[(offset + i) & mask] << (8u * i);
        *value = result;
    }
#else
    uint8_t bytes[4];
    if (!value || (width != 1 && width != 2 && width != 4) ||
        !o_sram_copy(m, address, bytes, width)) return false;
    *value = o_read_le(bytes, width);
#endif
    if (aliased(m, address, width)) ++m->sram_alias_reads;
    return true;
}
bool o_sram_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value) {
    uint32_t offset;
    if ((width != 1 && width != 2 && width != 4) || !span(m, address, width, &offset)) return false;
#if !defined(ORCHARD_REFERENCE) && defined(__BYTE_ORDER__) && \
    __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__ && (defined(__GNUC__) || defined(__clang__))
    if (width == 4 && 4u <= m->profile->ram_bytes - offset) {
        /* A complete chip span permits an unaligned-safe word store. */
        __builtin_memcpy(m->ram + offset, &value, 4);
    } else
#endif
    {
        uint32_t mask = m->profile->ram_bytes - 1u;
        for (unsigned i = 0; i < width; ++i) m->ram[(offset + i) & mask] = (uint8_t)(value >> (8u * i));
    }
    if (aliased(m, address, width)) ++m->sram_alias_writes;
    return true;
}
