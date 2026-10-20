/* SPDX-License-Identifier: MIT */
#include "internal.h"

/* Preserve the complete device dispatch for uncommon reads and reference
 * builds. Keeping it out of the small array-read path lets WASM specialize
 * instruction fetches and loads without inlining MMIO/device dispatch.
 * Native builds retain the original function and its call boundaries. */
#if defined(__wasm__) && !defined(ORCHARD_REFERENCE)
#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
static bool phys_read_slow(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value)
#else
bool o_phys_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value)
#endif
{
    if (!value || (width != 1 && width != 2 && width != 4)) return false;
    if (address < m->profile->flash_bytes && width <= m->profile->flash_bytes - address) {
        return o_nor_read(m, address, width, value);
    }
    if (o_sram_read(m, address, width, value)) return true;
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE < O_BOOT_SRAM_SIZE &&
        width <= O_BOOT_SRAM_SIZE - (address - O_BOOT_SRAM_BASE)) {
        *value = o_read_le(m->boot_sram + (address - O_BOOT_SRAM_BASE), width);
        return true;
    }
    if (address >= 0x48000000u && address < 0x60000000u)
        return o_mmio_read(m, address, width, value);
    return false;
}
bool o_phys_write(orchard_machine *m, uint32_t address, unsigned width, uint32_t value) {
    if (width != 1 && width != 2 && width != 4) return false;
    if (address < m->profile->flash_bytes && width <= m->profile->flash_bytes - address) {
        return o_nor_write(m, address, width, value);
    }
    if (o_sram_write(m, address, width, value)) return true;
    if (address >= O_BOOT_SRAM_BASE && address - O_BOOT_SRAM_BASE < O_BOOT_SRAM_SIZE &&
        width <= O_BOOT_SRAM_SIZE - (address - O_BOOT_SRAM_BASE)) {
        for (unsigned i = 0; i < width; ++i)
            m->boot_sram[address - O_BOOT_SRAM_BASE + i] = (uint8_t)(value >> (i * 8u));
        return true;
    }
    if (address >= 0x48000000u && address < 0x60000000u)
        return o_mmio_write(m, address, width, value);
    return false;
}
#if defined(__wasm__) && !defined(ORCHARD_REFERENCE)
/* Every read still fetches the current bytes. Only a complete, non-aliased
 * span in normal NOR array mode or physical SRAM takes this path; NOR ID,
 * mirrored/wrapping SRAM, boot SRAM, MMIO and faults keep the original path.
 * Ordinary memory does not materialize deferred peripheral phases. */
#if defined(__GNUC__) || defined(__clang__)
__attribute__((always_inline))
#endif
bool o_phys_read(orchard_machine *m, uint32_t address, unsigned width, uint32_t *value) {
    if (!value || (width != 1 && width != 2 && width != 4)) return false;
    if (address < m->profile->flash_bytes && width <= m->profile->flash_bytes - address && !m->nor_id_mode) {
        *value = o_read_le(m->flash + address, width);
        return true;
    }
    uint32_t delta = address - O_RAM_BASE;
    if (delta < m->profile->ram_bytes && width <= m->profile->ram_bytes - delta) {
        *value = o_read_le(m->ram + delta, width);
        return true;
    }
    return phys_read_slow(m, address, width, value);
}
#endif
